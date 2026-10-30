// The controller over the memory store and a real Document: the index and its verbs, and
// the reconcile flow against the core's own receipts and re-attachment rule.
import { describe, it, expect } from 'vitest';
import {
	createComments,
	MemoryCommentStore,
	remapPath,
	selectorOf,
	type CommentStore,
	type CommentThread
} from '../src/index.js';
import { anchoredDoc, clock, core, quill } from './helpers.js';

const author = { id: 'u1', name: 'Nibs' };

async function opened(doc = anchoredDoc()) {
	const store = new MemoryCommentStore();
	const comments = createComments({ store, author, now: clock() });
	await comments.ready;
	const thread = await comments.create(doc.anchorContext('t1')!, 'Which Monday?');
	return { doc, store, comments, thread };
}

describe('the index and its verbs', () => {
	it('creates a thread over a placed anchor, signed by the author, and lists it', async () => {
		const { comments, store, thread } = await opened();
		expect(thread).toMatchObject({
			id: 't1',
			status: 'open',
			anchored: true,
			selector: { path: 'main.body', quote: 'met on Monday' }
		});
		expect(thread.messages).toHaveLength(1);
		expect(thread.messages[0]).toMatchObject({ author, body: 'Which Monday?' });
		expect(comments.threads).toEqual([thread]);
		expect((await store.list())[0]).toEqual(thread);
	});

	it('reply, setStatus and remove show in the index at once and reach the store', async () => {
		const { comments, store } = await opened();
		const seen: number[] = [];
		comments.subscribe((threads) => seen.push(threads[0]?.messages.length ?? 0));
		const replied = comments.reply('t1', 'The 3rd.');
		expect(comments.thread('t1')?.messages).toHaveLength(2);
		await replied;
		expect((await store.list())[0].messages).toHaveLength(2);
		await comments.setStatus('t1', 'resolved');
		expect(comments.thread('t1')?.status).toBe('resolved');
		expect((await store.list())[0].status).toBe('resolved');
		await comments.remove('t1');
		expect(comments.threads).toEqual([]);
		expect(await store.list()).toEqual([]);
		expect(seen[0]).toBe(2);
		expect(seen.at(-1)).toBe(0);
	});

	it('a store that refuses reverts the index and rejects', async () => {
		const refusing: CommentStore = {
			...new MemoryCommentStore(),
			list: async () => [],
			create: async () => {
				throw new Error('offline');
			},
			reply: async () => {},
			setStatus: async () => {},
			setSelector: async () => {},
			remove: async () => {}
		};
		const comments = createComments({ store: refusing, author });
		await comments.ready;
		const doc = anchoredDoc();
		await expect(comments.create(doc.anchorContext('t1')!, 'x')).rejects.toThrow('offline');
		expect(comments.threads).toEqual([]);
	});

	it('a change made elsewhere in the store re-lists, keeping what this client derived', async () => {
		const { comments, store, doc } = await opened();
		comments.sync(core.Document.fromMarkdown('~~~\n$quill: showcase\n~~~\n\nNothing here.\n'));
		expect(comments.thread('t1')?.anchored).toBe(false);
		await store.reply('t1', { id: 'm2', author, body: 'elsewhere', createdAt: 'now' });
		await new Promise((r) => setTimeout(r, 0));
		expect(comments.thread('t1')?.messages).toHaveLength(2);
		expect(comments.thread('t1')?.anchored).toBe(false);
		comments.sync(doc);
		expect(comments.thread('t1')?.anchored).toBe(true);
	});
});

describe('sync, drift and the export envelope', () => {
	it('sync derives anchored from the live document and never writes', async () => {
		const { comments, store, doc } = await opened();
		const before = await store.list();
		doc.applyChange({}, { markOps: [{ op: 'removeAnchor', id: 't1' }] });
		comments.sync(doc);
		expect(comments.thread('t1')?.anchored).toBe(false);
		expect(await store.list()).toEqual(before);
	});

	it('a surviving anchor whose quote moved under it is drifted until refresh stores the new one', async () => {
		const { comments, store, doc } = await opened();
		doc.applyChange(
			{},
			{ delta: { ops: [{ retain: 14 }, { delete: 3 }, { insert: 'sat' }, { retain: 35 }] } }
		);
		expect(doc.anchorContext('t1')?.quote).toBe('sat on Monday');
		comments.sync(doc);
		expect(comments.drifted).toEqual(['t1']);
		await comments.refresh(doc);
		expect(comments.drifted).toEqual([]);
		expect((await store.list())[0].selector.quote).toBe('sat on Monday');
	});

	it('a collapsed anchor keeps its last quote through sync and refresh', async () => {
		const { comments, store, doc } = await opened();
		doc.applyChange({}, { delta: { ops: [{ retain: 14 }, { delete: 13 }, { retain: 25 }] } });
		expect(doc.anchorContext('t1')?.quote).toBe('');
		comments.sync(doc);
		expect(comments.drifted).toEqual([]);
		await comments.refresh(doc);
		expect((await store.list())[0].selector.quote).toBe('met on Monday');
	});

	it('export and import round-trip the envelope and refuse any other shape', async () => {
		const { store, thread } = await opened();
		const envelope = store.export();
		expect(envelope).toEqual({ version: 1, threads: [thread] });
		expect(
			(await MemoryCommentStore.import(JSON.parse(JSON.stringify(envelope))).list())[0]
		).toEqual(thread);
		expect(() => MemoryCommentStore.import({ version: 2, threads: [] })).toThrow(/version 1/);
		expect(() => MemoryCommentStore.import({ version: 1, threads: [{}] })).toThrow(/malformed/);
	});
});

describe('the reconcile flow', () => {
	it('a dropped anchor is placed again where its quote and context are found once', async () => {
		const { comments, store, doc } = await opened();
		const before = doc.anchorContexts();
		// The write kept the quote and carried no anchor: what a receipt naming `t1` dropped says.
		doc.revise({}, 'Minutes.\n\nThe committee met on Monday to plan the launch.');
		doc.applyChange({}, { markOps: [{ op: 'removeAnchor', id: 't1' }] });
		expect(doc.anchorContexts()).toEqual([]);
		const out = await comments.reconcile(doc, before, { droppedAnchors: [{ id: 't1' }] });
		expect(out.orphaned).toEqual([]);
		expect(out.reattached.map((c) => c.id)).toEqual(['t1']);
		expect(doc.anchorContext('t1')?.quote).toBe('met on Monday');
		const stored = (await store.list())[0];
		expect(stored.selector).toEqual({
			path: 'main.body',
			quote: 'met on Monday',
			prefix: 'Minutes.\nThe committee ',
			suffix: ' to plan the launch.'
		});
		expect(comments.thread('t1')?.anchored).toBe(true);
	});

	it('a quote the write took away orphans the thread, which keeps its selector and status', async () => {
		const { comments, store, doc } = await opened();
		await comments.setStatus('t1', 'resolved');
		const before = doc.anchorContexts();
		const revised = doc.revise({}, 'Nothing like it.\n\nAt all.');
		const out = await comments.reconcile(doc, before, {
			droppedAnchors: revised.droppedAnchors,
			deltas: { 'main.body': revised.delta }
		});
		expect(out.reattached).toEqual([]);
		expect(out.orphaned.map((c) => c.id)).toEqual(['t1']);
		const t = comments.thread('t1')!;
		expect(t).toMatchObject({ anchored: false, status: 'resolved' });
		expect(t.selector).toEqual(selectorOf(before[0]));
		expect((await store.list())[0].selector.quote).toBe('met on Monday');
	});

	it('a dropped id with no thread is a stray the flow leaves alone', async () => {
		const { comments, doc } = await opened();
		doc.applyChange(
			{},
			{ markOps: [{ op: 'add', start: 0, end: 3, type: 'anchor', attrs: { id: 'stray' } }] }
		);
		const before = doc.anchorContexts();
		const revised = doc.revise({}, 'Nothing like it.\n\nAt all.');
		expect(revised.droppedAnchors.map((a) => a.id).sort()).toEqual(['stray', 't1']);
		const out = await comments.reconcile(doc, before, { droppedAnchors: revised.droppedAnchors });
		expect(out.orphaned.map((c) => c.id)).toEqual(['t1']);
		expect(comments.threads.map((t) => t.id)).toEqual(['t1']);
	});

	it('reviseDocument reads the contexts before, writes, and reconciles in one call', async () => {
		const q = quill();
		const doc = q.exampleDocument()!;
		const body = doc.main.body;
		const quote = body.text.slice(0, 12);
		doc.applyChange(
			{},
			{ markOps: [{ op: 'add', start: 0, end: 12, type: 'anchor', attrs: { id: 'e1' } }] }
		);
		const comments = createComments({ store: new MemoryCommentStore(), author });
		await comments.ready;
		await comments.create(doc.anchorContext('e1')!, 'first words');
		const md = doc.toMarkdown().replace(quote, `Preface.\n\n${quote}`);
		const out = await comments.reviseDocument(doc, q.writer(doc), md);
		expect(out.from).toBeDefined();
		expect(out.warnings).toBeDefined();
		expect(out.orphaned).toEqual([]);
		expect(doc.anchorContext('e1')?.quote).toBe(quote);
		expect(comments.thread('e1')?.anchored).toBe(true);
		doc.free();
	});

	it('remapPath follows a card through the alignment and orphans a removed one', () => {
		expect(remapPath('cards.memo[2].summary', [2, 0, null])).toBe('cards.memo[0].summary');
		expect(remapPath('cards.memo[1].body', [2, 0, null])).toBeUndefined();
		expect(remapPath('main.body', [null])).toBe('main.body');
	});

	it('recover places every stored selector on a document reopened from markdown', async () => {
		const { comments, doc } = await opened();
		const reopened = core.Document.fromMarkdown(doc.toMarkdown());
		expect(reopened.anchorContexts()).toEqual([]);
		const out = await comments.recover(reopened);
		expect(out.reattached.map((c) => c.id)).toEqual(['t1']);
		expect(reopened.anchorContext('t1')?.quote).toBe('met on Monday');
		expect(comments.thread('t1')?.anchored).toBe(true);
	});

	it('setAnchored marks a re-anchored thread and stores the selector it was placed at', async () => {
		const { comments, store, doc } = await opened();
		doc.applyChange({}, { markOps: [{ op: 'removeAnchor', id: 't1' }] });
		comments.sync(doc);
		doc.applyChange(
			{},
			{ markOps: [{ op: 'add', start: 50, end: 56, type: 'anchor', attrs: { id: 't1' } }] }
		);
		await comments.setAnchored('t1', true, doc.anchorContext('t1')!);
		expect(comments.thread('t1')).toMatchObject({ anchored: true, selector: { quote: 'second' } });
		expect((await store.list())[0].selector.quote).toBe('second');
	});
});

describe('the thread shape', () => {
	it('is plain data a store can hold whole', () => {
		const thread: CommentThread = {
			id: 'x',
			status: 'open',
			anchored: true,
			selector: { path: 'main.body', quote: 'q', prefix: '', suffix: '' },
			messages: [],
			createdAt: 'now',
			updatedAt: 'now'
		};
		expect(structuredClone(thread)).toEqual(thread);
	});
});
