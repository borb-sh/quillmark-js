// @vitest-environment jsdom
// A card added or taken out as a review item: drawn where it would stand, stepped through with the
// rest, written by the editor when accepted, and taken back by ⌘Z.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import { REVIEW_KEYS } from '$lib/core/codec';
import type { ReviewDrawn, ReviewEvent, ReviewItem } from '$lib/visual';
import { proposalsBetween } from '$lib/visual/proposals';
import { quill, example } from '../helpers/fixtures.js';
import { mountEditor, press, settle, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const mod = { ctrlKey: true };
const kinds = (doc: Document) => Array.from({ length: doc.cardCount }, (_, i) => doc.card(i).kind);

/** The items an answer makes that adds a note after the second card and takes out the fourth. */
function cardItems(doc: Document, edit?: (answer: Document) => void): ReviewItem[] {
	const answer = doc.clone();
	if (edit) edit(answer);
	else {
		quill().writer(answer).addCard('note', {}, 'A note the writer adds.', 2);
		answer.removeCard(4);
	}
	let n = 0;
	return proposalsBetween(quill(), doc, answer, () => `c${n++}`).items;
}

function mount(items: (doc: Document) => ReviewItem[], extra = {}) {
	const doc = example();
	const events: ReviewEvent[] = [];
	const drawn: ReviewDrawn[] = [];
	const mounted = mountEditor(quill(), doc, {
		review: items(doc),
		onReview: (e) => events.push(e),
		onReviewDrawn: (d) => drawn.push(d),
		...extra
	});
	return { ...mounted, doc, events, drawn };
}

describe('a proposed card', () => {
	it('is drawn where it would stand, its removal marked on the card it takes out', async () => {
		const r = mount((doc) => cardItems(doc));
		await settle();
		const add = r.target.querySelector<HTMLElement>('.qm-review-card-add[data-qm-review="c0"]')!;
		expect(add.textContent).toContain('A note the writer adds.');
		const slots = [...r.target.querySelectorAll('.qm-card-slot')];
		expect(add.compareDocumentPosition(slots[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(slots[1].compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		const removal = r.target.querySelector<HTMLElement>('.qm-review-card-remove.qm-review-on')!;
		expect(removal.getAttribute('data-qm-review')).toBe('c1');
		expect(removal.querySelectorAll('.qm-card-slot').length).toBe(0);
		expect(r.drawn.at(-1)).toMatchObject({ open: ['c0', 'c1'], undrawn: [] });
	});

	it('previews each field it fills by name, and names a removal in the header of the card it takes out', async () => {
		const r = mount((doc) =>
			cardItems(doc, (answer) => {
				quill().writer(answer).addCard('note', { label: 'Aside' }, 'A note the writer adds.', 2);
				answer.removeCard(4);
			})
		);
		await settle();
		const add = r.target.querySelector<HTMLElement>('.qm-review-card-add[data-qm-review="c0"]')!;
		const values = [...add.querySelectorAll('dd')].map((dd) => dd.textContent);
		expect(values).toContain('Aside');
		expect(add.querySelectorAll('dt')).toHaveLength(values.length);
		const removal = r.target.querySelector<HTMLElement>('.qm-review-card-remove.qm-review-on')!;
		expect(removal.querySelector('.qm-card-header')?.textContent).toContain(
			removal.getAttribute('aria-label')
		);
	});

	it('is written by the editor when accepted, and ⌘Z takes it back and reopens it', async () => {
		const r = mount((doc) => cardItems(doc));
		await settle();
		const before = kinds(r.doc);
		expect(r.editor.answerReview(['c0'], 'accept')).toEqual(['c0']);
		await settle();
		const added = r.doc.card(2);
		expect(added.kind).toBe('note');
		expect(r.events).toEqual([{ id: 'c0', action: 'accept' }]);
		expect(r.changes.at(-1)).toMatchObject({ source: 'structure', op: { op: 'insert', at: 2 } });
		expect(r.target.querySelector('[data-qm-review="c0"]')).toBeNull();

		press(document.body, 'z', mod);
		await settle();
		expect(kinds(r.doc)).toEqual(before);
		expect(r.events.at(-1)).toEqual({ id: 'c0', action: 'reopen' });
		expect(r.target.querySelector('[data-qm-review="c0"]')).not.toBeNull();
	});

	it('takes its card out when its removal is accepted, and ⌘Z puts it back where it stood', async () => {
		const r = mount((doc) => cardItems(doc));
		await settle();
		const before = r.doc.toMarkdown();
		r.editor.answerReview(['c1'], 'accept');
		await settle();
		expect(r.doc.cardCount).toBe(example().cardCount - 1);
		expect(r.changes.at(-1)).toMatchObject({ op: { op: 'remove', at: 3 } });

		press(document.body, 'z', mod);
		await settle();
		expect(r.doc.toMarkdown()).toBe(before);
		expect(r.events.at(-1)).toEqual({ id: 'c1', action: 'reopen' });
		expect(r.drawn.at(-1)?.open).toContain('c1');
	});

	it('keeps a run of added cards in their order as each is accepted', async () => {
		const r = mount((doc) =>
			cardItems(doc, (answer) => {
				const write = quill().writer(answer);
				write.addCard('note', {}, 'First.', 1);
				write.addCard('note', {}, 'Second.', 2);
			})
		);
		await settle();
		r.editor.answerReview(['c0'], 'accept');
		r.editor.answerReview(['c1'], 'accept');
		await settle();
		expect([r.doc.card(1).body?.text, r.doc.card(2).body?.text].map((t) => t?.trim())).toEqual([
			'First.',
			'Second.'
		]);
	});

	it('is a step in the walk, and the answer moves on to the next', async () => {
		const r = mount((doc) => cardItems(doc));
		await settle();
		const lit = () => r.target.querySelector('.qm-review-lit')?.getAttribute('data-qm-review');
		expect(lit()).toBe('c0');
		press(document.body, 'ArrowDown', { ...mod, altKey: true });
		await settle();
		expect(lit()).toBe('c1');
		press(document.body, REVIEW_KEYS.dismiss.split('-').at(-1)!, mod);
		await settle();
		expect(r.events).toEqual([{ id: 'c1', action: 'dismiss' }]);
		expect(lit()).toBe('c0');
	});
});
