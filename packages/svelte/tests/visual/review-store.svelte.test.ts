// @vitest-environment jsdom
// The review state's one current item, where the card items draw, and what an answer takes off.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { Card } from '@quillmark/wasm';
import { createReview } from '$lib/visual/review.svelte';
import { nextOpen, stepIn } from '$lib/visual/review-order';
import { createStructuralUndo } from '$lib/visual/undo.svelte';
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
	const answered: [string, (readonly string[])?][] = [];
	const undone: string[] = [];
	const undo = createStructuralUndo();
	const review = createReview({
		items: () => items,
		keyFor: (path) => path,
		exact: () => true,
		leafFor: (path) => path,
		valueAt: () => undefined,
		nested: () => undefined,
		layout: () => [{ key: 'main', leaves: [{ key: 'main.title' }, { key: 'main.body' }] }],
		listedCards: () => cards.listed,
		liveCards: () => live,
		cardFor: () => undefined,
		undo,
		answer(id, item, action) {
			answers.push([id, action]);
			if (refuse) return false;
			if (action === 'reopen') return true;
			return () => {
				undone.push(id);
				review.heard(id, 'reopen', item && 'field' in item ? item.field : '');
			};
		},
		answerProse(key, id, action) {
			review.heard(id, action, key);
			return !refuse;
		},
		answered: (id, order) => answered.push(order ? [id, order] : [id])
	});
	review.drew('main.body', { ids: ['first', 'proposal'], outdated: [], undrawn: [] });
	return {
		review,
		answers,
		answered,
		undone,
		undo,
		list: (next: ReviewItem[]) => (items = next),
		cards: (next: string[]) => (live = next)
	};
}

describe('the current item', () => {
	it('is named by the caret arriving or a reveal, and kept when the caret leaves', () => {
		const { review } = store();
		expect(review.lit).toBeUndefined();
		review.point('proposal');
		expect(review.lit).toBe('proposal');
		review.point(undefined);
		expect(review.lit).toBe('proposal');
		review.reveal('title');
		expect(review.lit).toBe('title');
	});

	it('lights nothing once answered, says it was current, and is the item an undo reopens', () => {
		const { review, answered } = store();
		review.reveal('title');
		review.act('first', 'dismiss');
		review.act('title', 'accept');
		expect(answered).toEqual([['title']]);
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

describe('the report', () => {
	// The title's field holds nothing here, so its proposal's `before` is not what it holds.
	it('lists the open items in the page’s order, with no editor mounted', () => {
		const { review } = store();
		expect(review.order).toEqual(['title', 'first', 'proposal']);
		expect(review.report).toEqual({ open: review.order, outdated: ['title'], undrawn: [] });
	});

	it('says why an item no leaf reports draws nothing', () => {
		const { review } = store();
		review.drew('main.body', { ids: ['first'], outdated: ['first'], undrawn: [] });
		expect(review.report).toEqual({
			open: ['title', 'first'],
			outdated: ['title', 'first'],
			undrawn: [{ id: 'proposal', reason: 'block' }]
		});
	});
});

describe('the answer journal', () => {
	it('takes the answers back newest first, each reopened', () => {
		const { review, undone, undo } = store();
		review.act('title', 'accept');
		review.act('first', 'dismiss');
		expect(undo.take()).toBe(true);
		expect(undone).toEqual(['first']);
		expect(review.items.map((item) => item.id)).toEqual(['first', 'proposal']);
		expect(undo.take()).toBe(true);
		expect(undone).toEqual(['first', 'title']);
		expect(review.items).toEqual(ITEMS);
		expect(undo.take()).toBe(false);
	});

	it('ends at an edit that is no answer’s, and not at an answer’s own write', () => {
		const { review, undone, undo } = store();
		review.act('title', 'accept');
		review.writing(true);
		review.settled();
		review.writing(false);
		review.act('first', 'dismiss');
		review.settled();
		expect(undo.take()).toBe(false);
		expect(undone).toEqual([]);
	});

	it('starts over once another step has taken the key', () => {
		const { review, undone, undo } = store();
		review.act('title', 'accept');
		undo.offer('', () => undefined);
		review.act('first', 'dismiss');
		expect(undo.take()).toBe(true);
		expect(undo.take()).toBe(false);
		expect(undone).toEqual(['first']);
	});
});

describe('a batch of answers', () => {
	it('answers in the page’s order, and is taken back whole, last answer first', () => {
		const { review, answers, undone, undo } = store();
		expect(review.answer(['proposal', 'title'], 'dismiss')).toEqual(['title', 'proposal']);
		expect(answers).toEqual([
			['title', 'dismiss'],
			['proposal', 'dismiss']
		]);
		expect(undo.take()).toBe(true);
		expect(undone).toEqual(['proposal', 'title']);
		expect(review.items).toEqual(ITEMS);
		expect(undo.take()).toBe(false);
	});

	it('leaves the outdated items open when every item is accepted, and takes them when dismissed', () => {
		const { review } = store();
		const { outdated } = review.report;
		expect(outdated.length).toBeGreaterThan(0);
		const accepted = review.answer('all', 'accept');
		expect(accepted.length).toBeGreaterThan(0);
		expect(review.items.map((item) => item.id)).toEqual(outdated);
		expect(review.answer('all', 'dismiss')).toEqual(outdated);
		expect(review.items).toEqual([]);
	});

	it('moves on from the current item once, with the order as it stood before', () => {
		const { review, answered } = store();
		const before = review.order;
		review.reveal('first');
		review.answer('all', 'dismiss');
		expect(answered).toEqual([['first', before]]);
	});

	it('returns only what could be answered', () => {
		const { review } = store(true);
		expect(review.answer('all', 'dismiss')).toEqual([]);
		expect(review.items).toEqual(ITEMS);
	});
});

describe('the walk', () => {
	const order = ['a', 'b', 'c'];
	it('moves on to the next open item after an answer, round from the end', () => {
		expect(nextOpen(order, 'a', new Set(['b', 'c']))).toBe('b');
		expect(nextOpen(order, 'c', new Set(['a', 'b']))).toBe('a');
		expect(nextOpen(order, 'b', new Set(['a']))).toBe('a');
		expect(nextOpen(order, 'b', new Set())).toBeUndefined();
	});

	it('steps from the current item, round from either end', () => {
		expect(stepIn(order, 1, 'c')).toBe(order.indexOf('a'));
		expect(stepIn(order, -1, 'a')).toBe(order.indexOf('c'));
		expect(stepIn(order, 1, undefined)).toBe(0);
		expect(stepIn(order, -1, undefined)).toBe(order.length - 1);
		expect(stepIn([], 1, undefined)).toBeUndefined();
	});

	it('steps on from the place an answered item held', () => {
		expect(stepIn(order, 1, 'gone', 1)).toBe(1);
		expect(stepIn(order, -1, 'gone', 1)).toBe(0);
	});
});
