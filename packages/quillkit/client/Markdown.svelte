<!--
  The document's two doors, which are one panel: canonical Quillmark markdown out, the
  same markdown in (STUDIO §"The document has doors").

  Nothing here parses, conforms or reports. `apply` hands the text to the caller, which
  lands it through the repack's own carry.

  Mounted only while open, so `showModal` on mount is the whole of the lifecycle and the
  draft below is seeded against the document as it then stands. Native `<dialog>` carries
  the top layer, the focus trap and the escape key; what is written here is the scrim's
  tone and the plate's box, the preset carrying no dialog.
-->
<script lang="ts">
	import { save } from './save';

	interface Props {
		/** The document as it stands: its canonical markdown, or the text a failed open
		 *  left held. */
		text: string;
		/** The document's ref, which names the download. */
		ref: string;
		/** Land this text as the document, resolving to what refused it. What landed and
		 *  what it stranded are the caller's to report; what never became a document is
		 *  said here, beside the text that caused it. */
		onApply: (text: string) => Promise<string | undefined>;
		/** Called for every way it closes, the escape key and the scrim included. */
		onClose: () => void;
	}

	let { text, ref, onApply, onClose }: Props = $props();

	let el = $state.raw<HTMLDialogElement | undefined>();
	$effect(() => el?.showModal());

	/** What the panel opened with, edited or replaced; studio's document is untouched
	 *  until `apply`, so closing the panel discards this and nothing else. */
	// svelte-ignore state_referenced_locally
	let draft = $state(text);

	/** What refused the draft, at either door: a file that would not decode, or markdown
	 *  that would not parse. Both leave the document on screen standing. */
	let refused = $state.raw<string | undefined>();

	/** Where the gesture a click reports began. A click fires at the nearest common
	 *  ancestor of press and release, so a selection dragged out of the textarea and
	 *  released past the plate reports the dialog: the press is what tells a scrim click
	 *  from a drag that ended on one. */
	let pressed: EventTarget | null = null;

	const dirty = $derived(draft !== text);

	/** The text in the panel, named by the document's ref: what is on screen rather than
	 *  what the document holds, an edit here being what a reader is about to apply. */
	function download(): void {
		save(draft, `${ref}.md`, 'text/markdown');
	}

	async function readFile(input: HTMLInputElement): Promise<void> {
		const file = input.files?.[0];
		// The input keeps its value, so re-picking the same file after an edit re-reads it.
		input.value = '';
		if (!file) return;
		try {
			draft = await file.text();
			refused = undefined;
		} catch (err) {
			refused = err instanceof Error ? err.message : String(err);
		}
	}
</script>

<!-- The dialog fills the viewport and centres the plate, so a click on the dialog itself
     landed outside the plate. -->
<dialog
	bind:this={el}
	class="panel"
	aria-label="Document source"
	onclose={onClose}
	onpointerdown={(e) => (pressed = e.target)}
	onclick={(e) => e.target === el && pressed === el && onClose()}
>
	<div class="qm-panel plate">
		<header class="head">
			<h2 class="qm-label">{ref}</h2>
			<button class="qm-control" type="button" data-testid="markdown-close" onclick={onClose}
				>Close</button
			>
		</header>

		<!-- Editable, since replacing the text is how a document comes in. Not a second
		     editor: what is typed reaches the document only through `apply`, all at once. -->
		<textarea
			class="qm-readout source"
			data-testid="markdown-source"
			spellcheck="false"
			rows="16"
			aria-label="Document markdown"
			bind:value={draft}
		></textarea>

		{#if refused}
			<p class="qm-status qm-status-error" data-testid="markdown-refused">{refused}</p>
		{/if}

		<div class="row">
			<button class="qm-control" type="button" data-testid="markdown-download" onclick={download}
				>Download .md</button
			>
			<!-- The input is the control; the label is what it looks like, since a file input
			     draws a button this page does not draw. -->
			<label class="qm-control file">
				Open file…
				<input
					type="file"
					accept=".md,text/markdown,text/plain"
					data-testid="markdown-open"
					onchange={(e) => readFile(e.currentTarget)}
				/>
			</label>
			<!-- Inert until the text differs from the document: applying what is already
			     mounted would reseed a session to land the document it is holding. -->
			<button
				class="qm-control"
				type="button"
				data-testid="markdown-apply"
				disabled={!dirty}
				onclick={async () => (refused = await onApply(draft))}>Apply</button
			>
		</div>
	</div>
</dialog>

<style>
	/* The dialog is the room, not the plate: it takes the viewport so the scrim is
	   clickable everywhere, and the plate inside it is what has a size. The element's own
	   box is stripped of the shape a dialog comes with. */
	.panel {
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: 100%;
		max-width: 100%;
		height: 100%;
		max-height: 100%;
		padding: var(--qmh-space-4);
		border: none;
		background: none;
		overflow: hidden;
	}

	.panel::backdrop {
		/* mint: a scrim is a tone between two planes, and the host scale carries no
		   opacity rung — the recede ladder is the package's own. */
		background: color-mix(in srgb, var(--qmh-page) 80%, transparent);
	}

	.plate {
		display: flex;
		flex-direction: column;
		gap: var(--qmh-space-3);
		width: 100%;
		max-width: var(--st-panel);
		max-height: 100%;
		min-height: 0;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--qmh-space-4);
	}

	/* The block readout, made typable: `pre.qm-readout`'s plate on a control carrying its
	   own scroll. Its height is its rows, which is the one place a document's length is
	   stated in lines rather than in a rung; it takes what the panel has left when the
	   room is shorter than that. */
	.source {
		box-sizing: border-box;
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
		max-height: 100%;
		resize: none;
		background: var(--qmh-page);
		border: var(--qmh-border-width) solid var(--qmh-border);
		border-radius: var(--qmh-radius-inner);
		padding: var(--qmh-space-2);
		white-space: pre;
		overflow: auto;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--qmh-space-2);
	}

	/* A file input draws a control of its own, which is the one control here the page did
	   not draw. The label is the button and the input covers it, transparent: the platform
	   keeps the keyboard and the picker, and the page keeps the look. */
	.file {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.file input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	/* Focus lands on the input, which is transparent and rings nothing. The label wears it,
	   in the preset's ring. */
	.file:focus-within {
		outline: var(--qmh-ring-width) solid var(--qmh-ink);
		outline-offset: var(--qmh-space-half);
	}
</style>
