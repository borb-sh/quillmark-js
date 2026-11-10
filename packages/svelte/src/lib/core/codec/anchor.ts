// The anchor for a surface with no element to anchor to: a live reference to what
// the surface floats over, never a rect measured off it. A range of text is that
// case; every other surface passes its own element.
//
// `contextElement` is why this is a named type rather than an object literal per call
// site. floating-ui's `autoUpdate` tracks a DOM element: overflow ancestors for
// scroll, a `ResizeObserver` on the reference, a layout-shift observer. Its
// `unwrapElement` reaches one from a virtual anchor only through `contextElement`, so
// dropping the field skips all three, leaving the floating element's own listeners,
// which for a surface portalled to `[data-qm-root]` need not share a scroll container
// with the editor at all.
import type { EditorView } from 'prosemirror-view';

/** A floating-ui `Measurable` over a PM range, carrying the `contextElement`
 *  `autoUpdate` tracks in the range's place. */
export interface RangeAnchor {
	contextElement: Element;
	getBoundingClientRect: () => DOMRect;
}

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

function union(a: Box, b: Box): Box {
	return {
		left: Math.min(a.left, b.left),
		top: Math.min(a.top, b.top),
		right: Math.max(a.right, b.right),
		bottom: Math.max(a.bottom, b.bottom)
	};
}

function caretBox(view: EditorView, pos: number): Box {
	const { left, top, right, bottom } = view.coordsAtPos(pos);
	return { left, top, right, bottom };
}

/**
 * The box the highlight paints, and not the two ends' caret boxes: a selection that
 * wraps has its head and its anchor on opposite sides of the block, so their union
 * names a rectangle no text is under.
 *
 * A range measuring to nothing falls back to that union. A leaf the view draws no text
 * for has no painted box, and an approximate anchor beats one of zero.
 */
function selectionBox(view: EditorView, from: number, to: number): Box {
	const range = document.createRange();
	const start = view.domAtPos(from);
	const end = view.domAtPos(to);
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	const { left, top, right, bottom, width, height } = range.getBoundingClientRect();
	if (width || height) return { left, top, right, bottom };
	return union(caretBox(view, from), caretBox(view, to));
}

/**
 * A virtual anchor over one PM range, measured when asked rather than when made.
 *
 * The measure is total. It reads layout, and layout can be gone: a position the
 * document has since invalidated, a leaf inside a collapsed section, a view torn down
 * between a scroll firing and the measure running. `autoUpdate` calls this at moments
 * none of its callers choose, so an unmeasurable anchor returns the last rect that
 * measured rather than throwing out of floating-ui's positioning pass.
 *
 * `from === to` is a caret, which is what the slash menu hangs off.
 */
export function rangeAnchor(view: EditorView, from: number, to: number): RangeAnchor {
	// Plain numbers, not a `DOMRect`: this runs at construction, and the codec's suite
	// is a `node` environment with no DOM in it. The `DOMRect` is minted in the measure,
	// which is a layout read and browser-only by construction.
	let last: Box = { left: 0, top: 0, right: 0, bottom: 0 };
	return {
		contextElement: view.dom,
		getBoundingClientRect: () => {
			try {
				last = from === to ? caretBox(view, from) : selectionBox(view, from, to);
			} catch {
				// unmeasurable: keep the last good rect
			}
			return new DOMRect(last.left, last.top, last.right - last.left, last.bottom - last.top);
		}
	};
}

/**
 * `anchor`'s horizontal extent over the vertical extent of `boxes`: a surface hung off it
 * clears every one, as a surface over a selection in a table cell clears the cell's row.
 */
export function across(anchor: RangeAnchor, boxes: readonly Element[]): RangeAnchor {
	return {
		contextElement: anchor.contextElement,
		getBoundingClientRect: () => {
			const { left, width } = anchor.getBoundingClientRect();
			let top = Infinity;
			let bottom = -Infinity;
			for (const box of boxes) {
				const rect = box.getBoundingClientRect();
				top = Math.min(top, rect.top);
				bottom = Math.max(bottom, rect.bottom);
			}
			return new DOMRect(left, top, width, bottom - top);
		}
	};
}

/**
 * A virtual anchor over the first line box of the element `find` returns when asked: a mark a
 * view redraws under every edit, so no element outlives the surface hung off it. `context` is
 * the view's own element, which does. Total as {@link rangeAnchor} is: with nothing to measure
 * it returns the last rect that measured.
 */
export function markAnchor(context: Element, find: () => Element | undefined): RangeAnchor {
	let last: DOMRect | undefined;
	return {
		contextElement: context,
		getBoundingClientRect: () => {
			const el = find();
			const rect = el?.getClientRects()[0] ?? el?.getBoundingClientRect();
			if (rect) last = rect;
			return last ?? new DOMRect();
		}
	};
}
