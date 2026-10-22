// The click bridge: a click on a page slot resolves pixel -> PDF-pt (geometry.ts's
// inverse transform) -> an address, surfaced through `onPick`. Also the
// editor->preview scroll commands (`scrollToField`/`focusPosition`), which place an
// ephemeral marker at the target's % position and measure it, reading the same
// percent geometry through the forward transform, so zoom and resize need no
// hand-rolled pixel offset of their own.
//
// The scroll itself is the scrollport's, written as `container.scrollTop`, not
// `marker.scrollIntoView()`: that walks every scrollable ancestor, so a host
// whose document scrolls (the playground below its split threshold) has the
// whole page dragged to the preview by a keystroke in the editor. The preview
// moves its own scrollport and nothing else, instantly: no `scroll-behavior` on
// the container means no motion for a reduced-motion term to cancel.
import type { LiveSession } from '@quillmark/wasm';
import type { Landing } from '../core/address.js';
import type { PageSlot } from './paint.js';
import {
	boxesForField,
	rectToPercent,
	clickToPdfPt,
	pxToPt,
	applyPercentRect,
	type PercentRect
} from './geometry.js';

/** Both trips are held while the pane has no box to measure against, and the last one
 *  held runs when it has one again. */
export interface BridgeController {
	/** Scroll `field`'s first box to centre; `false` when this compile places none
	 *  for that address, which is the whole of what the preview can say about it. */
	scrollToField(field: string): boolean;
	/**
	 * Bring the caret rect at `field`/`pos` into view (a no-op off-content, and a
	 * no-op when it is already clear of the fold).
	 */
	focusPosition(field: string, pos: number): void;
	destroy(): void;
}

/** A pane hidden by the shell's narrow switch (`preset/recipes.css`) measures 0×0, and so
 *  does every box on it: the clearance arithmetic reads that as a caret clear of both
 *  edges, and a centring computes its trip out of zeros. Neither is an answer about where
 *  the caret is. */
function hasBox(port: DOMRect): boolean {
	return port.width > 0 && port.height > 0;
}

/** The vertical extent the fold test reads; a `DOMRect` is one. */
export interface VerticalSpan {
	top: number;
	bottom: number;
	height: number;
}

/** What a rect reporting no height clears an edge by, in CSS px: a caret's own at the
 *  smallest zoom a page still reads at. */
const MIN_CLEARANCE = 8;

/** What a click may miss a field's ink by and still land on it, in CSS px of the page as
 *  drawn, so it converts per click at the scale the slot is showing. Sized as the
 *  pointer's imprecision and not as the leading it partly closes, which is a trade
 *  PREVIEW.md §"Click bridge" carries. */
const CLICK_SLACK_PX = 2;

/**
 * Whether `target` sits clear of `port`'s edges by the fold's clearance, which is the
 * target's own height: a caret rect flush against an edge is visible and unusable, and
 * the next line typed lands past it. Derived from the target rather than a margin dial,
 * so it scales with zoom exactly as the caret does, and bounded at both ends so the
 * answer is reachable across the whole range of targets a compile locates.
 *
 * The floor is what a zero-height rect gets, which bare intersection would score as
 * clear at either edge. The cap is a third of the room the port has to spare, so a
 * target too tall for its own height of clearance — a located line at zoom, a short
 * split track — passes once centred and holds a band around it, rather than being
 * re-centred by every keystroke. A target taller than the port is clear while it covers
 * the port: no scroll shows more of it.
 */
export function clearOfTheFold(target: VerticalSpan, port: VerticalSpan): boolean {
	if (target.height >= port.height) return target.top <= port.top && target.bottom >= port.bottom;
	const clearance = Math.min(
		Math.max(target.height, MIN_CLEARANCE),
		(port.height - target.height) / 3
	);
	return target.top - clearance >= port.top && target.bottom + clearance <= port.bottom;
}

/** The trip a pane with no box could not run, held for the box coming back. One, and the
 *  last one asked for: a caret hop supersedes the hop before it on a showing pane too.
 *  A cell rather than closure state, so a bridge rebuilt under a changed page count
 *  inherits what the one it replaced was holding (`controller.ts`). */
export interface HeldTrip {
	run?: () => void;
}

export function createBridge(
	session: LiveSession,
	container: HTMLElement,
	slots: readonly PageSlot[],
	onPick: ((at: Landing) => void) | undefined,
	held: HeldTrip = {}
): BridgeController {
	const unlisten: Array<() => void> = [];

	// Two rungs: `positionAt` over span-tracked content, `fieldAt` over every placement
	// the compile tracks, a strict superset of it (PREVIEW.md §"Click bridge" carries
	// the measurement). The second fires where a field is placed without its content
	// being tracked, and the pick carries no `pos` there: a fabricated `0` would be an
	// invented offset wearing a real one's type. No third rung hit-tests `regions()`,
	// whose rects bound ink the field does not fill; the slack both rungs carry is what
	// that rung would have been reached for.
	if (onPick) {
		for (const { page, el } of slots) {
			const handleClick = (ev: MouseEvent): void => {
				// Re-read through the live array: a same-count `refresh` swaps the
				// slot objects to re-cache `size`, and the click math must use the
				// current compile's PageSize, not the one captured at bridge build.
				const slot = slots[page];
				if (!slot) return;
				const box = slot.el.getBoundingClientRect();
				const px = ev.clientX - box.left;
				const py = ev.clientY - box.top;
				const pt = clickToPdfPt(px, py, box.width, box.height, slot.size);
				const tol = pxToPt(CLICK_SLACK_PX, box.width, slot.size);
				const hit = session.positionAt(slot.page, pt.x, pt.y, tol);
				if (hit) return void onPick(hit);
				const field = session.fieldAt(slot.page, pt.x, pt.y, tol);
				if (field) onPick({ field });
			};
			el.addEventListener('click', handleClick);
			unlisten.push(() => el.removeEventListener('click', handleClick));
		}
	}

	// Where the % rect `pct` on `slot` currently sits, in the scrollport's own
	// coordinates: a throwaway marker, measured and removed. Absolutely positioned,
	// so it displaces nothing and no layout survives the read.
	function measure(slot: PageSlot, pct: PercentRect): DOMRect {
		const marker = document.createElement('div');
		applyPercentRect(marker, pct);
		slot.el.appendChild(marker);
		const rect = marker.getBoundingClientRect();
		marker.remove();
		return rect;
	}

	// Centre `target` vertically in `port`, the scrollport's box; the cross axis takes the
	// minimum trip instead, since the container is a vertical scroller and only a page
	// wider than the port has anything to move there. `port` is the caller's own read: the
	// marker `measure` places is absolute inside the slot, so nothing between that read
	// and this one moves the container's box, and one forced layout serves the whole hop.
	function centre(target: DOMRect, port: DOMRect): void {
		container.scrollTop += target.top + target.height / 2 - (port.top + port.height / 2);
		reveal(target, port);
	}
	function reveal(target: DOMRect, port: DOMRect): void {
		if (target.left < port.left) container.scrollLeft += target.left - port.left;
		else if (target.right > port.right) container.scrollLeft += target.right - port.right;
	}

	// The re-assert. Nothing else asks on the way back: `refresh` re-asks only on a
	// recompile, and the reader who has just tapped Preview is not typing, so the pane
	// would open where the caret was several edits ago. Guarded for jsdom, which ships no
	// ResizeObserver and lays out nothing for one to report.
	if (typeof ResizeObserver !== 'undefined') {
		const observer = new ResizeObserver(() => {
			if (!held.run || !hasBox(container.getBoundingClientRect())) return;
			const trip = held.run;
			held.run = undefined;
			trip();
		});
		observer.observe(container);
		unlisten.push(() => observer.disconnect());
	}

	function scrollToField(field: string): boolean {
		const box = boxesForField(field, session.fieldBoxes(field), () => session.regions())[0];
		if (!box) return false;
		const slot = slots[box.page];
		if (!slot) return false;
		const port = container.getBoundingClientRect();
		// The address is placed, which is the whole of what the `boolean` answers; a pane
		// with no box yet is not a second no.
		if (!hasBox(port)) {
			held.run = () => void scrollToField(field);
			return true;
		}
		// A discrete act ("show me this field"), so it centres every time, unlike
		// the continuous hop below.
		centre(measure(slot, rectToPercent(box.rect, slot.size)), port);
		return true;
	}

	function focusPosition(field: string, pos: number): void {
		const region = session.locate(field, pos);
		if (!region) return;
		const slot = slots[region.page];
		if (!slot) return;
		// Held before the guard below, which a pane measuring zero answers "already clear"
		// for every keystroke of (`hasBox`): the follow would die silently for as long as
		// a track is hidden. What is held is the request, not the trip, so it re-locates
		// against whatever compile is current when the pane comes back.
		const port = container.getBoundingClientRect();
		if (!hasBox(port)) {
			held.run = () => focusPosition(field, pos);
			return;
		}
		// The continuous hop: one call per keystroke and per arrow key, so it moves
		// the pane only when the caret has left the fold. Centring unconditionally
		// takes the scrollport back from the user on every one of them, including
		// the ones that changed nothing about where the caret already was.
		// Across, a page zoomed wider than the pane has a caret to keep in view too, and
		// the least trip does it without moving the line the reader is on.
		const target = measure(slot, rectToPercent(region.rect, slot.size));
		if (clearOfTheFold(target, port)) reveal(target, port);
		else centre(target, port);
	}

	return {
		scrollToField,
		focusPosition,
		destroy() {
			for (const off of unlisten) off();
		}
	};
}
