// @vitest-environment jsdom
// A zero-page session must not be a permanent empty-state stub. These
// drive the count transitions and assert the "No pages" element and the page
// slots both track the live count; 0→N escapes the empty state, N→0 returns.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createPreview } from '$lib/preview/controller';
import type { LiveSession, ChangeSet, FieldRegion } from '@quillmark/wasm';

// jsdom has no IntersectionObserver; the paint loop only needs it to observe
// visibility, which these count-transition assertions do not exercise (no page
// is ever scrolled into view, so `paint` is never reached).
class NoopIO {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

beforeAll(() => {
	(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = NoopIO;
});

/** A report-only session stub: only the geometry verbs the loop calls at build. */
function mockSession(pageCount: number): LiveSession {
	return {
		pageCount,
		pageSize: () => ({ widthPt: 612, heightPt: 792 }),
		paint: () => ({
			layoutWidth: 612,
			layoutHeight: 792,
			pixelWidth: 612,
			pixelHeight: 792
		}),
		regions: () => [],
		fieldBoxes: () => [],
		positionAt: () => undefined,
		locate: () => undefined
	} as unknown as LiveSession;
}

function change(pageCount: number): ChangeSet {
	return { pageCount, dirtyPages: [] };
}

describe('preview controller empty-state across page-count transitions', () => {
	let container: HTMLDivElement;
	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
	});

	const pages = () => container.querySelectorAll('.qm-page-slot').length;
	const isEmpty = () => !!container.querySelector('.qm-preview-empty');

	it('a session that opens empty escapes the empty state on a later apply', () => {
		const preview = createPreview(mockSession(0), { container });
		expect(isEmpty()).toBe(true);
		expect(pages()).toBe(0);

		// A ChangeSet arriving after an empty open builds slots; ignoring it would
		// strand the surface in the empty state for the session.
		preview.refresh(change(2));
		expect(isEmpty()).toBe(false);
		expect(pages()).toBe(2);

		preview.destroy();
	});

	it('a session that drops to zero pages returns to the empty state', () => {
		const preview = createPreview(mockSession(3), { container });
		expect(isEmpty()).toBe(false);
		expect(pages()).toBe(3);

		preview.refresh(change(0));
		expect(isEmpty()).toBe(true);
		expect(pages()).toBe(0);

		// …and back up again; the toggle is not one-way.
		preview.refresh(change(1));
		expect(isEmpty()).toBe(false);
		expect(pages()).toBe(1);

		preview.destroy();
	});

	it('destroy clears the empty state and the container class', () => {
		const preview = createPreview(mockSession(0), { container });
		expect(isEmpty()).toBe(true);
		preview.destroy();
		expect(isEmpty()).toBe(false);
		expect(container.classList.contains('qm-preview')).toBe(false);
	});
});

// `locate` answers against the last compiled layout, so a caret typed past it is
// off-content until the compile lands, and the next caret event is the only thing
// that would ask again. `refresh` has to re-ask (PREVIEW §"Follow-the-caret
// scroll"); where the scroll ends up is geometry jsdom does not have, so what is
// asserted is the query, not a scrollTop.
describe('a recompile re-locates the followed caret', () => {
	let container: HTMLDivElement;
	let located: Array<[string, number]>;
	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		located = [];
	});

	function trackingSession(boxes: FieldRegion[] = []): LiveSession {
		return {
			...mockSession(1),
			fieldBoxes: (field: string) => boxes.filter((b) => b.field === field),
			locate: (field: string, pos: number) => {
				located.push([field, pos]);
				return undefined;
			}
		} as unknown as LiveSession;
	}

	it('re-asks for the last followed place, and asks for nothing before one exists', () => {
		const preview = createPreview(trackingSession(), { container });
		preview.refresh(change(1));
		expect(located).toEqual([]);

		preview.focusPosition({ field: 'main.body', pos: 12 });
		expect(located).toEqual([['main.body', 12]]);

		preview.refresh(change(1));
		expect(located).toEqual([
			['main.body', 12],
			['main.body', 12]
		]);
		preview.destroy();
	});

	// Only a focus change says the caret has left the place the slot names: a control
	// reports none of its own, so the re-locate above would keep pulling the pane back
	// to the leaf the focus left, on every recompile.
	it('a focus change ends it, and the next place restarts it', () => {
		const preview = createPreview(trackingSession(), { container });
		preview.focusPosition({ field: 'main.body', pos: 12 });
		located.length = 0;

		preview.endFollow();
		preview.refresh(change(1));
		expect(located).toEqual([]);

		preview.focusPosition({ field: 'main.title', pos: 2 });
		preview.refresh(change(1));
		expect(located).toEqual([
			['main.title', 2],
			['main.title', 2]
		]);
		preview.destroy();
	});

	// A discrete hop is a host naming the field the pane shows, and the caret loses to
	// it: re-asserted at the next recompile, it would pull the pane straight back off
	// that field. A hop that placed nothing moved nothing, so it takes no rank.
	it('a placed discrete hop ends it', () => {
		const box = { field: 'main.date', page: 0, rect: [10, 10, 110, 30] } as FieldRegion;
		const preview = createPreview(trackingSession([box]), { container });
		preview.focusPosition({ field: 'main.body', pos: 12 });
		located.length = 0;

		expect(preview.scrollToField('main.date')).toBe(true);
		preview.refresh(change(1));
		expect(located).toEqual([]);
		preview.destroy();
	});

	it('a hop this compile places nothing for leaves it standing', () => {
		const preview = createPreview(trackingSession(), { container });
		preview.focusPosition({ field: 'main.body', pos: 12 });
		located.length = 0;

		expect(preview.scrollToField('main.date')).toBe(false);
		preview.refresh(change(1));
		expect(located).toEqual([['main.body', 12]]);
		preview.destroy();
	});
});

describe('the page slot names its index', () => {
	let container: HTMLDivElement;
	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
	});

	// A consumer drawing its own overlay reads the page number off the slot. Without
	// `data-page` the only handle is position among siblings, which is right today and
	// is not a contract; asserted here so it becomes one.
	it('every slot carries its page number, in DOM order, across a count change', () => {
		const preview = createPreview(mockSession(3), { container });
		const numbers = () =>
			[...container.querySelectorAll<HTMLElement>('.qm-page-slot')].map((el) => el.dataset.page);
		expect(numbers()).toEqual(['0', '1', '2']);

		// The slots a grow reuses keep the number they were built with, and the ones it
		// appends continue the run: an index written once at build is only right if the
		// reconcile never permutes.
		preview.refresh(change(5));
		expect(numbers()).toEqual(['0', '1', '2', '3', '4']);

		preview.refresh(change(2));
		expect(numbers()).toEqual(['0', '1']);
		preview.destroy();
	});
});

// A `session.paint` that throws must not abort the band sweep: it is
// caught per-slot and surfaced as an error state instead of an unhandled throw
// inside the IntersectionObserver callback.
describe('preview controller paint resilience', () => {
	let container: HTMLDivElement;
	let ioInstances: CapturingIO[];
	let prevIO: unknown;
	let prevGetContext: typeof HTMLCanvasElement.prototype.getContext;

	// A capturing IntersectionObserver whose callback the test fires on demand:
	// jsdom has none, and this path needs a page to actually reach `paint`.
	class CapturingIO {
		cb: (entries: { target: Element; isIntersecting: boolean }[]) => void;
		targets: Element[] = [];
		constructor(cb: CapturingIO['cb']) {
			this.cb = cb;
			ioInstances.push(this);
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
		fireAll(): void {
			this.cb(this.targets.map((target) => ({ target, isIntersecting: true })));
		}
	}

	beforeEach(() => {
		ioInstances = [];
		container = document.createElement('div');
		document.body.appendChild(container);
		prevIO = (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver;
		(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = CapturingIO;
		// jsdom's canvas has no 2d context; hand `paintSlot` a truthy stub so it
		// proceeds to `session.paint` (the throw under test) instead of bailing.
		prevGetContext = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext =
			(() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
	});
	afterEach(() => {
		(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = prevIO;
		HTMLCanvasElement.prototype.getContext = prevGetContext;
	});

	function throwingSession(pageCount: number): LiveSession {
		return {
			...mockSession(pageCount),
			paint: () => {
				throw new Error('backend refused to paint');
			}
		} as unknown as LiveSession;
	}

	it('a paint that throws surfaces an error state without aborting the observer sweep', () => {
		const preview = createPreview(throwingSession(2), { container });
		expect(container.querySelectorAll('.qm-page-slot').length).toBe(2);

		const io = ioInstances[ioInstances.length - 1];
		// The whole point: the band sweep does not throw out of the IO callback.
		expect(() => io.fireAll()).not.toThrow();
		expect(container.querySelector('.qm-preview-error')).toBeTruthy();
		// …and a failed paint leaves no blank registered canvas behind.
		expect(container.querySelectorAll('canvas.qm-page-canvas').length).toBe(0);

		preview.destroy();
	});
});
