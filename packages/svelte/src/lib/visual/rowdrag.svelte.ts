// A record list's drag handle. Press-and-drag the handle moves its row; a press that does
// not travel past the dead zone does nothing. The drop is the row under the pointer, read
// off the rows where they stand, so a scroll by any hand re-picks it. Held in an edge band
// of its scrollport, the drag scrolls it toward the rows out of view, once the pointer has
// been outside the band: a press on a row already in the band does not scroll. Nothing
// reflows until the release (the lift is a tone and the drop rule is out of flow), and the
// release is the one splice `move` makes. A handle that loses the pointer, or leaves the
// DOM, ends the drag with no move.

const DEAD_ZONE = 3;
/** The band at a scrollport's top and bottom edges that scrolls it under a held drag, and
 *  the most one frame scrolls, reached at the edge itself. */
const EDGE = 48;
const STEP = 16;

/** The list a drag reads and moves: its row count, row `i`'s box where it stands, and the
 *  splice a release makes. */
export interface DragRows {
	count(): number;
	box(i: number): DOMRect | undefined;
	move(k: number, to: number): void;
}

export interface RowDrag {
	/** Whether a press on a handle is held, engaged or not. */
	held(): boolean;
	/** Whether row `k` is the one an engaged drag carries. */
	lifted(k: number): boolean;
	/** Where the drop rule draws on row `k`, while a drag would land the row there. */
	dropSide(k: number): 'before' | 'after' | undefined;
	down(e: PointerEvent, k: number): void;
	move(e: PointerEvent): void;
	up(e: PointerEvent): void;
	/** Stop following the pointer, for the list's teardown. */
	release(): void;
}

const page = (): Element => document.scrollingElement ?? document.documentElement;

/** The nearest ancestor that scrolls vertically, else the page. */
function scrollport(from: Element): Element {
	for (let el = from.parentElement; el; el = el.parentElement) {
		const { overflowY } = getComputedStyle(el);
		if (/auto|scroll/.test(overflowY) && el.scrollHeight > el.clientHeight) return el;
	}
	return page();
}

export function rowDrag(rows: DragRows): RowDrag {
	type Held = { k: number; origin: number; y: number; engaged: boolean; drop: number };
	let drag = $state<Held | undefined>();
	let follow: { grip: Element; port: Element; armed: boolean; frame: number } | undefined;

	/** The row the pointer is over, or the nearest one past either end. */
	function dropIndex(k: number, y: number): number {
		let best = k;
		let nearest = Infinity;
		for (let i = 0; i < rows.count(); i++) {
			const box = rows.box(i);
			if (!box) continue;
			const gap = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
			if (gap < nearest) {
				nearest = gap;
				best = i;
			}
		}
		return best;
	}
	function repick(): void {
		if (drag?.engaged) drag.drop = dropIndex(drag.k, drag.y);
	}
	function edgeScroll(): void {
		if (!follow || !drag?.engaged) return;
		if (!follow.grip.isConnected) {
			drag = undefined;
			release();
			return;
		}
		const { port } = follow;
		const box = port === page() ? undefined : port.getBoundingClientRect();
		const top = Math.max(box?.top ?? 0, 0);
		const bottom = Math.min(box?.bottom ?? innerHeight, innerHeight);
		const into = Math.min(drag.y - top - EDGE, 0) + Math.max(drag.y - bottom + EDGE, 0);
		if (!into) follow.armed = true;
		// Only toward rows still out of view: past the list's end there is nothing to reach.
		const beyond =
			into < 0
				? (rows.box(0)?.top ?? top) < top
				: (rows.box(rows.count() - 1)?.bottom ?? 0) > bottom;
		if (into && follow.armed && beyond)
			port.scrollBy({ top: STEP * Math.max(-1, Math.min(1, into / EDGE)), behavior: 'instant' });
		follow.frame = requestAnimationFrame(edgeScroll);
	}
	function release(): void {
		if (follow) cancelAnimationFrame(follow.frame);
		follow = undefined;
		removeEventListener('scroll', repick, { capture: true });
	}

	return {
		held: () => drag !== undefined,
		lifted: (k) => !!drag?.engaged && drag.k === k,
		dropSide(k) {
			if (!drag?.engaged || drag.drop !== k || drag.drop === drag.k) return undefined;
			return drag.drop > drag.k ? 'after' : 'before';
		},
		down(e, k) {
			if (e.button !== 0) return;
			e.preventDefault();
			release();
			const grip = e.currentTarget as HTMLElement;
			grip.setPointerCapture?.(e.pointerId);
			drag = { k, origin: e.clientY, y: e.clientY, engaged: false, drop: k };
			follow = { grip, port: scrollport(grip), armed: false, frame: 0 };
		},
		move(e) {
			if (!drag) return;
			drag.y = e.clientY;
			if (!drag.engaged) {
				if (Math.abs(e.clientY - drag.origin) < DEAD_ZONE) return;
				drag.engaged = true;
				addEventListener('scroll', repick, { capture: true, passive: true });
				if (follow) follow.frame = requestAnimationFrame(edgeScroll);
			}
			repick();
		},
		up(e) {
			const done = drag;
			drag = undefined;
			release();
			if (!done?.engaged || e.type !== 'pointerup') return;
			rows.move(done.k, done.drop);
		},
		release
	};
}
