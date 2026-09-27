// @vitest-environment jsdom
// A zero-page session must not be a permanent empty-state stub. These
// drive the count transitions and assert the "No pages" element and the page
// slots both track the live count; 0→N escapes the empty state, N→0 returns.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createPreview } from '$lib/preview/controller';
import type { LiveSession, FieldRegion } from '@quillmark/wasm';
import { change, mockSession, stubPaintGlobals } from '../helpers/session.js';

beforeAll(stubPaintGlobals);

let container: HTMLDivElement;
beforeEach(() => {
	container = document.createElement('div');
	document.body.appendChild(container);
});

describe('preview controller empty-state across page-count transitions', () => {
	const pages = () => container.querySelectorAll('.qm-page-slot').length;
	const isEmpty = () => !!container.querySelector('.qm-preview-empty');

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
	let located: Array<[string, number]>;
	beforeEach(() => {
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
