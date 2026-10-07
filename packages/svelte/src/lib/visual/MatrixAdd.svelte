<!--
 An open matrix's add box (VISUAL_EDITOR §"The matrix"): a plain text input. Enter adds
 what was typed, trimmed, and clears the box; Escape clears it.
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
	<span class="qm-matrix-add-field">
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
	</span>
</div>

<style>
	.qm-matrix-add {
		--_slot: calc(var(--_qm-space-2) * 2 + var(--_qm-glyph-control));
		min-width: 0;
	}
	.qm-matrix-add-field {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.qm-matrix-add :global(.qm-matrix-add-glyph) {
		position: absolute;
		inset-inline-start: var(--_qm-space-2);
		width: var(--_qm-glyph-control);
		height: var(--_qm-glyph-control);
		color: var(--_qm-ink-label);
		pointer-events: none;
	}
	/* At rest the box is the add chip it stands in for: no well, its words at the label
	 ink. The well comes up under the pointer, and stays while it holds the focus or
	 typed words. */
	.qm-matrix-add-field .qm-input {
		flex: 1;
		min-width: 0;
		padding-inline-start: var(--_slot);
		transition: background-color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-matrix-add-field .qm-input:placeholder-shown:not(:focus) {
		background: transparent;
	}
	.qm-matrix-add-field .qm-input:placeholder-shown:not(:focus):hover {
		background: var(--_qm-surface-hover);
	}
</style>
