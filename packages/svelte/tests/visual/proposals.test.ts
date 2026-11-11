// The review list an answer makes from the document its writer read: one item per place that
// changed, at the path the editor draws it under, and an item per card added or taken out.
import { describe, it, expect } from 'vitest';
import type { Document } from '@quillmark/wasm';
import { proposalsBetween } from '$lib/visual/proposals';
import { quill, example } from '../helpers/fixtures.js';

const between = (edit: (answer: Document, base: Document) => void) => {
	const base = example();
	const answer = base.clone();
	edit(answer, base);
	let n = 0;
	return { base, ...proposalsBetween(quill(), base, answer, () => `p${n++}`) };
};
const texts = (list: string[]) => list.map((text) => ({ text, codec: 'plain' }));

describe('a body', () => {
	it('takes a block rewritten or taken out by its id, with what the writer read', () => {
		const { base, items } = between((answer) => {
			const [first, second] = answer.blocks({});
			answer.applyBlocks({}, [
				{ op: 'replace', id: first.id, markdown: 'Rewritten.' },
				{ op: 'delete', id: second.id }
			]);
		});
		const [first, second] = base.blocks({});
		expect(items).toEqual([
			{
				id: 'p0',

				field: 'main.body',
				replace: [first.id],
				before: first.markdown,
				after: 'Rewritten.'
			},
			{
				id: 'p1',

				field: 'main.body',
				replace: [second.id],
				before: second.markdown,
				after: ''
			}
		]);
	});

	it('takes a run of blocks added after the block it follows, or before the first', () => {
		const { base, items } = between((answer) => {
			const blocks = answer.blocks({});
			answer.applyBlocks({}, [
				{ op: 'insertAfter', id: blocks[0].id, markdown: 'One.' },
				{ op: 'insertAfter', id: blocks[0].id, markdown: 'Two.' }
			]);
		});
		expect(items).toMatchObject([{ field: 'main.body', insert: { after: base.blocks({})[0].id } }]);
		expect((items[0] as { after: string }).after.split('\n\n').sort()).toEqual(['One.', 'Two.']);
	});
});

describe('a field', () => {
	it('takes each member of a list changed, taken out, or appended, appends at successive indices', () => {
		const { items } = between(
			(answer) =>
				void quill()
					.writer(answer)
					.set('authors', ['Ada Lovelace', 'Mary Somerville', 'Emmy Noether'])
		);
		expect(items).toMatchObject([
			{
				field: 'main.authors[1]',
				before: { text: 'Grace Hopper' },
				after: { text: 'Mary Somerville' }
			},
			{ field: 'main.authors[2]', after: { text: 'Emmy Noether' } }
		]);

		const added = between(
			(answer) =>
				void quill().writer(answer).set('authors', ['Ada Lovelace', 'Grace Hopper', 'One', 'Two'])
		).items;
		expect(added.map((item) => 'field' in item && item.field)).toEqual([
			'main.authors[2]',
			'main.authors[3]'
		]);

		const removed = between(
			(answer) => void quill().writer(answer).set('authors', ['Grace Hopper'])
		).items;
		expect(removed).toMatchObject([{ field: 'main.authors[0]', before: { text: 'Ada Lovelace' } }]);
		expect(removed[0]).not.toHaveProperty('after');
	});

	it('takes a list gaining a member before its end member by member', () => {
		const { items } = between(
			(answer) =>
				void quill()
					.writer(answer)
					.set('authors', ['Mary Somerville', 'Ada Lovelace', 'Grace Hopper'])
		);
		expect(items).toMatchObject([
			{
				field: 'main.authors[0]',
				before: { text: 'Ada Lovelace' },
				after: { text: 'Mary Somerville' }
			},
			{
				field: 'main.authors[1]',
				before: { text: 'Grace Hopper' },
				after: { text: 'Ada Lovelace' }
			},
			{ field: 'main.authors[2]', after: { text: 'Grace Hopper' } }
		]);
	});

	it('takes a record’s cell inside a list’s member by its path', () => {
		const { items } = between((answer, base) => {
			const contributors = base.getStored('contributors') as Record<string, unknown>[];
			quill()
				.writer(answer)
				.set('contributors', [contributors[0], { ...contributors[1], role: 'editor' }]);
		});
		expect(items).toEqual([
			{
				id: 'p0',

				field: 'main.contributors[1].role',
				before: 'reviewer',
				after: 'editor'
			}
		]);
	});
});

describe('a card', () => {
	it('is an item: one added after the card it follows, one taken out, by their indexes', () => {
		const { items } = between((answer) => {
			quill().writer(answer).addCard('note', {}, 'A new note.', 2);
			answer.removeCard(4);
		});
		expect(items).toMatchObject([
			{ id: 'p0', add: { kind: 'note' }, after: 1 },
			{ id: 'p1', remove: 3 }
		]);
	});

	it('stands a run of added cards after the card the run follows, in order, the head’s with no index', () => {
		const { items } = between((answer) => {
			const write = quill().writer(answer);
			write.addCard('note', {}, 'First.', 0);
			write.addCard('note', {}, 'Second.', 1);
		});
		expect(items).toMatchObject([
			{ add: { kind: 'note', body: { text: 'First.' } } },
			{ add: { kind: 'note', body: { text: 'Second.' } } }
		]);
		expect(items.every((item) => !('after' in item))).toBe(true);
	});

	it('keeps its fields’ items under its own path when one before it moves', () => {
		const { items } = between((answer) => {
			answer.moveCard(0, 1);
			const at = answer.card(0).kind === 'section' ? 0 : 1;
			answer.applyBlocks({ card: answer.card(at).id! }, [
				{ op: 'replace', id: answer.blocks({ card: answer.card(at).id! })[0].id, markdown: 'New.' }
			]);
		});
		expect(items).toMatchObject([{ field: 'cards.section[0].body', after: 'New.' }]);
	});
});
