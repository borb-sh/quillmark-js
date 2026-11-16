import { describe, expect, it } from 'vitest';
import { frameDelta } from '$lib/core/frame.js';

const band = { top: 0, bottom: 600 };
const gap = 8;

describe('frameDelta', () => {
	it('leaves a framed target and its label where they are', () => {
		expect(frameDelta(band, { top: 200, bottom: 230 }, 180, gap, 'nearest')).toBe(0);
	});

	it('brings the label in with a target above the band', () => {
		const delta = frameDelta(band, { top: -100, bottom: -70 }, -124, gap, 'nearest');
		expect(-124 - delta).toBe(band.top + gap);
	});

	it('brings the label in where the target sits at the top edge with its label above', () => {
		const delta = frameDelta(band, { top: 4, bottom: 34 }, -20, gap, 'nearest');
		expect(-20 - delta).toBe(band.top + gap);
	});

	it('stops a target below the band clear of the foot', () => {
		const delta = frameDelta(band, { top: 900, bottom: 930 }, 876, gap, 'nearest');
		expect(930 - delta).toBe(band.bottom - gap);
	});

	it('frames the target alone where it and its label do not fit together', () => {
		const target = { top: 1000, bottom: 1300 };
		const label = 600;
		const delta = frameDelta(band, target, label, gap, 'nearest');
		expect(target.bottom - delta).toBe(band.bottom - gap);
		expect(label - delta).toBeLessThan(band.top);
	});

	it('aligns the top of a target taller than the band', () => {
		const delta = frameDelta(band, { top: 400, bottom: 1400 }, 376, gap, 'nearest');
		expect(400 - delta).toBe(band.top + gap);
	});

	it('centres a target with its label in view', () => {
		const target = { top: 1000, bottom: 1030 };
		const delta = frameDelta(band, target, 976, gap, 'center');
		expect((target.top + target.bottom) / 2 - delta).toBe((band.top + band.bottom) / 2);
	});

	it('gives up the centring where it would put the label above the band', () => {
		const target = { top: 1000, bottom: 1030 };
		const label = 600;
		const delta = frameDelta(band, target, label, gap, 'center');
		expect(label - delta).toBe(band.top + gap);
		expect(target.bottom - delta).toBeLessThanOrEqual(band.bottom - gap);
	});
});
