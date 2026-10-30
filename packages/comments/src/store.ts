// The in-memory store: the one a host with no database runs on (the playground, a test),
// and the shape a persisting store copies, its `export` envelope being what a host writes.
import type {
	AnchorSelector,
	CommentMessage,
	CommentStore,
	CommentThread,
	CommentThreadsExport,
	ThreadStatus
} from './model.js';

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryCommentStore implements CommentStore {
	private readonly threads = new Map<string, CommentThread>();
	private readonly listeners = new Set<() => void>();

	constructor(threads: readonly CommentThread[] = []) {
		for (const t of threads) this.threads.set(t.id, clone(t));
	}

	async list(): Promise<CommentThread[]> {
		return [...this.threads.values()].map(clone);
	}

	async create(thread: CommentThread): Promise<void> {
		if (this.threads.has(thread.id)) throw new Error(`comment thread ${thread.id} already exists`);
		this.threads.set(thread.id, clone(thread));
		this.changed();
	}

	async reply(id: string, message: CommentMessage): Promise<void> {
		const t = this.held(id);
		t.messages.push(clone(message));
		t.updatedAt = message.createdAt;
		this.changed();
	}

	async setStatus(id: string, status: ThreadStatus): Promise<void> {
		const t = this.held(id);
		t.status = status;
		t.updatedAt = new Date().toISOString();
		this.changed();
	}

	async setSelector(id: string, selector: AnchorSelector): Promise<void> {
		this.held(id).selector = clone(selector);
		this.changed();
	}

	async remove(id: string): Promise<void> {
		if (this.threads.delete(id)) this.changed();
	}

	subscribe(onChange: () => void): () => void {
		this.listeners.add(onChange);
		return () => void this.listeners.delete(onChange);
	}

	/** Every thread, as the envelope a host persists. */
	export(): CommentThreadsExport {
		return { version: 1, threads: [...this.threads.values()].map(clone) };
	}

	/** A store over an exported envelope. Throws on anything but a version 1 envelope. */
	static import(data: unknown): MemoryCommentStore {
		if (
			typeof data !== 'object' ||
			data === null ||
			(data as { version?: unknown }).version !== 1 ||
			!Array.isArray((data as { threads?: unknown }).threads)
		)
			throw new Error('comment threads: not a version 1 export');
		const threads = (data as CommentThreadsExport).threads;
		for (const t of threads)
			if (typeof t?.id !== 'string' || !Array.isArray(t.messages) || typeof t.selector !== 'object')
				throw new Error('comment threads: a thread is malformed');
		return new MemoryCommentStore(threads);
	}

	private held(id: string): CommentThread {
		const t = this.threads.get(id);
		if (!t) throw new Error(`no comment thread ${id}`);
		return t;
	}

	private changed(): void {
		for (const fn of this.listeners) fn();
	}
}
