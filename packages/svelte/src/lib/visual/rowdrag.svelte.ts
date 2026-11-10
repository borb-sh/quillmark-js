// A record list's drag handle. Press-and-drag the handle moves its row; a press that does
// not travel past the dead zone does nothing. The drop is the row under the pointer, read
// off the rows where they stand, so a scroll by any hand re-picks it, and held at an edge
// of its scrollport the drag scrolls toward the rows out of view (`core/dragfollow.ts`).
// A pointer more than a row's height past either end of the list is out of it: the drop
// rule goes, and a release there moves nothing.
// Nothing reflows until the release (the lift is a tone and the drop rule is out of flow),
// and the release is the one splice `move` makes. Escape, a handle that loses the pointer,
// or one that leaves the DOM ends the drag with no move.
import { followDrag } from '../core/dragfollow.js';

const DEAD_ZONE = 3;

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

export function rowDrag(rows: DragRows): RowDrag {
	type Held = { k: number; origin: number; y: number; engaged: boolean; drop: number };
	let drag = $state<Held | undefined>();
	let grip: HTMLElement | undefined;
	let unfollow: (() => void) | undefined;

	/** The row the pointer is over, or the nearest one within its own height past either
	 *  end; `k`, the drag's own row and so no move, further out than that. */
	function dropIndex(k: number, y: number): number {
		let best = k;
		let nearest = Infinity;
		let reach = 0;
		for (let i = 0; i < rows.count(); i++) {
			const box = rows.box(i);
			if (!box) continue;
			const gap = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
			if (gap < nearest) {
				nearest = gap;
				best = i;
				reach = box.bottom - box.top;
			}
		}
		return nearest > reach ? k : best;
	}
	function repick(): void {
		if (drag?.engaged) drag.drop = dropIndex(drag.k, drag.y);
	}
	function end(): void {
		drag = undefined;
		release();
	}
	function cancel(e: KeyboardEvent): void {
		if (e.key !== 'Escape' || !drag?.engaged) return;
		e.preventDefault();
		e.stopPropagation();
		end();
	}
	function release(): void {
		unfollow?.();
		unfollow = undefined;
		grip = undefined;
		removeEventListener('keydown', cancel, { capture: true });
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
			grip = e.currentTarget as HTMLElement;
			grip.setPointerCapture?.(e.pointerId);
			drag = { k, origin: e.clientY, y: e.clientY, engaged: false, drop: k };
		},
		move(e) {
			if (!drag) return;
			drag.y = e.clientY;
			if (!drag.engaged) {
				if (Math.abs(e.clientY - drag.origin) < DEAD_ZONE) return;
				drag.engaged = true;
				addEventListener('keydown', cancel, { capture: true });
				if (grip)
					unfollow = followDrag({
						grip,
						axis: 'y',
						at: () => drag?.y ?? 0,
						extent() {
							const first = rows.box(0);
							const last = rows.box(rows.count() - 1);
							return first && last ? { start: first.top, end: last.bottom } : undefined;
						},
						moved: repick,
						lost: end
					});
			}
			repick();
		},
		up(e) {
			const done = drag;
			end();
			if (!done?.engaged || e.type !== 'pointerup') return;
			rows.move(done.k, done.drop);
		},
		release
	};
}
