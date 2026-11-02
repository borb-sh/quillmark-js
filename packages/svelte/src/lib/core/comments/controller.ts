// The controller a host or the editor holds: the synchronous index the UI reads, the verbs that
// write through the store, and the reconcile flow every write that drops anchors runs
// (COMMENTS.md §"Reconcile"). Nothing here parses a body, knows Svelte, or touches an anchor no
// write reported dropped.
import type {
	AnchorContext,
	BaseOptions,
	Delta,
	Document,
	DocumentRevised,
	DocumentWriter
} from '@quillmark/wasm';
import {
	newThreadId,
	sameSelector,
	selectorOf,
	type AnchorSelector,
	type Author,
	type CommentMessage,
	type CommentStore,
	type CommentThread,
	type ThreadStatus
} from './model.js';

export interface CreateCommentsOpts {
	store: CommentStore;
	/** Who signs every message this client writes. */
	author: Author;
	/** A store write that failed after the index showed it, and a re-list that failed. */
	onError?: (e: unknown) => void;
	/** The clock, for a test that pins time. */
	now?: () => string;
}

/** What a reconcile did: the threads placed again, and the threads deleted with their text. */
export interface Reconciled {
	reattached: AnchorContext[];
	deleted: string[];
}

export interface Comments {
	/** Every thread, `anchored` derived against the last document synced. */
	readonly threads: readonly CommentThread[];
	/** Ids whose live quote differs from the stored one, until the next refresh. */
	readonly drifted: readonly string[];
	/** Resolves once the store's first list has landed in the index. */
	readonly ready: Promise<void>;
	/** Called with the index after every change to it. */
	subscribe(fn: (threads: readonly CommentThread[]) => void): () => void;
	thread(id: string): CommentThread | undefined;

	/** Open a thread over an anchor the caller has just placed, `context` from
	 *  `doc.anchorContext(id)`. Rejects, with the index reverted, when the store refuses; the
	 *  caller then removes the anchor. */
	create(context: AnchorContext, body: string): Promise<CommentThread>;
	reply(id: string, body: string): Promise<void>;
	setStatus(id: string, status: ThreadStatus): Promise<void>;
	/** Delete the thread. The caller removes the anchor. */
	remove(id: string): Promise<void>;
	/** Record a thread's anchor placed again over `context`, after the caller re-anchored it. */
	reanchor(id: string, context: AnchorContext): Promise<void>;

	/** Re-derive `anchored` and drift against the live document, with no write: on open, after a
	 *  structure op, after any change that reports no drops. */
	sync(doc: Document): void;
	/**
	 * The reconcile flow, for a write that dropped anchors: `dropped` are the selectors as read
	 * before the write (a `Receipt.droppedAnchors`, the editor's `onAnchorsDropped`, a collab
	 * `RemoteChange`), and `deltas` the write's text delta per path where it has one. Each dropped
	 * thread is placed again by `doc.reattach` or deleted: its text is gone. The document is
	 * written before the first await.
	 */
	reconcile(
		doc: Document,
		dropped: readonly AnchorContext[],
		deltas?: Record<string, Delta>
	): Promise<Reconciled>;
	/** `writer.reviseDocument`, then `reconcile` over what it dropped. */
	reviseDocument(
		doc: Document,
		writer: DocumentWriter,
		markdown: string,
		opts?: BaseOptions
	): Promise<DocumentRevised & Reconciled>;
	/**
	 * Bring back each thread `reconcile` deleted this session whose text the document holds again
	 * (an undo, the same words retyped in place): `doc.reattach` over their last selectors, under
	 * the same exact-match rule. Answers the anchors it placed, the document written before it
	 * returns; the store writes follow. Cheap while nothing is held.
	 */
	restore(doc: Document): AnchorContext[];
	/** Store the live selector of every anchored thread whose context changed, for a save. */
	refresh(doc: Document): Promise<void>;
	/** For a host that opened from markdown: `doc.reattach` over every stored selector. A thread
	 *  it cannot place stays, unanchored. */
	recover(doc: Document): Promise<AnchorContext[]>;
	/** Drop the store subscription. */
	destroy(): void;
}

/**
 * The selectors of `dropped` as `before` read them: what a receipt that names its drops by id
 * alone (`DocumentRevised`, `Revised`) hands `reconcile`, `before` being `doc.anchorContexts()`
 * read ahead of the write.
 */
export function droppedSelectors(
	dropped: readonly { id: string }[],
	before: readonly AnchorContext[]
): AnchorContext[] {
	const read = new Map(before.map((c) => [c.id, c]));
	return dropped.flatMap(({ id }) => {
		const context = read.get(id);
		return context ? [context] : [];
	});
}

export function createComments(opts: CreateCommentsOpts): Comments {
	const { store, author } = opts;
	const now = opts.now ?? (() => new Date().toISOString());
	const report = (e: unknown) => opts.onError?.(e);

	let index: CommentThread[] = [];
	/** `anchored` as last derived, overlaid on every re-list. */
	const anchored = new Map<string, boolean>();
	const drift = new Set<string>();
	/** The threads `reconcile` deleted this session, as they stood: what `restore` brings back. */
	const deletedHere = new Map<string, CommentThread>();
	/** The anchors of the document last synced, which a re-list derives against. */
	let live: readonly AnchorContext[] | undefined;
	const listeners = new Set<(threads: readonly CommentThread[]) => void>();

	const publish = () => {
		index = index.map((t) => ({ ...t, anchored: anchored.get(t.id) ?? false }));
		for (const fn of listeners) fn(index);
	};
	const at = (id: string) => index.findIndex((t) => t.id === id);
	const held = (id: string): CommentThread => {
		const t = index[at(id)];
		if (!t) throw new Error(`no comment thread ${id}`);
		return t;
	};
	const patch = (id: string, change: Partial<CommentThread>): void => {
		const i = at(id);
		if (i >= 0) index = index.with(i, { ...index[i], ...change });
	};
	const message = (body: string): CommentMessage => ({
		id: crypto.randomUUID(),
		author,
		body,
		createdAt: now()
	});

	let listing = 0;
	let loaded = false;
	async function load(): Promise<void> {
		const ticket = ++listing;
		try {
			const listed = await store.list();
			if (ticket !== listing) return;
			index = listed;
			loaded = true;
			for (const id of [...anchored.keys()]) if (at(id) < 0) anchored.delete(id);
			for (const id of [...drift]) if (at(id) < 0) drift.delete(id);
			const ids = new Set(live?.map((c) => c.id));
			for (const t of index) if (!anchored.has(t.id) && live) anchored.set(t.id, ids.has(t.id));
			publish();
		} catch (e) {
			report(e);
		}
	}
	const ready = load();
	const unsubscribe = store.subscribe?.(() => void load());

	function derive(contexts: readonly AnchorContext[]): void {
		live = contexts;
		const byId = new Map(contexts.map((c) => [c.id, c]));
		drift.clear();
		for (const t of index) {
			const here = byId.get(t.id);
			anchored.set(t.id, here !== undefined);
			if (here && here.quote !== '' && here.quote !== t.selector.quote) drift.add(t.id);
		}
		publish();
	}

	/** Store `context` as the thread's selector where it differs. A point never overwrites a
	 *  quote: the words are what a re-anchor works from. */
	function keep(context: AnchorContext): Promise<void> | undefined {
		const t = index[at(context.id)];
		if (!t || (context.quote === '' && t.selector.quote !== '')) return undefined;
		const selector = selectorOf(context);
		if (sameSelector(selector, t.selector)) return undefined;
		patch(t.id, { selector });
		return store.setSelector(t.id, selector);
	}

	const comments: Comments = {
		get threads() {
			return index;
		},
		get drifted() {
			return [...drift];
		},
		ready,
		subscribe(fn) {
			listeners.add(fn);
			return () => void listeners.delete(fn);
		},
		thread(id) {
			return index[at(id)];
		},

		async create(context, body) {
			if (at(context.id) >= 0) throw new Error(`comment thread ${context.id} already exists`);
			const first = message(body);
			const thread: CommentThread = {
				id: context.id,
				status: 'open',
				anchored: true,
				selector: selectorOf(context),
				messages: [first],
				createdAt: first.createdAt,
				updatedAt: first.createdAt
			};
			index = [...index, thread];
			anchored.set(thread.id, true);
			publish();
			try {
				await store.create(thread);
			} catch (e) {
				index = index.filter((t) => t.id !== thread.id);
				anchored.delete(thread.id);
				publish();
				throw e;
			}
			return thread;
		},
		async reply(id, body) {
			const next = message(body);
			const prior = held(id);
			patch(id, { messages: [...prior.messages, next], updatedAt: next.createdAt });
			publish();
			try {
				await store.reply(id, next);
			} catch (e) {
				patch(id, { messages: prior.messages, updatedAt: prior.updatedAt });
				publish();
				throw e;
			}
		},
		async setStatus(id, status) {
			const prior = held(id);
			if (prior.status === status) return;
			patch(id, { status, updatedAt: now() });
			publish();
			try {
				await store.setStatus(id, status);
			} catch (e) {
				patch(id, { status: prior.status, updatedAt: prior.updatedAt });
				publish();
				throw e;
			}
		},
		async remove(id) {
			const i = at(id);
			if (i < 0) return;
			const prior = index[i];
			const wasAnchored = anchored.get(id);
			const wasDrifted = drift.has(id);
			index = index.toSpliced(i, 1);
			anchored.delete(id);
			drift.delete(id);
			publish();
			try {
				await store.remove(id);
			} catch (e) {
				if (at(id) < 0) index = index.toSpliced(Math.min(i, index.length), 0, prior);
				if (wasAnchored !== undefined) anchored.set(id, wasAnchored);
				if (wasDrifted) drift.add(id);
				publish();
				throw e;
			}
		},
		async reanchor(id, context) {
			const prior = held(id);
			anchored.set(id, true);
			drift.delete(id);
			const write = keep({ ...context, id });
			publish();
			try {
				await write;
			} catch (e) {
				patch(id, { selector: prior.selector });
				publish();
				throw e;
			}
		},

		sync(doc) {
			derive(doc.anchorContexts());
		},
		async reconcile(doc, dropped, deltas) {
			// Before the first list lands no drop can be told a stray, so every one is offered back.
			const ours = loaded ? dropped.filter((c) => at(c.id) >= 0) : dropped;
			const placed = ours.length
				? doc.reattach([...ours], deltas)
				: { reattached: [] as AnchorContext[], orphaned: [] as AnchorContext[] };
			if (!loaded) await ready;
			const deleted = placed.orphaned.map((c) => c.id).filter((id) => at(id) >= 0);
			const writes: Promise<void>[] = [];
			for (const c of placed.reattached) {
				const write = keep(c);
				if (write) writes.push(write);
			}
			for (const id of deleted) {
				const gone = index[at(id)];
				if (gone) deletedHere.set(id, gone);
				index = index.filter((t) => t.id !== id);
				anchored.delete(id);
				drift.delete(id);
				writes.push(store.remove(id));
			}
			derive(doc.anchorContexts());
			await Promise.all(writes).catch(report);
			return { reattached: placed.reattached, deleted };
		},
		async reviseDocument(doc, writer, markdown, baseOpts) {
			const before = doc.anchorContexts();
			const revised = writer.reviseDocument(markdown, baseOpts);
			const out = await comments.reconcile(doc, droppedSelectors(revised.droppedAnchors, before));
			return { ...revised, ...out };
		},
		restore(doc) {
			if (!deletedHere.size) return [];
			const held = [...deletedHere.values()].filter((t) => at(t.id) < 0);
			const live = new Set(doc.anchorContexts().map((c) => c.id));
			const selectors = held
				.filter((t) => !live.has(t.id))
				.map((t) => ({ ...t.selector, id: t.id }));
			if (!selectors.length) return [];
			const { reattached } = doc.reattach(selectors);
			for (const c of reattached) {
				const thread = { ...deletedHere.get(c.id)!, selector: selectorOf(c) };
				deletedHere.delete(c.id);
				index = [...index, thread];
				store.create(thread).catch(report);
			}
			if (reattached.length) derive(doc.anchorContexts());
			return reattached;
		},
		async refresh(doc) {
			const contexts = doc.anchorContexts();
			const writes = contexts.map(keep).filter((w) => w !== undefined);
			derive(contexts);
			await Promise.all(writes);
		},
		async recover(doc) {
			const selectors = index.map((t) => ({ ...t.selector, id: t.id }));
			const placed = selectors.length ? doc.reattach(selectors).reattached : [];
			const writes = placed.map(keep).filter((w) => w !== undefined);
			derive(doc.anchorContexts());
			await Promise.all(writes).catch(report);
			return placed;
		},
		destroy() {
			unsubscribe?.();
			listeners.clear();
		}
	};
	return comments;
}
