// @vitest-environment jsdom
// The narrow shell hides the track the reader is not on with `display: none`, and the preview stays
// mounted behind it (THEMING §"The shell"). These drive that transition through fake observers,
// which jsdom lacks.
import { describe, it, expect, beforeAll, beforeEach, onTestFinished, vi } from 'vitest';
import { createPreview } from '$lib/preview/controller';
import type { LiveSession, FieldRegion } from '@quillmark/wasm';
import { FakeIO, change, mockSession, stubPaintGlobals } from '../helpers/session.js';

// Hiding is a box going to 0×0 and back. The viewport and the bridge both observe the container, so
// a run reports every instance.
let ros: FakeRO[] = [];
class FakeRO {
	constructor(private cb: ResizeObserverCallback) {
		ros.push(this);
	}
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {
		ros = ros.filter((ro) => ro !== this);
	}
	report(): void {
		this.cb([], this as unknown as ResizeObserver);
	}
}
/** Sets the box each module re-reads for itself, then reports the move. */
function setBox(el: HTMLElement, width: number, height: number): void {
	el.getBoundingClientRect = () =>
		({ left: 0, top: 0, right: width, bottom: height, width, height }) as DOMRect;
	Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
	Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
	for (const ro of ros) ro.report();
}
/** The rAF `scheduleRepaint` coalesces into. */
const frame = (): Promise<unknown> => new Promise((r) => requestAnimationFrame(r));

beforeAll(() => {
	stubPaintGlobals();
	(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
});

describe('a preview hidden by the narrow shell', () => {
	let container: HTMLDivElement;
	beforeEach(() => {
		ros = [];
		container = document.createElement('div');
		document.body.appendChild(container);
	});

	const canvases = () => container.querySelectorAll('canvas').length;

	/**
	 * What the bridge's marker measures: a caret a page down while the pane shows, 0×0 while it is
	 * hidden.
	 */
	function stubMarker(): void {
		const rect = Element.prototype.getBoundingClientRect;
		onTestFinished(() => {
			Element.prototype.getBoundingClientRect = rect;
		});
		Element.prototype.getBoundingClientRect = () =>
			(container.getBoundingClientRect().height > 0
				? { left: 0, top: 1000, right: 110, bottom: 1020, width: 100, height: 20 }
				: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
	}

	it('keeps its painted pages while the other track is showing', () => {
		const preview = createPreview(mockSession(2), { container });
		FakeIO.last!.report(true);
		expect(canvases()).toBe(2);

		FakeIO.last!.report(false);
		expect(canvases()).toBe(2);

		preview.destroy();
	});

	it('paints what a recompile dirtied while it was hidden once it is back', () => {
		const preview = createPreview(mockSession(2), { container });
		FakeIO.last!.report(true);
		FakeIO.last!.report(false);

		// Nothing is visible, so nothing paints yet.
		preview.refresh(change(3));
		expect(container.querySelectorAll('.qm-page-slot').length).toBe(3);

		FakeIO.last!.report(true);
		expect(canvases()).toBe(3);

		preview.destroy();
	});

	// Hiding fires the resize observer with a 0×0 box, which a repaint would read as a 1× raster.
	it('rasters nothing at the box a hidden pane reports', async () => {
		const painted: number[] = [];
		const session = {
			...mockSession(2),
			paint: (_ctx: unknown, page: number) => {
				painted.push(page);
			}
		} as unknown as LiveSession;
		setBox(container, 600, 800);
		const preview = createPreview(session, { container });
		FakeIO.last!.report(true);
		expect(painted).toEqual([0, 1]);

		painted.length = 0;
		setBox(container, 0, 0);
		await frame();
		expect(painted).toEqual([]);

		setBox(container, 600, 800);
		await frame();
		expect(painted).toEqual([]);

		setBox(container, 900, 800);
		await vi.waitFor(() => expect(painted).toEqual([0, 1]));

		preview.destroy();
	});

	// A dragged divider is a run of boxes a frame apart; stretched canvases stand in until it
	// rests.
	it('re-rasters a dragged pane once, when the drag rests', async () => {
		const painted: number[] = [];
		const session = {
			...mockSession(2),
			paint: (_ctx: unknown, page: number) => {
				painted.push(page);
			}
		} as unknown as LiveSession;
		setBox(container, 600, 800);
		const preview = createPreview(session, { container });
		FakeIO.last!.report(true);

		painted.length = 0;
		for (const width of [590, 580, 570]) {
			setBox(container, width, 800);
			await frame();
		}
		expect(painted).toEqual([]);
		await vi.waitFor(() => expect(painted).toEqual([0, 1]));

		preview.destroy();
	});

	// Every rect on a hidden pane measures zero, which the fold guard would read as clear of both
	// edges.
	it('holds the caret trip while it is hidden and runs it on the way back', () => {
		const located: Array<[string, number]> = [];
		const session = {
			...mockSession(1),
			locate: (field: string, pos: number): FieldRegion => {
				located.push([field, pos]);
				return { field, page: 0, rect: [10, 10, 110, 30] } as FieldRegion;
			}
		} as unknown as LiveSession;
		stubMarker();
		setBox(container, 600, 800);
		const preview = createPreview(session, { container });
		FakeIO.last!.report(true);

		setBox(container, 0, 0);
		preview.focusPosition({ field: 'main.body', pos: 12 });
		expect(located).toEqual([['main.body', 12]]);
		expect(container.scrollTop).toBe(0);

		setBox(container, 600, 800);
		expect(located).toEqual([
			['main.body', 12],
			['main.body', 12]
		]);
		expect(container.scrollTop).toBeGreaterThan(0);

		preview.destroy();
	});

	// A page count change rebuilds the bridge; the held trip survives it.
	it('holds the field trip across a recompile that changes the page count', () => {
		const session = {
			...mockSession(1),
			regions: (): FieldRegion[] => [
				{ field: 'main.date', page: 0, rect: [10, 10, 110, 30] } as FieldRegion
			]
		} as unknown as LiveSession;
		stubMarker();
		setBox(container, 600, 800);
		const preview = createPreview(session, { container });
		FakeIO.last!.report(true);

		setBox(container, 0, 0);
		expect(preview.scrollToField('main.date')).toBe(true);
		expect(container.scrollTop).toBe(0);

		preview.refresh(change(2));
		expect(container.scrollTop).toBe(0);

		setBox(container, 600, 800);
		expect(container.scrollTop).toBeGreaterThan(0);

		preview.destroy();
	});

	it('surfaces a paint that throws without aborting the observer sweep', () => {
		const session = {
			...mockSession(2),
			paint: () => {
				throw new Error('backend refused to paint');
			}
		} as unknown as LiveSession;
		const preview = createPreview(session, { container });
		expect(() => FakeIO.last!.report(true)).not.toThrow();
		expect(container.querySelector('.qm-preview-error')).toBeTruthy();
		expect(canvases()).toBe(0);
		preview.destroy();
	});
});
