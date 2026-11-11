// @vitest-environment jsdom
// The review state's one current item, where the card items draw, and what an answer takes off.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { Card } from '@quillmark/wasm';
import { createReview, DWELL_MS } from '$lib/visual/review.svelte';
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

function store(
	refuse = false,
	cards: { listed: string[]; live: string[] } = { listed: [], live: [] }
) {
	let items = $state<ReviewItem[]>(ITEMS);
	let live = $state(cards.live);
	const answers: [string, ReviewAction][] = [];
	const answered: [string, boolean][] = [];
	const review = createReview({
		items: () => items,
		keyFor: (path) => path,
		exact: () => true,
		leafFor: (path) => path,
		valueAt: () => undefined,
		nested: () => undefined,
		listedCards: () => cards.listed,
		liveCards: () => live,
		answer(id, _item, action) {
			answers.push([id, action]);
			return !refuse;
		},
		answered: (id, current) => answered.push([id, current])
	});
	review.drew('main.body', { ids: ['first', 'proposal'], outdated: [], undrawn: [] });
	return {
		review,
		answers,
		answered,
		list: (next: ReviewItem[]) => (items = next),
		cards: (next: string[]) => (live = next)
	};
}

describe('the current item', () => {
	it('is named by the caret arriving, a reveal, or the pointer once it rests, and kept when they leave', () => {
		const { review } = store();
		expect(review.lit).toBeUndefined();
		review.point('proposal', 'caret');
		expect(review.lit).toBe('proposal');
		review.point(undefined, 'caret');
		expect(review.lit).toBe('proposal');
		review.reveal('title');
		expect(review.lit).toBe('title');
		review.point('first', 'pointer');
		expect(review.lit).toBe('title');
		vi.advanceTimersByTime(DWELL_MS);
		expect(review.lit).toBe('first');
		review.point(undefined, 'pointer');
		expect(review.lit).toBe('first');
	});

	it('is not moved by a pointer that leaves before it rests, or rests over the answer card', () => {
		const { review } = store();
		review.reveal('title');
		review.point('first', 'pointer');
		review.point(undefined, 'pointer');
		vi.advanceTimersByTime(DWELL_MS);
		expect(review.lit).toBe('title');
		review.point('first', 'pointer');
		review.hoverCard(true);
		vi.advanceTimersByTime(DWELL_MS);
		expect(review.lit).toBe('title');
		review.hoverCard(false);
		review.point('first', 'pointer');
		vi.advanceTimersByTime(DWELL_MS);
		expect(review.lit).toBe('first');
	});

	it('lights nothing once answered, says it was current, and is the item an undo reopens', () => {
		const { review, answered } = store();
		review.reveal('title');
		review.act('first', 'dismiss');
		review.act('title', 'accept');
		expect(answered).toEqual([
			['first', false],
			['title', true]
		]);
		expect(review.lit).toBeUndefined();
		review.reveal('proposal');
		review.heard('first', 'reopen', 'main.body');
		expect(review.lit).toBe('first');
	});
});

describe('the card items', () => {
	const card = (kind: string): Card => ({ kind, payloadItems: [], body: {} as Card['body'] });
	const CARDS: ReviewItem[] = [
		{ id: 'add-a', add: card('a'), after: 0 },
		{ id: 'add-b', add: card('b'), after: 0 },
		{ id: 'head', add: card('c') },
		{ id: 'gone', add: card('d'), after: 1 },
		{ id: 'take', remove: 0 },
		{ id: 'taken', remove: 1 }
	];

	it('draw after the card they name in list order, at the head, or last where it is gone', () => {
		const { review, list } = store(false, { listed: ['k0', 'k1'], live: ['k0'] });
		list(CARDS);
		const adds = review.cards.adds;
		expect(adds.get('k0')?.map((a) => a.id)).toEqual(['add-a', 'add-b']);
		expect(adds.get('head')?.map((a) => a.id)).toEqual(['head']);
		expect(adds.get('end')?.map((a) => a.id)).toEqual(['gone']);
		expect(review.cards.removes.get('k0')?.id).toBe('take');
		expect(review.fieldUndrawn).toEqual([{ id: 'taken', reason: 'applied' }]);
	});

	it('stand after the card an earlier one of their place wrote, so a run keeps its order', () => {
		const { review, list, cards } = store(false, { listed: ['k0'], live: ['k0'] });
		list(CARDS.slice(0, 2));
		review.act('add-a', 'accept');
		review.wrote('add-a', 'k-a');
		cards(['k0', 'k-a']);
		expect(review.cards.adds.get('k-a')?.map((a) => a.id)).toEqual(['add-b']);
		review.wrote('add-a', undefined);
		expect(review.cards.adds.get('k0')?.map((a) => a.id)).toEqual(['add-b']);
	});

	it('are the editor’s to name, by no leaf', () => {
		const { review, list } = store(false, { listed: ['k0'], live: ['k0'] });
		list(CARDS.slice(0, 1));
		expect(review.keyOf('add-a')).toBeUndefined();
		review.reveal('add-a');
		expect(review.lit).toBe('add-a');
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
