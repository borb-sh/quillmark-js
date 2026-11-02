// The thread model and the seam a host implements over its own database (COMMENTS.md). A thread
// never enters the document: the document holds one anchor per thread, and the thread is a host
// record keyed by the anchor's id.
import type { AnchorContext } from '@quillmark/wasm';

/**
 * Where a thread's anchor was last read: the text-quote selector `doc.anchorContexts()` answers,
 * less the id, which is the thread's own. `cardId` lets `doc.reattach` follow a card wherever it
 * moved.
 */
export type AnchorSelector = Omit<AnchorContext, 'id'>;

export type ThreadStatus = 'open' | 'resolved';

export interface Author {
	id: string;
	name: string;
}

export interface CommentMessage {
	id: string;
	author: Author;
	/** Plain text, line breaks kept. */
	body: string;
	/** ISO 8601. */
	createdAt: string;
	editedAt?: string;
}

/** A thread. `id` is the anchor id in the document: client-minted, opaque, unique per document. */
export interface CommentThread {
	id: string;
	/** What people decided, independent of whether the document holds the anchor. */
	status: ThreadStatus;
	/**
	 * Whether this client's document holds the anchor now. Derived against the live document on
	 * every sync and write, never read from a store: another collab client's anchors are not in
	 * this client's document.
	 */
	anchored: boolean;
	/** The last known place and text. */
	selector: AnchorSelector;
	/** In creation order; the first message opens the thread. */
	messages: CommentMessage[];
	createdAt: string;
	updatedAt: string;
}

/**
 * The seam a host implements. Promise-based so a network store fits; the controller keeps a
 * synchronous index for the UI. A store may persist `anchored` as handed; the controller
 * re-derives it.
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

/** The interchange envelope a store exports and imports. */
export interface CommentThreadsExport {
	version: 1;
	threads: CommentThread[];
}

/**
 * A thread id, which is the anchor id minted over the selection: `c-` and a UUID v4. The prefix
 * namespaces the mint, as COMMENTS.md asks, so a comment id never meets an id another minter
 * placed. Nothing sorts or parses one; a host may supply its own.
 */
export function newThreadId(): string {
	return `c-${crypto.randomUUID()}`;
}

/** The selector half of a context: what the store keeps. */
export function selectorOf(context: AnchorContext): AnchorSelector {
	const { path, cardId, quote, prefix, suffix } = context;
	return cardId === undefined
		? { path, quote, prefix, suffix }
		: { path, cardId, quote, prefix, suffix };
}

export function sameSelector(a: AnchorSelector, b: AnchorSelector): boolean {
	return (
		a.path === b.path &&
		a.cardId === b.cardId &&
		a.quote === b.quote &&
		a.prefix === b.prefix &&
		a.suffix === b.suffix
	);
}
