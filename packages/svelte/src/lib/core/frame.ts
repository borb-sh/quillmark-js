// How a landing frames its target: the target in the band its scroller shows, and the label of the
// field it sits in with it wherever the two fit together, since a box without its label is a box
// the reader has to scroll to name. Where they do not fit, the target alone is framed.
import { spacePx } from './rungs.js';

/** A vertical extent in viewport px. */
export interface Band {
	top: number;
	bottom: number;
}

export interface FrameOptions {
	/** `nearest` moves the least that frames the target; `center` centres it where it fits. */
	block: 'nearest' | 'center';
	/** Room held clear at the band's foot, where it is more than the scroller's own `scroll-padding`. */
	foot?: number;
	behavior?: ScrollBehavior;
}

/**
 * The scroll, in px down, that frames `target` in `band` with `gap` clear of each edge. `top` is
 * where the field's label starts: kept in the band whenever it fits with the target, the target
 * winning where it does not. Zero for a target already framed, so a landing on the field in view
 * moves nothing.
 */
export function frameDelta(
	band: Band,
	target: Band,
	top: number,
	gap: number,
	block: FrameOptions['block']
): number {
	const room = band.bottom - band.top - 2 * gap;
	const high = band.top + gap;
	const low = band.bottom - gap;
	const tall = target.bottom - target.top > room;
	let delta = 0;
	if (tall) delta = target.top - high;
	else if (block === 'center') delta = (target.top + target.bottom) / 2 - (high + low) / 2;
	else if (target.top < high) delta = target.top - high;
	else if (target.bottom > low) delta = target.bottom - low;
	if (top < target.top && target.bottom - top <= room && top - delta < high) delta = top - high;
	return delta;
}

/** The nearest ancestor of `el` that scrolls vertically, or `undefined` where the page does. */
function scrollerOf(el: Element): HTMLElement | undefined {
	for (let at = el.parentElement; at; at = at.parentElement) {
		if (at === el.ownerDocument.documentElement || at === el.ownerDocument.body) return undefined;
		const { overflowY } = getComputedStyle(at);
		if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight)
			return at;
	}
	return undefined;
}

function px(value: string): number {
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : 0;
}

/** The band `scroller` shows, less its `scroll-padding` and at least `foot` at its foot. */
function bandOf(scroller: HTMLElement | undefined, foot: number): Band {
	const doc = document.documentElement;
	const style = getComputedStyle(scroller ?? doc);
	let top = 0;
	let bottom = window.innerHeight;
	if (scroller) {
		const box = scroller.getBoundingClientRect();
		top = Math.max(box.top + scroller.clientTop, 0);
		bottom = Math.min(top + scroller.clientHeight, bottom);
	}
	return {
		top: top + px(style.scrollPaddingTop),
		bottom: bottom - Math.max(px(style.scrollPaddingBottom), foot)
	};
}

/** Scroll the box `target` scrolls in sideways, a table's, the least that shows it. */
function frameInline(
	target: HTMLElement,
	stop: HTMLElement | undefined,
	behavior: ScrollBehavior
): void {
	for (let at = target.parentElement; at && at !== stop; at = at.parentElement) {
		const { overflowX } = getComputedStyle(at);
		if ((overflowX !== 'auto' && overflowX !== 'scroll') || at.scrollWidth <= at.clientWidth)
			continue;
		const port = at.getBoundingClientRect();
		const style = getComputedStyle(at);
		const left = port.left + at.clientLeft + px(style.scrollPaddingLeft);
		const right = port.left + at.clientLeft + at.clientWidth - px(style.scrollPaddingRight);
		const box = target.getBoundingClientRect();
		const dx =
			box.left < left || box.right - box.left > right - left
				? box.left - left
				: Math.max(box.right - right, 0);
		if (Math.abs(dx) >= 1) at.scrollBy({ left: dx, behavior });
		return;
	}
}

/**
 * Scroll `target` into the band its scroller shows, with the label of the field it sits in where
 * the two fit (`frameDelta`). One scroller moves, the nearest: a host page around the editor stays
 * where it is.
 */
export function frame(target: HTMLElement, opts: FrameOptions): void {
	const box = target.getBoundingClientRect();
	if (!box.width && !box.height) return;
	const field = target.closest('.qm-field');
	const top = Math.min(field?.getBoundingClientRect().top ?? box.top, box.top);
	const scroller = scrollerOf(target);
	frameInline(target, scroller, opts.behavior ?? 'instant');
	const delta = frameDelta(
		bandOf(scroller, opts.foot ?? 0),
		box,
		top,
		spacePx(target, 3) ?? 0,
		opts.block
	);
	if (Math.abs(delta) < 1) return;
	(scroller ?? window).scrollBy({ top: delta, behavior: opts.behavior ?? 'instant' });
}

/** The top a landing frames for `els`, its field's label included where it fits in `band`. */
export function framedTop(els: readonly HTMLElement[], band: Band): number | undefined {
	const rects = els.map((el) => el.getBoundingClientRect()).filter((r) => r.width || r.height);
	if (!rects.length) return undefined;
	const top = Math.min(...rects.map((r) => r.top));
	const bottom = Math.max(...rects.map((r) => r.bottom));
	const label = els[0]?.closest('.qm-field')?.getBoundingClientRect().top;
	if (label === undefined || label >= top) return top;
	return bottom - label <= band.bottom - band.top ? label : top;
}
