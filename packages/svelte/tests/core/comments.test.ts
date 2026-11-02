// The comment controller over a real document: the index and the store move together, a write that
// deletes a thread's text deletes the thread, a dropped anchor whose text survives is placed again,
// and an anchor that is merely absent leaves its thread in place, unanchored.
import { describe, expect, it } from 'vitest';
import type { AnchorContext, Document } from '@quillmark/wasm';
import {
	MemoryCommentStore,
	createComments,
	newThreadId,
	selectorOf,
	type CommentStore
} from '$lib/core';
import { core, example, quill } from '../helpers/fixtures.js';

const author = { id: 'u1', name: 'Ada' };

/** Anchor `id` over the first occurrence of `quote` in the body, and read its context. */
function anchorOver(doc: Document, quote: string, id = newThreadId()): AnchorContext {
	const start = doc.main.body.text.indexOf(quote);
	expect(start).toBeGreaterThanOrEqual(0);
	doc.apply({}, { steps: [{ anchor: { id, start, end: start + quote.length } }] });
	return doc.anchorContext(id)!;
}

/** The body's markdown with every line holding `quote` removed. */
function bodyWithout(doc: Document, quote: string): string {
	return quill()
		.reader(doc)
		.bodyMarkdown()
		.split('\n')
		.filter((line) => !line.includes(quote))
		.join('\n');
}

async function opened(doc: Document, store: CommentStore = new MemoryCommentStore()) {
	const comments = createComments({ store, author });
	await comments.ready;
	comments.sync(doc);
	return { comments, store };
}

describe('createComments', () => {
	it('opens a thread over a placed anchor, in the index and the store', async () => {
		const doc = example();
		const store = new MemoryCommentStore();
		const { comments } = await opened(doc, store);
		const context = anchorOver(doc, 'sibling');
		const thread = await comments.create(context, 'Why nest?');
		expect(comments.thread(context.id)).toMatchObject({
			status: 'open',
			anchored: true,
			selector: { path: context.path, quote: 'sibling' }
		});
		expect(store.export().threads.map((t) => t.id)).toEqual([thread.id]);
	});

	it('deletes the thread when a write deletes its text', async () => {
		const doc = example();
		const store = new MemoryCommentStore();
		const { comments } = await opened(doc, store);
		const context = anchorOver(doc, 'sibling');
		await comments.create(context, 'Why nest?');
		const receipt = doc.revise({}, bodyWithout(doc, 'sibling'));
		expect(receipt.droppedAnchors.map((c) => c.id)).toEqual([context.id]);
		const out = await comments.reconcile(doc, receipt.droppedAnchors);
		expect(out.deleted).toEqual([context.id]);
		expect(comments.threads).toEqual([]);
		expect(store.export().threads).toEqual([]);
	});

	it('places a dropped anchor again where its text still stands', async () => {
		const doc = example();
		const { comments } = await opened(doc);
		const context = anchorOver(doc, 'sibling');
		await comments.create(context, 'Why nest?');
		doc.apply({}, { steps: [{ anchor: { id: context.id, remove: true } }] });
		const out = await comments.reconcile(doc, [context]);
		expect(out).toEqual({ reattached: [context], deleted: [] });
		expect(doc.anchorContext(context.id)).toEqual(context);
		expect(comments.thread(context.id)?.anchored).toBe(true);
	});

	it('leaves a thread whose anchor is absent in place, unanchored, and recovers it', async () => {
		const doc = example();
		const store = new MemoryCommentStore();
		const { comments } = await opened(doc, store);
		const context = anchorOver(doc, 'sibling');
		await comments.create(context, 'Why nest?');
		const cold = core.Document.fromMarkdown(doc.toMarkdown());
		comments.sync(cold);
		expect(comments.thread(context.id)?.anchored).toBe(false);
		expect(store.export().threads).toHaveLength(1);
		const placed = await comments.recover(cold);
		expect(placed.map((c) => c.id)).toEqual([context.id]);
		expect(comments.thread(context.id)?.anchored).toBe(true);
	});

	it('reviseDocument reconciles the drops a whole-document revise names by id alone', async () => {
		const doc = example();
		const { comments } = await opened(doc);
		const context = anchorOver(doc, 'sibling');
		await comments.create(context, 'Why nest?');
		const markdown = doc
			.toMarkdown()
			.split('\n')
			.filter((line) => !line.includes('sibling'))
			.join('\n');
		const out = await comments.reviseDocument(doc, quill().writer(doc), markdown);
		expect(out.deleted).toEqual([context.id]);
		expect(comments.threads).toEqual([]);
	});

	it('ignores a dropped anchor no thread holds', async () => {
		const doc = example();
		const { comments } = await opened(doc);
		anchorOver(doc, 'sibling');
		const receipt = doc.revise({}, bodyWithout(doc, 'sibling'));
		expect(await comments.reconcile(doc, receipt.droppedAnchors)).toEqual({
			reattached: [],
			deleted: []
		});
	});

	it('reverts the index when the store refuses a new thread', async () => {
		const doc = example();
		class Refusing extends MemoryCommentStore {
			override async create(): Promise<void> {
				throw new Error('offline');
			}
		}
		const { comments } = await opened(doc, new Refusing());
		await expect(comments.create(anchorOver(doc, 'sibling'), 'Why nest?')).rejects.toThrow(
			'offline'
		);
		expect(comments.threads).toEqual([]);
	});
});

describe('createComments, when the store misbehaves', () => {
	it('refuses a second thread on an id it holds, and keeps the first', async () => {
		const doc = example();
		const { comments } = await opened(doc);
		const context = anchorOver(doc, 'sibling');
		await comments.create(context, 'Why nest?');
		await expect(comments.create(context, 'Again')).rejects.toThrow();
		expect(comments.threads.map((t) => t.id)).toEqual([context.id]);
	});

	it('restores a thread and its anchored state when the store refuses its removal', async () => {
		class Refusing extends MemoryCommentStore {
			override async remove(): Promise<void> {
				throw new Error('offline');
			}
		}
		const doc = example();
		const { comments } = await opened(doc, new Refusing());
		const context = anchorOver(doc, 'sibling');
		await comments.create(context, 'Why nest?');
		await expect(comments.remove(context.id)).rejects.toThrow('offline');
		expect(comments.thread(context.id)?.anchored).toBe(true);
	});

	it('answers a drop that lands before the first list, once the list does', async () => {
		const doc = example();
		const context = anchorOver(doc, 'sibling');
		let release!: () => void;
		class Slow extends MemoryCommentStore {
			override async list() {
				await new Promise<void>((r) => (release = r));
				return super.list();
			}
		}
		const store = new Slow([
			{
				id: context.id,
				status: 'open',
				anchored: true,
				selector: selectorOf(context),
				messages: [],
				createdAt: '',
				updatedAt: ''
			}
		]);
		const comments = createComments({ store, author });
		const receipt = doc.revise({}, bodyWithout(doc, 'sibling'));
		const pending = comments.reconcile(doc, receipt.droppedAnchors);
		release();
		expect((await pending).deleted).toEqual([context.id]);
		expect(store.export().threads).toEqual([]);
	});
});

describe('MemoryCommentStore', () => {
	it('round-trips its export and refuses an envelope of another version', async () => {
		const doc = example();
		const store = new MemoryCommentStore();
		const { comments } = await opened(doc, store);
		const thread = await comments.create(anchorOver(doc, 'sibling'), 'Why nest?');
		await comments.reply(thread.id, 'To show a sub-list.');
		const copy = MemoryCommentStore.import(JSON.parse(JSON.stringify(store.export())));
		expect(await copy.list()).toEqual(await store.list());
		expect(() => MemoryCommentStore.import({ version: 2, threads: [] })).toThrow();
	});
});
