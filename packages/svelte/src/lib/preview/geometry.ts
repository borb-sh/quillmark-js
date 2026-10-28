// The one pixel<->PDF-pt transform, and the rule for which rects an address has. Pure: no DOM, no
// session.
import type { FieldRegion, PageSize } from '@quillmark/wasm';

/** A page rect in PDF points, `[x0, y0, x1, y1]`, bottom-left origin (`FieldRegion.rect`'s shape). */
export type PdfRect = readonly [number, number, number, number];

/** A rect as CSS percent of the page box (top-left origin; Y is flipped from PDF-pt). */
export interface PercentRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** A point in PDF points, bottom-left origin (the space `positionAt`/`fieldAt` read). */
export interface PdfPoint {
	x: number;
	y: number;
}

/**
 * An address's boxes: `fieldBoxes`'s union, else every `regions()` rect at or under it
 * (PREVIEW.md §"Two responsibilities"). `fieldBoxes` answers `[]` for a scalar reference
 * the plate places without tracking its content and for an array itself; the fallback
 * takes the address and its descendants, matched at a path boundary (`.` or `[`):
 * `main.keywords` matches `main.keywords[0]`, not `main.keywords_note`.
 *
 * `regions` is a thunk because taking it marshals every placement across the WASM boundary.
 */
export function boxesForField(
	field: string,
	boxes: readonly FieldRegion[],
	regions: () => readonly FieldRegion[]
): readonly FieldRegion[] {
	if (boxes.length) return boxes;
	return regions().filter(
		(r) => r.field === field || r.field.startsWith(`${field}.`) || r.field.startsWith(`${field}[`)
	);
}

/**
 * Forward: a PDF-pt rect -> CSS % of the page box, which tracks the displayed size without a zoom
 * or DPR term.
 */
export function rectToPercent(rect: PdfRect, pageSize: PageSize): PercentRect {
	const [x0, y0, x1, y1] = rect;
	const { widthPt, heightPt } = pageSize;
	return {
		left: (x0 / widthPt) * 100,
		top: (1 - y1 / heightPt) * 100,
		width: ((x1 - x0) / widthPt) * 100,
		height: ((y1 - y0) / heightPt) * 100
	};
}

/** Position `el` absolutely at `pct`. */
export function applyPercentRect(el: HTMLElement, pct: PercentRect): void {
	Object.assign(el.style, {
		position: 'absolute',
		left: `${pct.left}%`,
		top: `${pct.top}%`,
		width: `${pct.width}%`,
		height: `${pct.height}%`
	});
}

/**
 * A CSS-px length on a page element of CSS width `cssW` -> PDF-pt. Width alone, since `paint.ts`
 * locks the aspect ratio.
 */
export function pxToPt(px: number, cssW: number, pageSize: PageSize): number {
	return (px / cssW) * pageSize.widthPt;
}

/**
 * Inverse of {@link rectToPercent}: a click at CSS px `(px, py)` within a page element of CSS size
 * `(cssW, cssH)` -> PDF-pt.
 */
export function clickToPdfPt(
	px: number,
	py: number,
	cssW: number,
	cssH: number,
	pageSize: PageSize
): PdfPoint {
	const { widthPt, heightPt } = pageSize;
	return {
		x: (px / cssW) * widthPt,
		y: heightPt - (py / cssH) * heightPt
	};
}
