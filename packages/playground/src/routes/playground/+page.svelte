<!--
  The reference split-pane shell, and the page the site is named for. One
  consumer-owned LiveSession drives both surfaces over one seeded document:
    • <VisualEditor> (left): the edit surface; commits land on `doc`.
    • <Preview>      (right): a pure view of the session; never mutates it.

  It wires the glue the primitives push outward (ARCHITECTURE §Playground), all
  through the public API; no reach-through:

    edit ─► (debounced) session.update(doc) ─► preview.refresh(change)
                                            └► diagnostics = session.warnings
    preview click ─► onPick(at) ─► editor.setCaret(at)          (preview→editor)
                                      └► shown = 1                (reveal, narrow)
    editor caret  ─► onCaretMove(at)  ─► preview.focusPosition(at) (editor→preview)
    editor focus  ─► onActiveLeafChange ─► preview.endFollow()     (editor→preview)

  The bridge is consumer-layer and one-way-independent: the editor is unaware of
  the preview (it only emits addresses + carets), the preview is unaware of the
  editor (it only surfaces hits). This route is the seam that joins them.

  Recompile is fed by `onChange` alone, which covers all three lanes: a prose
  commit, a scalar/array write, a card operation. A structure op applies at once
  (one per gesture, and the stack moved); prose and field edits debounce, since
  they arrive per keystroke. `onCaretMove` drives the preview's caret and nothing
  else: it fires on a bare arrow key, so a recompile hung off it would recompile
  on every one.

  A document the engine refuses reaches no session, and the editor needs none: the shell
  stands on `doc` and `quill`, the band says what refused, and the preview track waits.
  The card the refusal named draws in its recovery shell, and the edit that retypes or
  removes it tries the open again.

  Under the preset's threshold the split shows one track and the switch band says
  which, so the bridge's preview→editor hop reveals the editor as well as placing
  the caret in it: a hit that lands in a hidden pane lands nowhere a reader can see.
  Both panes stay mounted either way: the switch is CSS over a state, never an
  `{#if}` that would take the editor's history with it.

  The strip above the panes reads the bridge's outcomes back out (last-hit,
  active-addr, last-focus, last-change, the change lane, and the last recovered
  error), so a round-trip that lands nowhere shows there, as does a failure the
  surfaces recovered from. `inject-diagnostics` stands in for a live
  render-error feed: a real consumer derives external diagnostics from
  `session.warnings` (wired here, `[]` for the reference quill) plus render errors.

  Beside them is the one lane the canvas paint does not run: `session.render` writes
  the document out as a file, and the strip says what it cost or what refused it.

  Which quill is a control, since the answer changes what both surfaces are: picking
  tears the shell down and stands it back up. The seed variants are query flags with
  no chrome, read once per open, for the branches a quill on disk reaches none of
  (PLAYGROUND §"Which quill, and what is seeded into it").
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type {
		Engine,
		Quill,
		Document,
		LiveSession,
		ChangeSet,
		Diagnostic,
		OutputFormat
	} from '@quillmark/wasm';
	import type { Landing, Place, EditorError } from '@quillmark/svelte/core';
	import type { ActiveLeaf, EditorChange } from '@quillmark/svelte/visual';
	import { Preview } from '@quillmark/svelte/preview';
	import { DEFAULT_FIXTURE, fixtureNames, loadFixtureTree } from '../fixture';

	type Status = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready' };
	type VisualEditorComponent = typeof import('@quillmark/svelte/visual').VisualEditor;

	let status = $state<Status>({ phase: 'loading' });
	let VisualEditor = $state<VisualEditorComponent | undefined>();

	// Which quill the shell is over, and every one the served quiver holds — the pack's
	// call rather than this route's.
	let fixtures = $state<string[]>([]);
	let fixture = $state(DEFAULT_FIXTURE);
	// Inert while an open is in flight: a second pick mid-open would race it.
	let opening = $state(true);

	let session: LiveSession | undefined = $state();
	let quillHandle: Quill | undefined = $state();
	let docHandle: Document | undefined = $state();
	// Held so the recovery loop can try the open again; the surfaces never read it.
	let engineHandle: Engine | undefined;
	// What the engine refused the document with, and why there is no session to paint from.
	let refused = $state<string | undefined>();

	// Surface handles for the imperative bridge hops.
	let editorRef: { setCaret(at: Landing): Promise<void> } | undefined = $state();
	let previewRef: ReturnType<typeof Preview> | undefined = $state();

	// Which of the split's two tracks is showing. It is read only under the preset's
	// threshold, where one shows at a time; above it the attribute is inert and the
	// switch band is not drawn, so the route holds one number at every width rather
	// than a viewport in JS beside the one the stylesheet already has.
	let shown = $state<1 | 2>(1);

	// External diagnostics fed to the editor = live `session.warnings` + any
	// injected render-error stand-ins (recomputed on every recompile).
	let injected = $state<Diagnostic[]>([]);
	let externalDiagnostics = $state<Diagnostic[]>([]);
	function syncDiagnostics(): void {
		externalDiagnostics = session ? [...session.warnings, ...injected] : injected;
	}

	// What this quill's backend emits, probed once per open off its descriptor: the
	// download is drawn only where a document leaves as one file (`pdf`; the raster
	// formats emit one artifact per page).
	let formats = $state<OutputFormat[]>([]);

	// Bridge observability: what the strip reads.
	let lastHit = $state<Landing | undefined>();
	let activeAddr = $state('none');
	let lastFocus = $state('none');
	let lastChange = $state<ChangeSet | undefined>();
	let lastChangeSource = $state('none');
	let lastError = $state('none');
	let lastEmit = $state('none');

	// Every readout above names something in the document that is going, and the
	// injected stand-in names a field the next quill need not have.
	function resetBridge(): void {
		lastHit = undefined;
		activeAddr = 'none';
		lastFocus = 'none';
		lastChange = undefined;
		lastChangeSource = 'none';
		lastError = 'none';
		lastEmit = 'none';
		injected = [];
		syncDiagnostics();
	}

	// The handles the open in force made, newest first.
	let toFree: Array<{ free(): void }> = [];
	// Which open is in force. One that lands after a later one started frees what it
	// made and assigns nothing, so a pick during a pick leaves no session behind.
	let generation = 0;

	// ── Debounced recompile ─────────────────────────────────────────────────────
	// One session, many edit sources → one apply per settled burst. The timer is
	// cleared on unmount so a pending recompile never touches a freed session.
	let recompileTimer: ReturnType<typeof setTimeout> | undefined;
	function scheduleRecompile(): void {
		if (recompileTimer != null) clearTimeout(recompileTimer);
		recompileTimer = setTimeout(() => void recompileNow(), 120);
	}
	async function recompileNow(): Promise<void> {
		recompileTimer = undefined;
		if (!docHandle) return;
		if (!session) return reopen();
		try {
			const change = session.update(docHandle);
			lastChange = change;
			previewRef?.refresh(change);
			syncDiagnostics();
		} catch (e) {
			// A failed recompile keeps the last-good preview (the session is
			// transactional); surface it without crashing the shell.
			console.error('[playground] recompile failed', e);
		}
	}

	// A refused open is tried again by the edit that answers it; the session it lands joins
	// the handles this open owns.
	async function reopen(): Promise<void> {
		if (!engineHandle || !quillHandle || !docHandle) return;
		const mine = generation;
		let opened: LiveSession;
		try {
			opened = await engineHandle.open(quillHandle, docHandle);
		} catch (e) {
			refused = e instanceof Error ? e.message : String(e);
			return;
		}
		if (mine !== generation) return opened.free();
		toFree.unshift(opened);
		session = opened;
		refused = undefined;
		syncDiagnostics();
	}

	// ── Bridge: preview → editor ────────────────────────────────────────────────
	// The caret and the reveal together: under the threshold the editor is the track
	// that is not showing, and a caret placed in it is a round-trip the reader cannot
	// see land. Above it the write is a no-op the stylesheet ignores.
	//
	// The reveal needs no flush of its own, which is what makes the tab hop ordinary:
	// `setCaret` already waits one out before it lands (a collapsed group is `inert` and
	// swallows a focus, the same way a hidden track would), and the track's `display`
	// moves in that same flush.
	function handlePick(at: Landing): void {
		lastHit = at;
		shown = 1;
		editorRef?.setCaret(at);
	}

	// ── Bridge: editor → preview ────────────────────────────────────────────────
	// The arrival half of the bridge: a form control reports its focus and no caret, so
	// this is what ends the follow; a prose leaf restarts it with its next caret.
	function handleActiveLeaf(active: ActiveLeaf): void {
		previewRef?.endFollow();
		activeAddr = JSON.stringify(active);
	}
	// The editor already speaks the preview's address grammar, so this hop is a
	// pass-through; the strip readout is the only reason it is a function at all.
	function handleCaretMove(at: Place): void {
		previewRef?.focusPosition(at);
		lastFocus = JSON.stringify(at);
	}
	// Every edit, whichever lane it came down. A structure op recompiles at once:
	// it happens once per gesture, and a card that appears after a delay reads as
	// lag.
	function handleChange(change: EditorChange): void {
		lastChangeSource = change.source;
		if (change.source === 'structure') void recompileNow();
		else scheduleRecompile();
	}
	function handleError(err: EditorError): void {
		lastError = `${err.code}: ${err.message}`;
	}

	// The render lane, which the preview's canvas paint does not run: a page that paints
	// can still fail to emit, and the PDF spine is where that shows. Synchronous over the
	// compiled snapshot — no second compile — so the file is the page beside it.
	//
	// The outcome is read back out on the strip like every other hop, since a harness that
	// hands over a file and says nothing about it is one instrument short.
	function download(): void {
		if (!session) return;
		try {
			// Clocked here rather than read off the result: the emit is a synchronous call
			// on a session this turn owns, so the wall time around it is the render's.
			const started = performance.now();
			const result = session.render({ format: 'pdf' });
			const elapsedMs = performance.now() - started;
			const artifact = result.artifacts[0];
			if (!artifact) throw new Error(`${quillHandle?.backendId ?? 'the backend'} emitted no PDF`);
			// The bytes cross as `Uint8Array<ArrayBufferLike>`, where `BlobPart` takes an
			// `ArrayBuffer`-backed view alone; the engine's memory is one.
			const url = URL.createObjectURL(
				new Blob([artifact.bytes as BlobPart], { type: artifact.mimeType })
			);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${fixture}.pdf`;
			// Revoked on the same turn: `click` dispatches synchronously, and the browser
			// has taken the URL by the time it returns.
			a.click();
			URL.revokeObjectURL(url);
			lastEmit = `${artifact.bytes.length} B in ${Math.round(elapsedMs)} ms`;
		} catch (e) {
			lastEmit = `failed: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	// A toggle, not a trip: the stand-in is re-appended on every recompile, so a one-way
	// press would pin it to `main.title` for the life of the open.
	function toggleDiagnostics(): void {
		injected = injected.length
			? []
			: [
					{
						severity: 'error',
						message: 'External test error on title',
						path: 'main.title'
					}
				];
		syncDiagnostics();
	}

	/**
	 * Tear the shell down and stand it back up over `name`, so one session is live at a
	 * time.
	 *
	 * The surfaces come down before their handles do: the ready phase is what mounts
	 * them, so a loading phase and a flush is the teardown. The handles go before the
	 * next open allocates.
	 */
	async function open(name: string): Promise<void> {
		const mine = ++generation;
		opening = true;
		status = { phase: 'loading' };
		if (recompileTimer != null) {
			clearTimeout(recompileTimer);
			recompileTimer = undefined;
		}
		session = undefined;
		quillHandle = undefined;
		docHandle = undefined;
		engineHandle = undefined;
		refused = undefined;
		editorRef = undefined;
		previewRef = undefined;
		resetBridge();
		await tick();
		for (const h of toFree) h.free();
		toFree = [];

		// Handles created so far, newest first; freed in reverse creation order on a
		// stale open and on a mid-chain failure (`engine.open` throwing after
		// `quill`/`doc` already exist).
		const created: Array<{ free(): void }> = [];
		try {
			// Dynamic: the WASM binary and VisualEditor's ProseMirror stack are the
			// route's heaviest payload and nothing before paint needs them, so they load
			// after mount. `init` instantiates the core and resolves to `Quill`, which the
			// artifact exports nowhere statically. The fixture load awaits the same
			// memoized gate to materialize its quill.
			const [{ Engine, MAIN_CARD_ADDR }, { init }, visual] = await Promise.all([
				import('@quillmark/wasm'),
				import('@quillmark/svelte/core'),
				import('@quillmark/svelte/visual')
			]);
			const { Quill } = await init();
			fixtures = await fixtureNames();
			const params = new URLSearchParams(window.location.search);
			const quill = Quill.fromTree(await loadFixtureTree(name));
			created.unshift(quill);
			const doc = quill.seedDocument();
			created.unshift(doc);
			// The seed variants. `?foreign` holds a card whose kind the schema cannot
			// project: `Document.insertCard` is schema-agnostic where the Quill-bound
			// writer would reject it, and the engine refuses the document holding it, so the
			// seed reaches both the recovery shell and the sessionless shell it draws in.
			// `?tips` seeds the guidance channel a quill or consumer supplies
			// (`$ext`, not schema), through `patchEditorExt`, so a consumer seeding one key
			// does not replace the map.
			if (params.has('foreign')) {
				doc.insertCard({ kind: 'legacy_kind', body: 'Trapped legacy body.' });
			}
			if (params.has('tips')) {
				visual.patchEditorExt(doc, MAIN_CARD_ADDR, {
					tips: [
						'Press **Tab** to move on.',
						'Run `npm run dev` for the playground.',
						'Last one — dismissing clears the channel.'
					]
				});
			}
			const engine = new Engine();
			// Always free: it answers off the backend descriptor without loading the binary
			// or cloning the quill.
			const emits = await engine.supportedFormats(quill);
			// A refusal is a state of the document, not the end of the open: the editor binds
			// `doc` and `quill` alone, so the shell stands without a session.
			let openedSession: LiveSession | undefined;
			let refusal: string | undefined;
			try {
				openedSession = await engine.open(quill, doc);
				created.unshift(openedSession);
			} catch (e) {
				refusal = e instanceof Error ? e.message : String(e);
			}
			if (mine !== generation) {
				for (const h of created) h.free();
				return;
			}
			VisualEditor = visual.VisualEditor;
			formats = emits;
			engineHandle = engine;
			session = openedSession;
			refused = refusal;
			quillHandle = quill;
			docHandle = doc;
			syncDiagnostics();
			toFree = created;
			status = { phase: 'ready' };
		} catch (e) {
			for (const h of created) h.free();
			if (mine === generation)
				status = { phase: 'error', message: e instanceof Error ? e.message : String(e) };
		} finally {
			if (mine === generation) opening = false;
		}
	}

	function pick(name: string): void {
		fixture = name;
		void open(name);
	}

	onMount(() => {
		void open(fixture);
		return () => {
			// Bumped rather than flagged: it is the same guard an open in flight already
			// reads, so an unmount mid-open frees what that open made and lands nothing.
			generation++;
			if (recompileTimer != null) clearTimeout(recompileTimer);
			for (const h of toFree) h.free();
			toFree = [];
			session = undefined;
			quillHandle = undefined;
			docHandle = undefined;
			engineHandle = undefined;
		};
	});
</script>

<svelte:head><title>Playground · quillmark</title></svelte:head>

<main class="pg-width page">
	<!-- The boundary's phase, and only while it is one: the route carries no title,
	     since the running head names it and marks it current, and an open session says
	     the rest by painting the page. So the band is gone at rest and the panes have
	     the room (PLAYGROUND §"The routes"). -->
	{#if status.phase === 'loading'}
		<p data-testid="status" class="qm-status phase">Opening…</p>
	{:else if status.phase === 'error'}
		<p data-testid="status" class="qm-status qm-status-error phase">Error: {status.message}</p>
	{:else if refused}
		<!-- The paint is what is missing, not the route, so the band names what the engine
		     would not take. -->
		<p data-testid="refused" class="qm-status qm-status-error phase">Refused: {refused}</p>
	{/if}

	<!-- The bridge, read back out: each hop's last outcome, so a round-trip that lands
	     nowhere shows here. A row of labelled readouts and no plate: the label and
	     readout runs already say this is chrome, and a plate spends a fill, a hairline
	     and two rungs of the panes' height saying it again.

	     Drawn from the moment the catalog is known rather than with the panes: the picker
	     at its end is what opens them, and a control that goes while what it asked for
	     loads is one a hand cannot get back to. -->
	{#if fixtures.length > 0}
		<div class="strip">
			<span class="stat"
				><span class="qm-label">active</span>
				<span class="qm-readout" data-testid="active-addr">{activeAddr}</span></span
			>
			<span class="stat"
				><span class="qm-label">hit</span>
				<span class="qm-readout" data-testid="last-hit"
					>{lastHit ? JSON.stringify({ field: lastHit.field, pos: lastHit.pos }) : 'none'}</span
				></span
			>
			<span class="stat"
				><span class="qm-label">focus→preview</span>
				<span class="qm-readout" data-testid="last-focus">{lastFocus}</span></span
			>
			<span class="stat"
				><span class="qm-label">dirty pages</span>
				<span class="qm-readout" data-testid="last-change"
					>{lastChange ? JSON.stringify(lastChange.dirtyPages) : 'none'}</span
				></span
			>
			<span class="stat"
				><span class="qm-label">lane</span>
				<span class="qm-readout" data-testid="last-change-source">{lastChangeSource}</span></span
			>
			<span class="stat"
				><span class="qm-label">emit</span>
				<span class="qm-readout" class:alert={lastEmit.startsWith('failed')} data-testid="last-emit"
					>{lastEmit}</span
				></span
			>
			<span class="stat"
				><span class="qm-label">error</span>
				<!-- The one reading on the strip that is a failure rather than a fact, so it
				     is the one that takes colour when it holds one. -->
				<span class="qm-readout" class:alert={lastError !== 'none'} data-testid="last-error"
					>{lastError}</span
				></span
			>
			<span class="strip-actions">
				<!-- An axis holding one value is not a choice, so it is printed rather than
				     offered. Native where there is something to pick: a control the
				     platform draws is the one that competes least with the surfaces
				     under it. -->
				{#if fixtures.length > 1}
					<label class="pick">
						<span class="qm-label">quill</span>
						<select
							class="qm-control"
							data-testid="pick-quill"
							disabled={opening}
							value={fixture}
							onchange={(e) => pick(e.currentTarget.value)}
						>
							{#each fixtures as name (name)}
								<option value={name}>{name}</option>
							{/each}
						</select>
					</label>
				{:else}
					<span class="pick">
						<span class="qm-label">quill</span>
						<span class="qm-readout" data-testid="pick-quill">{fixture}</span>
					</span>
				{/if}
				<!-- The document out as the file a reader keeps. Drawn where the backend writes
				     one, so a quill whose backend emits no PDF stands no control that cannot
				     be pressed. -->
				{#if formats.includes('pdf')}
					<button
						class="qm-control"
						type="button"
						data-testid="download-doc"
						disabled={opening || !session}
						onclick={download}>Download PDF</button
					>
				{/if}
				<button
					class="qm-control"
					type="button"
					data-testid="inject-diagnostics"
					disabled={opening}
					aria-pressed={injected.length > 0}
					onclick={toggleDiagnostics}
					>{injected.length ? 'Clear diagnostics' : 'Inject diagnostics'}</button
				>
			</span>
		</div>
	{/if}

	{#if status.phase === 'ready'}
		<!-- Drawn only under the preset's threshold, where the split shows one track.
		     The pair reads as one choice, so the pressed state is the whole of what
		     says which: `.qm-control` already carries it. -->
		<div class="qm-switch" role="group" aria-label="Visible pane">
			<button
				class="qm-control"
				type="button"
				data-testid="show-editor"
				aria-pressed={shown === 1}
				onclick={() => (shown = 1)}>Editor</button
			>
			<button
				class="qm-control"
				type="button"
				data-testid="show-preview"
				aria-pressed={shown === 2}
				onclick={() => (shown = 2)}>Preview</button
			>
		</div>

		<div class="qm-split shell" data-qm-show={shown}>
			<section class="qm-frame" aria-label="Visual editor">
				{#if VisualEditor && docHandle && quillHandle}
					<VisualEditor
						class="qm-pane"
						bind:this={editorRef}
						doc={docHandle}
						quill={quillHandle}
						onActiveLeafChange={handleActiveLeaf}
						onCaretMove={handleCaretMove}
						onChange={handleChange}
						onError={handleError}
						diagnostics={externalDiagnostics}
					/>
				{/if}
			</section>
			<section class="qm-frame" aria-label="Live preview">
				{#if session}
					<Preview bind:this={previewRef} {session} onPick={handlePick} />
				{/if}
			</section>
		</div>
	{/if}
</main>

<style>
	/* The page takes what the shell hands it and never scrolls itself, at every width:
	   the panes below own their overflow, so the surfaces stay put while their contents
	   move, and under the threshold the one showing takes the room the two had. */
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--qmh-space-4);
		min-height: 0;
		/* The block gutter is the rung the bands are separated by: what stands between
		   the head's rule and the strip is what stands between the strip and the panes. */
		padding-block: var(--qmh-space-4);
	}

	/* A `<p>` in the column, so it takes the page's gap and nothing else; and it is here
	   only while the boundary is not open, so at rest the panes start under the head. */
	.phase {
		margin: 0;
	}

	.strip {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--qmh-space-2) var(--pg-space-6);
	}

	.stat {
		display: flex;
		align-items: baseline;
		gap: var(--qmh-space-2);
		min-width: 0;
	}

	.stat .qm-readout {
		color: var(--qmh-ink-meta);
	}

	.stat .qm-readout.alert {
		color: var(--qmh-alert);
	}

	.strip-actions {
		display: flex;
		align-items: center;
		gap: var(--qmh-space-3);
		margin-inline-start: auto;
	}

	/* The one pair on the strip whose value is a control rather than a readout, so the
	   label sits on its centre and not on the readouts' baseline. */
	.pick {
		display: flex;
		align-items: center;
		gap: var(--qmh-space);
	}

	/* The split's tracks, its gap, its frames and the width it shows one track at are
	   `.qm-split`'s and `.qm-frame`'s (THEMING §"The shell"). What is left here is the
	   split's pull on the height under the head and the strip, which is all of it. */
	.shell {
		flex: 1 1 0;
	}
</style>
