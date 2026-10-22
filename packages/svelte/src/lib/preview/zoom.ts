// The one scale every page is drawn at, as a fraction of actual size: pure, so the
// rules a gesture lands on are reachable without a layout (tests/preview/zoom.test.ts).
// `viewport.ts` measures the pane and applies the answer.
import type { PageSize } from '@quillmark/wasm';

/** CSS px per PDF pt at 100%: 96 CSS px to the inch over 72 pt, a PDF viewer's actual
 *  size. */
export const ACTUAL = 96 / 72;

/** The default never draws a page larger than this, so a wide pane shows a sheet at a
 *  size print would recognise rather than one stretched to the pane. */
const FIT_CAP = 1.25;

/** The furthest a gesture zooms in. */
export const MAX_ZOOM = 2;

/** How much of the pane the page still fills, on its limiting axis, at the furthest a
 *  gesture zooms out: the whole page in view with a thin margin, and never a stamp. */
const FLOOR_FILL = 0.9;

/** What `Mod +` and `Mod −` step through: a subset of the levels a browser's own zoom
 *  keys land on, so a step lands somewhere a reader has been before. */
export const STEPS = [0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

/** How far past 100% a continuous gesture carries before it leaves it. */
const DETENT = 0.04;

/** The pane's content box, in CSS px. */
export interface Pane {
	width: number;
	height: number;
}

/** The default: the widest page fits the pane's width, capped at {@link FIT_CAP}. A
 *  portrait-only document lands at the pane's width, as a narrow pane always drew it. */
export function fitZoom(pages: readonly PageSize[], pane: Pane): number {
	const widest = Math.max(...pages.map((p) => p.widthPt));
	return Math.min(pane.width / (widest * ACTUAL), FIT_CAP);
}

/** The furthest a gesture zooms out: every page fits the pane whole with
 *  {@link FLOOR_FILL} of it filled on the page's limiting axis, and never past the
 *  default, which on a pane past the cap is already smaller than that. */
export function floorZoom(pages: readonly PageSize[], pane: Pane): number {
	const whole = Math.min(
		...pages.map((p) => Math.min(pane.width / p.widthPt, pane.height / p.heightPt))
	);
	return Math.min((FLOOR_FILL * whole) / ACTUAL, fitZoom(pages, pane));
}

export function clampZoom(zoom: number, floor: number): number {
	return Math.min(MAX_ZOOM, Math.max(floor, zoom));
}

/** The next level in `dir` from `zoom`, skipping levels under `floor`. From between two
 *  levels the first press lands on the nearer one in that direction; past the last level
 *  above the floor, the floor. Half a percent of slack, so a zoom shown as a level is at
 *  it. */
export function stepZoom(zoom: number, dir: 1 | -1, floor: number): number {
	const next =
		dir > 0
			? STEPS.find((s) => s > zoom + 0.005)
			: [...STEPS].reverse().find((s) => s < zoom - 0.005 && s >= floor);
	return clampZoom(next ?? (dir > 0 ? MAX_ZOOM : floor), floor);
}

/**
 * A continuous gesture's run: where it would be unsnapped (`raw`), and what it shows.
 * The run carries `raw` across events, so the detent at 100% holds a slow gesture
 * rather than stopping it: a trackpad's small deltas accumulate past the detent, where
 * snapping the shown value alone would pin every later event back to it.
 */
export interface Glide {
	raw: number;
	shown: number;
}

/** One event of a continuous gesture, carrying the run to `raw`: held at 100% when it
 *  crosses or lands within {@link DETENT} of it, so one wheel notch across actual size
 *  stops there. */
export function glide(run: Glide, raw: number, floor: number): Glide {
	let next = clampZoom(raw, floor);
	if ((run.shown - 1) * (next - 1) < 0) next = 1;
	const shown = Math.abs(next - 1) <= DETENT ? 1 : next;
	return { raw: next, shown: clampZoom(shown, floor) };
}
