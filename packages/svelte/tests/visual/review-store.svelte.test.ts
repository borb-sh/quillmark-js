// @vitest-environment jsdom
// The review state's one answer to three sources of attention, and what an answer takes off.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createReview, REVEAL_MS } from '$lib/visual/review.svelte';
import type { ReviewAction } from '$lib/core/codec';
import type { ReviewItem } from '$lib/visual';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

// Two proposals in the body's leaf, and one under the title's control.
const ITEMS: ReviewItem[] = [
	{ id: 'first', field: 'main.body', replace: ['b0'], after: 'Now.' },
	{ id: 'title', field: 'main.title', before: 'Old', after: 'New' },
	{ id: 'proposal', field: 'main.body', insert: 'end', after: 'New.' }
];

function store(refuse = false) {
	let items = $state<ReviewItem[]>(ITEMS);
	const answers: [string, ReviewAction][] = [];
	const review = createReview({
		items: () => items,
		keyFor: (path) => path,
		exact: () => true,
		leafFor: (path) => path,
		valueAt: () => undefined,
		nested: () => undefined,
		answer(id, _item, action) {
			answers.push([id, action]);
			return !refuse;
		}
	});
	review.drew('main.body', { ids: ['first', 'proposal'], outdated: [], undrawn: [] });
	return { review, answers, list: (next: ReviewItem[]) => (items = next) };
}

describe('attention', () => {
	it('is the revealed item, else the caret’s, else the pointer’s', () => {
		const { review } = store();
		review.point('first', 'pointer');
		expect(review.lit).toBe('first');
		review.point('proposal', 'caret', 'main.body');
		expect(review.lit).toBe('proposal');
		review.reveal('title');
		expect(review.lit).toBe('title');
		vi.advanceTimersByTime(REVEAL_MS);
		expect(review.lit).toBe('proposal');
		review.point(undefined, 'caret', 'main.body');
		expect(review.lit).toBe('first');
	});

	it('takes no caret leaving from a leaf the caret has already left', () => {
		const { review } = store();
		review.point('first', 'caret', 'main.body');
		review.point('title', 'caret', 'main.title');
		review.point(undefined, 'caret', 'main.body');
		expect(review.lit).toBe('title');
	});
});

describe('the leaves', () => {
	it('each draw the items by blocks of their own field', () => {
		const { review, list } = store();
		list([
			...ITEMS,
			{ id: 'mine', field: 'main.body', replace: ['b1'], after: 'New.' },
			{ id: 'theirs', field: 'main.abstract', insert: 'end', after: 'New.' }
		]);
		expect(review.textAt('main.body').map((item) => item.id)).toEqual([
			'first',
			'proposal',
			'mine'
		]);
		expect(review.textAt('main.abstract').map((item) => item.id)).toEqual(['theirs']);
		expect(review.textAt('main.title')).toEqual([]);
		expect(review.at('main.body')).toEqual({});
		expect(review.at('main.title').proposed?.id).toBe('title');
	});
});

describe('an answer', () => {
	it('takes the item off what is drawn until a list arrives without it', () => {
		const { review, answers, list } = store();
		review.act('proposal', 'dismiss');
		review.act('title', 'accept');
		expect(answers).toEqual([
			['proposal', 'dismiss'],
			['title', 'accept']
		]);
		expect(review.textAt('main.body').map((item) => item.id)).toEqual(['first']);
		expect(review.at('main.title')).toEqual({});

		list([...ITEMS]);
		expect(review.textAt('main.body').map((item) => item.id)).toEqual(['first']);
		list(ITEMS.slice(0, 2));
		expect(review.textAt('main.body').map((item) => item.id)).toEqual(['first']);
		list(ITEMS);
		expect(review.textAt('main.body').map((item) => item.id)).toEqual(['first', 'proposal']);
	});

	it('is drawn again once reopened', () => {
		const { review } = store();
		review.act('title', 'accept');
		review.heard('title', 'reopen', 'main.title');
		expect(review.at('main.title').proposed?.id).toBe('title');
	});

	it('leaves the item standing where it could not be made', () => {
		const { review } = store(true);
		review.act('proposal', 'dismiss');
		expect(review.textAt('main.body').map((item) => item.id)).toEqual(['first', 'proposal']);
	});
});
