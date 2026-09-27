// @vitest-environment jsdom
// The click ladder, driven through real clicks on real slots against a stubbed
// session. It is about which query answers and what the answer carries, not about
// pixels: the transform it rides is `geometry.ts`'s and is tested against a compiled
// session there.
//
// jsdom lays nothing out, so every `getBoundingClientRect` is zero; the click math is
// therefore fed a page box stubbed to a known size, and what is asserted is the
// payload the hook received. The fold guard needs no layout at all: it reads two
// vertical spans, so it drives directly.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBridge, clearOfTheFold } from '$lib/preview/bridge';
import type { Landing } from '$lib/core';
import type { LiveSession } from '@quillmark/wasm';
import type { PageSlot } from '$lib/preview/paint';

const PAGE = { widthPt: 612, heightPt: 792 };

/** One page slot whose box measures `scale`×(612×792) CSS px, so at `scale` 1 a click at
 *  (x, y) reads back as the PDF point `(x, 792 - y)` and the queries can be keyed on
 *  plain numbers. */
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

	// Content ink: `positionAt` answers, and its whole hit rides through untouched.
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

	// A field the plate places without tracking its content: the second rung names it
	// and there is no offset to hand over. A fabricated `0` would be an invented caret
	// wearing a real one's type, so the pick carries none.
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

	// Off everything the compile tracks the hook stays silent: there is no third rung
	// hit-testing `regions()`, whose rects bound ink the field does not fill.
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

	// One slack, both rungs, converted at the scale the page is drawn: it is the
	// pointer's, so it is a fixed size on screen and a varying one in the document —
	// halve the drawn width and a CSS pixel covers twice as many points. The relation
	// is what is asserted; the constant is the bridge's alone.
	it('hands both rungs one slack, converted at the scale the page is drawn', () => {
		const tolAt = (scale: number): number => {
			// Typed by the arity, not the signature: what is read back is which argument
			// each rung was handed, and both rungs take the same four numbers.
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

// The clearance the continuous hop moves on, as spans rather than boxes (PREVIEW
// §"Follow-the-caret scroll"). Both bounds are about reachability: an unbounded
// target height leaves the answer stuck at "not clear" for a tall target and at
// "clear" for a rect reporting none.
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

	// The floor. A rect carrying no height would ask for no clearance, which is bare
	// intersection: the caret sits on the edge it is about to be typed past.
	it('asks a rect reporting no height for room anyway', () => {
		expect(clearOfTheFold(span(800, 0), PORT)).toBe(false);
		expect(clearOfTheFold(span(797, 0), PORT)).toBe(false);
		expect(clearOfTheFold(span(400, 0), PORT)).toBe(true);
	});

	// The cap. A target its own height could never clear — a located line at zoom, a
	// short split track — is answerable once centred, and holds a band around it, so
	// the hop stops re-centring on every keystroke.
	it('clears a target too tall for its own height of clearance once it is centred', () => {
		const track = span(0, 300);
		expect(clearOfTheFold(span(75, 150), track)).toBe(true);
		expect(clearOfTheFold(span(60, 150), track)).toBe(true);
		expect(clearOfTheFold(span(10, 150), track)).toBe(false);
		expect(clearOfTheFold(span(140, 150), track)).toBe(false);
	});

	// Past the cap: no scroll shows more of a target taller than the port, so covering
	// it is the whole of what clear can mean there.
	it('clears a target taller than the port while it covers the port', () => {
		const track = span(0, 300);
		expect(clearOfTheFold(span(-50, 400), track)).toBe(true);
		expect(clearOfTheFold(span(20, 400), track)).toBe(false);
	});
});
