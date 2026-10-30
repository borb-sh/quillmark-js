// The controller a host or the editor holds: the synchronous index the UI reads, the
// verbs that write through the store, and the one flow every markdown write runs
// (COMMENTS.md §"The reconcile flow"). Nothing here parses a body, knows Svelte, calls
// `overwrite`, or touches an anchor the document holds without a receipt saying it was
// dropped.
import type {
	AnchorContext,
	Delta,
	Document,
	DocumentRevised,
	DocumentWriter,
	Reattached
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

/**
 * Any revise receipt, as the flow reads it: `droppedAnchors` from `revise`, `reviseContent`,
 * `writer.reviseBody`, `writer.reviseField`, `writer.reviseDocument` or a collab
 * `RemoteChange.content[i]`; `from` where the receipt is a `DocumentRevised`; `deltas`, the
 * write's text delta keyed by the path it revised, where the rung has one, which keeps a
 * re-attachment to text the write inserted.
 */
export interface ReviseReceipt {
	droppedAnchors: readonly { id: string }[];
	from?: readonly (number | null)[];
	deltas?: Record<string, Delta>;
}

export interface CreateCommentsOpts {
	store: CommentStore;
	/** Who signs every message this client writes. */
	author: Author;
	/** A store write that failed after the index showed it, and a re-list that failed. */
	onError?: (e: unknown) => void;
	/** The clock, for a test that pins time. */
	now?: () => string;
}

export interface Comments {
	/** The index: every thread, `anchored` derived against the last document it was synced to. */
	readonly threads: readonly CommentThread[];
	/** Ids whose live quote differs from the stored one, since the last refresh. */
	readonly drifted: readonly string[];
	/** Resolves once the store's first list has landed in the index. */
	readonly ready: Promise<void>;
	/** Called with the index after every change to it. */
	subscribe(fn: (threads: readonly CommentThread[]) => void): () => void;
	thread(id: string): CommentThread | undefined;

	/** Mint a thread over an anchor the caller has just placed; `context` from `doc.anchorContext(id)`.
	 *  Rejects, with the index reverted, when the store refuses: the caller removes the anchor. */
	create(context: AnchorContext, body: string): Promise<CommentThread>;
	reply(id: string, body: string): Promise<void>;
	setStatus(id: string, status: ThreadStatus): Promise<void>;
	/** Deletes the thread. The caller removes the anchor; the editor's verb does both. */
	remove(id: string): Promise<void>;
	/** Mark a thread anchored or not, and store `selector` when given: what a re-anchor
	 *  over a fresh selection calls, with `doc.anchorContext(id)`. */
	setAnchored(id: string, anchored: boolean, selector?: AnchorSelector): Promise<void>;

	/** Re-derive `anchored` and `drifted` against the live document, with no write: after a
	 *  structure op, on open, after any path that produced no receipt. */
	sync(doc: Document): void;
	/** The reconcile flow. `before` is `doc.anchorContexts()` read before the write. */
	reconcile(
		doc: Document,
		before: readonly AnchorContext[],
		receipt: ReviseReceipt
	): Promise<Reattached>;
	/** `before = doc.anchorContexts()`; the write; `reconcile`. The common case in one call. */
	reviseDocument(
		doc: Document,
		writer: DocumentWriter,
		markdown: string
	): Promise<DocumentRevised & Reattached>;
	/** Store the live selector of every anchored thread whose context changed, for a save.
	 *  Writes only those; a collapsed anchor keeps its last non-empty quote. */
	refresh(doc: Document): Promise<void>;
	/** Recovery for a host that opened from markdown: `doc.reattach` over every stored selector. */
	recover(doc: Document): Promise<Reattached>;
	/** Drop the store subscription. */
	destroy(): void;
}

const CARD_PATH = /^cards\.([^.[]+)\[(\d+)\](.*)$/;

/**
 * A selector's path with its card index remapped through a `DocumentRevised.from`: the
 * alignment names, for each card of the revised document, the stored card it revises, so
 * the stored index `i` is found at the position holding it. `undefined` for a card no
 * entry names, which the write removed.
 */
export function remapPath(path: string, from: readonly (number | null)[]): string | undefined {
	const m = CARD_PATH.exec(path);
	if (!m) return path;
	const at = from.indexOf(Number(m[2]));
	return at < 0 ? undefined : `cards.${m[1]}[${at}]${m[3]}`;
}

export function createComments(opts: CreateCommentsOpts): Comments {
	const { store, author } = opts;
	const now = opts.now ?? (() => new Date().toISOString());
	const report = (e: unknown) => opts.onError?.(e);

	let index: CommentThread[] = [];
	/** `anchored` and drift as last derived, overlaid on every re-list. */
	const anchored = new Map<string, boolean>();
	const drift = new Set<string>();
	const listeners = new Set<(threads: readonly CommentThread[]) => void>();

	const publish = () => {
		index = index.map((t) => ({ ...t, anchored: anchored.get(t.id) ?? t.anchored }));
		for (const fn of listeners) fn(index);
	};
	const at = (id: string) => index.findIndex((t) => t.id === id);
	const held = (id: string): CommentThread => {
		const t = index[at(id)];
		if (!t) throw new Error(`no comment thread ${id}`);
		return t;
	};
	const patch = (id: string, change: Partial<CommentThread>): CommentThread | undefined => {
		const i = at(id);
		if (i < 0) return undefined;
		const prior = index[i];
		index = [...index.slice(0, i), { ...prior, ...change }, ...index.slice(i + 1)];
		return prior;
	};

	async function load(): Promise<void> {
		try {
			const listed = await store.list();
			index = listed.map((t) => ({ ...t, anchored: anchored.get(t.id) ?? t.anchored }));
			for (const id of [...anchored.keys()]) if (at(id) < 0) anchored.delete(id);
			for (const id of [...drift]) if (at(id) < 0) drift.delete(id);
			publish();
		} catch (e) {
			report(e);
		}
	}
	const ready = load();
	const unsubscribe = store.subscribe?.(() => void load());

	/** Derive `anchored` and drift against `live`, the document's anchors as they stand. */
	function derive(live: readonly AnchorContext[]): void {
		const byId = new Map(live.map((c) => [c.id, c]));
		drift.clear();
		for (const t of index) {
			const here = byId.get(t.id);
			anchored.set(t.id, here !== undefined);
			if (here && here.quote !== '' && here.quote !== t.selector.quote) drift.add(t.id);
		}
		publish();
	}

	/** Land a `Reattached` receipt in the index and the store: each reattached id anchored
	 *  with its refreshed selector, each orphaned id unanchored with the selector it had. */
	async function land(out: Reattached): Promise<void> {
		const writes: Promise<void>[] = [];
		for (const c of out.reattached) {
			if (at(c.id) < 0) continue;
			anchored.set(c.id, true);
			const selector = selectorOf(c);
			if (!sameSelector(selector, held(c.id).selector)) {
				patch(c.id, { selector });
				writes.push(store.setSelector(c.id, selector));
			}
		}
		for (const c of out.orphaned) if (at(c.id) >= 0) anchored.set(c.id, false);
		await Promise.all(writes).catch(report);
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
			const stamp = now();
			const message: CommentMessage = { id: newThreadId(), author, body, createdAt: stamp };
			const thread: CommentThread = {
				id: context.id,
				status: 'open',
				anchored: true,
				selector: selectorOf(context),
				messages: [message],
				createdAt: stamp,
				updatedAt: stamp
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
			const stamp = now();
			const message: CommentMessage = { id: newThreadId(), author, body, createdAt: stamp };
			const prior = held(id);
			patch(id, { messages: [...prior.messages, message], updatedAt: stamp });
			publish();
			try {
				await store.reply(id, message);
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
			index = index.filter((t) => t.id !== id);
			anchored.delete(id);
			drift.delete(id);
			publish();
			try {
				await store.remove(id);
			} catch (e) {
				index = [...index.slice(0, i), prior, ...index.slice(i)];
				publish();
				throw e;
			}
		},
		async setAnchored(id, isAnchored, selector) {
			const prior = held(id);
			anchored.set(id, isAnchored);
			if (isAnchored) drift.delete(id);
			if (selector && !sameSelector(selector, prior.selector)) {
				patch(id, { selector });
				publish();
				try {
					await store.setSelector(id, selector);
				} catch (e) {
					patch(id, { selector: prior.selector });
					publish();
					throw e;
				}
			} else publish();
		},

		sync(doc) {
			derive(doc.anchorContexts());
		},
		async reconcile(doc, before, receipt) {
			const was = new Map(before.map((c) => [c.id, c]));
			const selectors: AnchorContext[] = [];
			let out: Reattached = { reattached: [], orphaned: [] };
			for (const { id } of receipt.droppedAnchors) {
				const t = comments.thread(id);
				if (!t) continue;
				const selector: AnchorSelector = was.get(id) ?? t.selector;
				const path = receipt.from ? remapPath(selector.path, receipt.from) : selector.path;
				if (path === undefined) out.orphaned.push({ ...selector, id });
				else selectors.push({ ...selector, id, path });
			}
			if (selectors.length) {
				const placed = doc.reattach(selectors, receipt.deltas);
				out = { reattached: placed.reattached, orphaned: [...out.orphaned, ...placed.orphaned] };
			}
			await land(out);
			derive(doc.anchorContexts());
			return out;
		},
		async reviseDocument(doc, writer, markdown) {
			const before = doc.anchorContexts();
			const revised = writer.reviseDocument(markdown);
			const out = await comments.reconcile(doc, before, revised);
			return { ...revised, ...out };
		},
		async refresh(doc) {
			const live = new Map(doc.anchorContexts().map((c) => [c.id, c]));
			const writes: Promise<void>[] = [];
			for (const t of index) {
				const here = live.get(t.id);
				if (!here || here.quote === '') continue;
				const selector = selectorOf(here);
				if (sameSelector(selector, t.selector)) continue;
				patch(t.id, { selector });
				writes.push(store.setSelector(t.id, selector));
			}
			derive([...live.values()]);
			await Promise.all(writes);
		},
		async recover(doc) {
			const selectors = index.map((t) => ({ ...t.selector, id: t.id }));
			const out = selectors.length ? doc.reattach(selectors) : { reattached: [], orphaned: [] };
			await land(out);
			derive(doc.anchorContexts());
			return out;
		},
		destroy() {
			unsubscribe?.();
			listeners.clear();
		}
	};
	return comments;
}
