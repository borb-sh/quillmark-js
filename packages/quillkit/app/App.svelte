<!--
  The app, whole: one form to fill in, beside the page it prints, and the file it leaves as
  (APP.md). Drawn for the person filling the form in rather than for its author, so nothing
  on it names a quill, a ref, a file or a line.

  One document at a time, under two surfaces over one `LiveSession`, the same bridge studio
  draws (STUDIO §"A client, and what serves it"):

    edit ─► (debounced) session.update(doc) ─► preview.refresh(change)
        └► (debounced) save to this browser
    preview click ─► editor.setCaret(at), and the form shown on a phone
    editor caret  ─► preview.focusPosition(at)

  The editor stands on the core wasm alone, so the form is up while the render wasm is
  still arriving; the session, and with it the page, follows when it lands.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Engine } from '@quillmark/wasm';
	import type { CoreSurface, Diagnostic, Document, LiveSession, Quill } from '@quillmark/wasm';
	import type { Quiver } from '@quillmark/quiver';
	import { init } from '@quillmark/svelte/core';
	import type { EditorError, Landing, Place } from '@quillmark/svelte/core';
	import { Preview } from '@quillmark/svelte/preview';
	import { VisualEditor } from '@quillmark/svelte/visual';
	import type { EditorChange } from '@quillmark/svelte/visual';
	import { collect, diagnosticsOf } from '../client/notes';
	import { openQuiver } from '../client/quiver';
	import { save } from '../client/save';
	import Choose from './Choose.svelte';
	import Drawer from './Drawer.svelte';
	import Update from './Update.svelte';
	import { land } from './document';
	import {
		fileName,
		latestFor,
		newId,
		standing,
		titleOf,
		type AppConfig,
		type AppQuill,
		type DocRecord,
		type Standing
	} from './records';
	import { openStore, type Store } from './store';

	interface Props {
		app: AppConfig;
	}

	let { app }: Props = $props();

	/** One apply per settled burst of keystrokes. A structure op skips it. */
	const RECOMPILE_MS = 120;
	/** One save per settled burst, which a reader closing the tab mid-burst still gets. */
	const SAVE_MS = 400;
	/** The wasm compiled into this bundle, which is the release the footer names. */
	const QUILLMARK = __CARRIED__['@quillmark/wasm'];
	const CANT_RENDER = "This form can't render right now.";
	const CANT_LOAD = "This app can't load right now.";
	const CANT_OPEN = "This document can't open right now.";
	const GONE = 'This document was made with a form this app no longer has.';
	const FIX_FIELDS = 'Some answers need fixing before the page can update.';

	/** The document on screen and what it was opened on. */
	interface Open {
		id: string;
		ref: string;
		/** The title the quill gives a document nobody has answered. */
		label: string;
		quill: Quill;
		doc: Document;
		standing: Standing;
		/** Whether this browser holds it yet: a fresh document is kept from its first edit. */
		kept: boolean;
	}

	// Held, not tracked: nothing in the markup reads them.
	let core: CoreSurface | undefined;
	let quiver: Quiver | undefined;
	let engine: Engine | undefined;
	let store: Store | undefined;

	let booted = $state.raw(false);
	let failed = $state.raw<string | undefined>();
	let open = $state.raw<Open | undefined>();
	let session = $state.raw<LiveSession | undefined>();
	/** A document that would not open, kept as its record. */
	let unopenable = $state.raw<DocRecord | undefined>();
	/** Whether that is because the pack no longer holds its pin. */
	let gone = $state.raw(false);
	/** Whether the landing is up: several quills, and no document chosen. */
	let choosing = $state.raw(false);
	let keeps = $state.raw(false);

	/** The diagnostics of a refused open or a failed recompile. */
	let thrown = $state.raw<Diagnostic[]>([]);
	/** What landing the document stranded, until its first edit. */
	let stranded = $state.raw<Diagnostic[]>([]);
	/** A page that would not paint, until the next edit. */
	let painted = $state.raw(true);
	let notes = $state.raw<Diagnostic[]>([]);
	/** Why the last download did not happen. */
	let refusal = $state.raw<string | undefined>();
	let downloading = $state.raw(false);

	let drawer = $state.raw<DocRecord[] | undefined | false>(false);
	let asking = $state.raw(false);

	/** Which of the split's tracks shows under the preset's threshold: the form or the page. */
	let shown = $state.raw<1 | 2>(1);

	let editorRef: { setCaret(at: Landing): Promise<void> } | undefined = $state.raw();
	let previewRef: ReturnType<typeof Preview> | undefined = $state.raw();

	/** What the strip over the page says, where the page does not answer the form. */
	const strip = $derived.by(() => {
		if (!open) return undefined;
		if (thrown.length) return thrown.some((d) => d.path) ? FIX_FIELDS : CANT_RENDER;
		if (!painted) return CANT_RENDER;
		if (!session) return 'Loading the page…';
		return undefined;
	});

	function syncNotes(): void {
		notes = collect([
			thrown,
			open ? open.quill.validate(open.doc) : [],
			session ? session.warnings : [],
			stranded
		]);
	}

	// ── Opening ─────────────────────────────────────────────────────────────────
	/** The open in progress: an open loads a quill and a backend, which is long enough for a
	 *  second press to land inside one, and the loser drops what it built. */
	let turn = 0;
	/** The session being opened, which a download waits on. */
	let opening: Promise<void> | undefined;
	/** The document an open is in flight for, and whether an edit has moved it since that
	 *  open read it. */
	let attaching: Open | undefined;
	let behind = false;

	/** Take down what is mounted. The surfaces go first: a live preview paints from the
	 *  session it was handed, so freeing it under them would hand them a freed handle. */
	async function unmount(): Promise<void> {
		flushSave();
		const was = open;
		const had = session;
		open = undefined;
		session = undefined;
		unopenable = undefined;
		thrown = [];
		stranded = [];
		painted = true;
		refusal = undefined;
		await tick();
		had?.free();
		was?.doc.free();
	}

	/** Mount `next` and open its session behind it. */
	async function mount(next: Omit<Open, 'standing'>, landed: Diagnostic[]): Promise<void> {
		open = { ...next, standing: standing(next.ref, app, quiver!) };
		stranded = landed;
		choosing = false;
		shown = 1;
		syncNotes();
		opening = attach(open);
		await opening;
	}

	async function attach(at: Open): Promise<void> {
		engine ??= new Engine();
		attaching = at;
		behind = false;
		try {
			const opened = await engine.open(at.quill, at.doc);
			if (open !== at) return opened.free();
			session = opened;
			thrown = [];
		} catch (err) {
			if (open !== at) return;
			thrown = diagnosticsOf(err);
		} finally {
			if (attaching === at) attaching = undefined;
		}
		if (behind) return recompileNow();
		syncNotes();
	}

	/** What a reader is told when the app itself will not come up. What went wrong is the
	 *  console's: a reader can act on neither a URL nor a stack. */
	function fail(err: unknown): void {
		console.error(err);
		failed = CANT_LOAD;
	}

	/** A document that would not open, shown as its record, which still downloads. */
	function standAsRecord(record: DocRecord): void {
		unopenable = record;
		gone = standing(record.quill, app, quiver!) === 'missing';
		choosing = false;
	}

	const labelOf = (ref: string): string =>
		app.quills.find((q) => q.ref === ref)?.title ?? latestFor(ref, app)?.title ?? app.title;

	/** A blank document on `pin`. Kept from its first edit, so a visit that fills nothing in
	 *  leaves nothing behind. */
	async function begin(pin: AppQuill): Promise<void> {
		const mine = ++turn;
		await unmount();
		void store?.setOpened(undefined);
		try {
			const quill = await quiver!.getQuill(pin.ref);
			if (mine !== turn) return;
			const doc = quill.seedDocument();
			await mount({ id: newId(), ref: pin.ref, label: pin.title, quill, doc, kept: false }, []);
		} catch (err) {
			if (mine === turn) fail(err);
		}
	}

	/** A kept document, on the pin it was made on. One that will not open stands as its
	 *  record, with its markdown and the latest form offered. */
	async function resume(record: DocRecord): Promise<void> {
		const mine = ++turn;
		await unmount();
		void store?.setOpened(record.id);
		if (standing(record.quill, app, quiver!) === 'missing') return standAsRecord(record);
		try {
			const quill = await quiver!.getQuill(record.quill);
			if (mine !== turn) return;
			const { doc, stranded: landed } = land(core!, quill, record.quill, record.markdown);
			await mount(
				{ id: record.id, ref: record.quill, label: labelOf(record.quill), quill, doc, kept: true },
				landed
			);
		} catch (err) {
			if (mine === turn) {
				console.error(err);
				standAsRecord(record);
			}
		}
	}

	/** Back to the start: the one quill's blank form, or the landing over several. */
	async function fresh(): Promise<void> {
		if (app.quills.length === 1) return begin(app.quills[0]!);
		++turn;
		await unmount();
		void store?.setOpened(undefined);
		choosing = true;
	}

	// ── Saving ──────────────────────────────────────────────────────────────────
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	function recordOf(at: Open): DocRecord {
		return {
			id: at.id,
			title: titleOf(at.doc.main, at.quill.schema.main.fields, at.label),
			quill: at.ref,
			edited: Date.now(),
			markdown: at.doc.toMarkdown()
		};
	}

	function scheduleSave(): void {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(flushSave, SAVE_MS);
	}

	/** Write the document in hand to this browser now, where an edit is waiting to be. */
	function flushSave(): void {
		if (saveTimer === undefined) return;
		clearTimeout(saveTimer);
		saveTimer = undefined;
		const at = open;
		if (!at || !store) return;
		const record = recordOf(at);
		at.kept = true;
		void store.put(record).then(() => store?.setOpened(record.id));
	}

	// ── The bridge ──────────────────────────────────────────────────────────────
	let settle: ReturnType<typeof setTimeout> | undefined;

	function scheduleRecompile(): void {
		clearTimeout(settle);
		settle = setTimeout(() => void recompileNow(), RECOMPILE_MS);
	}

	async function recompileNow(): Promise<void> {
		clearTimeout(settle);
		settle = undefined;
		const at = open;
		if (!at) return;
		if (session) {
			try {
				previewRef?.refresh(session.update(at.doc));
				thrown = [];
			} catch (err) {
				thrown = diagnosticsOf(err);
			}
			syncNotes();
		} else if (attaching === at) {
			// The open in flight read the document before this edit, which applies once it lands.
			behind = true;
		} else if (thrown.length) {
			// The last open was refused, and this edit may be what answers it.
			opening = attach(at);
			await opening;
		}
	}

	function handleChange(change: EditorChange): void {
		if (stranded.length) stranded = [];
		refusal = undefined;
		painted = true;
		scheduleSave();
		if (change.source === 'structure') void recompileNow();
		else scheduleRecompile();
	}

	function handlePick(at: Landing): void {
		shown = 1;
		editorRef?.setCaret(at);
	}

	function handleCaretMove(at: Place): void {
		previewRef?.focusPosition(at);
	}

	function handleActiveLeaf(): void {
		previewRef?.endFollow();
	}

	function handleSurfaceError(err: EditorError): void {
		if (err.code === 'paint-failed') painted = false;
	}

	// ── The file ────────────────────────────────────────────────────────────────
	/**
	 * The document as the PDF the page shows. A keystroke not yet applied is applied first
	 * and an open still in flight is waited on, so the file is the document in hand; a
	 * document that does not render is refused rather than written from the last good page.
	 */
	async function download(): Promise<void> {
		const at = open;
		if (!at || downloading) return;
		downloading = true;
		try {
			if (settle !== undefined) await recompileNow();
			await opening;
			if (open !== at) return;
			if (!session || thrown.length) {
				refusal = thrown.some((d) => d.path) ? FIX_FIELDS : CANT_RENDER;
				return;
			}
			const [artifact] = session.render({ format: 'pdf' }).artifacts;
			if (!artifact) throw new Error('no PDF');
			refusal = undefined;
			save(artifact.bytes, fileName(recordOf(at).title, 'pdf'), artifact.mimeType);
		} catch {
			refusal = CANT_RENDER;
		} finally {
			downloading = false;
		}
	}

	function downloadMarkdown(record: DocRecord): void {
		save(record.markdown, fileName(record.title || 'document', 'md'), 'text/markdown');
	}

	/** The document on screen as a record, whether or not this browser keeps it yet. */
	const current = (): DocRecord | undefined => (open ? recordOf(open) : unopenable);

	// ── Retired pins ────────────────────────────────────────────────────────────
	/** Move the document on screen onto the latest form, in place: same record, the latest
	 *  pin, what the move stranded named on its fields. The dialog that calls this offered
	 *  the markdown first, and a move that does not land leaves the record on its own pin. */
	async function update(): Promise<void> {
		asking = false;
		const record = current();
		const latest = record && latestFor(record.quill, app);
		if (!record || !latest) return;
		const mine = ++turn;
		await unmount();
		try {
			const quill = await quiver!.getQuill(latest.ref);
			if (mine !== turn) return;
			const { doc, stranded: landed } = land(core!, quill, latest.ref, record.markdown);
			const next = { id: record.id, ref: latest.ref, label: latest.title, quill, doc, kept: true };
			void store?.put(recordOf({ ...next, standing: 'current' }));
			void store?.setOpened(record.id);
			await mount(next, landed);
		} catch (err) {
			if (mine === turn) {
				console.error(err);
				standAsRecord(record);
			}
		}
	}

	// ── The drawer ──────────────────────────────────────────────────────────────
	async function showDrawer(): Promise<void> {
		flushSave();
		drawer = undefined;
		drawer = (await store?.list()) ?? [];
	}

	async function remove(record: DocRecord): Promise<void> {
		if (!confirm(`Delete "${record.title || 'Untitled'}" from this browser?`)) return;
		await store?.remove(record.id);
		if (open?.id === record.id || unopenable?.id === record.id) {
			clearTimeout(saveTimer);
			saveTimer = undefined;
			await fresh();
		}
		drawer = (await store?.list()) ?? [];
	}

	async function clearAll(): Promise<void> {
		if (!confirm('Delete every document this browser keeps for this app?')) return;
		clearTimeout(saveTimer);
		saveTimer = undefined;
		await store?.clear();
		drawer = [];
		if (open?.kept || unopenable) await fresh();
	}

	onMount(() => {
		let cancelled = false;
		(async () => {
			try {
				core = await init();
				quiver = await openQuiver();
				store = await openStore(new URL('.', document.baseURI).href);
				keeps = store !== undefined;
				if (cancelled) return;
				const id = await store?.opened();
				const record = id === undefined ? undefined : await store?.get(id);
				booted = true;
				if (record) await resume(record);
				else await fresh();
			} catch (err) {
				if (!cancelled) fail(err);
			}
		})();
		return () => {
			cancelled = true;
			clearTimeout(settle);
			flushSave();
			session?.free();
			open?.doc.free();
		};
	});
</script>

<svelte:window onpagehide={flushSave} />
<svelte:document
	onvisibilitychange={() => {
		if (document.visibilityState === 'hidden') flushSave();
	}}
/>

<div class="qm-workspace">
	<header class="qm-bar qm-app-header head">
		<span class="name">
			{#if app.icon}
				<img class="icon" src={app.icon} alt="" />
			{/if}
			<h1 class="qm-app-title">{app.title}</h1>
		</span>
		{#if booted}
			<button class="qm-control" type="button" data-testid="documents" onclick={showDrawer}
				>My documents</button
			>
		{/if}
		{#if open}
			<button
				class="qm-app-primary"
				type="button"
				data-testid="download"
				disabled={downloading}
				onclick={download}>{downloading ? 'Preparing…' : 'Download PDF'}</button
			>
		{/if}
	</header>

	<main class="body">
		{#if failed}
			<p class="qm-status qm-status-error vacant" role="alert">{failed}</p>
		{:else if !booted}
			<p class="qm-status vacant" data-testid="booting">Loading…</p>
		{:else if choosing}
			<Choose description={app.description} quills={app.quills} onPick={begin} />
		{:else if unopenable}
			{@const latest = latestFor(unopenable.quill, app)}
			<div class="vacant" data-testid="unopenable">
				<p>{gone ? GONE : CANT_OPEN}</p>
				<div class="qm-bar">
					<button class="qm-control" type="button" onclick={() => downloadMarkdown(unopenable!)}
						>Download .md</button
					>
					{#if latest && latest.ref !== unopenable.quill}
						<button class="qm-app-primary" type="button" onclick={() => (asking = true)}
							>Update to the latest form</button
						>
					{/if}
				</div>
			</div>
		{:else if open}
			{#if open.standing === 'retired'}
				<div class="qm-bar retired" data-testid="retired" role="status">
					<span>This document uses an earlier version of this form.</span>
					{#if latestFor(open.ref, app)}
						<button class="qm-control" type="button" onclick={() => (asking = true)}
							>Update to the latest form</button
						>
					{/if}
				</div>
			{/if}
			{#if refusal}
				<p class="qm-status qm-status-error refusal" data-testid="refusal" role="alert">
					{refusal}
				</p>
			{/if}
			<div class="qm-switch switch" role="group" aria-label="Visible pane">
				<button
					class="qm-control"
					type="button"
					aria-pressed={shown === 1}
					onclick={() => (shown = 1)}>Form</button
				>
				<button
					class="qm-control"
					type="button"
					aria-pressed={shown === 2}
					onclick={() => (shown = 2)}>Page</button
				>
			</div>
			<div class="qm-split panes" data-qm-show={shown}>
				<section class="pane" aria-label="Form">
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
				<section class="pane paint" aria-label="Page">
					{#if strip}
						<p class="stalled" data-testid="stalled" role="status">{strip}</p>
					{/if}
					{#if session}
						<Preview
							bind:this={previewRef}
							{session}
							onPick={handlePick}
							onError={handleSurfaceError}
						/>
					{/if}
				</section>
			</div>
		{/if}
	</main>

	<footer class="qm-bar qm-app-footer">
		<span
			>Built with <a href="https://github.com/borb-sh/quillmark" rel="noreferrer"
				>Quillmark v{QUILLMARK}</a
			></span
		>
	</footer>
</div>

{#if drawer !== false}
	<Drawer
		records={drawer}
		{keeps}
		current={open?.kept ? open.id : unopenable?.id}
		onOpen={(record) => {
			drawer = false;
			void resume(record);
		}}
		onDownload={downloadMarkdown}
		onDelete={remove}
		onNew={() => {
			drawer = false;
			void fresh();
		}}
		onClearAll={clearAll}
		onClose={() => (drawer = false)}
	/>
{/if}

{#if asking}
	<Update
		onDownload={() => {
			const record = current();
			if (record) downloadMarkdown(record);
		}}
		onUpdate={update}
		onClose={() => (asking = false)}
	/>
{/if}

<style>
	/* The name and the mark before it, holding the head's start; the controls after it sit
	   at the end of the line. */
	.name {
		display: flex;
		align-items: center;
		gap: var(--qmh-space-2);
		min-width: 0;
		margin-inline-end: auto;
	}

	.icon {
		width: var(--qmh-tap);
		height: var(--qmh-tap);
		object-fit: contain;
	}

	/* One height for the head's presses: the primary stands at the touch floor, so the
	   control beside it does too, and the line reads as one row of buttons. */
	.head > .qm-control {
		min-height: var(--qmh-tap);
	}

	.body {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.vacant {
		margin: 0;
		padding: var(--qmh-space-4);
	}

	.vacant p {
		margin: 0 0 var(--qmh-space-3);
	}

	.retired,
	.refusal {
		margin: 0;
		padding: var(--qmh-space-2) var(--qmh-space-4);
		border-block-end: var(--qmh-border-width) solid var(--qmh-border);
	}

	.switch {
		padding-inline: var(--qmh-space-4);
		border-block-end: var(--qmh-border-width) solid var(--qmh-border);
	}

	/* The panes meet at a hairline and run to the viewport's edges, as studio's do: the
	   form and the page are the whole screen. */
	.panes {
		gap: var(--qmh-border-width);
		background: var(--qmh-border);
		flex: 1 1 0;
	}

	.pane {
		min-width: 0;
		min-height: 0;
	}

	/* The preview's desk tone under the preview, so the pane does not change tone when
	   the first paint lands (studio's `.pane.paint`). */
	.pane.paint {
		position: relative;
		background: var(--qmh-page);
	}

	/* Laid over the page rather than above it, so the page does not move when it stops
	   answering the form. Its words start on the sheet's edge, the desk's gutter. */
	.stalled {
		position: absolute;
		inset-block-start: 0;
		inset-inline: 0;
		z-index: 1;
		margin: 0;
		padding: var(--qmh-space-2) var(--qmh-space-4);
		font-size: var(--qmh-text-label);
		color: var(--qmh-ink-meta);
		background: var(--qmh-page);
		border-block-end: var(--qmh-border-width) solid var(--qmh-border);
	}
</style>
