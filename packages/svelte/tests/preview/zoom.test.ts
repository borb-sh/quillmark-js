// The zoom's rules as relations over a pane and a set of page sizes, so a retuned cap,
// fill or step list leaves them green.
import { describe, it, expect } from 'vitest';
import {
	ACTUAL,
	MAX_ZOOM,
	STEPS,
	fitZoom,
	floorZoom,
	glide,
	stepZoom,
	type Glide
} from '$lib/preview/zoom.js';

const portrait = { widthPt: 612, heightPt: 792 };
const landscape = { widthPt: 792, heightPt: 612 };
const panes = [
	{ width: 320, height: 640 },
	{ width: 560, height: 760 },
	{ width: 900, height: 760 },
	{ width: 2400, height: 1400 }
];

describe('the default zoom', () => {
	it('fits a narrow pane to the width of a portrait page', () => {
		const pane = panes[0];
		expect(fitZoom([portrait], pane) * ACTUAL * portrait.widthPt).toBeCloseTo(pane.width, 6);
	});

	it('fits the widest page, so a mixed document draws every page at one scale', () => {
		const pane = panes[1];
		const zoom = fitZoom([portrait, landscape, portrait], pane);
		expect(zoom * ACTUAL * landscape.widthPt).toBeCloseTo(pane.width, 6);
		expect(zoom * ACTUAL * portrait.widthPt).toBeLessThan(pane.width);
	});

	it('stops growing on a wide pane', () => {
		const wide = fitZoom([portrait], panes[3]);
		expect(wide * ACTUAL * portrait.widthPt).toBeLessThan(panes[3].width);
		expect(fitZoom([portrait], { width: 4000, height: 1400 })).toBe(wide);
	});
});

describe('the zoom-out floor', () => {
	for (const pane of panes)
		for (const pages of [[portrait], [landscape], [portrait, landscape]])
			it(`shows every page whole and never passes the default (${pane.width}×${pane.height}, ${pages.length} sizes)`, () => {
				const floor = floorZoom(pages, pane);
				expect(floor).toBeLessThanOrEqual(fitZoom(pages, pane));
				for (const p of pages) {
					expect(floor * ACTUAL * p.widthPt).toBeLessThanOrEqual(pane.width);
					expect(floor * ACTUAL * p.heightPt).toBeLessThanOrEqual(pane.height);
				}
			});
});

// A fit on 100% leaves the ladder and the holds as `STEPS` and 100% alone.
const onLevel = 1;

describe('stepping', () => {
	it('lands on the next level from between two', () => {
		const between = (STEPS[3] + STEPS[4]) / 2;
		expect(stepZoom(between, 1, 0, onLevel)).toBe(STEPS[4]);
		expect(stepZoom(between, -1, 0, onLevel)).toBe(STEPS[3]);
	});

	it('walks the levels from one to the next', () => {
		for (let i = 0; i < STEPS.length - 1; i++)
			expect(stepZoom(STEPS[i], 1, 0, onLevel)).toBe(STEPS[i + 1]);
	});

	it('skips levels under the floor and stops at it', () => {
		const floor = (STEPS[1] + STEPS[2]) / 2;
		expect(stepZoom(STEPS[3], -1, floor, onLevel)).toBe(STEPS[2]);
		expect(stepZoom(STEPS[2], -1, floor, onLevel)).toBe(floor);
		expect(stepZoom(floor, -1, floor, onLevel)).toBe(floor);
	});

	it('stops at the ceiling', () => {
		expect(stepZoom(MAX_ZOOM, 1, 0, onLevel)).toBe(MAX_ZOOM);
	});

	it('stops at the fit between two levels, both ways', () => {
		const fit = (STEPS[3] + STEPS[4]) / 2;
		expect(stepZoom(STEPS[3], 1, 0, fit)).toBe(fit);
		expect(stepZoom(fit, 1, 0, fit)).toBe(STEPS[4]);
		expect(stepZoom(STEPS[4], -1, 0, fit)).toBe(fit);
		expect(stepZoom(fit, -1, 0, fit)).toBe(STEPS[3]);
	});

	it('takes the fit in place of a level beside it', () => {
		const fit = STEPS[2] + 0.001;
		expect(stepZoom(STEPS[1], 1, 0, fit)).toBe(fit);
		expect(stepZoom(fit, 1, 0, fit)).toBe(STEPS[3]);
		expect(stepZoom(STEPS[3], -1, 0, fit)).toBe(fit);
	});
});

describe('a continuous gesture', () => {
	const at = (z: number): Glide => ({ raw: z, shown: z });

	it('stops at 100% when one event crosses it, from either side', () => {
		expect(glide(at(0.8), 1.3, 0, onLevel).shown).toBe(1);
		expect(glide(at(1.3), 0.8, 0, onLevel).shown).toBe(1);
	});

	it('leaves 100% once a run of small events carries it far enough', () => {
		let run = at(1);
		const shown = new Set<number>();
		for (let i = 0; i < 20; i++) {
			run = glide(run, run.raw * 1.01, 0, onLevel);
			shown.add(run.shown);
		}
		expect(shown.has(1)).toBe(true);
		expect(run.shown).toBeGreaterThan(1);
	});

	it('stops at the fit when one event crosses it, from either side', () => {
		const fit = (STEPS[1] + STEPS[2]) / 2;
		expect(glide(at(STEPS[0]), STEPS[3], 0, fit).shown).toBe(fit);
		expect(glide(at(STEPS[3]), STEPS[0], 0, fit).shown).toBe(fit);
	});

	it('stops at whichever of the fit and 100% one event meets first', () => {
		const fit = (STEPS[1] + STEPS[2]) / 2;
		expect(glide(at(STEPS[0]), MAX_ZOOM, 0, fit).shown).toBe(fit);
		expect(glide(at(MAX_ZOOM), STEPS[0], 0, fit).shown).toBe(1);
	});

	it('holds a fit beside 100% in its place, and leaves it either way', () => {
		const fit = 1.005;
		expect(glide(at(STEPS[2]), STEPS[4], 0, fit).shown).toBe(fit);
		for (const rate of [1.01, 1 / 1.01]) {
			let run = at(fit);
			for (let i = 0; i < 20; i++) run = glide(run, run.raw * rate, 0, fit);
			expect(Math.abs(run.shown - fit)).toBeGreaterThan(0.05);
		}
	});

	it('holds between the floor and the ceiling', () => {
		expect(glide(at(1.5), 10, 0, onLevel).shown).toBe(MAX_ZOOM);
		expect(glide(at(0.7), 0.1, 0.6, onLevel).shown).toBe(0.6);
	});
});
