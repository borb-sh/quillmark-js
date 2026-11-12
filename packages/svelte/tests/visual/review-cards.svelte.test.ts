// @vitest-environment jsdom
// An item names its card by index as the cards stood when the list was set, and stays on that
// card through the host's card ops and the reader's: drawn there, and accepted it writes there.
// One naming its card by `$id` is on that card wherever it stands, in a document that has moved on
// from the one its writer read.
import { describe, it, expect, afterEach } from 'vitest';
import type { Document } from '@quillmark/wasm';
import type { ReviewDrawn, ReviewItem } from '$lib/visual';
import { proposalsBetween } from '$lib/visual/proposals';
import { fieldValues } from '$lib/visual/structure';
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

/** An answer over `base` that rewrites the first card's heading and the fourth card's body, adds
 *  a note after the second card and takes out the third. */
function answerOver(base: Document): ReviewItem[] {
	const answer = base.clone();
	const write = quill().writer(answer);
	write.card(0).set('heading', 'A heading, proposed');
	const fourth = { card: answer.card(3).id! };
	answer.applyBlocks(fourth, [
		{ op: 'replace', id: answer.blocks(fourth)[0].id, markdown: 'The fourth card, proposed.' }
	]);
	answer.removeCard(2);
	write.addCard('note', {}, 'A note the writer adds.', 2);
	const names = ['heading', 'body', 'add', 'remove'];
	return proposalsBetween(quill(), base, answer, () => names.shift()!).items;
}

const idOf = (doc: Document, k: number): string => doc.card(k).id!;
const at = (doc: Document, id: string): number =>
	Array.from({ length: doc.cardCount }, (_, k) => doc.card(k).id).indexOf(id);

describe('an item naming its card by `$id`', () => {
	it('is on that card in a document whose cards have moved since its writer read it', async () => {
		const base = example();
		const items = answerOver(base);
		expect(items.map((item) => item.id).sort()).toEqual(['add', 'body', 'heading', 'remove']);
		const [first, second, third, fourth] = [0, 1, 2, 3].map((k) => idOf(base, k));

		const doc = base.clone();
		doc.unchecked.insertCard(quill().seedCard('section', doc.seedOverlay('section'))!, 0);
		doc.moveCard(4, 1);
		const drawn: ReviewDrawn[] = [];
		const { target, editor } = mountEditor(quill(), doc, {
			review: items,
			onReviewDrawn: (d) => drawn.push(d)
		});
		await settle();
		expect(drawn.at(-1)!.undrawn).toEqual([]);
		const cards = slots(target);
		expect(holds(cards[at(doc, first)], 'heading')).toBe(true);
		expect(holds(cards[at(doc, fourth)], 'body')).toBe(true);
		expect(holds(cards[at(doc, third)], 'remove')).toBe(true);
		const add = target.querySelector('[data-qm-review="add"]')!;
		const lead = cards[at(doc, second)];
		expect(lead.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(
			add.compareDocumentPosition(cards[at(doc, second) + 1]) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();

		expect(editor.answerReview('all', 'accept')).toHaveLength(items.length);
		await settle();
		expect(fieldValues(doc.card(at(doc, first)).payloadItems).heading).toMatchObject({
			text: 'A heading, proposed'
		});
		expect(doc.card(at(doc, fourth)).body.text).toContain('The fourth card, proposed.');
		expect(at(doc, third)).toBe(-1);
		expect(doc.card(at(doc, second) + 1).body.text).toContain('A note the writer adds.');
	});

	it('draws nothing where no card holds the id, whatever card stands at its index', async () => {
		const base = example();
		const items = answerOver(base);
		const doc = base.clone();
		doc.removeCard(3);
		doc.removeCard(2);
		doc.removeCard(1);
		doc.removeCard(0);
		expect(doc.cardCount).toBeGreaterThan(0);
		const drawn: ReviewDrawn[] = [];
		const { target } = mountEditor(quill(), doc, {
			review: items,
			onReviewDrawn: (d) => drawn.push(d)
		});
		await settle();
		expect(drawn.at(-1)!.open).toEqual(['add']);
		expect([...drawn.at(-1)!.undrawn].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
			{ id: 'body', reason: 'field' },
			{ id: 'heading', reason: 'field' },
			{ id: 'remove', reason: 'applied' }
		]);
		const add = target.querySelector('[data-qm-review="add"]')!;
		const last = slots(target).at(-1)!;
		expect(last.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('follows its card through the reader taking it out and putting it back', async () => {
		const base = example();
		const items = answerOver(base);
		const doc = base.clone();
		const drawn: ReviewDrawn[] = [];
		const { editor } = mountEditor(quill(), doc, {
			review: items,
			onReviewDrawn: (d) => drawn.push(d)
		});
		await settle();
		const fourth = idOf(base, 3);
		const taken = doc.removeCard(at(doc, fourth))!;
		editor.applyCardOps([{ op: 'remove', at: 3 }]);
		await settle();
		expect(drawn.at(-1)!.undrawn).toContainEqual({ id: 'body', reason: 'field' });
		doc.unchecked.insertCard(taken, 0);
		editor.applyCardOps([{ op: 'insert', at: 0 }]);
		await settle();
		expect(drawn.at(-1)!.undrawn).toEqual([]);
		expect(drawn.at(-1)!.open).toContain('body');
	});
});
