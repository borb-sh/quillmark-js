// The gesture's anchor, which scroll anchoring is not: the platform picks its anchor off
// the layout, and what fills the viewport as a section collapses is that section's own
// content, whose top never moves.

import { flushSync } from 'svelte';
import { rungMs, rungStyle } from '../core/rungs.js';

/**
 * Run `change` and keep `anchor` inside the fold for the length of the move.
 *
 * A section closing above the pressed control carries that control off the fold with it,
 * and what answers that is the trip every landing here already takes: the minimum, to the
 * nearest edge, never a centring (VISUAL_EDITOR §"Focus and the preview bridge"). So a
 * control the collapse never carries out of view costs no scroll at all, and one it would
 * rides up and parks at the edge, which is where a section just opened wants its header:
 * the fold below it is the room its fields unfold into, where a control held on the line
 * it was pressed on opens its section into the screen it sits on the edge of.
 *
 * Per frame, because both panels move over the motion rung: a trip taken once is taken
 * against a track that has not moved yet, the same flush a reveal's landing measures in
 * (`Card.revealLeaf`). `instant`, because a host's `scroll-behavior: smooth` would
 * otherwise animate each frame's correction toward the one before it.
 */
export function holdInView(anchor: HTMLElement | undefined, change: () => void): void {
	if (!anchor) return void change();
	change();
	flushSync();
	const reveal = (): void => anchor.scrollIntoView({ block: 'nearest', behavior: 'instant' });
	reveal();
	const rung = rungMs(rungStyle(anchor), '--_qm-duration-slow');
	if (rung === undefined) return;
	const until = performance.now() + rung;
	const step = (now: number): void => {
		reveal();
		if (now < until) requestAnimationFrame(step);
	};
	requestAnimationFrame(step);
}
