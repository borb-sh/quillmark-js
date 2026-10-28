// @vitest-environment jsdom
// The click ladder, driven through real clicks on slots against a stubbed session: which query
// answers and what it carries, not pixels. jsdom lays nothing out, so the page box is stubbed to a
// known size.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBridge, clearOfTheFold } from '$lib/preview/bridge';
import type { Landing } from '$lib/core';
import type { LiveSession } from '@quillmark/wasm';
import type { PageSlot } from '$lib/preview/paint';

const PAGE = { widthPt: 612, heightPt: 792 };

/** One page slot whose box measures `scale`×(612×792) CSS px. */
function mockSlots(scale = 1): PageSlot[] {
	const el = document.createElement('div');
	el.getBoundingClientRect = () =>
		({
			left: 0,
			top: 0,
			width: PAGE.widthPt * scale,
			height: PAGE.heightPt * scale
		}) as unknown as DOMRect;
	document.body.appendChild(el);
	return [{ page: 0, size: PAGE, el } as unknown as PageSlot];
}

function click(el: HTMLElement, x: number, y: number): void {
	el.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
}

describe('the click ladder', () => {
	let picks: Landing[];
	beforeEach(() => {
		picks = [];
	});

	it('surfaces a content hit with its caret and granularity', () => {
		const session = {
			positionAt: () => ({ field: 'main.body', pos: 42, granularity: 'cluster' }),
			fieldAt: () => 'main.body'
		} as unknown as LiveSession;
		const slots = mockSlots();
		const bridge = createBridge(session, document.body, slots, (at) => picks.push(at));

		click(slots[0].el, 100, 100);

		expect(picks).toEqual([{ field: 'main.body', pos: 42, granularity: 'cluster' }]);
		bridge.destroy();
	});

	it('surfaces a placement with no caret when only fieldAt answers', () => {
		const session = {
			positionAt: () => undefined,
			fieldAt: () => 'main.signature_block'
		} as unknown as LiveSession;
		const slots = mockSlots();
		const bridge = createBridge(session, document.body, slots, (at) => picks.push(at));

		click(slots[0].el, 100, 100);

		expect(picks).toEqual([{ field: 'main.signature_block' }]);
		expect(picks[0].pos).toBeUndefined();
		bridge.destroy();
	});

	it('does not fire where neither query answers', () => {
		const regions = vi.fn(() => [{ field: 'main.body', page: 0, rect: [0, 0, 612, 792] }]);
		const session = {
			positionAt: () => undefined,
			fieldAt: () => undefined,
			regions
		} as unknown as LiveSession;
		const slots = mockSlots();
		const bridge = createBridge(session, document.body, slots, (at) => picks.push(at));

		click(slots[0].el, 300, 300);

		expect(picks).toEqual([]);
		expect(regions).not.toHaveBeenCalled();
		bridge.destroy();
	});

	it('hands both rungs one slack, converted at the scale the page is drawn', () => {
		const tolAt = (scale: number): number => {
			const positionAt = vi.fn((..._args: number[]) => undefined);
			const fieldAt = vi.fn((..._args: number[]) => undefined);
			const session = { positionAt, fieldAt } as unknown as LiveSession;
			const slots = mockSlots(scale);
			const bridge = createBridge(session, document.body, slots, (at) => picks.push(at));
			click(slots[0].el, 10, 10);
			bridge.destroy();
			expect(positionAt.mock.calls[0]).toHaveLength(4);
			expect(fieldAt.mock.calls[0][3]).toBe(positionAt.mock.calls[0][3]);
			return positionAt.mock.calls[0][3];
		};
		expect(tolAt(1)).toBeGreaterThan(0);
		expect(tolAt(0.5)).toBeCloseTo(tolAt(1) * 2);
		expect(tolAt(2)).toBeCloseTo(tolAt(1) / 2);
	});
});

// The clearance the continuous hop moves on (PREVIEW §"Follow-the-caret scroll").
describe('the fold guard', () => {
	/** A span `height` tall whose top edge sits at `top`. */
	const span = (top: number, height: number) => ({ top, bottom: top + height, height });
	const PORT = span(0, 800);

	it('clears a caret with its own height of room at each edge, and not one flush to an edge', () => {
		expect(clearOfTheFold(span(400, 20), PORT)).toBe(true);
		expect(clearOfTheFold(span(20, 20), PORT)).toBe(true);
		expect(clearOfTheFold(span(10, 20), PORT)).toBe(false);
		expect(clearOfTheFold(span(780, 20), PORT)).toBe(false);
	});

	it('asks a rect reporting no height for room anyway', () => {
		expect(clearOfTheFold(span(800, 0), PORT)).toBe(false);
		expect(clearOfTheFold(span(797, 0), PORT)).toBe(false);
		expect(clearOfTheFold(span(400, 0), PORT)).toBe(true);
	});

	it('clears a target too tall for its own height of clearance once it is centred', () => {
		const track = span(0, 300);
		expect(clearOfTheFold(span(75, 150), track)).toBe(true);
		expect(clearOfTheFold(span(60, 150), track)).toBe(true);
		expect(clearOfTheFold(span(10, 150), track)).toBe(false);
		expect(clearOfTheFold(span(140, 150), track)).toBe(false);
	});

	it('clears a target taller than the port while it covers the port', () => {
		const track = span(0, 300);
		expect(clearOfTheFold(span(-50, 400), track)).toBe(true);
		expect(clearOfTheFold(span(20, 400), track)).toBe(false);
	});
});
