// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { createPreview } from '$lib/preview/controller';
import { DEFAULT_PREVIEW_STRINGS } from '$lib/preview/strings';
import type { LiveSession, FieldRegion } from '@quillmark/wasm';
import { FakeIO, change, mockSession, stubPaintGlobals } from '../helpers/session.js';

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

// What a screen reader hears of the pane's message: a region mounted empty, which takes the
// message once the pane's state has changed and held still.
describe('the pane’s live region', () => {
	const S = DEFAULT_PREVIEW_STRINGS;
	beforeEach(() => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
	afterEach(() => void vi.useRealTimers());

	const live = () => container.querySelector('[role="status"]')!;
	const rest = () => vi.runOnlyPendingTimers();
	/** A session whose paint is refused while `failing` holds. */
	function refusing(pageCount: number) {
		const state = { failing: true };
		const session = {
			...mockSession(pageCount),
			paint: () => {
				if (state.failing) throw new Error('backend refused to paint');
			}
		} as unknown as LiveSession;
		return { session, state };
	}

	it('stands empty from the mount, and a fresh seed’s empty pane says nothing', () => {
		const preview = createPreview(mockSession(0), { container });
		expect(live().textContent).toBe('');
		rest();
		expect(live().textContent).toBe('');
		preview.refresh(change(1));
		rest();
		expect(live().textContent).toBe('');
		preview.destroy();
		expect(container.querySelector('[role="status"]')).toBeNull();
	});

	it('says a failed paint once it has held, and the pages standing again', () => {
		const { session, state } = refusing(1);
		const preview = createPreview(session, { container });
		FakeIO.last!.report(true);
		expect(live().textContent).toBe('');
		rest();
		expect(live().textContent).toBe(S.renderFailed);

		state.failing = false;
		preview.refresh(change(1));
		rest();
		expect(live().textContent).toBe(S.restored);
		preview.destroy();
	});

	it('says nothing more for a recompile the failure outlasts', () => {
		const { session } = refusing(1);
		const preview = createPreview(session, { container });
		FakeIO.last!.report(true);
		rest();
		const heard = new MutationObserver(() => {});
		heard.observe(live(), { childList: true, characterData: true, subtree: true });
		preview.refresh(change(1));
		rest();
		expect(heard.takeRecords()).toEqual([]);
		heard.disconnect();
		preview.destroy();
	});

	it('says the pages running out, and their return', () => {
		const preview = createPreview(mockSession(2), { container });
		preview.refresh(change(0));
		rest();
		expect(live().textContent).toBe(S.noPages);
		preview.refresh(change(1));
		rest();
		expect(live().textContent).toBe(S.restored);
		preview.destroy();
	});
});

// `refresh` re-asks `locate` for the followed caret (INVARIANTS §"Follow-the-caret scroll"); jsdom has
// no geometry, so the query is asserted, not a scrollTop.
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
	it('every slot carries its page number, in DOM order, across a count change', () => {
		const preview = createPreview(mockSession(3), { container });
		const numbers = () =>
			[...container.querySelectorAll<HTMLElement>('.qm-page-slot')].map((el) => el.dataset.page);
		expect(numbers()).toEqual(['0', '1', '2']);

		preview.refresh(change(5));
		expect(numbers()).toEqual(['0', '1', '2', '3', '4']);

		preview.refresh(change(2));
		expect(numbers()).toEqual(['0', '1']);
		preview.destroy();
	});
});

describe('what a screen reader hears of the pane', () => {
	const S = DEFAULT_PREVIEW_STRINGS;
	const labels = () =>
		[...container.querySelectorAll<HTMLElement>('.qm-page-slot')].map((el) => [
			el.getAttribute('role'),
			el.getAttribute('aria-label')
		]);

	it('names the pane a region and each page by its place, across a count change', () => {
		const preview = createPreview(mockSession(2), { container });
		expect(container.getAttribute('role')).toBe('region');
		expect(container.getAttribute('aria-label')).toBe(S.previewLabel);
		expect(labels()).toEqual([
			['img', S.pageLabel(1, 2)],
			['img', S.pageLabel(2, 2)]
		]);

		preview.refresh(change(3));
		expect(labels().map(([, label]) => label)).toEqual([1, 2, 3].map((n) => S.pageLabel(n, 3)));

		preview.destroy();
		expect(container.hasAttribute('role')).toBe(false);
		expect(container.hasAttribute('aria-label')).toBe(false);
	});

	it("keeps the host's own role and name", () => {
		container.setAttribute('role', 'figure');
		container.setAttribute('aria-labelledby', 'heading');
		const preview = createPreview(mockSession(1), { container });
		expect(container.getAttribute('role')).toBe('figure');
		expect(container.hasAttribute('aria-label')).toBe(false);
		preview.destroy();
		expect(container.getAttribute('role')).toBe('figure');
	});
});
