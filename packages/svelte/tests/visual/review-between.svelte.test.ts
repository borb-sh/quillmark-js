// @vitest-environment jsdom
// An answer as a review list, handed to an editor over the document its writer read: every item
// drawn, none outdated, and the whole list accepted leaves the document as the answer, its cards
// included. The host sets the list once and clears it once, and between the two the editor answers
// it alone.
import { describe, it, expect, afterEach } from 'vitest';
import type { Document } from '@quillmark/wasm';
import type { ReviewDrawn, ReviewEvent, ReviewItem } from '$lib/visual';
import { proposalsBetween } from '$lib/visual/proposals';
import { sameValue } from '$lib/visual/review';
import { fieldValues } from '$lib/visual/structure';
import { core, quill, example } from '../helpers/fixtures.js';
import { mountEditor, press, settle, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

/** A writer's answer over `base`: words of the body and of a block rich text field rewritten
 *  and added, a one-line rich text field, a text cell, a list's member, a record's cell and a
 *  number changed, a card added and a card taken out. */
function answered(base: Document): Document {
	const answer = base.clone();
	const write = quill().writer(answer);
	write.set('title', 'The Showcase Quill, *Reviewed*');
	write.set('subtitle', 'A reviewed reference document');
	write.set('signature_block', ['A. LOVELACE', 'Countess', 'Analyst']);
	const contributors = base.getStored('contributors') as Record<string, unknown>[];
	write.set('contributors', [contributors[0], { ...contributors[1], role: 'editor' }]);
	write.set('columns', 3);
	const [first, , second, last] = answer.blocks({});
	answer.applyBlocks({}, [
		{ op: 'replace', id: first.id, markdown: 'The body is a block leaf: paragraphs and lists.' },
		{ op: 'replace', id: second.id, markdown: '- A second bullet, rewritten.' },
		{ op: 'insertAfter', id: last.id, markdown: 'A paragraph the writer adds.' }
	]);
	answer.applyBlocks({ field: 'abstract' }, [
		{ op: 'insertAfter', id: answer.blocks({ field: 'abstract' })[0].id, markdown: 'More.' }
	]);
	write.addCard('note', {}, 'A note the writer adds.', 1);
	answer.removeCard(3);
	return answer;
}

describe('an answer’s review list', () => {
	it('is drawn whole over the document its writer read, and accepted it is the answer', async () => {
		const doc = example();
		const answer = answered(doc);
		const { items } = proposalsBetween(quill(), doc, answer);
		const drawn: ReviewDrawn[] = [];
		const { editor } = mountEditor(quill(), doc, {
			review: items,
			onReviewDrawn: (d) => drawn.push(d)
		});
		await settle();
		const report = drawn.at(-1)!;
		expect(report.undrawn).toEqual([]);
		expect(report.outdated).toEqual([]);
		expect([...report.open].sort()).toEqual(items.map((item) => item.id).sort());

		expect(editor.answerReview('all', 'accept').length).toBe(items.length);
		await settle();
		expect(doc.blocks({}).map((b) => b.markdown)).toEqual(answer.blocks({}).map((b) => b.markdown));
		expect(doc.blocks({ field: 'abstract' }).map((b) => b.markdown)).toEqual(
			answer.blocks({ field: 'abstract' }).map((b) => b.markdown)
		);
		const now = fieldValues(doc.main.payloadItems);
		const want = fieldValues(answer.main.payloadItems);
		for (const name of ['title', 'subtitle', 'signature_block', 'contributors', 'columns'])
			expect(sameValue(now[name], want[name]), name).toBe(true);
		const cards = (d: Document) =>
			Array.from({ length: d.cardCount }, (_, i) => ({ kind: d.card(i).kind, id: d.card(i).id }));
		expect(cards(doc)).toEqual(cards(answer));
	});
});

describe('a record or list the answer writes past what a list item names', () => {
	it('is drawn place by place, and accepted it is the answer', async () => {
		const doc = example();
		const answer = doc.clone();
		const write = quill().writer(answer);
		write.set('contact', { name: 'Grace', email: 'g@example.org' });
		write.set('authors', ['Mary Somerville', 'Ada Lovelace', 'Grace Hopper']);
		expect(doc.getStored('contact')).toBeUndefined();
		const { items } = proposalsBetween(quill(), doc, answer);
		expect(items.every((item) => 'field' in item && /[.[]/.test(item.field.slice(5)))).toBe(true);
		const drawn: ReviewDrawn[] = [];
		const { editor } = mountEditor(quill(), doc, {
			review: items,
			onReviewDrawn: (d) => drawn.push(d)
		});
		await settle();
		expect(drawn.at(-1)!.undrawn).toEqual([]);
		expect(drawn.at(-1)!.outdated).toEqual([]);
		expect(editor.answerReview('all', 'accept').length).toBe(items.length);
		await settle();
		const now = fieldValues(doc.main.payloadItems);
		const want = fieldValues(answer.main.payloadItems);
		for (const name of ['contact', 'authors'])
			expect(sameValue(now[name], want[name]), name).toBe(true);
	});

	it('takes out every member the answer removes, each found where the removals before it left it', async () => {
		const doc = example();
		const answer = doc.clone();
		quill().writer(answer).set('contributors', []);
		const { items } = proposalsBetween(quill(), doc, answer);
		const drawn: ReviewDrawn[] = [];
		const { editor } = mountEditor(quill(), doc, {
			review: items,
			onReviewDrawn: (d) => drawn.push(d)
		});
		await settle();
		expect(editor.answerReview('all', 'accept').length).toBe(items.length);
		await settle();
		expect(drawn.at(-1)!.open).toEqual([]);
		expect(doc.getStored('contributors')).toEqual(answer.getStored('contributors'));
	});
});

describe('a body the answer rewrites whole', () => {
	/** A template's body, a paragraph, a bullet holding a bullet and two paragraphs, rewritten as
	 *  the first paragraph rewritten, the rest taken out, and two paragraphs added after it. */
	function rewritten(): { doc: Document; answer: Document; items: ReviewItem[] } {
		const doc = example();
		doc.replace(
			{},
			core.importMarkdown(
				'Write here.\n\n- Use bullets.\n\n  - Indent to go deeper.\n\nYou can **bold**.\n\nNumbered for you.'
			).content
		);
		const answer = doc.clone();
		const [first, ...rest] = answer.blocks({}).map((b) => b.id);
		answer.applyBlocks({}, [
			{ op: 'replace', id: first, markdown: 'One.' },
			...rest.map((id) => ({ op: 'delete' as const, id })),
			{ op: 'insertAfter', id: first, markdown: 'Two.\n\nThree.' }
		]);
		let n = 0;
		return { doc, answer, items: proposalsBetween(quill(), doc, answer, () => `p${n++}`).items };
	}
	const bodyOf = (d: Document): string[] => d.blocks({}).map((b) => b.markdown);

	it('accepted whole is the answer, and one ⌘Z takes it back', async () => {
		const { doc, answer, items } = rewritten();
		const base = bodyOf(doc);
		const { editor, target } = mountEditor(quill(), doc, { review: items });
		await settle();
		expect(editor.answerReview('all', 'accept').length).toBe(items.length);
		await settle();
		expect(bodyOf(doc)).toEqual(bodyOf(answer));
		press(target.querySelector<HTMLElement>('.qm-editor')!, 'z', { ctrlKey: true });
		await settle();
		expect(bodyOf(doc)).toEqual(base);
	});

	it('accepted one item at a time is the answer, last item first', async () => {
		const { doc, answer, items } = rewritten();
		const { editor } = mountEditor(quill(), doc, { review: items });
		await settle();
		for (const { id } of items.toReversed())
			expect(editor.answerReview([id], 'accept'), id).toEqual([id]);
		expect(bodyOf(doc)).toEqual(bodyOf(answer));
	});
});

describe('the host’s list', () => {
	it('is set once and cleared once, the editor drawing each answer while it stands', async () => {
		const doc = example();
		const { items } = proposalsBetween(quill(), doc, answered(doc));
		const [first, second] = items.map((item) => item.id);
		const drawn: ReviewDrawn[] = [];
		const events: ReviewEvent[] = [];
		const { target, editor, props } = mountEditor(quill(), doc, {
			review: items,
			onReview: (e) => events.push(e),
			onReviewDrawn: (d) => drawn.push(d)
		});
		await settle();
		expect(drawn.at(-1)?.open).toHaveLength(items.length);

		editor.answerReview([first], 'accept');
		editor.answerReview([second], 'dismiss');
		await settle();
		expect(drawn.at(-1)?.open).toHaveLength(items.length - 2);
		expect(drawn.at(-1)?.open).not.toContain(first);
		expect(drawn.at(-1)?.open).not.toContain(second);
		expect(target.querySelector('.qm-toast-notice')?.textContent ?? '').toBe('');

		press(target.querySelector<HTMLElement>('.qm-editor')!, 'z', { ctrlKey: true });
		press(target.querySelector<HTMLElement>('.qm-editor')!, 'z', { ctrlKey: true });
		await settle();
		expect(events.slice(-2)).toEqual([
			{ id: second, action: 'reopen' },
			{ id: first, action: 'reopen' }
		]);
		expect(drawn.at(-1)?.open).toHaveLength(items.length);

		const kept = items.find(
			(item) => 'field' in item && item.field.endsWith('signature_block[1]')
		)!.id;
		editor.answerReview([kept], 'accept');
		props.review = [];
		await settle();
		expect(drawn.at(-1)).toMatchObject({ open: [] });
		expect(target.querySelector('[data-qm-review]')).toBeNull();
		expect(
			sameValue(fieldValues(doc.main.payloadItems).signature_block, ['A. LOVELACE', 'Countess'])
		).toBe(true);
	});
});

describe('a body the answer adds to above its first block', () => {
	const bodyOf = (d: Document): string[] => d.blocks({}).map((b) => b.markdown);
	const ahead = (added: string, first = (md: string) => md) => {
		const doc = example();
		const [lead, ...rest] = doc.toMarkdown({}).split('\n\n');
		const answer = doc.clone();
		answer.revise({}, [added, first(lead), ...rest].join('\n\n'));
		let n = 0;
		return { doc, answer, items: proposalsBetween(quill(), doc, answer, () => `p${n++}`).items };
	};

	it.each([
		['a heading', '## Purpose'],
		['a paragraph', 'A paragraph the writer adds.'],
		['a heading and a paragraph', '## Purpose\n\nA paragraph the writer adds.']
	])('takes %s as one insert before the first block, struck nowhere', async (_, added) => {
		const { doc, answer, items } = ahead(added);
		const first = doc.blocks({})[0].id;
		expect(items).toMatchObject([{ insert: { before: first }, after: added }]);
		const { editor, target } = mountEditor(quill(), doc, { review: items });
		await settle();
		expect(target.querySelector('.qm-review-del')).toBeNull();
		expect(editor.answerReview(['p0'], 'accept')).toEqual(['p0']);
		await settle();
		expect(bodyOf(doc)).toEqual(bodyOf(answer));
	});

	it('takes a heading above a first block it rewrites as an insert and that rewrite', async () => {
		const { doc, answer, items } = ahead('## Purpose', (md) => md.replace('full', 'whole'));
		const first = doc.blocks({})[0].id;
		expect(items).toMatchObject([
			{ replace: [first] },
			{ insert: { before: first }, after: '## Purpose' }
		]);
		for (const order of [items, items.toReversed()]) {
			const doc = example();
			const { editor } = mountEditor(quill(), doc, { review: items });
			await settle();
			for (const { id } of order) expect(editor.answerReview([id], 'accept'), id).toEqual([id]);
			await settle();
			expect(bodyOf(doc)).toEqual(bodyOf(answer));
			unmountAll();
		}
	});

	it('draws what is added after a block a rewrite retypes, once the rewrite is taken', async () => {
		const doc = example();
		const [first] = doc.blocks({});
		const items: ReviewItem[] = [
			{
				id: 'p0',
				field: 'main.body',
				replace: [first.id],
				before: first.markdown,
				after: '## Purpose'
			},
			{ id: 'p1', field: 'main.body', insert: { after: first.id }, after: first.markdown }
		];
		const drawn: ReviewDrawn[] = [];
		const { editor } = mountEditor(quill(), doc, {
			review: items,
			onReviewDrawn: (d) => drawn.push(d)
		});
		await settle();
		expect(editor.answerReview(['p0'], 'accept')).toEqual(['p0']);
		await settle();
		expect(drawn.at(-1)).toMatchObject({ open: ['p1'], undrawn: [] });
		expect(editor.answerReview(['p1'], 'accept')).toEqual(['p1']);
		expect(bodyOf(doc).slice(0, 2)).toEqual(['## Purpose', first.markdown]);
	});
});
