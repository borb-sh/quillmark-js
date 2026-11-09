// What a held reorder drag owes the scrolls under it, for the two surfaces that carry one:
// a record list's handle (`visual/rowdrag.svelte.ts`) and a table island's grip
// (`codec/table-view.ts`). A scroll by any hand moves the lines under a pointer that has not
// moved, so the drag is told to read them again. Held in an edge band of its scrollport, the
// drag scrolls it toward the lines out of view, once the pointer has been outside the band:
// a press on a line already in the band does not scroll.

/** The band at a scrollport's two edges that scrolls it under a held drag, and the most one
 *  frame scrolls, reached at the edge itself. */
const EDGE = 48;
const STEP = 16;

export interface DragFollowOptions {
	/** The handle the drag holds. One that leaves the DOM ends the follow as {@link lost}. */
	grip: Element;
	/** The axis the lines stack along: the one the drag scrolls. */
	axis: 'x' | 'y';
	/** The pointer along the axis, in client pixels. */
	at(): number;
	/** The lines' whole extent along the axis, where they stand now. */
	extent(): { start: number; end: number } | undefined;
	/** The lines moved under the pointer: pick the drop again. */
	moved(): void;
	lost(): void;
}

const page = (): Element => document.scrollingElement ?? document.documentElement;

/** The nearest ancestor that scrolls along `axis`, else the page. */
function scrollport(from: Element, axis: 'x' | 'y'): Element {
	for (let el = from.parentElement; el; el = el.parentElement) {
		const style = getComputedStyle(el);
		const scrolls = /auto|scroll/.test(axis === 'y' ? style.overflowY : style.overflowX);
		const room = axis === 'y' ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth;
		if (scrolls && room) return el;
	}
	return page();
}

/** Follow an engaged drag until the returned stop is called. */
export function followDrag(o: DragFollowOptions): () => void {
	const port = scrollport(o.grip, o.axis);
	let armed = false;
	let frame = 0;
	let stopped = false;
	const stop = (): void => {
		stopped = true;
		cancelAnimationFrame(frame);
		removeEventListener('scroll', o.moved, { capture: true });
	};
	const edgeScroll = (): void => {
		if (stopped) return;
		if (!o.grip.isConnected) {
			stop();
			o.lost();
			return;
		}
		const vertical = o.axis === 'y';
		const box = port === page() ? undefined : port.getBoundingClientRect();
		const view = vertical ? innerHeight : innerWidth;
		const near = Math.max((vertical ? box?.top : box?.left) ?? 0, 0);
		const far = Math.min((vertical ? box?.bottom : box?.right) ?? view, view);
		const at = o.at();
		const into = Math.min(at - near - EDGE, 0) + Math.max(at - far + EDGE, 0);
		if (!into) armed = true;
		// Only toward lines still out of view: past the list's end there is nothing to reach.
		const lines = o.extent();
		const beyond = into < 0 ? (lines?.start ?? near) < near : (lines?.end ?? 0) > far;
		if (into && armed && beyond) {
			const by = STEP * Math.max(-1, Math.min(1, into / EDGE));
			port.scrollBy({ [vertical ? 'top' : 'left']: by, behavior: 'instant' });
		}
		frame = requestAnimationFrame(edgeScroll);
	};
	addEventListener('scroll', o.moved, { capture: true, passive: true });
	frame = requestAnimationFrame(edgeScroll);
	return stop;
}
