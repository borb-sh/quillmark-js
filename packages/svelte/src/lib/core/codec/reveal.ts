// The props a PM view reveals its caret through: the leaf's clearance plus the block-axis
// `scroll-padding` its scrollports declare. PM's own reveal walks the ancestors by hand rather than
// through `scrollIntoView`, so it never sees the inset a host keeps under an overlay; the padding
// is read on each flagged reveal and handed to the getters PM reads its margins through.
import type { EditorView } from 'prosemirror-view';

interface Inset {
	top: number;
	bottom: number;
}

function padding(value: string, extent: number): number {
	const n = Number.parseFloat(value);
	if (!Number.isFinite(n)) return 0;
	return value.endsWith('%') ? (n / 100) * extent : n;
}

function scrollInset(dom: Element): Inset {
	const inset = { top: 0, bottom: 0 };
	const view = dom.ownerDocument.defaultView;
	if (!view) return inset;
	for (let el = dom.parentElement; el; el = el.parentElement) {
		const style = view.getComputedStyle(el);
		const extent = el === dom.ownerDocument.documentElement ? view.innerHeight : el.clientHeight;
		inset.top = Math.max(inset.top, padding(style.scrollPaddingTop, extent));
		inset.bottom = Math.max(inset.bottom, padding(style.scrollPaddingBottom, extent));
	}
	return inset;
}

type Sides = { top: number; right: number; bottom: number; left: number };

export interface RevealProps {
	scrollThreshold: Sides;
	scrollMargin: Sides;
	handleScrollToSelection: (view: EditorView) => boolean;
}

export function revealProps(clearance: number | undefined): RevealProps {
	let inset: Inset = { top: 0, bottom: 0 };
	const sides = (base: number): Sides => ({
		get top() {
			return base + inset.top;
		},
		right: base,
		get bottom() {
			return base + inset.bottom;
		},
		left: base
	});
	return {
		scrollThreshold: sides(clearance ?? 0),
		scrollMargin: sides(clearance ?? 5),
		handleScrollToSelection: (view) => {
			inset = scrollInset(view.dom);
			return false;
		}
	};
}
