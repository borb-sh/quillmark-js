<!--
 A `boolean` field → a styled switch on bits-ui.

 Styled rather than a native checkbox: the native box's face is UA-owned shadow
 DOM, so no dial reaches it. The a11y comes with the primitive:
 Switch.Root renders `role="switch"` with its checked state and keyboard handling.

 An unset `boolean?` prints `none`, which neither face of a switch says, so it draws a
 third: the thumb at the track's centre. `role="switch"` admits no third state (a
 `mixed` there reads as false), so an optional boolean's control is a `checkbox`, the
 toggle role that does, announcing `mixed` while unset. A press from unset writes
 `true`; nothing here returns the cell to unset.
-->
<script lang="ts">
	import { Switch } from 'bits-ui';
	import { syncedLocal } from './synced.svelte.js';
	import './controls.css';

	interface Props {
		value: boolean | undefined;
		fallback?: boolean;
		/** A `boolean?` cell, which has a third state: unset, printing `none`. */
		optional?: boolean;
		/** Accessible name for a switch nothing else names: an object property, whose
		 * name is the field label plus the property's. A field's own switch takes `id`
		 * instead and is named by the `<label for>` beside it. */
		label?: string;
		/** `<label for>` target. `Switch.Root` renders a `<button>`, which is labelable,
		 * so the click a label forwards toggles the switch: correct for this control,
		 * and single-fire: the label is a sibling, not a wrapper, so there is no second
		 * click bubbling back up to be re-dispatched. */
		id?: string;
		/** The parked `description` (FieldLabel): announced after the name. */
		describedBy?: string;
		onCommit: (v: boolean) => void;
	}
	let { value, fallback, optional = false, label, id, describedBy, onCommit }: Props = $props();

	// Local toggle state synced to `value`; own-toggles stay local, only an external
	// change reconciles back in (see `syncedLocal`). The primitive is driven
	// controlled (`checked` + `onCheckedChange`, never `bind:`) so reconciliation
	// stays the package's: a two-way bind hands the primitive a lane around it,
	// which repeats the reconciliation hazard in miniature. `undefined` is the unset
	// optional cell, the one state with no default to stand in for it.
	const local = syncedLocal<boolean | undefined>(
		() => value ?? fallback ?? (optional ? undefined : false)
	);
	const unset = $derived(local.value === undefined);
	const tristate = $derived(
		optional ? { role: 'checkbox', 'aria-checked': unset ? ('mixed' as const) : !!local.value } : {}
	);
</script>

<!-- Not `.qm-switch`: that name is the preset's pane band, whose narrow-viewport rule
 stands every child of it at `--qmh-tap`, so a track wearing it grows a thumb three times
 its own height over the labels around it (`preset/recipes.css`, held by `check:style`). -->
<span class="qm-toggle-wrap" data-unset={unset ? '' : undefined}>
	<Switch.Root
		class="qm-toggle qm-focus-ring qm-tap-floor"
		checked={!!local.value}
		{id}
		aria-label={id ? undefined : label}
		aria-describedby={describedBy}
		onCheckedChange={(v) => {
			// From unset the primitive reads the unchecked face, so its toggle is `true`.
			local.value = v;
			onCommit(v);
		}}
	>
		{#snippet child({ props })}
			<button {...props} {...tristate}><Switch.Thumb class="qm-toggle-thumb" /></button>
		{/snippet}
	</Switch.Root>
</span>

<style>
	/* A primitive renders its own element, which a scoped selector cannot reach:
	 styled through the wrapper with `:global`. */
	/* The track is the drawn box and the target is `.qm-tap-floor`'s (controls.css): a
	 switch is a mark standing in a field's row, so its height is the track's, where WCAG
	 2.5.8's floor is half again that. The `<label for>` beside it forwards a press but
	 stands at the label rung, so it is no taller: without the floor no region on the
	 surface reaches this control at the size every other control on it holds. */
	.qm-toggle-wrap :global(.qm-toggle) {
		display: inline-flex;
		align-items: center;
		width: 1.75rem;
		height: 1rem;
		padding: var(--_qm-space-half);
		border: none;
		border-radius: var(--_qm-radius-pill);
		/* The track is a fill and nothing else: an edge around it would be a second
		 statement of a shape the tone already draws, and the checked state swaps that
		 one fill for the accent (ARCHITECTURE §Styling). */
		background: var(--_qm-surface-hover);
		cursor: pointer;
		transition: background var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-toggle-wrap :global(.qm-toggle[data-state='checked']) {
		background: var(--_qm-accent);
	}
	/* The focus ring rides `.qm-focus-ring` on the switch (controls.css). */
	/* The thumb reads on tone alone: the base surface over the track's `hover` rung
	 unchecked, and over `--_qm-accent` checked. No edge of its own: a hairline around
	 a 12px pill is a second box inside the track's. */
	.qm-toggle-wrap :global(.qm-toggle-thumb) {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: var(--_qm-radius-pill);
		background: var(--_qm-surface);
		transition: translate var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-toggle-wrap :global(.qm-toggle-thumb[data-state='checked']) {
		translate: 0.75rem;
	}
	/* Unset, the thumb stands at neither end: halfway along its travel. */
	.qm-toggle-wrap[data-unset] :global(.qm-toggle-thumb) {
		translate: 0.375rem;
	}
</style>
