// @vitest-environment jsdom
// The page as it would read with every open proposal taken, written into a copy the host hands
// in: what accepting them all writes, made without writing the document or raising a hook, and
// the way between places in the document and places in the copy.
import { describe, it, expect, afterEach } from 'vitest';
import type { Document } from '@quillmark/wasm';
import type { ReviewDrawn, ReviewEvent, ReviewItem } from '$lib/visual';
import { proposalsBetween } from '$lib/visual/proposals';
import { quill, example } from '../helpers/fixtures.js';
import { mountEditor, settle, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

function mount(edit: (answer: Document) => void) {
	const doc = example();
	const answer = doc.clone();
	edit(answer);
	let n = 0;
	const { items } = proposalsBetween(quill(), doc, answer, () => `p${n++}`);
	const events: ReviewEvent[] = [];
	const drawn: ReviewDrawn[] = [];
	const mounted = mountEditor(quill(), doc, {
		review: items,
		onReview: (e) => events.push(e),
		onReviewDrawn: (d) => drawn.push(d)
	});
	return { ...mounted, doc, items, events, drawn };
}

/** The copy the editor projects into, made and projected as a host makes it. */
function project(r: ReturnType<typeof mount>) {
	const copy = r.doc.clone();
	const before = r.doc.toMarkdown();
	const changes = r.changes.length;
	const projection = r.editor.projectReview(copy);
	expect(r.doc.toMarkdown()).toBe(before);
	expect(r.changes.length).toBe(changes);
	expect(r.events).toEqual([]);
	return { copy, projection };
}

/** Projecting first, then accepting every open item, leaves the document as the copy. */
async function writesWhatAcceptWrites(edit: (answer: Document) => void): Promise<void> {
	const r = mount(edit);
	await settle();
	const open = r.drawn.at(-1)!.open;
	expect(open.length).toBeGreaterThan(0);
	const { copy, projection } = project(r);
	expect([...projection.ids].sort()).toEqual([...open].sort());
	expect(r.editor.answerReview('all', 'accept').length).toBe(open.length);
	await settle();
	expect(copy.toMarkdown()).toBe(r.doc.toMarkdown());
	copy.free();
}

const write = (answer: Document) => quill().writer(answer);

describe('a review projected into a copy', () => {
	it('writes a field’s proposal as its accept does', () =>
		writesWhatAcceptWrites((a) => {
			write(a).set('title', 'The Showcase Quill, *Reviewed*');
			write(a).set('columns', 3);
		}));

	it('writes places inside a field as their accepts do, a member taken out ahead of one changed', () =>
		writesWhatAcceptWrites((a) => {
			write(a).set('signature_block', ['A. LOVELACE', 'Countess', 'Analyst']);
			write(a).set('contact', { name: 'Grace', email: 'g@example.org' });
			write(a).set('authors', ['Mary Somerville', 'Ada Lovelace', 'Grace Hopper']);
		}));

	it('writes the cards a review adds and takes out where their accepts write them', () =>
		writesWhatAcceptWrites((a) => {
			write(a).addCard('note', {}, 'A note the writer adds.', 1);
			a.removeCard(3);
		}));

	it('writes a leaf’s rewrites and additions from the plans its accepts take', () =>
		writesWhatAcceptWrites((a) => {
			const [first, , second, last] = a.blocks({});
			a.applyBlocks({}, [
				{
					op: 'replace',
					id: first.id,
					markdown: 'The body is a block leaf: paragraphs and lists.'
				},
				{ op: 'replace', id: second.id, markdown: '- A second bullet, rewritten.' },
				{ op: 'insertAfter', id: last.id, markdown: 'A paragraph the writer adds.' }
			]);
			a.applyBlocks({ field: 'abstract' }, [
				{ op: 'insertAfter', id: a.blocks({ field: 'abstract' })[0].id, markdown: 'More.' }
			]);
		}));

	it('writes nothing of an item it does not draw, nor of one answered', async () => {
		const r = mount((a) => {
			write(a).set('columns', 3);
			write(a).set('subtitle', 'A reviewed reference document');
		});
		await settle();
		const [first, second] = r.drawn.at(-1)!.open;
		r.editor.answerReview([first], 'dismiss');
		await settle();
		const { copy, projection } = project({ ...r, events: [] });
		expect(projection.ids).toEqual([second]);
		r.editor.answerReview([second], 'accept');
		await settle();
		expect(copy.toMarkdown()).toBe(r.doc.toMarkdown());
		copy.free();
	});
});

describe('the way between the document and the copy', () => {
	function cards(r: ReturnType<typeof mount>) {
		const add = r.items.find((item) => 'add' in item)!.id;
		return { add, ...project(r) };
	}
	const cardEdit = (a: Document) => {
		write(a).addCard('note', {}, 'A note the writer adds.', 1);
		a.removeCard(3);
	};

	it('moves a card’s places past the cards a review adds and takes out', async () => {
		const r = mount(cardEdit);
		await settle();
		const { copy, projection } = cards(r);
		const at = (doc: Document, k: number) => doc.pathFor({ card: k });
		expect(projection.toProjection(at(r.doc, 0))).toBe(at(r.doc, 0));
		expect(projection.toProjection(at(r.doc, 1))).toBe(at(copy, 2));
		expect(projection.toProjection(at(r.doc, 2))).toBeUndefined();
		expect(projection.toProjection(at(r.doc, 3))).toBe(at(copy, 3));
		expect(projection.toLive(at(copy, 2))).toBe(at(r.doc, 1));
		expect(projection.toLive({ field: at(copy, 3), pos: 2 })).toEqual({
			field: at(r.doc, 3),
			pos: 2
		});
		copy.free();
	});

	it('names the proposal for a place only the copy holds', async () => {
		const r = mount(cardEdit);
		await settle();
		const { add, copy, projection } = cards(r);
		expect(projection.toLive({ field: copy.pathFor({ card: 1 }), pos: 0 })).toEqual({
			review: add
		});
		copy.free();
	});

	it('moves an offset past the words a proposal writes before it, and names an added paragraph', async () => {
		let added = '';
		const r = mount((a) => {
			const [first, second] = a.blocks({});
			a.applyBlocks({}, [
				{ op: 'replace', id: first.id, markdown: `${first.markdown} Proposed words.` },
				{ op: 'insertAfter', id: second.id, markdown: 'A paragraph the writer adds.' }
			]);
			added = 'A paragraph the writer adds.';
		});
		await settle();
		const body = r.doc.pathFor({});
		const { copy, projection } = project(r);
		const text = copy.main.body.text as string;
		const live = r.doc.main.body.text as string;
		const start = live.length - 12;
		const moved = projection.toProjection({ field: body, pos: start })!;
		expect(moved.pos).toBeGreaterThan(start);
		expect(text.slice(moved.pos, moved.pos + 12)).toBe(live.slice(start));
		expect(projection.toLive(moved)).toEqual({ field: body, pos: start });
		const proposedItem = r.items.find((item) => 'insert' in item)!.id;
		expect(projection.toLive({ field: body, pos: text.indexOf(added) + 3 })).toEqual({
			review: proposedItem
		});
		copy.free();
	});
});
