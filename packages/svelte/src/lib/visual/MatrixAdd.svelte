<!--
 An open matrix's add box (INVARIANTS §"The matrix"): a plain text input. Enter adds
 what was typed, trimmed, and clears the box, and so does the focus leaving it: words
 typed there are an item, not a draft a click elsewhere discards. Escape clears it
 unadded. It is a box the width of the list, the plus inside it at its start.
-->
<script lang="ts">
	import Icon from './icons/Icon.svelte';
	import './controls.css';

	interface Props {
		id: string;
		/** The input's accessible name and its words at rest. */
		placeholder: string;
		/** Add an item titled `title`, never empty. `land` is off where the focus has
		 *  already gone elsewhere and stays there. */
		onAdd: (title: string, land: boolean) => void;
	}
	let { id, placeholder, onAdd }: Props = $props();

	let typed = $state('');
	let inputEl = $state<HTMLInputElement | undefined>();

	export function focus(): void {
		inputEl?.focus();
	}

	function take(land: boolean): void {
		const title = typed.trim();
		typed = '';
		if (title) onAdd(title, land);
	}
	function onkeydown(e: KeyboardEvent): void {
		if (e.isComposing) return;
		if (e.key === 'Enter' && typed.trim()) {
			e.preventDefault();
			take(true);
		} else if (e.key === 'Escape' && typed) {
			e.preventDefault();
			e.stopPropagation();
			typed = '';
		}
	}
</script>

<div class="qm-matrix-add">
	<label class="qm-matrix-add-field">
		<Icon name="plus" class="qm-matrix-add-glyph" />
		<input
			bind:this={inputEl}
			bind:value={typed}
			{id}
			class="qm-input qm-focus-ring"
			type="text"
			autocomplete="off"
			aria-label={placeholder}
			{placeholder}
			{onkeydown}
			onblur={() => inputEl?.isConnected && take(false)}
		/>
	</label>
</div>

<style>
	.qm-matrix-add {
		min-width: 0;
	}
	/* The glyph stands inside the box, at its start inset, as a list's standing row draws
	 its words inside its own: the box is the whole row, and the input's words start a
	 gap past the glyph. A `<label>`, so a press on the glyph lands in the box. */
	.qm-matrix-add-field {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.qm-matrix-add :global(.qm-matrix-add-glyph) {
		position: absolute;
		inset-inline-start: var(--_qm-space-3);
		width: var(--_qm-glyph-control);
		height: var(--_qm-glyph-control);
		color: var(--_qm-ink-label);
		pointer-events: none;
	}
	/* At rest the box is the add chip it stands in for: no well, and its words at the
	 label ink in full, as the add chip's are: words take the text floor, not the rest rung
	 a glyph control rests at. */
	.qm-matrix-add-field .qm-input {
		flex: 1;
		min-width: 0;
		padding-inline-start: calc(var(--_qm-space-3) + var(--_qm-glyph-control) + var(--_qm-space-2));
		transition: background-color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-matrix-add-field .qm-input:placeholder-shown:not(:focus) {
		background: transparent;
	}
	.qm-matrix-add-field:hover .qm-input:placeholder-shown:not(:focus) {
		background: var(--_qm-surface-hover);
	}
</style>
