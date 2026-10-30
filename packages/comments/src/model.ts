// The thread model, and the seam a host implements over its own database (COMMENTS.md).
// A thread never enters the document: the document holds one `anchor{id}` mark per
// thread and nothing else, and the thread is a host record keyed by that id.
import type { AnchorContext } from '@quillmark/wasm';

/**
 * Where a thread's anchor was last read: a W3C TextQuoteSelector plus the `DocPath`
 * of the body or content field holding it. What the core answers off a live anchor
 * (`doc.anchorContexts()`), and what finds the anchor again once a write drops it
 * (`doc.reattach`).
 */
export interface AnchorSelector {
	/** The body or content field, as a `DocPath` string: `main.body`, `cards.memo[1].summary`. */
	path: string;
	/** The anchored text, an island slot kept as `U+FFFC`; empty for a point. Never refreshed to empty. */
	quote: string;
	/** Up to 32 scalar values before the start. */
	prefix: string;
	/** Up to 32 scalar values after the end. */
	suffix: string;
}

export type ThreadStatus = 'open' | 'resolved';

export interface Author {
	id: string;
	name: string;
}

export interface CommentMessage {
	id: string;
	author: Author;
	/** Plain text, line breaks kept. Rendering richer bodies is the host's choice. */
	body: string;
	/** ISO 8601. */
	createdAt: string;
	editedAt?: string;
}

/** A thread. `id` is the anchor id in the document: client-minted, opaque, unique per document. */
export interface CommentThread {
	id: string;
	/** What people decided. Independent of whether the document still holds the anchor. */
	status: ThreadStatus;
	/**
	 * What the document says: `false` is orphaned, no anchor with this id in the document
	 * right now. Derived per client against the live document on every open and write,
	 * never trusted from a store.
	 */
	anchored: boolean;
	/** The last known place and text, refreshed by every reconcile. */
	selector: AnchorSelector;
	/** In creation order; the first message opens the thread. */
	messages: CommentMessage[];
	createdAt: string;
	updatedAt: string;
}

/**
 * The seam a host implements. Promise-based so a network store fits; the controller
 * (`createComments`) keeps a synchronous in-memory index for the UI. `anchored` is not
 * the store's to keep: a store may persist whatever it is handed, and the controller
 * re-derives it from the live document.
 */
export interface CommentStore {
	list(): Promise<CommentThread[]>;
	create(thread: CommentThread): Promise<void>;
	reply(id: string, message: CommentMessage): Promise<void>;
	setStatus(id: string, status: ThreadStatus): Promise<void>;
	setSelector(id: string, selector: AnchorSelector): Promise<void>;
	remove(id: string): Promise<void>;
	/** Changes made elsewhere (another tab, a server push); the controller re-lists. */
	subscribe?(onChange: () => void): () => void;
}

/** The interchange envelope a store exports and imports: what a host writes beside its
 *  documents and what a fixture holds. Versioned for the reason `StoredDocument` is. */
export interface CommentThreadsExport {
	version: 1;
	threads: CommentThread[];
}

/** A thread id, which is the anchor id the editor mints over the selection: a UUID v4.
 *  Nothing sorts or parses one; a host may supply its own. */
export function newThreadId(): string {
	return crypto.randomUUID();
}

/** The selector half of a context: what the store keeps. */
export function selectorOf(context: AnchorContext): AnchorSelector {
	const { path, quote, prefix, suffix } = context;
	return { path, quote, prefix, suffix };
}

export function sameSelector(a: AnchorSelector, b: AnchorSelector): boolean {
	return a.path === b.path && a.quote === b.quote && a.prefix === b.prefix && a.suffix === b.suffix;
}
