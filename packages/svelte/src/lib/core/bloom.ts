// The arrival wash: a soft accent bloom that rises over a leaf the editor just landed on and decays
// to nothing. A landing is an event, not a state, so a highlight that outlives the hop is ink
// nothing asked for.
//
// Opacity is the animated property, never the colour: the wash's alpha is a peak fixed by
// `--_qm-accent-wash`, so the scale stays in CSS where `color-mix` resolves. The wash is the host's
// `::after` (`.qm-wash`, controls.css); this module plays it and adds nothing to the tree.

import { rungMs, rungStyle } from './rungs.js';

const WASH = '::after';
/** The dwell used when the derivation is out of reach (an unstyled root, or jsdom). */
const FALLBACK_MS = 1100;

// Rise fast, hold, then leave slowly: a highlighter's decay. A keyframe's easing governs the
// segment that starts at it. Under reduced motion the ramps are dropped: the wash holds at full for
// a beat and cuts.
const FRAMES: Keyframe[] = [
	{ opacity: 0, offset: 0, easing: 'ease-out' },
	{ opacity: 1, offset: 0.08 },
	{ opacity: 1, offset: 0.3, easing: 'ease-in' },
	{ opacity: 0, offset: 1 }
];
const FRAMES_REDUCED: Keyframe[] = [{ opacity: 1 }, { opacity: 1 }];

/**
 * Run one wash over `host`, a `.qm-wash` box, resolving the dwell off its root so the number is
 * single-sourced in CSS (`core/rungs.ts`). `--_qm-bloom-dwell` already shortens under
 * `prefers-reduced-motion`, so `matchMedia` here only picks the frame list. A run in flight on the
 * same host is cancelled first, so two quick landings do not stack alphas.
 */
export function bloom(host: HTMLElement): void {
	if (typeof host.animate !== 'function') return;
	for (const a of host.getAnimations({ subtree: true })) {
		const effect = a.effect as KeyframeEffect | null;
		if (effect?.target === host && effect.pseudoElement === WASH) a.cancel();
	}
	const reduced =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const duration = rungMs(rungStyle(host), '--_qm-bloom-dwell') ?? FALLBACK_MS;
	host.animate(reduced ? FRAMES_REDUCED : FRAMES, { duration, pseudoElement: WASH });
}
