// The zoom, applied: measures the pane, hands the paint loop the one scale every page is
// drawn at (zoom.ts), and owns the gestures that move it and the pill that shows it.
// The pill exists only while the zoom is not the default, says nothing but the
// percentage, and resets on a click, which a reader learns by doing it.
import type { PageSlot } from './paint.js';
import {
	ACTUAL,
	clampZoom,
	fitZoom,
	floorZoom,
	glide,
	stepZoom,
	type Glide,
	type Pane
} from './zoom.js';

export interface Viewport {
	/** Re-fit: the pane's box, or the pages' sizes after a recompile, moved. */
	update(): void;
	/** A fraction of actual size, held against the pane's floor; `undefined` is the
	 *  default fit. */
	setZoom(zoom: number | undefined): void;
	destroy(): void;
}

/** How long the pill stays after the zoom last moved, or the pointer last came near. */
const IDLE_MS = 1200;
/** How long a continuous gesture rests before its pages re-raster at the scale it
 *  reached: a raster per event would cost a full paint of every mounted page each one. */
const SETTLE_MS = 150;
/** How near the pill, in CSS px, the pointer brings it back. */
const CORNER_REACH_PX = 64;
/** What a wheel delta multiplies the zoom by, per unit of each `deltaMode`: a mouse
 *  notch is about 100 px or 3 lines, which this lands near a fifth either way. */
const WHEEL_RATE = [0.0025, 0.08, 0.25] as const;
/** The pixel delta under which a ctrl-wheel event is a pinch rather than a notch, and the
 *  rate that inverts the pinch's encoding. */
const PINCH_DELTA = 50;
const PINCH_RATE = 0.01;
/** How far, as a log of the spread's ratio, two fingers part or close before a touch
 *  pinch zooms rather than only pans. */
const PINCH_SLOP = 0.04;

/** Safari's trackpad pinch: not a wheel event there, and not in the DOM lib. */
interface GestureEvent extends UIEvent {
	readonly scale: number;
	readonly clientX: number;
	readonly clientY: number;
}

const px = (value: string): number => parseFloat(value) || 0;

interface Bounds {
	current: number;
	floor: number;
	fit: number;
}

export function createViewport(
	container: HTMLElement,
	slots: readonly PageSlot[],
	setScale: (scale: number, settle?: number) => void,
	resetLabel: string
): Viewport {
	let zoom: number | undefined;
	// The continuous gesture under way; a discrete act or a zoom it did not produce ends it.
	let run: Glide | undefined;
	let pointer: { x: number; y: number } | undefined;

	// Sticky in the desk's flex column, last by `order` and pushed to the bottom by an
	// auto margin, so the pill sits at the pane's corner however short or wide the
	// pages are (`Preview.svelte`).
	const dock = document.createElement('div');
	dock.className = 'qm-preview-dock';
	const pill = document.createElement('button');
	pill.type = 'button';
	pill.className = 'qm-preview-zoom';
	dock.appendChild(pill);

	const ownsTabIndex = !container.hasAttribute('tabindex');
	if (ownsTabIndex) container.tabIndex = 0;

	function pane(): Pane | undefined {
		const style = getComputedStyle(container);
		const width = container.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
		const height = container.clientHeight - px(style.paddingTop) - px(style.paddingBottom);
		// A pane the shell has hidden measures 0×0, which is no box to fit: the scale it
		// was hidden at stands, so a return to the same box re-rasters nothing.
		return width > 0 && height > 0 ? { width, height } : undefined;
	}

	// What the pages are drawn at, the zoom held against this pane's floor, the floor, and
	// the default fit.
	function bounds(): Bounds | undefined {
		const box = pane();
		if (!box || !slots.length) return undefined;
		const sizes = slots.map((s) => s.size);
		const floor = floorZoom(sizes, box);
		const fit = fitZoom(sizes, box);
		const current = zoom === undefined ? fit : clampZoom(zoom, floor);
		return { current, floor, fit };
	}

	function apply(settle?: number): void {
		const b = bounds();
		if (!b) return;
		setScale(b.current * ACTUAL, settle);
		if (zoom === undefined) {
			if (dock.contains(document.activeElement)) container.focus({ preventScroll: true });
			dock.remove();
			return;
		}
		const pct = `${Math.round(b.current * 100)}%`;
		pill.textContent = pct;
		pill.setAttribute('aria-label', `${pct}, ${resetLabel}`);
		if (dock.isConnected) return;
		container.appendChild(dock);
		wake();
	}

	// A pill under the pointer stays: hidden, it lets the click through to the page.
	let idle: ReturnType<typeof setTimeout> | undefined;
	function wake(): void {
		delete pill.dataset.idle;
		clearTimeout(idle);
		idle = setTimeout(() => {
			if (pill.matches(':hover')) wake();
			else pill.dataset.idle = '';
		}, IDLE_MS);
	}

	// The page under `y`, or the nearest one: the point a zoom holds still is a fraction
	// of a page, since the gaps between pages do not scale with them.
	function pageAt(y: number): HTMLElement | undefined {
		for (const { el } of slots) if (el.getBoundingClientRect().bottom >= y) return el;
		return slots.at(-1)?.el;
	}

	// Run `act`, then scroll so the point at `x`, `y` is over the same place on its page.
	function holding(x: number, y: number, act: () => void): void {
		const page = pageAt(y);
		const before = page?.getBoundingClientRect();
		act();
		if (!page || !before?.width || !before.height) return;
		const after = page.getBoundingClientRect();
		container.scrollLeft += after.left + ((x - before.left) / before.width) * after.width - x;
		container.scrollTop += after.top + ((y - before.top) / before.height) * after.height - y;
	}

	function zoomTo(next: number | undefined, x: number, y: number, settle?: number): void {
		holding(x, y, () => {
			zoom = next;
			apply(settle);
		});
		if (zoom !== undefined) wake();
	}

	// A re-fit holds the line at the pane's top edge, so a dragged divider leaves the
	// reader where they were. The desk turns the browser's own scroll anchoring off
	// (`Preview.svelte`), which would correct the same move a second time.
	function refit(settle?: number): void {
		if (!container.scrollTop && !container.scrollLeft) return apply(settle);
		const r = container.getBoundingClientRect();
		holding(r.left + r.width / 2, r.top, () => apply(settle));
	}

	function centre(): { x: number; y: number } {
		const r = container.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	}
	// The pointer while it is over the pane, else the pane's centre.
	const anchor = (): { x: number; y: number } => pointer ?? centre();

	// A zoom landing on the fit is the default again, and follows the pane from there.
	const settled = (next: number | undefined, b: Bounds): number | undefined =>
		next === b.fit ? undefined : next;

	function step(next: (b: Bounds) => number | undefined, at = anchor()): void {
		const b = bounds();
		if (!b) return;
		run = undefined;
		zoomTo(settled(next(b), b), at.x, at.y);
	}

	// About the pane's centre, the pointer being on the pill.
	const reset = (): void => step(() => undefined, centre());

	// The raw zoom a gesture starting now carries from: the run's own while it is still
	// the one on screen.
	function from(b: { current: number }): Glide {
		return run && run.shown === b.current ? run : { raw: b.current, shown: b.current, slack: 0 };
	}

	function glideTo(raw: (from: Glide) => number, x: number, y: number): void {
		const b = bounds();
		if (!b) return;
		const start = from(b);
		run = glide(start, raw(start), b.floor, b.fit);
		zoomTo(settled(run.shown, b), x, y, SETTLE_MS);
	}

	// Ctrl-wheel is a mouse's zoom, and the trackpad pinch Chromium and Firefox send as
	// `deltaY = -100 ln(scale)`, in deltas smaller than a notch's: those track the fingers.
	function onWheel(e: WheelEvent): void {
		if (!(e.ctrlKey || e.metaKey)) return pan(e);
		e.preventDefault();
		const pinched = e.deltaMode === 0 && Math.abs(e.deltaY) < PINCH_DELTA;
		const factor = Math.exp(-e.deltaY * (pinched ? PINCH_RATE : WHEEL_RATE[e.deltaMode]));
		glideTo((g) => g.raw * factor, e.clientX, e.clientY);
	}

	// A trackpad pan over pages that overflow both ways, scrolled here: on macOS the
	// browser rails a scroll not near enough a diagonal to the axis it leans on, which
	// over a zoomed page is the wrong axis as often as not. A delta on one axis is left
	// to the browser, so a mouse wheel keeps its smooth notch, and one at an edge
	// chains on.
	function pan(e: WheelEvent): void {
		if (e.deltaMode !== 0 || !e.deltaX || !e.deltaY) return;
		const { scrollWidth, scrollHeight, clientWidth, clientHeight } = container;
		if (scrollWidth <= clientWidth || scrollHeight <= clientHeight) return;
		const { scrollLeft, scrollTop } = container;
		container.scrollLeft += e.deltaX;
		container.scrollTop += e.deltaY;
		if (container.scrollLeft !== scrollLeft || container.scrollTop !== scrollTop) {
			e.preventDefault();
		}
	}

	// The keys are the focused pane's alone: elsewhere they are the browser's own zoom,
	// the pointer over the pane notwithstanding. A key a host's own handler took is left
	// to it.
	function onKeyDown(e: KeyboardEvent): void {
		if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented || e.isComposing) return;
		if (!container.contains(document.activeElement)) return;
		const dir = e.key === '=' || e.key === '+' ? 1 : e.key === '-' || e.key === '_' ? -1 : 0;
		if ((!dir && e.key !== '0') || !bounds()) return;
		e.preventDefault();
		step((b) => (dir ? stepZoom(b.current, dir, b.floor, b.fit) : undefined));
	}

	// A two-finger pinch on a touch screen. The browser's own page zoom is held off by the
	// desk's `touch-action`, and cancelling the move stops the pan a second finger would
	// otherwise start: the pinch pans itself, holding the point it began under, as a
	// fraction of its page, under the fingers' midpoint. Placed afresh on each move rather
	// than stepped, since the scroll offsets round. The spread zooms only once it has
	// moved past `PINCH_SLOP`, so a two-finger drag pans and leaves the fit alone.
	interface Pinch {
		spread: number;
		raw: number;
		zooming: boolean;
		page: HTMLElement;
		fx: number;
		fy: number;
	}
	let pinch: Pinch | undefined;
	// The fingers on this pane, not one resting on the editor beside it.
	const fingers = (e: TouchEvent): Touch[] =>
		[...e.touches].filter((t) => t.target instanceof Node && container.contains(t.target));
	const spread = ([a, b]: Touch[]): number =>
		Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
	const midpoint = ([a, b]: Touch[]): { x: number; y: number } => ({
		x: (a.clientX + b.clientX) / 2,
		y: (a.clientY + b.clientY) / 2
	});
	function grip(at: { x: number; y: number }): Pick<Pinch, 'page' | 'fx' | 'fy'> | undefined {
		const page = pageAt(at.y);
		const r = page?.getBoundingClientRect();
		if (!page || !r?.width || !r.height) return undefined;
		return { page, fx: (at.x - r.left) / r.width, fy: (at.y - r.top) / r.height };
	}
	// A finger landing or lifting starts the pinch over with the two that remain.
	function onTouches(e: TouchEvent): void {
		pinch = undefined;
		const t = fingers(e);
		const b = bounds();
		const held = t.length === 2 && b ? grip(midpoint(t)) : undefined;
		if (held) pinch = { spread: spread(t), raw: from(b!).raw, zooming: false, ...held };
	}
	function onTouchMove(e: TouchEvent): void {
		const t = fingers(e);
		if (!pinch || t.length !== 2) return;
		e.preventDefault();
		const mid = midpoint(t);
		const ratio = spread(t) / pinch.spread;
		if (pinch.zooming) {
			const start = pinch.raw;
			glideTo(() => start * ratio, mid.x, mid.y);
		} else if (Math.abs(Math.log(ratio)) >= PINCH_SLOP) {
			pinch.zooming = true;
			pinch.spread = spread(t);
		}
		// A move the browser is already scrolling cannot be cancelled: its pan stands, and
		// the pinch holds whatever is under the fingers now.
		if (!e.cancelable) {
			Object.assign(pinch, grip(mid));
			return;
		}
		const r = pinch.page.getBoundingClientRect();
		container.scrollLeft += r.left + pinch.fx * r.width - mid.x;
		container.scrollTop += r.top + pinch.fy * r.height - mid.y;
	}

	// Safari's trackpad pinch. iOS sends these beside the touches, which are the ones read
	// there; either way the page zoom is cancelled.
	let gesture: number | undefined;
	function onGestureStart(e: Event): void {
		e.preventDefault();
		const b = bounds();
		gesture = pinch || !b ? undefined : from(b).raw;
	}
	function onGestureChange(e: Event): void {
		e.preventDefault();
		if (gesture === undefined || pinch) return;
		const { scale, clientX, clientY } = e as GestureEvent;
		const start = gesture;
		const at = Number.isFinite(clientX + clientY) ? { x: clientX, y: clientY } : anchor();
		glideTo(() => start * scale, at.x, at.y);
	}
	function onGestureEnd(e: Event): void {
		e.preventDefault();
		gesture = undefined;
	}

	function onPointerMove(e: PointerEvent): void {
		if (e.pointerType === 'touch') return;
		pointer = { x: e.clientX, y: e.clientY };
		if (!dock.isConnected) return;
		const r = pill.getBoundingClientRect();
		if (e.clientX >= r.left - CORNER_REACH_PX && e.clientY >= r.top - CORNER_REACH_PX) wake();
	}
	function onPointerLeave(): void {
		pointer = undefined;
	}

	const listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = [
		[container, 'wheel', onWheel as EventListener, { passive: false }],
		[window, 'keydown', onKeyDown as EventListener],
		[container, 'touchstart', onTouches as EventListener, { passive: true }],
		[container, 'touchmove', onTouchMove as EventListener, { passive: false }],
		[container, 'touchend', onTouches as EventListener],
		[container, 'touchcancel', onTouches as EventListener],
		[container, 'gesturestart', onGestureStart],
		[container, 'gesturechange', onGestureChange],
		[container, 'gestureend', onGestureEnd],
		[container, 'pointermove', onPointerMove as EventListener],
		[container, 'pointerleave', onPointerLeave],
		[pill, 'click', reset]
	];
	for (const [target, type, fn, opts] of listeners) target.addEventListener(type, fn, opts);

	// The pane's box moving: a dragged divider, a resized window, a hidden track shown. A
	// drag is a gesture, so its pages re-raster once it rests. Guarded for jsdom, which
	// ships no ResizeObserver.
	const resizeObserver =
		typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => refit(SETTLE_MS));
	resizeObserver?.observe(container);

	apply();

	return {
		update: () => refit(),
		setZoom(next) {
			const valid = next !== undefined && Number.isFinite(next) && next > 0 ? next : undefined;
			if (bounds()) step(() => valid);
			else zoom = valid;
		},
		destroy() {
			for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
			resizeObserver?.disconnect();
			clearTimeout(idle);
			dock.remove();
			if (ownsTabIndex) container.removeAttribute('tabindex');
		}
	};
}
