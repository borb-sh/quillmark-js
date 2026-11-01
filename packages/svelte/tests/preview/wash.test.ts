// @vitest-environment jsdom
// The page wash against a stubbed session: which boxes take a plane, and that the plane goes once
// its run ends. jsdom plays no animation, so `animate` is stubbed with a run the test ends.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { washField } from '$lib/preview/wash';
import type { LiveSession } from '@quillmark/wasm';
import type { PageSlot } from '$lib/preview/paint';

const PAGE = { widthPt: 600, heightPt: 800 };

function mockSlots(count: number): PageSlot[] {
	return Array.from({ length: count }, (_, page) => {
		const el = document.createElement('div');
		document.body.appendChild(el);
		return { page, size: PAGE, el } as unknown as PageSlot;
	});
}

function planes(slot: PageSlot): HTMLElement[] {
	return [...slot.el.querySelectorAll<HTMLElement>('.qm-preview-wash')];
}

describe('the page wash', () => {
	let runs: Animation[];
	beforeEach(() => {
		runs = [];
		HTMLElement.prototype.animate = vi.fn(function () {
			const run = { onfinish: null, oncancel: null } as unknown as Animation;
			runs.push(run);
			return run;
		});
		HTMLElement.prototype.getAnimations = () => [];
	});
	afterEach(() => {
		delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
		delete (HTMLElement.prototype as Partial<HTMLElement>).getAnimations;
		document.body.replaceChildren();
	});

	it('lays a plane over each box the compile places, on its own page', () => {
		const session = {
			fieldBoxes: () => [
				{ field: 'main.body', page: 0, rect: [60, 600, 360, 700] },
				{ field: 'main.body', page: 1, rect: [0, 0, 600, 800] }
			],
			regions: () => []
		} as unknown as LiveSession;
		const slots = mockSlots(2);

		expect(washField(session, slots, 'main.body')).toBe(true);

		const [plane] = planes(slots[0]);
		expect(plane.style.left).toBe('10%');
		expect(plane.style.top).toBe('12.5%');
		expect(plane.style.width).toBe('50%');
		expect(planes(slots[1])).toHaveLength(1);
	});

	it('falls back to the placements at or under an address fieldBoxes leaves empty', () => {
		const session = {
			fieldBoxes: () => [],
			regions: () => [
				{ field: 'main.keywords[0]', page: 0, rect: [0, 0, 10, 10] },
				{ field: 'main.keywords_note', page: 0, rect: [0, 0, 10, 10] }
			]
		} as unknown as LiveSession;
		const slots = mockSlots(1);

		expect(washField(session, slots, 'main.keywords')).toBe(true);
		expect(planes(slots[0])).toHaveLength(1);
	});

	it('answers false and lays nothing for an address the compile does not place', () => {
		const session = { fieldBoxes: () => [], regions: () => [] } as unknown as LiveSession;
		const slots = mockSlots(1);

		expect(washField(session, slots, 'main.subject')).toBe(false);
		expect(planes(slots[0])).toHaveLength(0);
	});

	it('removes the plane when its run ends, and cuts one still playing on the address', () => {
		const session = {
			fieldBoxes: () => [{ field: 'main.subject', page: 0, rect: [0, 0, 10, 10] }],
			regions: () => []
		} as unknown as LiveSession;
		const slots = mockSlots(1);

		washField(session, slots, 'main.subject');
		washField(session, slots, 'main.subject');
		expect(planes(slots[0])).toHaveLength(1);

		runs.at(-1)!.onfinish!({} as AnimationPlaybackEvent);
		expect(planes(slots[0])).toHaveLength(0);
	});
});
