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

/** How far, as a log of the zoom's ratio to a hold, a continuous gesture carries past it
 *  before it leaves it: a ratio, so a hold is as wide at a phone's fit as at 100%. */
const DETENT = 0.04;

const near = (zoom: number, hold: number): boolean => Math.abs(Math.log(zoom / hold)) <= DETENT;

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

/** The levels a step lands on: `STEPS` with `fit` among them, which takes the
 *  place of any level within {@link DETENT} of it, since fit is the one that follows the
 *  pane. */
function stops(fit: number): number[] {
	return [...STEPS.filter((s) => !near(s, fit)), fit].sort((a, b) => a - b);
}

/** The next level in `dir` from `zoom`, `fit` among them, skipping levels under `floor`.
 *  From between two levels the first press lands on the nearer one in that direction;
 *  past the last level above the floor, the floor. Half a percent of slack, so a zoom
 *  shown as a level is at it. */
export function stepZoom(zoom: number, dir: 1 | -1, floor: number, fit: number): number {
	const levels = stops(fit);
	const next =
		dir > 0
			? levels.find((s) => s > zoom + 0.005)
			: levels.reverse().find((s) => s < zoom - 0.005 && s >= floor);
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

/** One event of a continuous gesture, carrying the run to `raw`: held at `fit` or 100%
 *  when it crosses or lands within {@link DETENT} of one, so one wheel notch across
 *  either stops there, at the first it meets. 100% gives way to a `fit` within the
 *  detent of it: two holds that close would pin the run between them. */
export function glide(run: Glide, raw: number, floor: number, fit: number): Glide {
	const holds = near(fit, 1) ? [fit] : [fit, 1];
	let next = clampZoom(raw, floor);
	const crossed = holds
		.filter((t) => (run.shown - t) * (next - t) < 0)
		.sort((a, b) => Math.abs(a - run.shown) - Math.abs(b - run.shown));
	if (crossed.length) next = crossed[0];
	const shown = holds.find((t) => near(next, t)) ?? next;
	return { raw: next, shown: clampZoom(shown, floor) };
}
