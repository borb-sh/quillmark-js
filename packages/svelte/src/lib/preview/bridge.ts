// The click bridge: a click on a page slot resolves pixel -> PDF-pt -> an address, surfaced through
// `onPick`. Also the editor->preview scroll commands, which measure an ephemeral marker at the
// target's % position.
//
// The scroll writes `container.scrollTop` rather than calling `marker.scrollIntoView()`, which
// walks every scrollable ancestor and drags a host whose document scrolls to the preview on each
// keystroke. It is instant: no `scroll-behavior` on the container.
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

/**
 * Both trips are held while the pane has no box to measure against; the last one held runs when it
 * has one again.
 */
export interface BridgeController {
	/**
	 * Scroll `field`'s first box to centre; `false` when this compile places none for that address.
	 */
	scrollToField(field: string): boolean;
	/**
	 * Bring the caret rect at `field`/`pos` into view; a no-op off-content or when already clear of
	 * the fold.
	 */
	focusPosition(field: string, pos: number): void;
	destroy(): void;
}

/**
 * A pane hidden by the shell's narrow switch (`preset/shell.css`) measures 0×0, as does every box
 * on it, which the clearance arithmetic would read as a caret clear of both edges.
 */
function hasBox(port: DOMRect): boolean {
	return port.width > 0 && port.height > 0;
}

/** The vertical extent the fold test reads; a `DOMRect` is one. */
export interface VerticalSpan {
	top: number;
	bottom: number;
	height: number;
}

/** What a rect reporting no height clears an edge by, in CSS px. */
const MIN_CLEARANCE = 8;

/**
 * What a click may miss a field's ink by and still land on it, in CSS px of the page as drawn
 * (PREVIEW.md §"Click bridge").
 */
const CLICK_SLACK_PX = 2;

/**
 * Whether `target` sits clear of `port`'s edges by the fold's clearance, which is the target's own
 * height, so it scales with zoom as the caret does. The floor is {@link MIN_CLEARANCE}, for a
 * zero-height rect. The cap is a third of the room the port has to spare, so a target too tall for
 * its own clearance passes once centred rather than being re-centred by every keystroke. A target
 * taller than the port is clear while it covers the port.
 */
export function clearOfTheFold(target: VerticalSpan, port: VerticalSpan): boolean {
	if (target.height >= port.height) return target.top <= port.top && target.bottom >= port.bottom;
	const clearance = Math.min(
		Math.max(target.height, MIN_CLEARANCE),
		(port.height - target.height) / 3
	);
	return target.top - clearance >= port.top && target.bottom + clearance <= port.bottom;
}

/**
 * The last trip a pane with no box could not run. A cell so a rebuilt bridge inherits it
 * (`controller.ts`).
 */
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

	// Two rungs: `positionAt` over span-tracked content, then `fieldAt` over every tracked
	// placement (PREVIEW.md §"Click bridge"). The second carries no `pos`: a fabricated `0` would
	// be an invented offset.
	if (onPick) {
		for (const { page, el } of slots) {
			const handleClick = (ev: MouseEvent): void => {
				// Re-read through the live array: a refresh swaps slot objects to re-cache `size`.
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

	// Where the % rect `pct` on `slot` currently sits: a throwaway absolute marker, measured and
	// removed.
	function measure(slot: PageSlot, pct: PercentRect): DOMRect {
		const marker = document.createElement('div');
		applyPercentRect(marker, pct);
		slot.el.appendChild(marker);
		const rect = marker.getBoundingClientRect();
		marker.remove();
		return rect;
	}

	// Centre `target` vertically in `port`; the cross axis takes the minimum trip.
	function centre(target: DOMRect, port: DOMRect): void {
		container.scrollTop += target.top + target.height / 2 - (port.top + port.height / 2);
		reveal(target, port);
	}
	function reveal(target: DOMRect, port: DOMRect): void {
		if (target.left < port.left) container.scrollLeft += target.left - port.left;
		else if (target.right > port.right) container.scrollLeft += target.right - port.right;
	}

	// Runs the held trip once the pane has a box again. Guarded for jsdom, which has no
	// ResizeObserver.
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
		// Placed, so `true`; a pane with no box yet is not a no.
		if (!hasBox(port)) {
			held.run = () => void scrollToField(field);
			return true;
		}
		// A discrete act, so it centres every time.
		centre(measure(slot, rectToPercent(box.rect, slot.size)), port);
		return true;
	}

	function focusPosition(field: string, pos: number): void {
		const region = session.locate(field, pos);
		if (!region) return;
		const slot = slots[region.page];
		if (!slot) return;
		// Held before the fold test, which would call a zero-sized pane clear. The request is held,
		// so it re-locates against the compile current on return.
		const port = container.getBoundingClientRect();
		if (!hasBox(port)) {
			held.run = () => focusPosition(field, pos);
			return;
		}
		// Called per keystroke, so it moves the pane only when the caret has left the fold; across,
		// the least trip.
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
