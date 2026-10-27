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

 An unset switch draws its `default:` at the default rung, as every control draws a
 printed default: a checked track takes the accent's default rung.
-->
<script lang="ts">
	import { Switch } from 'bits-ui';
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

	// The primitive is driven controlled (`checked` + `onCheckedChange`, never `bind:`)
	// so reconciliation stays the package's: a two-way bind hands the primitive a lane
	// around it, which repeats the reconciliation hazard in miniature. `undefined` is
	// the unset optional cell, the one state with no default to stand in for it.
	let local = $derived<boolean | undefined>(value ?? fallback ?? (optional ? undefined : false));
	const unset = $derived(local === undefined);
	const defaulted = $derived(value === undefined && fallback !== undefined);
	const tristate = $derived(
		optional ? { role: 'checkbox', 'aria-checked': unset ? ('mixed' as const) : !!local } : {}
	);
</script>

<!-- Not `.qm-switch`: that name is the preset's pane band, whose narrow-viewport rule
 stands every child of it at `--qmh-tap`, so a track wearing it grows a thumb three times
 its own height over the labels around it (`preset/shell.css`, held by `check:style`). -->
<span
	class="qm-toggle-wrap"
	data-unset={unset ? '' : undefined}
	data-default={defaulted ? '' : undefined}
>
	<Switch.Root
		class="qm-toggle qm-focus-ring qm-tap-floor"
		checked={!!local}
		{id}
		aria-label={id ? undefined : label}
		aria-describedby={describedBy}
		onCheckedChange={(v) => {
			// From unset the primitive reads the unchecked face, so its toggle is `true`.
			local = v;
			onCommit(v);
		}}
	>
		{#snippet child({ props })}
			<button {...props} {...tristate}><Switch.Thumb class="qm-toggle-thumb" /></button>
		{/snippet}
	</Switch.Root>
</span>

<style>
	/* The switch stands on the first line of the boxes beside it: a row of controls tops
	 out together, and a mark carries no line of its own to sit on.

	 One length, the thumb's, and the track is two of them around the inset: the travel
	 is a thumb's width at every setting of `--qm-space`, where a track sized apart from
	 its inset ran the checked thumb into the end cap as the inset grew. */
	.qm-toggle-wrap {
		--thumb: 0.75rem;
		display: flex;
		align-items: center;
		min-height: var(--_qm-box-line);
	}
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
		width: calc(2 * var(--thumb) + 2 * var(--_qm-space-half));
		height: calc(var(--thumb) + 2 * var(--_qm-space-half));
		padding: var(--_qm-space-half);
		border: none;
		border-radius: var(--_qm-radius-pill);
		/* The track is a fill and nothing else: an edge around it would be a second
		 statement of a shape the tone already draws, and the checked state swaps that
		 one fill for the accent (ARCHITECTURE §Styling). The fill is the band, a
		 resting tone: on the hover rung an off switch read as a button under the
		 pointer. */
		background: var(--_qm-surface-band);
		cursor: pointer;
		transition: background var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-toggle-wrap :global(.qm-toggle[data-state='checked']) {
		background: var(--_qm-accent);
	}
	.qm-toggle-wrap[data-default] :global(.qm-toggle[data-state='checked']) {
		background: var(--_qm-accent-default);
	}
	/* The focus ring rides `.qm-focus-ring` on the switch (controls.css). */
	/* The thumb reads on tone alone, and its tone is what says where it stands: the
	 label rung over the track's band unchecked, and the base surface over
	 `--_qm-accent` checked. The card's own tone over the band is a step of about
	 1.3:1 in light and 1.5:1 in dark, a state indicator under WCAG 1.4.11's 3:1; the
	 label rung clears it at both, at 4.6:1 and 3.3:1. No edge of its own: a hairline
	 around a 12px pill is a second box inside the track's. */
	.qm-toggle-wrap :global(.qm-toggle-thumb) {
		width: var(--thumb);
		height: var(--thumb);
		border-radius: var(--_qm-radius-pill);
		background: var(--_qm-ink-label);
		transition:
			translate var(--_qm-duration-fast) var(--_qm-ease-reverse),
			background var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-toggle-wrap :global(.qm-toggle-thumb[data-state='checked']) {
		translate: var(--thumb);
		background: var(--_qm-surface);
	}
	/* Unset, the thumb stands at neither end: halfway along its travel. */
	.qm-toggle-wrap[data-unset] :global(.qm-toggle-thumb) {
		translate: calc(var(--thumb) / 2);
	}
</style>
