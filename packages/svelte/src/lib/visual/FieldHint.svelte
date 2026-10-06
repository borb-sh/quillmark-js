<!--
 The schema `description` as a themed floating surface: the second that is read
 rather than picked from, so it shares {@link FormatPopover}'s translucent recipe
 and portals into the nearest `[data-qm-root]` like every
 other floating surface, so a consumer's dials still reach it.

 Not the native `title` tooltip: that reaches no dial, waits ~1s, cannot be
 dismissed, and (the part that makes it a hole rather than a blemish) does not exist
 on touch, which leaves guidance the reference quill puts on nearly every field
 reachable on a tablet only through a screen reader.

 Floating rather than inline under the label: the reference quill's descriptions run
 to a median of ~110 characters and past 250 at the tail: permanently in flow that
 is several wrapped lines under every field, which is the density the card is built
 to avoid. Measured, not assumed; a quill whose descriptions are all one short line
 would be better served inline.

 The popover is chrome, not the announcement. Its content is `aria-hidden`: the
 description reaches assistive tech through the always-present parked node
 {@link FieldLabel} renders and the `aria-describedby` the control carries, which
 holds whether the surface is open or not. So no reader depends on a hover.

 Three ways in, one per input modality: hover (pointer), focus (keyboard), tap
 (touch); wired here rather than taken from `Tooltip`, whose trigger returns early
 on `pointerType === 'touch'` and closes on click.
-->
<script lang="ts">
	import { Popover } from 'bits-ui';
	import Icon from './icons/Icon.svelte';
	import './controls.css';

	interface Props {
		description: string;
		/** The field's label: the trigger's own name, so 30 info buttons on a card
		 * do not all announce alike. */
		label: string;
		/** The parked description node; the trigger points at it too, so a reader
		 * that lands here announces the guidance rather than only the field's own. */
		describedBy?: string;
	}
	let { description, label, describedBy }: Props = $props();

	let open = $state(false);
	let triggerEl = $state<HTMLButtonElement | undefined>(undefined);
	/** The root to portal into: `document.body` would escape the consumer's dials
	 * along with the editor's subtree. `undefined` falls back to bits-ui's default. */
	const portalTarget = $derived(triggerEl?.closest<HTMLElement>('[data-qm-root]') ?? undefined);

	/** What the surface stays inside: the field's own card and the root it portals into.
	 * floating-ui intersects the two, so a flip answers to whichever is tighter. Empty
	 * falls back to the primitive's default, the surface's own clipping ancestors. */
	const bounds = $derived(
		[triggerEl?.closest<HTMLElement>('[data-qm-card]'), portalTarget].filter((el) => el != null)
	);

	/** Placement, re-measured on each opening: the surface rides the label rung beside
	 * the glyph, or stands over the field. */
	let beside = $state(false);

	/** Whether this description sets one line. Off a probe rather than the surface
	 * itself, since the side is a prop the surface is positioned from, and a side chosen
	 * after the fact moves a surface the reader is already looking at. The probe wears
	 * the surface's own class inside the portal target, so it wraps to the same measure
	 * under the same dials; `width: max-content` keeps that measure the class's rather
	 * than the containing block's. Line boxes are counted off a range over the text
	 * rather than derived from a height, which would need the line rung and the inset
	 * restated here as numbers. A DOM with no layout yields none, which stands the
	 * surface over the field. */
	function ridesTheRung(): boolean {
		const host = portalTarget ?? document.body;
		const probe = document.createElement('div');
		probe.className = 'qm-hint-popover';
		probe.style.cssText =
			'position:absolute;width:max-content;visibility:hidden;pointer-events:none';
		probe.textContent = description;
		host.appendChild(probe);
		const range = document.createRange();
		range.selectNodeContents(probe);
		const lines = range.getClientRects().length;
		probe.remove();
		return lines === 1;
	}

	/** How far the trigger's target reaches past its glyph on the axis the surface stands
	 * on, which makes the side offset clearance from the target rather than from the
	 * glyph. The target is `.qm-tap-floor`'s box (controls.css), centred on the glyph and
	 * read off it rather than restated. A surface landing on the target takes a resting
	 * pointer off the trigger, which closes the surface, and hands the pointer back as it
	 * goes: a loop. A DOM with no layout reads none. */
	let reach = $state(0);

	function targetReach(): number {
		if (triggerEl === undefined) return 0;
		const glyph = triggerEl.getBoundingClientRect();
		const target = getComputedStyle(triggerEl, '::after');
		const [across, own] = beside ? [target.width, glyph.width] : [target.height, glyph.height];
		return Math.max(0, (parseFloat(across) - own) / 2) || 0;
	}

	function raise(): void {
		beside = ridesTheRung();
		reach = targetReach();
		open = true;
	}
</script>

<!-- The trigger is ours, not `Popover.Trigger`, and the surface anchors to it:
 the same shape {@link FormatPopover} uses. The primitive's trigger owns a click
 toggle, which fights every one of the three openings below: a mouse click after
 a hover-open would close, and on touch the focus that precedes the click opens
 it just in time for the click to close it again. -->
<button
	bind:this={triggerEl}
	type="button"
	class="qm-field-hint qm-icon-btn qm-focus-ring qm-tap-floor"
	aria-label="{label} guidance"
	aria-expanded={open}
	aria-describedby={describedBy}
	onpointerenter={(e) => {
		if (e.pointerType !== 'touch') raise();
	}}
	onpointerleave={(e) => {
		if (e.pointerType !== 'touch') open = false;
	}}
	onpointerup={(e) => {
		// Touch only, and a toggle: the one modality with no hover to leave and no
		// blur on the way out. A mouse press falls through to hover, which already
		// has it open and will close it on the way off.
		if (e.pointerType === 'touch') {
			if (open) open = false;
			else raise();
		}
	}}
	onfocus={(e) => {
		// Keyboard arrival only. A pointer press focuses the button too, and opening
		// on that would re-open what the tap just toggled shut; `:focus-visible` is
		// the UA's own answer to which arrival this was.
		if (e.currentTarget.matches(':focus-visible')) raise();
	}}
	onblur={() => (open = false)}
	onkeydown={(e) => {
		if (e.key === 'Escape' && open) {
			// Stopped here so the key does not travel on to a card- or editor-level
			// Escape.
			e.stopPropagation();
			open = false;
		}
	}}><Icon name="info" size={13} /></button
>

<!-- Placement is the description's height. One line rides the label rung beside its own
 glyph, where the overhang past the rung's line box falls in the label-to-control gaps.
 Anything taller stands over the field: beside the glyph it would hang onto the control
 it describes, the one overlap a reader cannot clear by reaching for what is hidden,
 since a pointer leaving the trigger closes the surface. Over the field it covers a
 neighbour's control instead, which reaching for it dismisses. -->
<!-- `align="center"` for the rung, `"start"` over the field: centred, a surface taller
 than the glyph's line box would hang half its height onto the field's own control. -->
<!-- Both are preferences, and the card is what refuses them: its first field has no room
 above its label inside one, so standing over that field puts the surface on the ground
 above the card, reading as the neighbour's rather than as this field's. Refused, the
 placement reverses and the surface goes under the field, over the control it describes:
 the overlap the fork above spends a probe to avoid, and the only one left where there is
 nothing above to stand over. -->

<Popover.Root bind:open>
	<Popover.Portal to={portalTarget}>
		<Popover.Content
			customAnchor={triggerEl ?? null}
			collisionBoundary={bounds}
			side={beside ? 'right' : 'top'}
			align={beside ? 'center' : 'start'}
			sideOffset={6 + reach}
			trapFocus={false}
			onOpenAutoFocus={(e: Event) => e.preventDefault()}
			onCloseAutoFocus={(e: Event) => e.preventDefault()}
		>
			<!-- The `child` snippet, the same shape {@link FormatPopover} takes and for
			 the same reason: the surface is the primitive's own content node, so the
			 dismissal animation is one the primitive waits on before unmounting.
			 `data-qm-root` because a portalled subtree is
			 detached for the derivation's purposes, and the marker is what applies
			 it; `wrapperProps` is floating-ui's positioning box, spread and never
			 styled. `inert` is the half of the dismissal the recipe cannot carry: the
			 surface is still on screen for the length of the fade, and one on its way
			 out is not a thing to click. -->
			{#snippet child({ props, wrapperProps, open: raised })}
				<div {...wrapperProps}>
					<div
						{...props}
						class="qm-hint-popover qm-popover-surface"
						data-qm-root
						aria-hidden="true"
						inert={!raised}
					>
						{description}
					</div>
				</div>
			{/snippet}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>

<style>
	/* Chrome, type and ring are the glyph-button family's (`.qm-icon-btn` +
	 `.qm-focus-ring`, controls.css): this trigger is one more glyph button and
	 assembles none of that itself. What it does not take is the family's tap floor
	 and the fill that floor sizes, because this is the one glyph button that sits in
	 a line of text rather than in a row of its own: the floor is half again the label
	 rung's line box, so a target-sized paint box overhangs the line at each end by
	 most of the field's label-to-control gap: the hover fill landing on the input's
	 top border, the focus ring crossing it.

	 So the box is the glyph and the target is `.qm-tap-floor`'s (controls.css), which
	 carries that split and the giving-up of the family floor together.

	 It takes no fill either: the ink step below says hover, and the surface itself
	 opens on it. */
	.qm-field-hint {
		/* The marker recedes to the label rung; the surface carries the text. */
		color: var(--_qm-ink-label);
		/* Not the family's `pointer`: the glyph raises guidance, it does not act. */
		cursor: help;
		padding: 0;
		background: none;
	}
	.qm-field-hint:hover,
	.qm-field-hint:focus-visible {
		color: var(--_qm-ink-label);
	}
	/* The lift, the translucency, the blur and the scale-in come from
	 `.qm-popover-surface` (controls.css). This surface's own is a measure: guidance
	 is prose, and prose past ~40 characters a line stops being scannable; plus the
	 inset and the meta type rung that keep it a note about a field rather than a
	 second field.

	 Unscoped, because the placement probe wears this class on a node Svelte never
	 compiled: a scoped rule would leave the probe wrapping to a different measure
	 than the surface it stands in for, which is the one thing the probe must not do. */
	:global(.qm-hint-popover) {
		max-width: 22rem;
		padding: var(--_qm-space) var(--_qm-space-2);
		font-size: var(--_qm-text-label);
		line-height: var(--_qm-leading-body);
		color: var(--_qm-ink-label);
	}
</style>
