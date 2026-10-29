// A session: one stretch of live editing over a saved Document, carried by a log of Y updates.
//
// The saved Document is the record. A session is identified by an epoch, and every entry of its
// log belongs to it. A client joins by reading the saved Document, then the open epoch's log:
// an empty log takes the seed of the saved Document first, which is the same bytes on every
// client, so two that race to seed land one copy. Every Y update a client makes is appended,
// every entry another client appends is applied, and each client saves what it holds, the save
// carrying the Y state vector it reflects so the store keeps only the furthest one. A session
// ends when its last entry is saved and nobody has appended within the idle lease: the next join
// opens a new epoch from the saved Document.
import * as Y from 'yjs';
import { init, type Addr, type Document, type Quill } from '@quillmark/wasm';
import { bindDocument, seedDocument, type CardOp, type DocumentBinding } from './document.js';
import type { RemoteChange } from './document.js';

/** A saved Document, with the session and the Y state it reflects. */
export interface Saved {
	epoch: string;
	/** `doc.toStored()`. */
	stored: string;
	/** `Y.encodeStateVector` of the state the save reflects. */
	version: Uint8Array;
}

/** Where a room keeps its saved Document and its session's log. */
export interface SessionLog {
	/** The open session's epoch, opening one when none is. */
	epoch(): Promise<string>;
	/** Close `epoch` and drop its entries, when it is still the open one. */
	end(epoch: string): Promise<void>;
	/** Add an entry to `epoch`'s log; false when `epoch` is no longer open. */
	append(epoch: string, update: Uint8Array): Promise<boolean>;
	/**
	 * The entries of `epoch` after `cursor`, a value an earlier call returned, and when the log
	 * last took an entry. `undefined` when `epoch` is no longer open.
	 */
	since(
		epoch: string,
		cursor?: unknown
	): Promise<{ updates: Uint8Array[]; cursor: unknown; touched: number } | undefined>;
	/** Call `onChange` when the log may hold new entries. A hint: `since` is what reads them. */
	subscribe(onChange: () => void): () => void;
	load(): Promise<Saved | undefined>;
	/**
	 * Keep `saved` unless the store holds a save of the same epoch that `saved` does not move
	 * past, or `saved` names an epoch that is not open. Returns whether it was kept.
	 */
	save(saved: Saved): Promise<boolean>;
}

export interface JoinSessionOpts {
	log: SessionLog;
	quill: Quill;
	/** The Document a room starts from when it holds no saved one. */
	initial(): Document;
	/** How long a session stays open with no new entry, in ms. */
	lease?: number;
	/** How long after the last change a client saves, in ms. */
	saveDelay?: number;
	onRemote?(change: RemoteChange): void;
	onError?(error: unknown): void;
	/** The session this client joined is over: its edits no longer reach anyone. Rejoin. */
	onEnded?(): void;
}

export interface Session {
	readonly epoch: string;
	readonly doc: Document;
	readonly ydoc: Y.Doc;
	readonly binding: DocumentBinding;
	/** `binding.push`: write a local edit to the session. */
	push(op?: CardOp): Addr[];
	/** Save now rather than after the delay. */
	save(): Promise<boolean>;
	/** Save, and stop taking entries. */
	leave(): Promise<void>;
}

const LOG = Symbol('session-log');

/** Whether state vector `a` holds everything `b` does. */
export function reflects(a: Uint8Array, b: Uint8Array): boolean {
	const held = Y.decodeStateVector(a);
	for (const [client, clock] of Y.decodeStateVector(b))
		if ((held.get(client) ?? 0) < clock) return false;
	return true;
}

export async function joinSession(opts: JoinSessionOpts): Promise<Session> {
	const { log, quill } = opts;
	const lease = opts.lease ?? 5 * 60_000;
	const { Document } = await init();

	// The saved Document is read before the log, so a log found empty was empty when the save
	// was read too, and the seed is of the Document every other seeder saw.
	let saved = await log.load();
	if (!saved) {
		const initial = opts.initial();
		await log.save({
			epoch: await log.epoch(),
			stored: initial.toStored(),
			version: Y.encodeStateVector(new Y.Doc())
		});
		initial.free();
		saved = (await log.load())!;
	}
	let epoch = await log.epoch();
	let read = await log.since(epoch);
	if (read && read.updates.length && Date.now() - read.touched > lease) {
		const merged = Y.mergeUpdates(read.updates);
		if (saved.epoch === epoch && reflects(saved.version, Y.encodeStateVectorFromUpdate(merged))) {
			await log.end(epoch);
			saved = (await log.load())!;
			epoch = await log.epoch();
			read = await log.since(epoch);
		}
	}
	if (!read) throw new Error('the session closed while joining');

	const ydoc = new Y.Doc();
	if (!read.updates.length) {
		const fresh = Document.fromStored(saved.stored);
		const seed = seedDocument(fresh, quill);
		fresh.free();
		await log.append(epoch, seed);
		read = (await log.since(epoch)) ?? read;
	}
	if (read.updates.length) Y.applyUpdate(ydoc, Y.mergeUpdates(read.updates), LOG);
	let cursor = read.cursor;

	const doc = Document.fromStored(saved.stored);
	const report = (e: unknown) => opts.onError?.(e);
	const binding = bindDocument({ doc, quill, ydoc, onRemote: opts.onRemote, onError: report });

	let ended = false;
	const end = () => {
		if (ended) return;
		ended = true;
		stop();
		opts.onEnded?.();
	};

	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = () => {
		clearTimeout(timer);
		timer = setTimeout(() => void save(), opts.saveDelay ?? 1000);
	};
	async function save(): Promise<boolean> {
		clearTimeout(timer);
		timer = undefined;
		if (ended) return false;
		try {
			return await log.save({
				epoch,
				stored: doc.toStored(),
				version: Y.encodeStateVector(ydoc)
			});
		} catch (e) {
			report(e);
			return false;
		}
	}

	let appending = Promise.resolve();
	const onUpdate = (update: Uint8Array, origin: unknown) => {
		schedule();
		if (origin === LOG) return;
		appending = appending.then(async () => {
			if (ended) return;
			try {
				if (!(await log.append(epoch, update))) end();
			} catch (e) {
				report(e);
			}
		});
	};
	ydoc.on('update', onUpdate);

	let pulling: Promise<void> | undefined;
	let again = false;
	const pull = (): Promise<void> => {
		if (pulling) {
			again = true;
			return pulling;
		}
		pulling = (async () => {
			do {
				again = false;
				try {
					const next = await log.since(epoch, cursor);
					if (!next) return end();
					cursor = next.cursor;
					if (next.updates.length && !ended) Y.applyUpdate(ydoc, Y.mergeUpdates(next.updates), LOG);
				} catch (e) {
					report(e);
				}
			} while (again && !ended);
		})().finally(() => (pulling = undefined));
		return pulling;
	};
	const unsubscribe = log.subscribe(() => void pull());
	await pull();

	function stop() {
		unsubscribe();
		clearTimeout(timer);
		ydoc.off('update', onUpdate);
		binding.destroy();
	}

	return {
		get epoch() {
			return epoch;
		},
		doc,
		ydoc,
		binding,
		push: (op) => binding.push(op),
		save,
		async leave() {
			await appending;
			await save();
			if (!ended) {
				ended = true;
				stop();
			}
		}
	};
}
