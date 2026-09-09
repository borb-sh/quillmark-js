// @vitest-environment jsdom
// The narrow shell hides the track the reader is not on with `display: none`, and the
// preview stays mounted behind it (THEMING §"The shell"): a surface that lost its pages
// to a tab switch would repaint the whole document on every one. Hiding is what the loop
// sees as an empty visible set, so these drive that transition directly — the observer is
// the only thing that reports it, and jsdom has none.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createPreview } from '$lib/preview/controller';
import type { LiveSession, ChangeSet, FieldRegion } from '@quillmark/wasm';

// A driveable IntersectionObserver: the paint loop learns visibility from it alone, so a
// stub that remembers its targets can play "scrolled into view" and "hidden" in turn.
let io: FakeIO | undefined;
class FakeIO {
	targets: Element[] = [];
	constructor(private cb: IntersectionObserverCallback) {
		io = this;
	}
	observe(el: Element): void {
		this.targets.push(el);
	}
	unobserve(el: Element): void {
		this.targets = this.targets.filter((t) => t !== el);
	}
	disconnect(): void {
		this.targets = [];
	}
	/** Report every observed page at once, which is what a short document does. */
	report(isIntersecting: boolean): void {
		this.cb(
			this.targets.map((target) => ({ target, isIntersecting })) as IntersectionObserverEntry[],
			this as unknown as IntersectionObserver
		);
	}
}

// The other half of the transition, and the only thing that reports it: the switch is
// `display: none`, which is a box going to 0×0 and back. Both the paint loop and the
// bridge observe the container, so a run reports every instance.
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
/** The switch flipping, as jsdom can carry it: the box each module re-reads for itself
 *  — the entries a run hands them are never read — and the run that says it moved. */
function setBox(el: HTMLElement, width: number, height: number): void {
	el.getBoundingClientRect = () =>
		({ left: 0, top: 0, right: width, bottom: height, width, height }) as DOMRect;
	Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
	for (const ro of ros) ro.report();
}
/** The rAF `scheduleRepaint` coalesces into. */
const frame = (): Promise<unknown> => new Promise((r) => requestAnimationFrame(r));

beforeAll(() => {
	(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
	(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
	// jsdom ships no canvas backend, so `getContext` returns null and the loop reads every
	// page as one it must not register. What is under test is which pages are mounted, and
	// the pixels are the session's — which is mocked — so a stub context is the whole need.
	HTMLCanvasElement.prototype.getContext =
		(() => ({})) as unknown as HTMLCanvasElement['getContext'];
});

function mockSession(pageCount: number): LiveSession {
	return {
		pageCount,
		pageSize: () => ({ widthPt: 612, heightPt: 792 }),
		paint: () => ({ layoutWidth: 612, layoutHeight: 792, pixelWidth: 612, pixelHeight: 792 }),
		regions: () => [],
		fieldBoxes: () => [],
		positionAt: () => undefined,
		locate: () => undefined
	} as unknown as LiveSession;
}

const change = (pageCount: number): ChangeSet => ({ pageCount, dirtyPages: [] });

describe('a preview hidden by the narrow shell', () => {
	let container: HTMLDivElement;
	beforeEach(() => {
		io = undefined;
		ros = [];
		container = document.createElement('div');
		document.body.appendChild(container);
	});

	const canvases = () => container.querySelectorAll('canvas').length;

	it('keeps its painted pages while the other track is showing', () => {
		const preview = createPreview(mockSession(2), { container });
		io?.report(true);
		expect(canvases()).toBe(2);

		// The switch flips: `display: none` on the track leaves nothing intersecting.
		io?.report(false);
		expect(canvases()).toBe(2);

		preview.destroy();
	});

	it('paints what a recompile dirtied while it was hidden once it is back', () => {
		const preview = createPreview(mockSession(2), { container });
		io?.report(true);
		io?.report(false);

		// An edit lands in the other track; the page count moves under a preview no one
		// is looking at. Nothing is visible, so nothing paints yet.
		preview.refresh(change(3));
		expect(container.querySelectorAll('.qm-page-slot').length).toBe(3);

		// Back on this track, the observer reports again and the band is swept.
		io?.report(true);
		expect(canvases()).toBe(3);

		preview.destroy();
	});

	// The resize path is the one the sweep's no-op does not cover: hiding fires the
	// observer with a 0×0 box, and a repaint taken from it reads every page's width
	// through `clientWidth || widthPt` — the 1× raster, frozen over the pixels the pane
	// already had, for a pane nobody is looking at.
	it('rasters nothing at the box a hidden pane reports', async () => {
		const painted: number[] = [];
		const session = {
			...mockSession(2),
			paint: (_ctx: unknown, page: number) => {
				painted.push(page);
				return { layoutWidth: 612, layoutHeight: 792, pixelWidth: 612, pixelHeight: 792 };
			}
		} as unknown as LiveSession;
		setBox(container, 600, 800);
		const preview = createPreview(session, { container });
		io?.report(true);
		expect(painted).toEqual([0, 1]);

		painted.length = 0;
		setBox(container, 0, 0);
		await frame();
		expect(painted).toEqual([]);

		// Back at the width it left: the pixels are the ones it was hidden with.
		setBox(container, 600, 800);
		await frame();
		expect(painted).toEqual([]);

		// A pane that comes back to another box is the case a repaint is for.
		setBox(container, 900, 800);
		await frame();
		expect(painted).toEqual([0, 1]);

		preview.destroy();
	});

	// The caret follow across the same window. Every rect on a hidden pane measures zero,
	// which the fold guard reads as a caret already clear of both edges: unheld, the
	// follow answers "nothing to do" for every keystroke and the pane opens where the
	// caret was several edits ago.
	it('holds the caret trip while it is hidden and runs it on the way back', () => {
		const located: Array<[string, number]> = [];
		const session = {
			...mockSession(1),
			locate: (field: string, pos: number): FieldRegion => {
				located.push([field, pos]);
				return { field, page: 0, rect: [10, 10, 110, 30] } as FieldRegion;
			}
		} as unknown as LiveSession;
		// What the bridge's marker measures, the container's own box being its own
		// property: a caret a page down while the pane is showing — off the fold of any
		// port here — and nothing at all while it is not, since a box inside a hidden
		// container measures 0×0 exactly as the container does.
		const rect = Element.prototype.getBoundingClientRect;
		Element.prototype.getBoundingClientRect = () =>
			(container.getBoundingClientRect().height > 0
				? { left: 0, top: 1000, right: 110, bottom: 1020, width: 100, height: 20 }
				: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
		setBox(container, 600, 800);
		const preview = createPreview(session, { container });
		io?.report(true);

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

		Element.prototype.getBoundingClientRect = rect;
		preview.destroy();
	});

	// The discrete hop across the same window, with a recompile in it. A page count that
	// moves rebuilds the bridge, and nothing re-asserts a `scrollToField` the way `refresh`
	// re-asserts the follow: the trip is held by the controller, so the rebuild carries it.
	it('holds the field trip across a recompile that changes the page count', () => {
		const session = {
			...mockSession(1),
			regions: (): FieldRegion[] => [
				{ field: 'main.date', page: 0, rect: [10, 10, 110, 30] } as FieldRegion
			]
		} as unknown as LiveSession;
		const rect = Element.prototype.getBoundingClientRect;
		Element.prototype.getBoundingClientRect = () =>
			(container.getBoundingClientRect().height > 0
				? { left: 0, top: 1000, right: 110, bottom: 1020, width: 100, height: 20 }
				: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
		setBox(container, 600, 800);
		const preview = createPreview(session, { container });
		io?.report(true);

		// The address is placed, which is the whole of what the boolean says; a pane with
		// no box yet is not a second no.
		setBox(container, 0, 0);
		expect(preview.scrollToField('main.date')).toBe(true);
		expect(container.scrollTop).toBe(0);

		preview.refresh(change(2));
		expect(container.scrollTop).toBe(0);

		setBox(container, 600, 800);
		expect(container.scrollTop).toBeGreaterThan(0);

		Element.prototype.getBoundingClientRect = rect;
		preview.destroy();
	});
});
