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

/** Safari's trackpad pinch: not a wheel event there, and not in the DOM lib. */
interface GestureEvent extends UIEvent {
	readonly scale: number;
	readonly clientX: number;
	readonly clientY: number;
}

const px = (value: string): number => parseFloat(value) || 0;

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

	// What the pages are drawn at, the zoom held against this pane's floor, and the floor.
	function bounds(): { current: number; floor: number } | undefined {
		const box = pane();
		if (!box || !slots.length) return undefined;
		const sizes = slots.map((s) => s.size);
		const floor = floorZoom(sizes, box);
		const current = zoom === undefined ? fitZoom(sizes, box) : clampZoom(zoom, floor);
		return { current, floor };
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
	function refit(): void {
		if (!container.scrollTop && !container.scrollLeft) return apply();
		const r = container.getBoundingClientRect();
		holding(r.left + r.width / 2, r.top, () => apply());
	}

	function centre(): { x: number; y: number } {
		const r = container.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	}
	// The pointer while it is over the pane, else the pane's centre.
	const anchor = (): { x: number; y: number } => pointer ?? centre();

	function step(
		next: (b: { current: number; floor: number }) => number | undefined,
		at = anchor()
	): void {
		const b = bounds();
		if (!b) return;
		run = undefined;
		zoomTo(next(b), at.x, at.y);
	}

	// About the pane's centre, the pointer being on the pill.
	const reset = (): void => step(() => undefined, centre());

	// The raw zoom a gesture starting now carries from: the run's own while it is still
	// the one on screen.
	function from(b: { current: number }): Glide {
		return run && run.shown === b.current ? run : { raw: b.current, shown: b.current };
	}

	function glideTo(raw: (from: Glide) => number, x: number, y: number): void {
		const b = bounds();
		if (!b) return;
		const start = from(b);
		run = glide(start, raw(start), b.floor);
		zoomTo(run.shown, x, y, SETTLE_MS);
	}

	// Ctrl-wheel is a mouse's zoom, and the trackpad pinch Chromium and Firefox send as
	// `deltaY = -100 ln(scale)`, in deltas smaller than a notch's: those track the fingers.
	function onWheel(e: WheelEvent): void {
		if (!(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		const pinched = e.deltaMode === 0 && Math.abs(e.deltaY) < PINCH_DELTA;
		const factor = Math.exp(-e.deltaY * (pinched ? PINCH_RATE : WHEEL_RATE[e.deltaMode]));
		glideTo((g) => g.raw * factor, e.clientX, e.clientY);
	}

	// The keys reach the pane under the pointer as well as the focused one: a click on a
	// page lands its caret in the editor, taking the focus with it.
	// The first pane to take a key claims it, so two previews never both step, and a key
	// a host's own handler took is left to it.
	function onKeyDown(e: KeyboardEvent): void {
		if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented || e.isComposing) return;
		if (!pointer && !container.contains(document.activeElement)) return;
		const dir = e.key === '=' || e.key === '+' ? 1 : e.key === '-' || e.key === '_' ? -1 : 0;
		if ((!dir && e.key !== '0') || !bounds()) return;
		e.preventDefault();
		step((b) => (dir ? stepZoom(b.current, dir, b.floor) : undefined));
	}

	// A two-finger pinch on a touch screen. The browser's own page zoom is held off by the
	// desk's `touch-action` and by cancelling the move, which also stops the pan a second
	// finger would otherwise start: the pinch pans itself, so the pages follow the
	// fingers' midpoint as well as their spread.
	let pinch: { spread: number; raw: number; mid: { x: number; y: number } } | undefined;
	const spread = (t: TouchList): number =>
		Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
	const midpoint = (t: TouchList): { x: number; y: number } => ({
		x: (t[0].clientX + t[1].clientX) / 2,
		y: (t[0].clientY + t[1].clientY) / 2
	});
	function onTouchStart(e: TouchEvent): void {
		if (e.touches.length !== 2) return;
		const b = bounds();
		if (b) pinch = { spread: spread(e.touches), raw: from(b).raw, mid: midpoint(e.touches) };
	}
	function onTouchMove(e: TouchEvent): void {
		if (!pinch || e.touches.length !== 2) return;
		e.preventDefault();
		const mid = midpoint(e.touches);
		container.scrollLeft += pinch.mid.x - mid.x;
		container.scrollTop += pinch.mid.y - mid.y;
		pinch.mid = mid;
		const ratio = spread(e.touches) / pinch.spread;
		const start = pinch.raw;
		glideTo(() => start * ratio, mid.x, mid.y);
	}
	function onTouchEnd(e: TouchEvent): void {
		if (e.touches.length < 2) pinch = undefined;
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
		[container, 'touchstart', onTouchStart as EventListener, { passive: true }],
		[container, 'touchmove', onTouchMove as EventListener, { passive: false }],
		[container, 'touchend', onTouchEnd as EventListener],
		[container, 'touchcancel', onTouchEnd as EventListener],
		[container, 'gesturestart', onGestureStart],
		[container, 'gesturechange', onGestureChange],
		[container, 'gestureend', onGestureEnd],
		[container, 'pointermove', onPointerMove as EventListener],
		[container, 'pointerleave', onPointerLeave],
		[pill, 'click', reset]
	];
	for (const [target, type, fn, opts] of listeners) target.addEventListener(type, fn, opts);

	// The pane's box moving: a dragged divider, a resized window, a hidden track shown.
	// Guarded for jsdom, which ships no ResizeObserver.
	const resizeObserver =
		typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => refit());
	resizeObserver?.observe(container);

	apply();

	return {
		update: refit,
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
