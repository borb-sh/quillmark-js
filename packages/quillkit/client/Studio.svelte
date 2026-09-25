<!--
  Studio, whole: a quiver's quills worked live. Pick a quill, edit, watch it paint,
  read what it will not do.

  One consumer-owned `LiveSession` over one document, under two surfaces:
    • <VisualEditor> (left): the edit surface; commits land on `open.doc`.
    • <Preview>     (right): a pure view of the session; never mutates it.

  The bridge is studio's own: consumer-layer by design, and rewritten here rather than
  shared with the playground, whose chrome shows its instruments where studio's hides
  them.

    edit ─► (debounced) session.update(doc) ─► preview.refresh(change)
                                            └► diagnostics = every producer, merged,
    preview click ─► onPick(at) ─► editor.setCaret(at)
                                      └► shown = 1   (reveal, under the threshold)
    editor caret  ─► onCaretMove(at)  ─► preview.focusPosition(at)
    editor focus  ─► onActiveLeafChange ─► preview.endFollow()

  A document the engine refuses reaches no session, and the editor needs none: it mounts
  on the quill and the document alone, drawing the card the refusal named, while the
  preview says what refused. The edit that answers it tries the open again.

  A repack of the source quiver arrives as one dev-server signal and is answered by
  minting a fresh `Quiver`: the repack replaced the file, and the quill cache lives as
  long as the quiver does, so the quiver is dropped rather than invalidated.
  The document crosses (STUDIO §"The document survives the quill"), which is what
  makes an edit to a schema an edit to the thing the author is holding.

  Studio stores nothing, so a boot is a seed and a reload is the reseed: the carry is
  what keeps an edited `example:` out of a running session, and F5 is what puts it back
  (STUDIO §"The document is the blueprint's"). What outlives a boot is which quill, and
  it stands in the URL rather than in a store: a link names a quill, and a reload keeps
  it while still reseeding the document (`link.ts`).
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Engine } from '@quillmark/wasm';
	import type { CoreSurface, Diagnostic, Document } from '@quillmark/wasm';
	import type { Quiver } from '@quillmark/quiver';
	import { init } from '@quillmark/svelte/core';
	import type { EditorError, Landing, Place } from '@quillmark/svelte/core';
	import { Preview } from '@quillmark/svelte/preview';
	import { VisualEditor } from '@quillmark/svelte/visual';
	import type { EditorChange } from '@quillmark/svelte/visual';
	import Picker from './Picker.svelte';
	import Markdown from './Markdown.svelte';
	import { save } from './save';
	import { askedRef, sayRef } from './link';
	import { catalogOf, openQuiver, type Catalog } from './quiver';
	import { close, openRef, openSession, type Opened } from './session';
	import { collect, diagnosticsOf, messageOf, placeOf } from './notes';

	/** The dev server's signal that a repack landed. */
	const REPACKED = 'studio:quiver-repacked';
	/** One apply per settled burst of keystrokes. A structure op skips it. */
	const RECOMPILE_MS = 120;
	/** The engine compiled into this bundle, one of the three the build stamps. */
	const WASM = __CARRIED__['@quillmark/wasm'];

	type Phase =
		| { kind: 'booting' }
		| { kind: 'opening'; ref: string }
		| { kind: 'ready' }
		| { kind: 'failed'; message: string };

	// The engine, the quiver and the core surface are held, not tracked: nothing in the
	// markup reads them, and the surfaces read the handles under `open`.
	let engine: Engine | undefined;
	let quiver: Quiver | undefined;
	let core: CoreSurface | undefined;

	let phase = $state.raw<Phase>({ kind: 'booting' });
	let catalog = $state.raw<Catalog | undefined>();
	let picked = $state.raw<{ name: string; version: string } | undefined>();
	let open = $state.raw<Opened | undefined>();
	/** The document as text, kept across an open that materialized no quill: a `Quill.yaml`
	 *  mid-edit is reloaded through, and the document survives the trip. */
	let held = $state.raw<string | undefined>();

	// ── The errors ──────────────────────────────────────────────────────────────
	/** The diagnostics of a throw: a failed open or a failed recompile. */
	let thrown = $state.raw<Diagnostic[]>([]);
	/** What a surface recovered from, in its own slot so it neither clobbers a compile
	 *  failure nor is clobbered by the next successful compile. */
	let recovered = $state.raw<Diagnostic[]>([]);
	/** What the last carry stranded. Held for the open and dropped at the first edit:
	 *  from then on the schema producer speaks for the document's current state. */
	let carried = $state.raw<Diagnostic[]>([]);
	/** What the last emit refused. Its own slot rather than the compile's: a session that
	 *  paints can still fail to write a file, the PDF spine being the one lane a canvas
	 *  paint does not run, so the paint on screen is whole and what failed is the file. */
	let unemitted = $state.raw<Diagnostic[]>([]);
	/** Every producer's diagnostics, merged, for the editor to route by `path`. */
	let notes = $state.raw<Diagnostic[]>([]);

	/** The first diagnostic of the throw naming a place in the quill's source. A compile
	 *  failure carries one and nothing the schema says does, so this is the line the
	 *  author opens whichever shape the failure took. */
	const placed = $derived(thrown.find((d) => d.location));
	/**
	 * What the strip over the paint stands for, with the surfaces up, and what it is
	 * called. Three failures reach it and one is shown: a compile that will not land or an
	 * open the engine refused — both of which are why the paint does not answer the
	 * document, and both of which outrank the third — or an emit that would not write the
	 * file. It names the failure's place where it carried one, else its first note.
	 */
	const halt = $derived.by(() => {
		if (!open) return undefined;
		const set = thrown.length ? thrown : unemitted;
		if (!set.length) return undefined;
		const said = thrown.length
			? open.session
				? 'Compile failed'
				: 'Open failed'
			: 'Download failed';
		return { said, note: set.find((d) => d.location) ?? set[0]! };
	});

	/** Whether a repack put the document where it is. An import lands through the same
	 *  carry, and says nothing: a repack happens to the author, and an import is a thing
	 *  the reader just did. */
	let repacked = $state.raw(false);

	function syncNotes(): void {
		notes = collect([
			thrown,
			open ? open.quill.validate(open.doc) : [],
			open?.session ? open.session.warnings : [],
			carried,
			unemitted,
			recovered
		]);
	}

	// Surface handles for the two imperative bridge hops.
	let editorRef: { setCaret(at: Landing): Promise<void> } | undefined = $state.raw();
	let previewRef: ReturnType<typeof Preview> | undefined = $state.raw();

	/** Which of the split's two tracks is showing. Read only under the preset's threshold,
	 *  where one shows at a time; above it the attribute is inert and the switch band is
	 *  not drawn, so studio holds one number rather than a viewport in JS beside the one
	 *  the stylesheet already has. */
	let shown = $state.raw<1 | 2>(1);

	// ── Opening ─────────────────────────────────────────────────────────────────
	/** Whether an open is in flight: the picker is inert while one is. */
	const busy = $derived(phase.kind === 'booting' || phase.kind === 'opening');

	/** The open in progress. An open takes as long as the backend takes to load and
	 *  compile a page, which is long enough for a second repack to land inside one, so
	 *  the loser drops what it built instead of both writing the same slot. */
	let turn = 0;

	/**
	 * Replace what is mounted with `ref`, over `carry` when the document should cross.
	 * The old handles are freed only after the surfaces are gone: a live `<Preview>`
	 * paints from the session it was handed, so unmounting first is what keeps a
	 * freed handle out of reach.
	 */
	async function mount(ref: string, carry?: string): Promise<void> {
		if (!engine || !quiver) return;
		const mine = ++turn;
		phase = { kind: 'opening', ref };
		const previous = open;
		open = undefined;
		await tick();
		if (previous) close(previous);
		recovered = [];
		unemitted = [];
		try {
			const next = await openRef(engine, quiver, ref, carry);
			if (mine !== turn) return close(next);
			open = next;
			held = undefined;
			writes = next.formats.includes('pdf');
			thrown = next.refused;
			carried = next.carry.stranded;
			// Failed with the surfaces up: the head says the state, and the strip over the
			// preview says what the engine would not take.
			phase = next.session
				? { kind: 'ready' }
				: { kind: 'failed', message: next.refused[0].message };
		} catch (err) {
			if (mine !== turn) return;
			// No quill to stand a surface on, so the panes go and the room they had says
			// why. The document waits it out as text.
			held = carry;
			thrown = diagnosticsOf(err);
			carried = [];
			phase = { kind: 'failed', message: messageOf(err) };
		}
		syncNotes();
	}

	// ── The door ────────────────────────────────────────────────────────────────
	/** The document as text while the door is open, taken when it opened rather than
	 *  tracked: an edit mutates the document in place and reassigns nothing, so a
	 *  derivation over it would hold whatever the last remount produced. Undefined is the
	 *  door being shut. */
	let sourceText = $state.raw<string | undefined>();

	/** Whether there is a document to read at all: the session's, or the text a failed
	 *  open left held. */
	const carrying = $derived(open !== undefined || held !== undefined);

	function openSource(): void {
		sourceText = open ? open.doc.toMarkdown() : held;
	}

	/**
	 * Land `text` as the document, which is the repack's carry with a different source.
	 * Resolves to what refused it, or to `undefined` once it is mounted.
	 *
	 * The file names its own quill and is believed: a ref this quiver holds is the one it
	 * lands in, the picker following. A ref the quiver does not hold has nothing to
	 * honour, so the quill on screen takes it and the conform names what would not fit
	 * (STUDIO §"The document has doors").
	 */
	async function applyMarkdown(text: string): Promise<string | undefined> {
		let at = picked;
		let probe: Document | undefined;
		try {
			// Quill-free, so the ref is read before anything is opened against it.
			probe = core!.Document.fromMarkdown(text);
			const [name, version] = probe.quillRef.split('@');
			if (catalog?.quills.some((q) => q.name === name && q.versions.includes(version!)))
				at = { name: name!, version: version! };
		} catch (err) {
			return messageOf(err);
		} finally {
			probe?.free();
		}
		if (!at) return `quiver "${catalog?.name}" holds no quills`;
		sourceText = undefined;
		repacked = false;
		picked = at;
		held = undefined;
		await mount(`${at.name}@${at.version}`, text);
		return undefined;
	}

	// ── The file ────────────────────────────────────────────────────────────────
	/** Whether the quill on screen writes a document as one file, which is what `pdf` is
	 *  and the raster formats are not (one artifact per page). Latched from the open rather
	 *  than derived off it, so the control holds its place while the next one loads; a
	 *  backend that emits no PDF draws none, a control that cannot be used being chrome
	 *  standing on the mounts. */
	let writes = $state.raw(false);

	/**
	 * The document out as the file a reader keeps, named by the ref the address bar
	 * carries.
	 *
	 * It renders the compiled snapshot the preview is painting rather than opening a
	 * second compile, so the file is the paint: where a keystroke has not settled or a
	 * compile failed, what is written is what is on screen, and the strip over the preview
	 * is what says so. The emit is its own lane — a page that paints can still fail to
	 * write — so a refusal lands in `unemitted`, which neither clobbers the compile's
	 * failure nor is clobbered by it.
	 */
	function download(): void {
		const at = open;
		if (!at?.session) return;
		try {
			const [artifact] = at.session.render({ format: 'pdf' }).artifacts;
			if (!artifact) throw new Error(`${at.quill.backendId} emitted no PDF`);
			unemitted = [];
			save(artifact.bytes, `${at.ref}.pdf`, artifact.mimeType);
		} catch (err) {
			unemitted = diagnosticsOf(err);
		}
		syncNotes();
	}

	/** A pick is a different document, so nothing crosses: the picked quill seeds its
	 *  own example, which is what "what is this quill like to use" starts from. */
	async function pick(name: string, version: string): Promise<void> {
		picked = { name, version };
		held = undefined;
		await mount(`${name}@${version}`);
	}

	/**
	 * The quill a boot opens: what the URL asks for where the quiver holds it, else the
	 * catalog's first. A selector is honoured (`?quill=showcase`, `?quill=showcase@1`),
	 * being the grammar `getQuill` already takes.
	 *
	 * A ref this quiver does not hold has nothing to honour, so the first quill opens and
	 * the write below corrects the address bar to it.
	 */
	function firstOpen(from: Quiver, next: Catalog): { name: string; version: string } | undefined {
		const asked = askedRef();
		if (asked !== undefined) {
			try {
				const [name, version] = from.resolve(asked).split('@');
				return { name: name!, version: version! };
			} catch {
				// Not in this quiver's catalog.
			}
		}
		const first = next.quills[0];
		if (!first) return undefined;
		return { name: first.name, version: first.versions[0] };
	}

	// The address bar names the quill on screen, whichever way it got there: a pick, a
	// document that named its own, or a repack that took the ref away. It is what makes
	// a deployed studio linkable to a quill rather than to a quiver
	// (STUDIO §"Opened, not stood on").
	$effect(() => {
		if (picked) sayRef(`${picked.name}@${picked.version}`);
	});

	/**
	 * A repack landed: mint a fresh `Quiver`, re-read the catalog (a version directory
	 * may have appeared or gone), and carry the document into the quill that came out.
	 * The ref is unchanged, so the document is landed under a schema that may have
	 * moved under it; a ref that vanished falls back to whatever the catalog now holds.
	 */
	async function reload(): Promise<void> {
		repacked = true;
		const carry = open ? open.doc.toMarkdown() : held;
		let next: Catalog;
		try {
			quiver = await openQuiver();
			next = catalogOf(quiver);
			catalog = next;
		} catch (err) {
			thrown = diagnosticsOf(err);
			phase = { kind: 'failed', message: messageOf(err) };
			syncNotes();
			return;
		}
		const at = picked;
		if (at && next.quills.some((q) => q.name === at.name && q.versions.includes(at.version)))
			return mount(`${at.name}@${at.version}`, carry);
		// The ref went away under the author (a version directory renamed), so the
		// document has nothing to land in: whatever the catalog holds now, seeded.
		const first = next.quills[0];
		if (!first) {
			thrown = [];
			phase = { kind: 'failed', message: `quiver "${next.name}" holds no quills` };
			syncNotes();
			return;
		}
		await pick(first.name, first.versions[0]);
	}

	// ── The bridge ──────────────────────────────────────────────────────────────
	let settle: ReturnType<typeof setTimeout> | undefined;

	function scheduleRecompile(): void {
		clearTimeout(settle);
		settle = setTimeout(() => void recompileNow(), RECOMPILE_MS);
	}

	/** Land the document on the paint: an update where a session stands, an open where the
	 *  last one was refused. */
	async function recompileNow(): Promise<void> {
		// A structure op reaches here without the debounce, so a keystroke's pending timer
		// is this call's to cancel: the document it would apply is the one being applied.
		clearTimeout(settle);
		settle = undefined;
		const at = open;
		if (!at || !engine) return;
		if (at.session) {
			try {
				previewRef?.refresh(at.session.update(at.doc));
				thrown = [];
			} catch (err) {
				// The session is transactional, so the last good paint stays on screen and
				// stops answering the document, which is a state rather than a note. The
				// strip over the preview says so and carries the place; the band lists it
				// with everything else.
				thrown = diagnosticsOf(err);
			}
		} else {
			const landed = await openSession(engine, at.quill, at.doc);
			// The slot rather than the turn: two recompiles over one unresolved `open` leave
			// the turn where it was, and the loser's session is a handle nothing would free.
			if (open !== at) return landed.session?.free();
			open = { ...at, ...landed };
			thrown = landed.refused;
			if (landed.session) phase = { kind: 'ready' };
		}
		syncNotes();
	}

	function handleChange(change: EditorChange): void {
		// The carry's diagnostics describe the document as it arrived; an edit makes
		// them history, and the schema producer speaks for it from here. The last emit's
		// refusal goes with them, being about the document that was in hand when it ran.
		if (carried.length) carried = [];
		if (unemitted.length) unemitted = [];
		// A structure op happens once per gesture and the stack has already moved, so
		// it applies at once; prose and field edits arrive per keystroke and debounce.
		if (change.source === 'structure') void recompileNow();
		else scheduleRecompile();
	}

	/** The caret and the reveal together: under the threshold the editor is the track that
	 *  is not showing, and a caret placed in it is a round-trip the author cannot see
	 *  land. Above it the write is a no-op the stylesheet ignores.
	 *
	 *  The reveal needs no flush of its own, which is what makes the tab hop ordinary:
	 *  `setCaret` already waits one out before it lands (a collapsed group is `inert` and
	 *  swallows a focus, the same way a hidden track would), and the track's `display`
	 *  moves in that same flush. */
	function handlePick(at: Landing): void {
		shown = 1;
		editorRef?.setCaret(at);
	}

	/** The editor already speaks the preview's address grammar, so nothing translates. */
	function handleCaretMove(at: Place): void {
		previewRef?.focusPosition(at);
	}
	/** The other half of that hop: a focus into a leaf with no caret to report — every
	 *  form control — ends the follow, and a prose leaf restarts it with its next caret. */
	function handleActiveLeaf(): void {
		previewRef?.endFollow();
	}

	/** Both surfaces report here: a commit the boundary refused, a page the backend
	 *  would not paint. Neither stops the session, and both belong in the one place
	 *  studio puts what went wrong. */
	function handleSurfaceError(err: EditorError): void {
		recovered = [{ severity: 'warning', code: err.code, message: err.message }];
		syncNotes();
	}

	onMount(() => {
		let cancelled = false;
		(async () => {
			try {
				// `init` instantiates the core and latches the surface the editor's codec
				// reads synchronously. The quiver awaits the same memoized gate to
				// materialize a quill.
				core = await init();
				quiver = await openQuiver();
				const next = catalogOf(quiver);
				catalog = next;
				const at = firstOpen(quiver, next);
				if (!at) throw new Error(`quiver "${next.name}" holds no quills`);
				if (cancelled) return;
				engine = new Engine();
				await pick(at.name, at.version);
			} catch (err) {
				if (!cancelled) {
					thrown = diagnosticsOf(err);
					phase = { kind: 'failed', message: messageOf(err) };
					syncNotes();
				}
			}
		})();

		// The repack signal, dev only: a built studio has no dev server behind it and
		// nothing to repack.
		const hot = import.meta.hot;
		hot?.on(REPACKED, reload);

		return () => {
			cancelled = true;
			clearTimeout(settle);
			hot?.off(REPACKED, reload);
			if (open) close(open);
			open = undefined;
		};
	});
</script>

<div class="qm-workspace">
	<header class="qm-bar head">
		<span class="mark">quillmark<span class="slash">/</span>studio</span>
		<!-- The engine that painted what is on screen. A client renders through the wasm
		     it was built with while the author's gate runs whatever they installed, and
		     nothing at runtime reconciles the two, so the version is stated rather than
		     left to `npm ls` — which the reader of a client served from elsewhere cannot
		     run. -->
		<span class="qm-readout engine" data-testid="engine">wasm {WASM}</span>
		{#if catalog}
			<Picker {catalog} {picked} disabled={busy} onPick={pick} />
		{/if}
		<!-- The document's two doors (STUDIO §"Opened, not stood on"). The source goes both
		     ways through the panel; the file goes one way and needs none, so the press is
		     the whole of it. -->
		<button
			class="qm-control"
			type="button"
			data-testid="edit-source"
			disabled={!carrying}
			onclick={openSource}>Edit source</button
		>
		{#if writes}
			<button
				class="qm-control"
				type="button"
				data-testid="download-doc"
				disabled={!open?.session}
				onclick={download}>Download PDF</button
			>
		{/if}
		<span class="state">
			{#if phase.kind === 'booting'}
				<span class="qm-status" data-testid="phase">Opening…</span>
			{:else if phase.kind === 'opening'}
				<span class="qm-status" data-testid="phase">Opening {phase.ref}…</span>
			{:else if phase.kind === 'failed'}
				<!-- The head says the state; what went wrong is a sentence, and it belongs
				     where the panes were rather than on one line of chrome. -->
				<span class="qm-status qm-status-error" data-testid="phase">Open failed</span>
				{#if held}
					<!-- The document is not gone with the quill that would not open: it waits
					     as text for the repack that fixes it. -->
					<span class="qm-status" data-testid="held">Document held</span>
				{/if}
			{:else if repacked && open && open.carry.how !== 'seeded'}
				<!-- An open session says so by painting the page, so the only word here is
				     what a repack did to the document that was already in hand. -->
				<span class="qm-status" data-testid="phase"
					>Repacked · document {open.carry.how === 'carried' ? 'carried' : 'reseeded'}</span
				>
			{/if}
		</span>
	</header>

	{#if open}
		<!-- Both surfaces bind their handles once, on mount: `mount()` clears `open`
		     and waits a tick before freeing anything, so a new session arrives as a
		     remount of this block rather than as a prop swap the preview would
		     refuse to rebind. -->
		<div class="body">
			<!-- Drawn only under the preset's threshold, where the split shows one track.
			     Full-bleed and shallow like the head, since it is chrome between two bands
			     rather than a plate on a page. -->
			<div class="qm-switch switch" role="group" aria-label="Visible pane">
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

			<div class="qm-split panes" data-qm-show={shown}>
				<section class="pane" aria-label="Editor">
					<VisualEditor
						class="qm-pane"
						bind:this={editorRef}
						doc={open.doc}
						quill={open.quill}
						diagnostics={notes}
						onActiveLeafChange={handleActiveLeaf}
						onCaretMove={handleCaretMove}
						onChange={handleChange}
						onError={handleSurfaceError}
					/>
				</section>
				<section class="pane paint" aria-label="Preview">
					{#if halt}
						<!-- A document that reaches no paint is a state of the paint, not a row under
						     it: the failure at the surface it is about, carrying the place to open
						     (STUDIO §"The errors"). The band below still lists it, one list being
						     its job. The label says which it stands over: a stale paint, none, or a
						     paint that is whole and would not be written out. -->
						<div class="stalled" data-testid="stalled" role="status">
							<span class="qm-status qm-status-error">{halt.said}</span>
							{#if halt.note.location}
								<span class="qm-readout at">{placeOf(halt.note.location)}</span>
							{/if}
							<span class="what">{halt.note.message}</span>
						</div>
					{/if}
					{#if open.session}
						<Preview
							bind:this={previewRef}
							session={open.session}
							onPick={handlePick}
							onError={handleSurfaceError}
						/>
					{/if}
				</section>
			</div>
		</div>
	{:else}
		<!-- No quill materialized, so there is no schema to draw a document against: the room
		     the panes had says why, the message where the paint would be and the line of
		     source it failed at under it. -->
		<div class="vacant">
			{#if phase.kind === 'failed'}
				<p class="reason" data-testid="reason">{phase.message}</p>
				{#if placed?.location}
					<!-- A `Quill.yaml` mid-edit is what lands here, and the line it failed at is
					     what the author does next. -->
					<span class="qm-readout at" data-testid="reason-at">{placeOf(placed.location)}</span>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<!-- Mounted only while open, which is what makes every opening a fresh read of the
     document as it then stands. -->
{#if sourceText !== undefined && picked}
	<Markdown
		text={sourceText}
		ref={`${picked.name}@${picked.version}`}
		onApply={applyMarkdown}
		onClose={() => (sourceText = undefined)}
	/>
{/if}

<style>
	/* The shell's shape is the preset's: the pinned bands, the row a band puts its parts
	   on, the split's tracks (THEMING §"The shell"). What each band is made of is studio's,
	   and it is made like a tool: no maximum to hold its content to, so the head's rule
	   runs the width of the viewport and the gutter it keeps inside itself is the one the
	   panes stand off by; and shallow, because a band this dense is chrome the author
	   reads past. */
	.head {
		padding: var(--qmh-space-2) var(--qmh-space-4);
		border-block-end: var(--qmh-border-width) solid var(--qmh-border);
	}

	/* Whose surface this is, said once. Uppercase and tracked, the treatment the labels
	   under it take: studio is a workroom rather than a site, and the mark is a plate on
	   the wall of it, not a link back to anywhere. */
	.mark {
		font-family: var(--qmh-font-mono);
		font-size: var(--qmh-text-label);
		font-weight: var(--qmh-weight-mid);
		letter-spacing: var(--qmh-track-label);
		text-transform: uppercase;
		color: var(--qmh-ink);
	}

	.slash {
		color: var(--qmh-ink-meta);
	}

	/* Beside the mark, in the ghost the mark's own slash takes: a fact about the build,
	   read once and not watched. */
	.engine {
		color: var(--qmh-ink-meta);
	}

	/* The phase reads off the end of the line, so the picker holds its position when
	   it clears. The band's own row treatment, because this end of it carries two
	   independent readings at once (the open failed, the document is held) and at a
	   word-space they read as one sentence. */
	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--qmh-space) var(--qmh-space-4);
		margin-inline-start: auto;
		min-width: 0;
	}

	/* The workspace's body band, and the two things in it: the switch that is drawn only
	   under the threshold, and the split that takes everything left either way. A column
	   rather than a fourth row on the workspace, since three bands is what a workspace is
	   and the switch belongs to the mounts rather than beside them. */
	.body {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	/* The band's look, where the preset carries whether it is drawn at all: full-bleed, and
	   the head's own gutter beside the controls so the two rules above the panes read as
	   one edge. The depth is the controls', which stand at the touch floor: a band padded
	   past them would be chrome standing deeper than the head, on the viewports with the
	   least of it to spend. */
	.switch {
		padding-inline: var(--qmh-space-4);
		border-block-end: var(--qmh-border-width) solid var(--qmh-border);
	}

	/* The split's tracks are the preset's; its gap is not. Studio hides its instruments
	   and spends the screen on the two mounts, so the panes meet at a hairline and run to
	   the viewport's edges: a gap and a frame apiece would draw two cards on a page, which
	   is the playground's job and the opposite of this one.

	   The hairline is the gap, closed to a stroke with the border showing through it,
	   rather than an edge on one of the two panes. A seam drawn on a pane outlives the
	   pane beside it: under the threshold one track shows, and the border that was between
	   the mounts is left against the viewport. A gap has nothing to leave behind, so the
	   seam appears and goes with the second track and studio states no threshold of its
	   own. */
	.panes {
		gap: var(--qmh-border-width);
		background: var(--qmh-border);
		flex: 1 1 0;
	}

	/* A track that may shrink below its content, which is the whole of what a pane owes
	   its surface: the gutter, the scroll container, the tone and the tail are the
	   surface's own (THEMING §"Drop it in"), and the editor takes `.qm-pane` in the markup
	   to say it is mounted in a fixed height rather than a page. */
	.pane {
		min-width: 0;
		min-height: 0;
	}

	/* Positioned, because the compile failure is laid over this pane. The seam between the
	   two is the split's gap; there is no resizer, a divider that can be dragged being an
	   instrument. It carries its own ground, which the preview paints over: `.panes` lays
	   the seam's colour behind both tracks, so a pane with nothing mounted on it would
	   show that colour across its whole area. */
	.pane.paint {
		position: relative;
		background: var(--qmh-surface);
	}

	/* The failure over the paint rather than above it. The last good paint, where there is
	   one, stays whole underneath: it is what the author was judging, and the only
	   evidence of what the plate did before it stopped compiling. Overlaid rather than stacked, so the
	   keystroke that breaks a plate and the one that fixes it do not resize the surface
	   being judged. */
	.stalled {
		position: absolute;
		inset-block-start: 0;
		inset-inline: 0;
		z-index: 1;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--qmh-space) var(--qmh-space-3);
		padding: var(--qmh-space-2) var(--qmh-space-3);
		background: var(--qmh-page);
		border-block-end: var(--qmh-border-width) solid var(--qmh-alert);
	}

	/* The place, in the ink the addresses in the band take: it is the one part of this
	   strip an author acts on. */
	.at {
		color: var(--qmh-ink);
	}

	/* One line of it. The strip is the state and the band below is the list, so a
	   compiler's paragraph truncates here and is read in full there. */
	.what {
		flex: 1 1 auto;
		min-width: 0;
		font-size: var(--qmh-text-label);
		line-height: var(--qmh-leading-tight);
		color: var(--qmh-alert);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Where the panes were. It takes the same room so the bands do not move when a quill
	   stops opening, and it holds the one sentence that says why.

	   At the top of that room rather than centred in it: the sentence lands where the
	   editor's first card was, which is where the author was already looking, and it
	   stands on one edge with the head that says the state and the band that lists it.
	   Centred, it floated in most of a viewport of empty surface, which is a site's error
	   page and not a workroom mid-fix. */
	.vacant {
		display: grid;
		justify-items: start;
		align-content: start;
		gap: var(--qmh-space-2);
		min-height: 0;
		padding: var(--qmh-space-4);
		background: var(--qmh-surface);
	}

	.reason {
		margin: 0;
		max-width: var(--qmh-measure);
		color: var(--qmh-alert);
		overflow-wrap: anywhere;
	}
</style>
