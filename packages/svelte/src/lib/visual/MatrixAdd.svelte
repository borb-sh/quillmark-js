<!--
 An open matrix's add box (VISUAL_EDITOR §"The matrix"): a plain text input. Enter adds
 what was typed, trimmed, and clears the box; Escape clears it. It is drawn as the item
 it adds, unwritten: the plus in the tick's column and the words in the title's.
-->
<script lang="ts">
	import Icon from './icons/Icon.svelte';
	import './controls.css';

	interface Props {
		id: string;
		/** The input's accessible name and its words at rest. */
		placeholder: string;
		/** Add an item titled `title`, never empty. */
		onAdd: (title: string) => void;
	}
	let { id, placeholder, onAdd }: Props = $props();

	let typed = $state('');
	let inputEl = $state<HTMLInputElement | undefined>();

	export function focus(): void {
		inputEl?.focus();
	}

	function onkeydown(e: KeyboardEvent): void {
		if (e.isComposing) return;
		if (e.key === 'Enter' && typed.trim()) {
			e.preventDefault();
			const title = typed.trim();
			typed = '';
			onAdd(title);
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
		/>
	</label>
</div>

<style>
	.qm-matrix-add {
		min-width: 0;
	}
	/* An added item's head (`MatrixField.svelte`): the glyph a tick's width at the
	 tick's place, the gap after it the head's, and the input pulled back over that gap
	 by its own inset, so its words start where the titles above them do. A `<label>`,
	 so a press on the glyph lands in the box. */
	.qm-matrix-add-field {
		display: flex;
		align-items: center;
		gap: var(--_qm-space-2);
		min-width: 0;
	}
	.qm-matrix-add :global(.qm-matrix-add-glyph) {
		flex-shrink: 0;
		width: var(--_qm-glyph-control);
		height: var(--_qm-glyph-control);
		color: var(--_qm-ink-label);
	}
	/* At rest the box is the add chip it stands in for: no well, its words at the label
	 ink, and the line at the chip's idle rung. The line comes up under the pointer with
	 the well, and both stay while the box holds the focus or typed words. */
	.qm-matrix-add-field {
		opacity: var(--_qm-opacity-idle);
		transition: opacity var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-matrix-add-field:hover,
	.qm-matrix-add-field:focus-within,
	.qm-matrix-add-field:has(.qm-input:not(:placeholder-shown)) {
		opacity: 1;
	}
	.qm-matrix-add-field .qm-input {
		flex: 1;
		min-width: 0;
		margin-inline-start: calc(-1 * var(--_qm-space-2));
		padding-inline-start: var(--_qm-space-2);
		transition: background-color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-matrix-add-field .qm-input:placeholder-shown:not(:focus) {
		background: transparent;
	}
	.qm-matrix-add-field:hover .qm-input:placeholder-shown:not(:focus) {
		background: var(--_qm-surface-hover);
	}
	/* No hover to come up on: the line stands at the muted rung, as the chip does. */
	@media (hover: none) {
		.qm-matrix-add-field {
			opacity: var(--_qm-opacity-muted);
		}
	}
</style>
