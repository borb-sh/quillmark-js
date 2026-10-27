<!--
  Card controls, composable cards only.
  Right-aligned in the header: a move-up/move-down chevron pair (each disabled at its
  edge), then delete, the row revealed while the pointer or the caret is in the card.
  Reorder is buttons, not drag (V1). All three are chips (controls.css): fill arrives
  on hover, and delete rests at the label ink beside them. The card scopes
  that reveal, so its condition lives in the parent's CSS; the row keeps the narrower
  guarantee here, that a focused control is a visible one.
-->
<script lang="ts">
	import { wording } from './strings.js';

	// The surface's words, ambient from the editor root; the package's English
	// off-tree, so this component renders standalone too.
	const t = wording();
	import Icon from './icons/Icon.svelte';
	import './controls.css';

	interface Props {
		isFirst: boolean;
		isLast: boolean;
		onMoveUp: () => void;
		onMoveDown: () => void;
		onDelete: () => void;
	}
	let { isFirst, isLast, onMoveUp, onMoveDown, onDelete }: Props = $props();
</script>

<div class="qm-card-controls">
	<div class="qm-card-reorder">
		<button
			type="button"
			class="qm-chip qm-focus-ring"
			title={t.strings.cardMoveUp}
			disabled={isFirst}
			onclick={onMoveUp}><Icon name="chevron-up" /></button
		>
		<button
			type="button"
			class="qm-chip qm-focus-ring"
			title={t.strings.cardMoveDown}
			disabled={isLast}
			onclick={onMoveDown}><Icon name="chevron-down" /></button
		>
	</div>
	<button
		type="button"
		class="qm-chip qm-card-delete qm-focus-ring"
		title={t.strings.cardDelete}
		onclick={onDelete}><Icon name="trash-2" /></button
	>
</div>

<style>
	.qm-card-controls {
		display: flex;
		align-items: center;
		gap: var(--_qm-space-half);
		opacity: 0;
		transition: opacity var(--_qm-duration-fast) var(--_qm-ease-reverse);
		/* One compositor layer for the row at rest as well as mid-fade: a box handed
		   back to the document paint when its fade ends snaps off the header's
		   half-pixel as it lands. */
		transform: translateZ(0);
	}
	.qm-card-reorder {
		display: flex;
	}
	/* Opacity hides the row without taking it out of the tab order, which keeps
	   delete the keyboard's way to remove a card, so the component holds its own
	   floor: a control that has focus is drawn, and its ring with it. The card's
	   reveal already covers this; the rule is here because the hidden state is. */
	.qm-card-controls:focus-within {
		opacity: 1;
	}
	/* Squares: the chip's inline pad is for a label. Width and height are one rung
	 so the hover fill is a square and the glyph sits in the middle. */
	.qm-card-controls button {
		width: var(--_qm-tap-min);
		height: var(--_qm-tap-min);
		padding: 0;
	}
	/* The delete rests at the chip's label ink, as an array row's and a matrix member's
	 remove do, and under the pointer or the focus takes their danger tint and ink in
	 place of the chip's hover fill. */
	.qm-card-delete:hover,
	.qm-card-delete:focus-visible {
		background: var(--_qm-danger-tint);
		color: var(--_qm-danger);
	}
</style>
