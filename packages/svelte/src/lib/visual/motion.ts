// The card stack's trips: a slot's position ↔ position in a keyed list, the one row of
// the mechanism table no CSS rule can serve, because the two frames belong to different
// elements, and a slot entering or leaving the list. Svelte's `animate:` and `in:`/`out:`
// supply the halves CSS cannot see (the rects either side of the reconciliation, a node
// the list no longer holds) and WAAPI paints the trip, the same seam `core/bloom.ts` takes
// to keep a duration in the derivation while a script runs the animation.

import type { AnimationConfig } from 'svelte/animate';
import type { TransitionConfig } from 'svelte/transition';
import { rungMs, rungStyle } from '../core/rungs.js';

/** Marks this module's runs, so a second reorder cancels the first rather than layering
 *  a second transform over it. */
const RUN_ID = 'qm-reorder';

/** The trips this module is running on `node`. A run holds the slot at its pre-move
 *  position for its whole length, so anything that measures the node's box waits on
 *  these rather than reading the one a transform is holding. */
export function reorderTrips(node: HTMLElement): Animation[] {
	if (typeof node.getAnimations !== 'function') return [];
	return node.getAnimations().filter((run) => run.id === RUN_ID);
}

/**
 * The reorder gesture's arming window, for a keyed list that takes the trip. The
 * reconcile that moves a slot is the trip, and every other reconcile that happens to
 * move one is not; so the command arms the gesture and the frame it lands in disarms
 * it, `animate:` asking at apply time, a microtask after the mutation and well inside
 * that frame. `armed` is a getter rather than a value, so the flag stays out of the
 * template and needs no reactivity for it. `cancel` is for the surface's teardown.
 */
export interface ReorderArm {
	arm(): void;
	armed(): boolean;
	cancel(): void;
}

export function reorderArm(): ReorderArm {
	let reordering = false;
	let frame = 0;
	return {
		arm() {
			reordering = true;
			frame = requestAnimationFrame(() => (reordering = false));
		},
		armed: () => reordering,
		cancel: () => cancelAnimationFrame(frame)
	};
}

/**
 * Slide a keyed slot from where it was to where it now is.
 *
 * `armed` is why this is the reorder and not every reconcile: `animate:` fires wherever
 * a slot's rect moved, and a card growing under the caret moves every slot below it,
 * which is a layout change with no trip in it and one that would draw those slots over
 * the content that displaced them for the length of the run. So a command that moves
 * slots in the list arms the gesture and the frame it lands in disarms it, which is the
 * admission test read off the endpoints: two positions in the list, not two positions on
 * the page. A move is one; so, in the card stack, are an insert and a removal, which move
 * every slot past them by one.
 *
 * Both endpoints are rest states, so the curve is `--_qm-ease-reverse` (a second click
 * lands mid-slide) and the rung is `slow` (the trip moves the stack around it).
 */
export function reorder(
	node: HTMLElement,
	{ from, to }: { from: DOMRect; to: DOMRect },
	armed: () => boolean
): AnimationConfig {
	// The returned config is empty by design, in both exits and the run below: Svelte
	// samples a config's keyframes through a JS easing function, and this curve is a
	// rung the derivation mints.
	if (!armed() || typeof node.animate !== 'function') return {};
	const style = rungStyle(node);
	const duration = rungMs(style, '--_qm-duration-slow');
	const easing = style.getPropertyValue('--_qm-ease-reverse').trim();
	if (duration === undefined || !easing) return {};
	for (const running of node.getAnimations()) if (running.id === RUN_ID) running.cancel();
	node.animate(
		[
			{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
			{ transform: 'none' }
		],
		{ duration, easing, id: RUN_ID }
	);
	return {};
}

/**
 * A slot entering or leaving the list fades where it stands, while the slots it displaces
 * take the reorder trip: the stack is what slides, and a card is what appears or goes, under
 * the slots crossing it. Opacity alone, because a leaving slot is held at its place by a
 * transform `animate:` writes, which a keyframed transform would override.
 *
 * The returned duration is what keeps a leaving slot mounted until its fade has run, and
 * the fill what keeps it from painting whole in the frame between the two.
 */
export function slot(
	node: HTMLElement,
	_params: unknown,
	{ direction }: { direction: 'in' | 'out' | 'both' }
): TransitionConfig {
	if (typeof node.animate !== 'function') return {};
	const style = rungStyle(node);
	const duration = rungMs(style, '--_qm-duration-slow');
	const easing = style.getPropertyValue('--_qm-ease-reverse').trim();
	if (duration === undefined || !easing) return {};
	const opacity = direction === 'out' ? [1, 0] : [0, 1];
	node.animate({ opacity }, { duration, easing, fill: direction === 'out' ? 'forwards' : 'none' });
	return { duration };
}

/** Frames nothing may scroll in before a scroll counts as over. More than one, because a
 *  smooth scroll asked for in this frame takes its first step in a later one. */
const STILL_FRAMES = 3;
/** The wait's ceiling, in frames: a scroller a host keeps moving is not a trip that ends. */
const MAX_FRAMES = 60;

/**
 * Resolves once nothing in the document has scrolled for {@link STILL_FRAMES} frames
 * running. A smooth scroll moves its scroller on every frame until it lands, so stillness
 * is its end on every engine, whether or not it reports one; a scroll with nowhere to go
 * is still from the first frame.
 */
export function scrollSettled(): Promise<void> {
	return new Promise((resolve) => {
		let still = 0;
		let frames = 0;
		const moved = (): void => void (still = 0);
		document.addEventListener('scroll', moved, { capture: true, passive: true });
		const frame = (): void => {
			if (++still < STILL_FRAMES && ++frames < MAX_FRAMES) return void requestAnimationFrame(frame);
			document.removeEventListener('scroll', moved, { capture: true });
			resolve();
		};
		requestAnimationFrame(frame);
	});
}
