// The arrival wash: a soft accent bloom that rises over a leaf the editor just
// landed on and decays to nothing. A landing is an event, not a state, so a
// highlight that outlives the hop that caused it is ink nothing asked for.
//
// Opacity is the animated property, never the colour. The wash's alpha is a peak
// fixed by `--_qm-accent-wash`, so interpolating 0→1→0 keeps the scale in CSS where
// `color-mix` resolves, instead of in keyframe values a script would have to
// pre-resolve and re-resolve on a theme change.
//
// The wash is the host's `::after` (`.qm-wash`, controls.css), drawn from mount: this
// module plays it and adds nothing to the tree.

import { rungStyle } from './rungs.js';

const WASH = '::after';
/** The dwell used when the derivation is out of reach (an unstyled root, or jsdom,
 *  where `getComputedStyle` reports custom properties as empty). A fallback is the
 *  absence of the scale, not a copy of it. */
const FALLBACK_MS = 1100;

// Rise fast, hold, then leave slowly: a highlighter's decay, not a linear fade. A
// keyframe's easing governs the segment that starts at it. Under reduced motion the
// ramps are dropped entirely: the wash holds at full for a beat and cuts, which
// still answers "here" with nothing to track.
const FRAMES: Keyframe[] = [
	{ opacity: 0, offset: 0, easing: 'ease-out' },
	{ opacity: 1, offset: 0.08 },
	{ opacity: 1, offset: 0.3, easing: 'ease-in' },
	{ opacity: 0, offset: 1 }
];
const FRAMES_REDUCED: Keyframe[] = [{ opacity: 1 }, { opacity: 1 }];

/**
 * Run one wash over `host`, a `.qm-wash` box, resolving the dwell off its root so the
 * number is single-sourced in CSS (`core/rungs.ts`).
 *
 * One property, both motion preferences: `--_qm-bloom-dwell` already shortens under
 * `prefers-reduced-motion` in the derivation, so what is left to `matchMedia` here is
 * the shape: a hold and a cut carry no ramps, which is a frame list rather than a
 * number and the one half CSS cannot hand over.
 *
 * A run in flight on the same host is cancelled first: two quick landings on one leaf
 * must not stack two alphas over it.
 */
export function bloom(host: HTMLElement): void {
	if (typeof host.animate !== 'function') return;
	for (const a of host.getAnimations({ subtree: true })) {
		const effect = a.effect as KeyframeEffect | null;
		if (effect?.target === host && effect.pseudoElement === WASH) a.cancel();
	}
	const reduced =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const raw = rungStyle(host).getPropertyValue('--_qm-bloom-dwell').trim();
	const n = Number.parseFloat(raw);
	const duration = !Number.isFinite(n) ? FALLBACK_MS : raw.endsWith('ms') ? n : n * 1000;
	host.animate(reduced ? FRAMES_REDUCED : FRAMES, { duration, pseudoElement: WASH });
}
