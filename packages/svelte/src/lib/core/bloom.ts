// The arrival wash: a soft accent bloom that rises over a leaf the editor just
// landed on and decays to nothing. A landing is an event, not a state, so a
// highlight that outlives the hop that caused it is ink nothing asked for.
//
// Opacity is the animated property, never the colour. The wash's alpha is a peak
// fixed by `--_qm-accent-wash`, so interpolating 0→1→0 keeps the scale in CSS where
// `color-mix` resolves, instead of in keyframe values a script would have to
// pre-resolve and re-resolve on a theme change.

import { rungStyle } from './rungs.js';

const BLOOM_CLASS = 'qm-bloom';
const WASH = 'var(--_qm-accent-wash)';
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
 * Run one wash on `el`, resolving the dwell off it so the number is single-sourced
 * in CSS.
 *
 * One property, both motion preferences: `--_qm-bloom-dwell` already shortens under
 * `prefers-reduced-motion` in the derivation, so what is left to `matchMedia` here is
 * the shape: a hold and a cut carry no ramps, which is a frame list rather than a
 * number and the one half CSS cannot hand over.
 */
function bloom(el: HTMLElement): Animation | undefined {
	if (typeof el.animate !== 'function') return undefined;
	const reduced =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const raw = rungStyle(el).getPropertyValue('--_qm-bloom-dwell').trim();
	const n = Number.parseFloat(raw);
	const duration = !Number.isFinite(n) ? FALLBACK_MS : raw.endsWith('ms') ? n : n * 1000;
	return el.animate(reduced ? FRAMES_REDUCED : FRAMES, { duration });
}

/**
 * Bloom over `host`'s content: an inset child, so the wash neither tints the host's
 * own background nor fades the text under it. `host` must be positioned.
 *
 * One wash node per host, reused while it lives: two quick landings on the same leaf
 * must not stack two alphas over it.
 */
export function bloomInside(host: HTMLElement): void {
	let el = host.querySelector<HTMLElement>(`:scope > .${BLOOM_CLASS}`);
	if (el) {
		// Drop the in-flight run's handlers before cancelling: its `oncancel` would
		// otherwise remove the node the new run is about to animate.
		for (const a of el.getAnimations()) {
			a.onfinish = null;
			a.oncancel = null;
			a.cancel();
		}
	} else {
		el = document.createElement('div');
		el.className = BLOOM_CLASS;
		Object.assign(el.style, {
			position: 'absolute',
			inset: '0',
			pointerEvents: 'none',
			borderRadius: 'inherit',
			background: WASH,
			opacity: '0'
		});
		host.appendChild(el);
	}
	const node = el;
	const anim = bloom(node);
	if (!anim) {
		node.remove();
		return;
	}
	const drop = (): void => node.remove();
	anim.onfinish = drop;
	anim.oncancel = drop;
}
