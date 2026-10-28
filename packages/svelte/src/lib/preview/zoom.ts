// The one scale every page is drawn at, as a fraction of actual size. Pure; `viewport.ts` measures
// the pane and applies the answer.
import type { PageSize } from '@quillmark/wasm';

/** CSS px per PDF pt at 100%: 96 CSS px to the inch over 72 pt. */
export const ACTUAL = 96 / 72;

/** The default never draws a page larger than this. */
const FIT_CAP = 1.25;

/** The furthest a gesture zooms in. */
export const MAX_ZOOM = 2;

/**
 * How much of the pane the page still fills, on its limiting axis, at the furthest a gesture zooms
 * out.
 */
const FLOOR_FILL = 0.9;

/** What `Mod +` and `Mod −` step through. */
export const STEPS = [0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

/**
 * How far, as a log of the zoom's ratio to a hold, a continuous gesture carries past it before it
 * leaves it.
 */
const DETENT = 0.04;

const near = (zoom: number, hold: number): boolean => Math.abs(Math.log(zoom / hold)) <= DETENT;

/** The pane's content box, in CSS px. */
export interface Pane {
	width: number;
	height: number;
}

/** The default: the widest page fits the pane's width, capped at {@link FIT_CAP}. */
export function fitZoom(pages: readonly PageSize[], pane: Pane): number {
	const widest = Math.max(...pages.map((p) => p.widthPt));
	return Math.min(pane.width / (widest * ACTUAL), FIT_CAP);
}

/**
 * The furthest a gesture zooms out: every page fits the pane whole with {@link FLOOR_FILL} filled
 * on its limiting axis, and never past the default.
 */
export function floorZoom(pages: readonly PageSize[], pane: Pane): number {
	const whole = Math.min(
		...pages.map((p) => Math.min(pane.width / p.widthPt, pane.height / p.heightPt))
	);
	return Math.min((FLOOR_FILL * whole) / ACTUAL, fitZoom(pages, pane));
}

export function clampZoom(zoom: number, floor: number): number {
	return Math.min(MAX_ZOOM, Math.max(floor, zoom));
}

/**
 * The levels a step lands on: `STEPS` with `fit` replacing any level within {@link DETENT} of it.
 */
function stops(fit: number): number[] {
	return [...STEPS.filter((s) => !near(s, fit)), fit].sort((a, b) => a - b);
}

/**
 * The next level in `dir` from `zoom`, skipping levels under `floor`; past the last, the floor.
 * Half a percent of slack, so a zoom shown as a level is at it.
 */
export function stepZoom(zoom: number, dir: 1 | -1, floor: number, fit: number): number {
	const levels = stops(fit);
	const next =
		dir > 0
			? levels.find((s) => s > zoom + 0.005)
			: levels.reverse().find((s) => s < zoom - 0.005 && s >= floor);
	return clampZoom(next ?? (dir > 0 ? MAX_ZOOM : floor), floor);
}

/**
 * A continuous gesture's run: the zoom its events asked for (`raw`), what it shows, and while it
 * shows a hold, how far past it the events have carried (`slack`, a log of the ratio).
 */
export interface Glide {
	raw: number;
	shown: number;
	slack: number;
}

/**
 * One event of a continuous gesture, carrying the run to `raw`. It stops at the first of `fit` or
 * 100% it crosses, and leaves a hold once carried {@link DETENT} past. 100% gives way to a `fit`
 * within the detent of it.
 */
export function glide(run: Glide, raw: number, floor: number, fit: number): Glide {
	const holds = near(fit, 1) ? [fit] : [fit, 1];
	const step = Math.log(raw / run.raw);
	let next: number;
	if (holds.includes(run.shown)) {
		const slack = run.slack + step;
		if (Math.abs(slack) <= DETENT) return { raw, shown: run.shown, slack };
		next = run.shown * Math.exp(slack - Math.sign(slack) * DETENT);
	} else next = run.shown * Math.exp(step);
	next = clampZoom(next, floor);
	const crossed = holds
		.filter((t) => (run.shown - t) * (next - t) < 0)
		.sort((a, b) => Math.abs(a - run.shown) - Math.abs(b - run.shown));
	return { raw, shown: crossed[0] ?? next, slack: 0 };
}
