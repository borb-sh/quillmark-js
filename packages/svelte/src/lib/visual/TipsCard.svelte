<!--
 The ephemeral tips card. Renders the
 `$ext.editor.tips` channel one tip at a time: dots reach any tip in the set, and the
 foot's one button advances until the last, where it becomes the dismiss. Dismissal
 clears the channel in the Document, so the card is gone and does not reappear.

 The cursor is local state, not the channel. Advancing writes nothing: a per-tip
 write would round-trip the boundary, re-derive the card tree, and dirty the
 document (firing a consumer's autosave) on what is a read gesture. Exactly one
 write happens, at dismissal, and this component unmounts with it, so the cursor
 needs no reset.
-->
<script lang="ts">
	import { wording } from './strings.js';

	// The surface's words, ambient from the editor root; the package's English
	// off-tree, so this component renders standalone too.
	const t = wording();
	import Icon from './icons/Icon.svelte';
	import { renderTip } from './tips.js';
	import type { EditorErrorHandler } from '../core/errors.js';
	import './controls.css';

	interface Props {
		/** The narrowed channel (`tipsChannel`); never empty; the parent gates on length. */
		tips: string[];
		/** Clear `$ext.editor.tips`: the patch-write that preserves the `title` sibling. */
		onDismiss: () => void;
		/** A tip whose markdown did not render; it shows literally either way. */
		onError?: EditorErrorHandler;
	}
	let { tips, onDismiss, onError }: Props = $props();

	/** Control-glyph size: the shared rule, as CardControls. */
	const GLYPH = 14;

	let cursor = $state(0);
	// Clamped: the channel is consumer-authored and can be re-seeded shorter while
	// the card is open, which would otherwise index past the end.
	const index = $derived(Math.min(cursor, tips.length - 1));
	const isLast = $derived(index >= tips.length - 1);

	// The tip string is derived before the attachment reads it, and that is load-bearing.
	// Reading `tips[index]` inside the attachment makes the parent's `model` derive the
	// dependency (a fresh object every `revision` bump) so it would re-run on every
	// unrelated commit, re-crossing the WASM boundary and rebuilding this `aria-live`
	// region per keystroke. A derived string short-circuits on `===`.
	const tip = $derived(tips[index] ?? '');

	// The tip is DOM, not text: `renderTip` returns a fragment the codec's own
	// `toDOM` built, so it is written in rather than interpolated.
	function writeTip(body: HTMLDivElement): void {
		body.replaceChildren(renderTip(tip, onError));
	}

	function advance(): void {
		if (isLast) onDismiss();
		else cursor = index + 1;
	}
</script>

<aside class="qm-tips" aria-label={t.strings.tipsLabel}>
	<!-- Advancing swaps the text under a button that keeps focus, so the region
	     announces rather than the change passing silently. -->
	<div class="qm-tips-body" aria-live="polite" {@attach writeTip}></div>
	<div class="qm-tips-foot">
		<!-- One tip is its own whole set, so a lone dot reports nothing the card does
		     not already show. -->
		{#if tips.length > 1}
			<div class="qm-tips-dots">
				{#each tips as _, i (i)}
					<button
						type="button"
						class="qm-tips-dot"
						aria-label={t.strings.tipsDot(i + 1, tips.length)}
						aria-current={i === index}
						onclick={() => (cursor = i)}
					></button>
				{/each}
			</div>
		{/if}
		<button type="button" class="qm-icon-btn qm-tips-action" onclick={advance}>
			{#if isLast}
				{t.strings.tipsDismiss} <Icon name="trash-2" size={GLYPH} />
			{:else}
				{t.strings.tipsNext} <Icon name="arrow-right" size={GLYPH} />
			{/if}
		</button>
	</div>
</aside>

<style>
	/* Attached to `main`, not a block beside it: a square top pulled up by the radius,
	 so its background fills the notches `main`'s rounded bottom corners cut and `main`
	 paints over the rest. The two read as one block, which is what document-level
	 guidance is: the main card's, not a card of its own. Still in-flow, no lift.

	 No stroke of its own. A tint below the card reads as a slip; the same tint inside an
	 outline reads as a second card, which is the one thing the tuck exists to deny. What
	 shows below the seam is fill, and `main`'s hairline is the pair's only edge.

	 The bottom corners take the inner rung where the card above takes the outer: a slip
	 is cut crisper than the thing it is tucked under, at every setting of the dial.

	 Down, the insets are the document's own rhythm and they are measured to the ink, not
	 to the boxes. The top is a block gap below the seam, what two of the body's paragraphs
	 take, so the tip reads as the block after the prose; the bottom is the card's inset
	 rung; and the foot sits at half of either, being the message's own foot rather than
	 the next thing after it. The control gives its tap floor back as margin for that to
	 hold: a box standing on the floor rather than on its one-line label carries a rung of
	 slack at each edge, and spent inside the gap that is enough to make the tightest space
	 in the card measure as the widest.

	 Across, the inset is `main`'s stroke and the two nested insets under it, the card's
	 own and the prose control's, so the tip starts on the prose's edge rather than short
	 of it. */
	.qm-tips {
		margin-top: calc(var(--_qm-radius) * -1);
		border-radius: 0 0 var(--_qm-radius-inner) var(--_qm-radius-inner);
		padding: calc(var(--_qm-space-3) + var(--_qm-radius))
			calc(var(--_qm-border-width) + var(--_qm-space-3) * 2) var(--_qm-space-3);
		background: var(--_qm-tips-surface);
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
		font-family: var(--_qm-tips-font);
		font-size: var(--_qm-text-body);
		line-height: var(--_qm-leading-body);
		color: var(--_qm-tips-ink);
	}
	/* One line held open, so the foot does not step up under a shorter tip. */
	.qm-tips-body {
		min-height: calc(var(--_qm-leading-body) * 1em);
	}
	/* The rendered tip is injected DOM (the codec's `toDOM` output), so its element
	 styles are `:global`: the compiler never sees these tags in the markup. Restated
	 from `core/codec/prose.css`, which is where they are argued and which cannot reach
	 here: its selectors are scoped to `.ProseMirror` and a tip is not a view. The one
	 divergence: `code` takes a chip and a warmer ink where a leaf gives it a face, the
	 face here being the card's own already. `pre-wrap` keeps the significant space
	 inside a token like `- `; collapsed, the chip closes on the word after it. */
	.qm-tips-body :global(p) {
		margin: 0;
	}
	.qm-tips-body :global(code) {
		font-family: inherit;
		font-size: inherit;
		white-space: pre-wrap;
		padding: 0 var(--_qm-space);
		border-radius: var(--_qm-radius-inner);
		background: var(--_qm-tips-fill);
		color: var(--_qm-tips-ink-warm);
	}
	.qm-tips-body :global(a) {
		color: inherit;
		text-decoration: underline;
	}
	.qm-tips-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--_qm-space-2);
	}
	.qm-tips-dots {
		display: flex;
		align-items: center;
		gap: var(--_qm-space-half);
		margin-right: auto;
	}
	/* Random access to the set, drawn as one cluster: a row of marks spaced to the tap
	 floor reads as a row of controls. So the target is the mark plus its padding, under
	 the floor, which 2.5.8 allows on the equivalent-control exception rather than on
	 the spacing one — the foot's button clears the floor and walks the whole set from
	 the tip the card opens on, so no tip is reachable only by a dot. State is three
	 steps of one ink on the recede ladder, never a second hue and never a size: a dot
	 that grew would move the row it sits in.

	 `color` is restated because a button takes the UA's and not its parent's, so
	 `currentColor` is the card's ink only once it is inherited; left to the UA it is
	 `buttontext`, which is the one neutral on a card that carries no neutrals. */
	.qm-tips-dot {
		box-sizing: content-box;
		width: 5px;
		height: 5px;
		padding: var(--_qm-space-half);
		border: none;
		border-radius: var(--_qm-radius-pill);
		color: inherit;
		background: currentColor;
		background-clip: content-box;
		opacity: var(--_qm-opacity-idle);
		cursor: pointer;
		transition: opacity var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-tips-dot:hover {
		opacity: var(--_qm-opacity-muted);
	}
	.qm-tips-dot[aria-current='true'] {
		opacity: 1;
	}
	/* Box and disabled state come from `.qm-icon-btn` (controls.css); what this
	   overrides is everything the family sets for a glyph among callers of its own
	   colour, a labelled control on a warm card wanting none of it. The hover included:
	   the family's neutral step would read as lent from the document above. Unlayered,
	   so it beats the base rule without out-specifying it.

	   The box is the tap target and the label is what the rhythm measures, so both axes
	   give the difference back as margin: the inline rung lands the label on the body's
	   edge above, and the block rung takes the floor's slack out of the foot's height.
	   The box, and the hover it paints, still reaches past the label the way a control
	   does. */
	.qm-tips-action {
		margin-block: calc(var(--_qm-space) * -1);
		margin-right: calc(var(--_qm-space-2) * -1);
		padding: var(--_qm-space-half) var(--_qm-space-2);
		font-family: inherit;
		font-size: inherit;
		color: inherit;
		transition:
			color var(--_qm-duration-fast) var(--_qm-ease-reverse),
			background-color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-tips-action:hover {
		color: var(--_qm-tips-ink-warm);
		background: var(--_qm-tips-fill);
	}
</style>
