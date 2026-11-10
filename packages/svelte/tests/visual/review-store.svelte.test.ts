// @vitest-environment jsdom
// The review state's one answer to three sources of attention, and when a change's card is up.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createReview, HOVER_MS, LEAVE_MS, REVEAL_MS } from '$lib/visual/review.svelte';
import type { ReviewAction } from '$lib/core/codec';
import type { ReviewItem } from '$lib/visual';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const ITEMS: ReviewItem[] = [
	{ id: 'change', state: 'changed', anchor: '~a', before: 'was' },
	{ id: 'other', state: 'changed', field: 'main.title', before: 'Old' },
	{ id: 'proposal', state: 'proposed', anchor: '~b', after: 'New.' }
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
	return { review, answers, list: (next: ReviewItem[]) => (items = next) };
}

describe('the card', () => {
	it('rises for the pointer after a beat, and not for a pointer passing through', () => {
		const { review } = store();
		review.point('change', 'pointer');
		expect(review.lit).toBe('change');
		vi.advanceTimersByTime(HOVER_MS - 1);
		expect(review.shown).toBeUndefined();
		review.point(undefined, 'pointer');
		vi.advanceTimersByTime(HOVER_MS);
		expect(review.shown).toBeUndefined();

		review.point('change', 'pointer');
		vi.advanceTimersByTime(HOVER_MS);
		expect(review.shown?.item.id).toBe('change');
	});

	it('outlasts the pointer’s leaving by the trip into it, and stays while it is held', () => {
		const { review } = store();
		review.point('change', 'pointer');
		vi.advanceTimersByTime(HOVER_MS);
		review.point(undefined, 'pointer');
		vi.advanceTimersByTime(LEAVE_MS - 1);
		review.hold();
		vi.advanceTimersByTime(LEAVE_MS * 4);
		expect(review.shown?.item.id).toBe('change');
		review.release();
		vi.advanceTimersByTime(LEAVE_MS);
		expect(review.shown).toBeUndefined();
	});

	it('rises for the caret after the same beat, and goes with it', () => {
		const { review } = store();
		review.point('change', 'caret');
		expect(review.lit).toBe('change');
		vi.advanceTimersByTime(HOVER_MS - 1);
		expect(review.shown).toBeUndefined();
		review.point(undefined, 'caret');
		vi.advanceTimersByTime(HOVER_MS);
		expect(review.shown).toBeUndefined();

		review.point('change', 'caret');
		vi.advanceTimersByTime(HOVER_MS);
		expect(review.shown).toMatchObject({ item: { id: 'change' }, via: 'caret' });
		review.point(undefined, 'caret');
		expect(review.shown).toBeUndefined();
	});

	it('stays with the caret that enters the item the pointer raised it for', () => {
		const { review } = store();
		review.point('change', 'pointer');
		vi.advanceTimersByTime(HOVER_MS);
		review.point('change', 'caret');
		review.point(undefined, 'pointer');
		vi.advanceTimersByTime(LEAVE_MS * 4);
		expect(review.shown).toMatchObject({ item: { id: 'change' }, via: 'caret' });
	});

	it('is a change’s alone: a proposal is lit and raises none', () => {
		const { review } = store();
		review.point('proposal', 'caret');
		expect(review.lit).toBe('proposal');
		expect(review.shown).toBeUndefined();
	});

	it('keeps the caret’s item over the pointer’s', () => {
		const { review } = store();
		review.point('change', 'caret');
		review.point('other', 'pointer');
		vi.advanceTimersByTime(HOVER_MS);
		expect(review.shown?.item.id).toBe('change');
		expect(review.lit).toBe('change');
		review.point(undefined, 'pointer');
		review.point('other', 'pointer');
		vi.advanceTimersByTime(HOVER_MS);
		expect(review.shown?.item.id).toBe('change');
	});
});

describe('a reveal', () => {
	it('raises a change’s card, and lights an item for a while', () => {
		const { review } = store();
		review.reveal('proposal');
		expect(review.lit).toBe('proposal');
		vi.advanceTimersByTime(REVEAL_MS);
		expect(review.lit).toBeUndefined();

		review.reveal('change');
		expect(review.shown).toMatchObject({ item: { id: 'change' }, via: 'reveal' });
	});
});

describe('the leaves', () => {
	it('each draw the anchored items and those by blocks of their own field', () => {
		const { review, list } = store();
		list([
			...ITEMS,
			{ id: 'mine', state: 'proposed', field: 'main.body', replace: ['b1'], after: 'New.' },
			{ id: 'theirs', state: 'proposed', field: 'main.abstract', insert: 'end', after: 'New.' }
		]);
		expect(review.textAt('main.body').map((item) => item.id)).toEqual([
			'change',
			'proposal',
			'mine'
		]);
		expect(review.textAt('main.abstract').map((item) => item.id)).toEqual([
			'change',
			'proposal',
			'theirs'
		]);
		expect(review.textAt('main.title').map((item) => item.id)).toEqual(['change', 'proposal']);
		expect(review.at('main.body')).toEqual({});
	});
});

describe('an answer', () => {
	it('takes the item off what is drawn until a list arrives without it', () => {
		const { review, answers, list } = store();
		review.act('change', 'revert');
		expect(answers).toEqual([['change', 'revert']]);
		expect(review.textAt('main:$body').map((item) => item.id)).toEqual(['proposal']);

		list([...ITEMS]);
		expect(review.textAt('main:$body').map((item) => item.id)).toEqual(['proposal']);
		list(ITEMS.slice(1));
		expect(review.textAt('main:$body').map((item) => item.id)).toEqual(['proposal']);
		list(ITEMS);
		expect(review.textAt('main:$body').map((item) => item.id)).toEqual(['change', 'proposal']);
	});

	it('leaves the item standing where it could not be made', () => {
		const { review } = store(true);
		review.act('other', 'revert');
		expect(review.at('main.title').changed?.id).toBe('other');
	});
});
