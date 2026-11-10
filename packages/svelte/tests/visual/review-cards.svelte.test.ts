// @vitest-environment jsdom
// An item names its card by index as the cards stood when the list was set, and stays on that
// card through the host's card ops and the reader's: drawn there, and accepted it writes there.
import { describe, it, expect, afterEach } from 'vitest';
import type { Document } from '@quillmark/wasm';
import type { ReviewDrawn, ReviewItem } from '$lib/visual';
import { quill, example } from '../helpers/fixtures.js';
import { mountEditor, settle, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const slots = (target: HTMLElement) => [...target.querySelectorAll<HTMLElement>('.qm-card-slot')];

/** A proposal over the first block of card `k`'s body. */
const onCard = (doc: Document, id: string, k: number, after: string): ReviewItem => ({
	id,
	field: doc.pathFor({ card: k }),
	replace: [doc.blocks({ card: k })[0].id],
	after
});

function reviewed() {
	const doc = example();
	const drawn: ReviewDrawn[] = [];
	expect(doc.cardCount).toBeGreaterThanOrEqual(4);
	const items = [
		onCard(doc, 'first', 0, 'The first card, proposed.'),
		onCard(doc, 'fourth', 3, 'The fourth card, proposed.')
	];
	const mounted = mountEditor(quill(), doc, {
		review: items,
		onReviewDrawn: (d) => drawn.push(d)
	});
	return { ...mounted, doc, drawn };
}

const holds = (slot: HTMLElement, id: string): boolean =>
	!!slot.querySelector(`[data-qm-review="${id}"]`);

describe('an item on a card', () => {
	it('stays on its card through a card the host inserts ahead of it, and writes there', async () => {
		const r = reviewed();
		await settle();
		const q = quill();
		r.doc.unchecked.insertCard(q.seedCard('section', r.doc.seedOverlay('section'))!, 1);
		r.editor.applyCardOps([{ op: 'insert', at: 1 }]);
		await settle();
		const cards = slots(r.target);
		expect(holds(cards[0], 'first')).toBe(true);
		expect(holds(cards[3], 'fourth')).toBe(false);
		expect(holds(cards[4], 'fourth')).toBe(true);
		expect(r.drawn.at(-1)).toMatchObject({ open: ['first', 'fourth'] });

		expect(r.editor.answerReview('all', 'accept')).toEqual(['first', 'fourth']);
		expect(r.doc.card(0).body.text).toContain('The first card, proposed.');
		expect(r.doc.card(4).body.text).toContain('The fourth card, proposed.');
		expect(r.doc.card(3).body.text).not.toContain('proposed');
	});

	it('stays on its card through a card the host removes ahead of it, and draws nothing once its own goes', async () => {
		const r = reviewed();
		await settle();
		r.doc.removeCard(1);
		r.editor.applyCardOps([{ op: 'remove', at: 1 }]);
		await settle();
		const cards = slots(r.target);
		expect(holds(cards[0], 'first')).toBe(true);
		expect(holds(cards[2], 'fourth')).toBe(true);

		r.doc.removeCard(2);
		r.editor.applyCardOps([{ op: 'remove', at: 2 }]);
		await settle();
		expect(r.drawn.at(-1)?.open).toEqual(['first']);
		expect(r.drawn.at(-1)?.undrawn).toContainEqual({ id: 'fourth', reason: 'field' });
	});

	it('is read against the cards as they stand when the host sets a new list', async () => {
		const r = reviewed();
		await settle();
		r.doc.removeCard(1);
		r.editor.applyCardOps([{ op: 'remove', at: 1 }]);
		r.props.review = [onCard(r.doc, 'now', 2, 'The card now third, proposed.')];
		await settle();
		expect(holds(slots(r.target)[2], 'now')).toBe(true);
	});
});
