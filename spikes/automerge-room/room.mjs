/**
 * A collab room with the WASM `Document` as the CRDT: the row is the
 * document's Automerge bytes, a revision is its heads, an append is the
 * changes since a client's last append, and a slow writer lands its edit at
 * the heads it read. No Y state, projection, binding or conflict path.
 */

/** The host's store: one row and the increments past it. */
export class Store {
	constructor(row) {
		this.row = row;
		this.log = [];
		this.listeners = new Set();
	}

	append(increment) {
		if (increment.length === 0) return this.log.length;
		this.log.push(increment);
		for (const listener of this.listeners) listener();
		return this.log.length;
	}

	since(cursor) {
		return { entries: this.log.slice(cursor), cursor: this.log.length };
	}

	/** Folds the log into the row, as a session end or a compaction does. */
	compact(Document) {
		const doc = Document.fromBytes(this.row);
		for (const entry of this.log) doc.merge(entry);
		this.row = doc.save();
		this.log = [];
		doc.free();
	}

	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

/** One client: its own `Document`, read from the row and every entry. */
export class Client {
	constructor(Document, store, actor) {
		this.store = store;
		this.actor = actor;
		this.doc = Document.fromBytes(store.row);
		const { entries, cursor } = store.since(0);
		for (const entry of entries) this.doc.merge(entry);
		this.cursor = cursor;
		this.sent = this.doc.heads();
	}

	/** Runs `edit` on the document and appends what it changed. */
	edit(edit) {
		edit(this.doc, this.actor);
		this.push();
	}

	push() {
		const increment = this.doc.saveSince(this.sent);
		this.sent = this.doc.heads();
		this.store.append(increment);
	}

	/** Takes every entry past this client's cursor, its own among them: a
	 * merge of changes the document holds changes nothing. */
	pull() {
		const { entries, cursor } = this.store.since(this.cursor);
		for (const entry of entries) this.doc.merge(entry);
		this.cursor = cursor;
		this.sent = this.doc.heads();
		return entries.length;
	}

	/** What a slow writer reads: the value and the hash it lands against. */
	read(addr = {}) {
		return { markdown: this.doc.toMarkdown(addr), base: this.doc.hash(addr) };
	}
}

/** Two documents brought to one state over the sync protocol, as two peers
 * on a socket are, answering how many messages crossed. */
export function sync(SyncState, a, b) {
	const [toB, toA] = [new SyncState(), new SyncState()];
	let crossed = 0;
	for (let round = 0; round < 16; round++) {
		const forB = a.generateSyncMessage(toB);
		if (forB) {
			b.receiveSyncMessage(toA, forB);
			crossed++;
		}
		const forA = b.generateSyncMessage(toA);
		if (forA) {
			a.receiveSyncMessage(toB, forA);
			crossed++;
		}
		if (!forA && !forB) return crossed;
	}
	throw new Error('the sync did not settle');
}
