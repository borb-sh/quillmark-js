<!--
 One of the formatting popover's font menus (FormatPopover): a trigger showing what
 the selection is set in, and the list of what a pick sets it to. Driven controlled, as
 EnumField is: the selection is the value, and a pick is a command the popover runs at
 the leaf, never a value this component keeps.

 The focus stays on the trigger while the list is open, bits-ui's listbox model, so the
 popover holds as it does over its link input. The list portals into the popover's root
 and carries `data-qm-format-menu`, which is how the popover tells a press on it from one
 off the surface: the list is not inside the surface's DOM, and a press there is still a
 press on the surface. Closing, the popover hands the focus back to the leaf whose
 selection the pick acted on.
-->
<script lang="ts">
	import { Select } from 'bits-ui';
	import Icon from './icons/Icon.svelte';
	import { spacePx } from '../core/rungs.js';

	interface Item {
		value: string;
		label: string;
		/** A CSS `font-family` the row draws in: a family's row shows its face. */
		face?: string;
		disabled?: boolean;
	}

	interface Props {
		/** The accessible name and hover title. */
		label: string;
		/** The selected row, `undefined` over a selection set in more than one value. */
		value: string | undefined;
		/** What the closed trigger shows. */
		shown: string;
		items: Item[];
		portalTarget: HTMLElement | undefined;
		onPick: (value: string) => void;
		/** The list closed, with a pick or without one. */
		onClose: () => void;
	}
	let { label, value, shown, items, portalTarget, onPick, onClose }: Props = $props();
</script>

<span class="qm-format-menu-wrap">
	<Select.Root
		type="single"
		allowDeselect={false}
		value={value ?? ''}
		onValueChange={(v) => {
			if (v && v !== value) onPick(v);
		}}
		onOpenChange={(open) => {
			if (!open) onClose();
		}}
	>
		<Select.Trigger
			class="qm-icon-btn qm-format-menu qm-focus-ring"
			aria-label={label}
			title={label}
		>
			<span class="qm-format-menu-shown">{shown}</span>
			<Icon name="chevron-down" class="qm-format-menu-chevron" />
		</Select.Trigger>
		<Select.Portal to={portalTarget}>
			<Select.Content collisionBoundary={portalTarget ?? []} sideOffset={spacePx(portalTarget)}>
				<div class="qm-menu-surface qm-format-menu-list" data-qm-root data-qm-format-menu>
					<Select.Viewport>
						{#each items as item (item.value)}
							<Select.Item
								class="qm-menu-item qm-format-menu-item"
								value={item.value}
								label={item.label}
								disabled={item.disabled}
							>
								<span style:font-family={item.face}>{item.label}</span>
							</Select.Item>
						{/each}
					</Select.Viewport>
				</div>
			</Select.Content>
		</Select.Portal>
	</Select.Root>
</span>

<style>
	/* A primitive renders its own element, which a scoped selector cannot reach: styled
	   through the wrapper with `:global`. The trigger is the popover's mark button
	   carrying a word rather than a glyph: its inset and ink, and the word and the
	   chevron in a row. The word is one line, cut where a long family would widen the
	   surface. */
	.qm-format-menu-wrap {
		display: contents;
	}
	.qm-format-menu-wrap :global(.qm-format-menu) {
		display: inline-flex;
		align-items: center;
		gap: var(--_qm-space-half);
		max-width: 10rem;
		padding: var(--_qm-space) var(--_qm-space-2);
		color: var(--_qm-ink);
	}
	.qm-format-menu-shown {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.qm-format-menu-wrap :global(.qm-format-menu-chevron) {
		flex-shrink: 0;
		width: var(--_qm-glyph-control);
		height: var(--_qm-glyph-control);
	}
	/* What a listbox adds over the menu recipe (controls.css), as EnumField's list does:
	   it spans its trigger, scrolls past a screenful, and marks the value in force. */
	.qm-format-menu-list {
		min-width: var(--bits-select-anchor-width);
		max-height: 16rem;
		overflow-y: auto;
	}
	.qm-format-menu-list :global(.qm-format-menu-item[data-selected]) {
		font-weight: var(--_qm-weight-strong);
	}
	.qm-format-menu-list :global(.qm-format-menu-item[data-disabled]) {
		opacity: var(--_qm-opacity-muted);
		cursor: default;
	}
</style>
