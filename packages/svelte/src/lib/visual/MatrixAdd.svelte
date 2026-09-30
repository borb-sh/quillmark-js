<!--
 An open matrix's add box (VISUAL_EDITOR §"The matrix"): a combobox whose options are
 what the typed words name across the document's checklists, best first, and last the
 item they would add to this one. The list stands in flow under the input rather than
 floating, so a closing group panel clips nothing of it, and it closes while the focus
 is elsewhere. The input keeps the caret throughout and the active option is
 `aria-activedescendant`, the combobox pattern: ↑/↓ walk, Enter picks, Escape clears.
 Unwalked, the active option is the first result the words name outright, else the add
 option: a result named only by abbreviation, which may stand in another card, is
 taken by an arrow or a press and never by Enter alone.
-->
<script lang="ts">
	import Icon from './icons/Icon.svelte';
	import type { AddOption } from './checklists.js';
	import './controls.css';

	interface Props {
		/** The input's id, and the base its listbox and options derive theirs from. */
		id: string;
		/** The input's accessible name and its words at rest. */
		placeholder: string;
		/** The options `query` offers, best first; the add option, where there is one, last. */
		options: (query: string) => AddOption[];
		onChoose: (option: AddOption, query: string) => void;
	}
	let { id, placeholder, options, onChoose }: Props = $props();

	let query = $state('');
	/** The walked option, `undefined` until an arrow or the pointer moves it. */
	let walked = $state<number | undefined>();
	let focused = $state(false);
	let inputEl = $state<HTMLInputElement | undefined>();
	const shown = $derived(query.trim() ? options(query.trim()) : []);
	const open = $derived(focused && shown.length > 0);
	const active = $derived.by(() => {
		if (walked !== undefined) return Math.min(walked, shown.length - 1);
		const strong = shown.findIndex((o) => o.strong);
		if (strong >= 0) return strong;
		const add = shown.findIndex((o) => o.add);
		return add >= 0 ? add : 0;
	});
	const listId = $derived(`${id}-list`);
	const optionId = (k: number): string => `${id}-opt-${k}`;

	export function focus(): void {
		inputEl?.focus();
	}

	function choose(k: number): void {
		const option = shown[k];
		if (!option) return;
		const typed = query.trim();
		query = '';
		walked = undefined;
		onChoose(option, typed);
	}

	function onkeydown(e: KeyboardEvent): void {
		if (e.isComposing) return;
		if (e.key === 'ArrowDown' && open) {
			e.preventDefault();
			walked = (active + 1) % shown.length;
		} else if (e.key === 'ArrowUp' && open) {
			e.preventDefault();
			walked = (active - 1 + shown.length) % shown.length;
		} else if (e.key === 'Enter' && open) {
			e.preventDefault();
			choose(active);
		} else if (e.key === 'Escape' && query) {
			e.preventDefault();
			e.stopPropagation();
			query = '';
			walked = undefined;
		}
	}
</script>

<div class="qm-matrix-add">
	<span class="qm-matrix-add-field">
		<Icon name="plus" class="qm-matrix-add-glyph" />
		<input
			bind:this={inputEl}
			{id}
			class="qm-input qm-focus-ring"
			type="text"
			role="combobox"
			autocomplete="off"
			aria-label={placeholder}
			aria-autocomplete="list"
			aria-expanded={open}
			aria-controls={listId}
			aria-activedescendant={open ? optionId(active) : undefined}
			{placeholder}
			value={query}
			oninput={(e) => {
				query = e.currentTarget.value;
				walked = undefined;
			}}
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			{onkeydown}
		/>
	</span>
	<!-- Always mounted, so `aria-controls` names an element at rest too; empty, it draws
	     nothing. -->
	<div
		class="qm-menu-surface qm-matrix-add-list"
		role="listbox"
		id={listId}
		aria-label={placeholder}
		hidden={!open}
	>
		{#each shown as option, k (option.key)}
			<!-- The input keeps focus and owns the keys; a press picks without taking it. -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="qm-menu-item qm-matrix-add-option"
				class:add={option.add}
				role="option"
				id={optionId(k)}
				tabindex="-1"
				aria-selected={k === active}
				data-highlighted={k === active ? '' : undefined}
				onpointerdown={(e) => e.preventDefault()}
				onpointermove={() => (walked = k)}
				onclick={() => choose(k)}
			>
				{#if option.add}<Icon name="plus" class="qm-matrix-add-glyph" />{/if}
				<span class="qm-matrix-add-title">{option.title}</span>
				{#if option.note}<span class="qm-matrix-add-note">{option.note}</span>{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	/* The box's text, and every option's, starts past the glyph slot at its leading edge,
	 so a result reads in the column the typed words stand in and the add option's `+`
	 stands under the box's. */
	.qm-matrix-add {
		--_slot: calc(var(--_qm-space-2) * 2 + var(--_qm-glyph-control));
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space-half);
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
	/* The list is a menu, raised over the card rather than cut into it, so its options
	 read as choices and not as a second field. Its edge and inset come off each
	 option's, which keeps the column. */
	.qm-matrix-add-list {
		display: flex;
		flex-direction: column;
	}
	.qm-matrix-add-list[hidden] {
		display: none;
	}
	.qm-matrix-add-option {
		position: relative;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--_qm-space-2);
		padding-inline-start: calc(var(--_slot) - var(--_qm-space-half) - var(--_qm-border-width));
		font-size: var(--_qm-text-body);
		color: var(--_qm-ink);
	}
	.qm-matrix-add-option :global(.qm-matrix-add-glyph) {
		inset-inline-start: calc(var(--_qm-space-2) - var(--_qm-space-half) - var(--_qm-border-width));
		inset-block-start: 50%;
		translate: 0 -50%;
	}
	/* The add option reads at the label ink: it offers a new item, where a result names
	 one the document already knows. */
	.qm-matrix-add-option.add {
		color: var(--_qm-ink-label);
	}
	.qm-matrix-add-note {
		flex-shrink: 0;
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
	}
</style>
