// A session: one stretch of live editing over a saved Document, carried by a log of Y updates.
//
// The saved Document is the record. A session is identified by an epoch and opened with its
// seed, the Y form of the save it opened from, in one write: every client that joins applies that
// seed and never writes one of its own, so two clients can never start one epoch from two saves.
// Every Y update a client makes is appended, and every entry another client appends is applied.
// Each client saves what it holds, with the Y snapshot it reflects, and the store keeps only a
// save that moves past the one held: a snapshot counts deletions, which a state vector does not.
// A session ends at a join that finds nobody has appended or been present within the lease and
// the save reflecting every entry: the next session opens from the save.
import * as Y from 'yjs';
import { init, type Addr, type Document, type Quill } from '@quillmark/wasm';
import {
	bindDocument,
	seedDocument,
	Diverged,
	type CardOp,
	type DocumentBinding,
	type RemoteChange
} from './document.js';

/** A saved Document, with the session and the Y state it reflects. */
export interface Saved {
	epoch: string;
	/** `doc.toStored()`. */
	stored: string;
	/** `Y.encodeSnapshot` of the state the save reflects. */
	version: Uint8Array;
}

/** An open session: its epoch, the update every client starts it from, and the quill
 *  (`name@version`) it was opened under, which every client joining it runs. */
export interface Opened {
	epoch: string;
	seed: Uint8Array;
	quill?: string;
}

/** How an append went: kept, refused because the epoch is no longer open, refused because the
 *  log moved past `after`, or a repeat of an entry already kept under its `key`. */
export type Appended = 'appended' | 'closed' | 'moved' | 'duplicate';

export interface AppendOpts {
	/** Who the entry is by. */
	writer?: string;
	/** Append only when the epoch holds exactly this many entries, in the same transaction. */
	after?: number;
	/** Append only once under this key, for a writer that may retry. */
	key?: string;
}

/** Where a room keeps its saved Document and its session's log. */
export interface SessionLog {
	/** The open session; `undefined` when none is. */
	current(): Promise<Opened | undefined>;
	/** Open a session from `seed` under `quill` unless one is open already; the session open
	 *  after. */
	open(seed: Uint8Array, quill?: string): Promise<Opened>;
	/** Close `epoch` and drop its entries, when it is still the open one. */
	end(epoch: string): Promise<void>;
	/** Add an entry to `epoch`'s log. Entries are numbered from 1 in the order they are kept,
	 *  with no gaps. */
	append(epoch: string, update: Uint8Array, opts?: AppendOpts): Promise<Appended>;
	/** Mark a client present in `epoch`, so the session is not idle while it is open. */
	touch(epoch: string): Promise<void>;
	/**
	 * The entries of `epoch` after `cursor`, a value an earlier call returned, how many entries
	 * the epoch holds, and when a client last appended or touched. `undefined` when `epoch` is no
	 * longer open.
	 */
	since(
		epoch: string,
		cursor?: unknown
	): Promise<
		{ updates: Uint8Array[]; cursor: unknown; count: number; touched: number } | undefined
	>;
	/**
	 * The updates that make up `epoch`'s first `count` entries. `undefined` when `epoch` is no
	 * longer open, or when compaction merged an entry past `count` with one before it.
	 */
	upTo(epoch: string, count: number): Promise<Uint8Array[] | undefined>;
	/** Call `onChange` when the log may hold new entries. A hint: `since` is what reads them. */
	subscribe(onChange: () => void): () => void;
	load(): Promise<Saved | undefined>;
	/**
	 * Keep `saved` when the store holds none, or when `saved` names the open epoch and moves past
	 * a held save of that epoch ({@link covers}, one way and not the other). Returns whether it
	 * was kept. A store that saves the log's projection itself, on a server, leaves it out, and
	 * no client saves.
	 */
	save?(saved: Saved): Promise<boolean>;
}

export interface JoinSessionOpts {
	log: SessionLog;
	/** The quill the room's Document is under. A Document under another quill is refused. */
	quill: Quill;
	/** The Document a room starts from when it holds no saved one. Read once, and freed. */
	initial(): Document;
	/** Who this client's edits are by, passed to every `append` they make. */
	writer?: string;
	/** How long a session stays open with nobody appending or present, in ms. */
	lease?: number;
	/** How long after the last change a client saves, in ms. */
	saveDelay?: number;
	/** How long to wait before each retry of an append that failed, in ms. An append that
	 *  fails past the last ends the session. */
	retry?: readonly number[];
	/** What another client's edit moved, after `joinSession` has returned. */
	onRemote?(change: RemoteChange): void;
	onError?(error: unknown): void;
	/**
	 * The session this client joined is over, and nothing it does reaches anyone: rejoin. `lost`
	 * is whether an edit made here never reached the log, an edit the rejoin does not hold.
	 */
	onEnded?(lost: boolean): void;
}

export interface Session {
	readonly epoch: string;
	/** The Document the session edits. The host frees it, after `leave`. */
	readonly doc: Document;
	readonly ydoc: Y.Doc;
	readonly binding: DocumentBinding;
	/** `binding.push`: write a local edit to the session. */
	push(op?: CardOp | readonly CardOp[]): Addr[];
	/** `Y.encodeSnapshot` of the state the session holds now, a base for `writeFrom`. */
	snapshot(): Uint8Array;
	/**
	 * Apply an update made for this session from an older state, `writeFrom`'s, as an edit by
	 * `writer`: it is appended under that name, and the Document hears it through `onRemote`.
	 * Run the `writeFrom` and the `apply` in one task, so the conflicts it reported are current.
	 */
	apply(update: Uint8Array, writer: string): void;
	/** Save now rather than after the delay. */
	save(): Promise<boolean>;
	/** Save, and stop taking entries. */
	leave(): Promise<void>;
}

/** The Document's quill, or the open session's, and `quill` disagree: the room is under the
 *  quill this names. */
export class QuillMismatch extends Error {
	constructor(readonly quillRef: string) {
		super(`the room's document is under ${quillRef}`);
	}
}

const LOG = Symbol('session-log');

/** Whether snapshot `a` holds everything `b` does: every insert, and every deletion. */
export function covers(a: Uint8Array, b: Uint8Array): boolean {
	const x = Y.decodeSnapshot(a);
	const y = Y.decodeSnapshot(b);
	for (const [client, clock] of y.sv) if ((x.sv.get(client) ?? 0) < clock) return false;
	for (const [client, items] of y.ds.clients) {
		const held = [...(x.ds.clients.get(client) ?? [])].sort((p, q) => p.clock - q.clock);
		for (const { clock, len } of items) {
			let at = clock;
			for (const r of held) {
				if (r.clock > at) break;
				if (r.clock + r.len > at) at = r.clock + r.len;
				if (at >= clock + len) break;
			}
			if (at < clock + len) return false;
		}
	}
	return true;
}

/**
 * Whether `opened` is over for a writer: closed, or idle past `lease` with `saved` holding every
 * entry, so the next session can open from the save.
 */
export async function settled(
	log: SessionLog,
	opened: Opened,
	saved: Saved,
	lease = LEASE
): Promise<boolean> {
	const read = await log.since(opened.epoch);
	if (!read) return true;
	if (Date.now() - read.touched <= lease) return false;
	return (
		read.updates.length === 0 ||
		(saved.epoch === opened.epoch &&
			covers(saved.version, snapshotOf([opened.seed, ...read.updates])))
	);
}

const LEASE = 5 * 60_000;
const RETRY = [500, 2000, 8000];

function snapshotOf(updates: Uint8Array[]): Uint8Array {
	const ydoc = new Y.Doc();
	Y.applyUpdate(ydoc, Y.mergeUpdates(updates));
	const out = Y.encodeSnapshot(Y.snapshot(ydoc));
	ydoc.destroy();
	return out;
}

const sameQuill = (ref: string, quill: Quill) => ref.split('@')[0] === quill.metadata.name;
const quillOf = (quill: Quill) => `${quill.metadata.name}@${quill.metadata.version}`;

export async function joinSession(opts: JoinSessionOpts): Promise<Session> {
	const { log, quill } = opts;
	const lease = opts.lease ?? LEASE;
	const { Document } = await init();

	let saved = await log.load();
	if (!saved) {
		const initial = opts.initial();
		const first: Saved = {
			epoch: '',
			stored: initial.toStored(),
			version: Y.encodeSnapshot(Y.emptySnapshot)
		};
		initial.free();
		await log.save?.(first);
		saved = (await log.load()) ?? first;
	}

	let opened = await log.current();
	if (opened && (await settled(log, opened, saved, lease))) {
		if (await log.since(opened.epoch)) await log.end(opened.epoch);
		saved = (await log.load()) ?? saved;
		opened = undefined;
	}
	const probe = Document.fromStored(saved.stored);
	const ref = probe.quillRef;
	if (!sameQuill(ref, quill)) {
		probe.free();
		throw new QuillMismatch(ref);
	}
	if (!opened) opened = await log.open(seedDocument(probe, quill), quillOf(quill));
	probe.free();
	if (opened.quill !== undefined && opened.quill !== quillOf(quill))
		throw new QuillMismatch(opened.quill);
	const epoch = opened.epoch;
	const read = await log.since(epoch);
	if (!read) throw new Error('the session closed while joining');

	// History is kept, so a writer can work from an older revision (`writeFrom`).
	const ydoc = new Y.Doc({ gc: false });
	Y.applyUpdate(ydoc, Y.mergeUpdates([opened.seed, ...read.updates]), LOG);
	let cursor = read.cursor;
	const doc = Document.fromStored(saved.stored);

	let ended = false;
	let lost = false;
	let ready = false;
	const report = (e: unknown) => opts.onError?.(e);
	const end = () => {
		if (ended) return;
		ended = true;
		stop();
		opts.onEnded?.(lost);
	};

	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = () => {
		clearTimeout(timer);
		timer = setTimeout(() => void save(), opts.saveDelay ?? 1000);
	};
	async function save(): Promise<boolean> {
		clearTimeout(timer);
		timer = undefined;
		if (ended || !log.save || binding?.holding) return false;
		try {
			return await log.save({
				epoch,
				stored: doc.toStored(),
				version: Y.encodeSnapshot(Y.snapshot(ydoc))
			});
		} catch (e) {
			report(e);
			return false;
		}
	}

	// An update this client made reaches the log, or the session ends: every later update builds
	// on it, so one missing would hold all of them back from every other client. Updates made
	// while an append is out go together in the next, and a failed append is tried again: an
	// update applied twice changes nothing, so a retry of one that landed unseen is harmless.
	const writers = new WeakMap<object, string>();
	const queue: { writer?: string; updates: Uint8Array[] }[] = [];
	let flushing: Promise<void> | undefined;
	const delays = opts.retry ?? RETRY;
	const onUpdate = (update: Uint8Array, origin: unknown) => {
		schedule();
		if (origin === LOG) return;
		const writer =
			(origin !== null && typeof origin === 'object' && writers.get(origin)) || opts.writer;
		const last = queue.at(-1);
		if (last && last.writer === writer) last.updates.push(update);
		else queue.push({ writer, updates: [update] });
		flushing ??= flush().finally(() => (flushing = undefined));
	};
	async function flush(): Promise<void> {
		for (let group = queue.shift(); group; group = queue.shift()) {
			if (ended) return void (lost = true);
			const update = group.updates.length === 1 ? group.updates[0] : Y.mergeUpdates(group.updates);
			let appended: Appended | undefined;
			for (let attempt = 0; appended === undefined; attempt++) {
				try {
					appended = await log.append(epoch, update, { writer: group.writer });
				} catch (e) {
					report(e);
					if (attempt >= delays.length || ended) break;
					await new Promise((r) => setTimeout(r, delays[attempt]));
				}
			}
			if (appended === 'appended' || appended === 'duplicate') continue;
			lost = true;
			end();
			return;
		}
	}
	ydoc.on('update', onUpdate);

	let binding: DocumentBinding | undefined;
	binding = bindDocument({
		doc,
		quill,
		ydoc,
		onRemote: (change) => {
			if (ready) opts.onRemote?.(change);
		},
		onError: (e) => {
			report(e);
			if (e instanceof Diverged) end();
		}
	});

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

	let beat: ReturnType<typeof setTimeout> | undefined;
	const heartbeat = () => {
		if (ended) return;
		log.touch(epoch).catch(report);
		beat = setTimeout(heartbeat, Math.max(lease / 3, 10));
	};
	heartbeat();
	await pull();
	ready = true;
	const bound = binding;

	function stop() {
		unsubscribe();
		clearTimeout(timer);
		clearTimeout(beat);
		ydoc.off('update', onUpdate);
		binding?.destroy();
		ydoc.destroy();
	}

	return {
		epoch,
		doc,
		ydoc,
		binding: bound,
		push: (op) => bound.push(op),
		snapshot: () => Y.encodeSnapshot(Y.snapshot(ydoc)),
		apply(update, writer) {
			const by = { writer };
			writers.set(by, writer);
			Y.applyUpdate(ydoc, update, by);
		},
		save,
		async leave() {
			while (flushing) await flushing;
			await save();
			if (!ended) {
				ended = true;
				stop();
			}
		}
	};
}
