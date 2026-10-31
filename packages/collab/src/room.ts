// A writer with no editor open, such as a server answering a model's tool call: it reads a room's
// document at a revision, and later writes an edit from that revision, straight through the log.
//
// A revision is `{ epoch, count, check }`: the session, how many of its log entries the state
// holds, and a digest of that state. It is short enough to hand a model, the state it names is
// rebuilt from the log, and a count the reader did not read fails its check. With no session
// open, or one nobody is in whose every entry is saved, the revision is `{ epoch: '', count: 0,
// check: '' }`, the saved Document itself.
//
// A read changes nothing. A write from the save ends a session nobody is in, rebuilds the log's
// history, makes the edit from its revision (`writeFrom`), opens a session from the save only once
// it has an edit to append, and appends it only if the log still holds the entries the conflict
// check saw, trying again when it moved. It then saves the Document the log projects to, so the
// save follows the write with no client open.
import * as Y from 'yjs';
import { init, type Document, type Quill } from '@quillmark/wasm';
import { seedDocument, type CardOp } from './document.js';
import { changesSince, projectDocument, writeFrom, type Change } from './fork.js';
import { QuillMismatch, settled, type Opened, type Saved, type SessionLog } from './session.js';

/** A point in a room's session: its epoch, how many log entries the state there holds, and a
 *  digest of that state. A writer hands back the revision it read, as it read it. */
export interface Revision {
	epoch: string;
	count: number;
	check: string;
}

export interface ReadLogOpts {
	log: SessionLog;
	/** The quill the room's Document is under. */
	quill: Quill;
	/** How long a session stays open with nobody appending or present, in ms: `joinSession`'s. */
	lease?: number;
}

const SAVE: Revision = { epoch: '', count: 0, check: '' };

export interface LogRead {
	revision: Revision;
	/** The Document at `revision`. The host frees it. */
	doc: Document;
	/** What changed since the `since` revision; absent when that revision can no longer be
	 *  rebuilt, as after its session ended. */
	changes?: Change[];
}

/** The room's Document as it stands, its revision, and what changed since `since`. */
export async function readLog(opts: ReadLogOpts & { since?: Revision }): Promise<LogRead> {
	const { log, quill, since } = opts;
	const room = await open(opts);
	try {
		const opened = await log.current();
		if (!opened || (await settled(log, opened, room.saved, opts.lease))) {
			const doc = room.template.clone();
			const changes = since && validRevision(since) && since.epoch === '' ? [] : undefined;
			return { revision: SAVE, doc, ...(changes ? { changes } : {}) };
		}
		const read = await history(log, opened);
		if (!read) return readLog(opts);
		try {
			const doc = projectDocument(read.ydoc, quill, room.template);
			const revision = {
				epoch: opened.epoch,
				count: read.count,
				check: checkOf(Y.encodeSnapshot(Y.snapshot(read.ydoc)))
			};
			let changes: Change[] | undefined;
			if (since && validRevision(since) && since.epoch === opened.epoch) {
				const base = await snapshotAt(log, opened, since.count, read.count);
				if (base && checkOf(base) === since.check)
					changes = changesSince({ history: read.ydoc, base, quill, doc: room.template });
			}
			return { revision, doc, ...(changes ? { changes } : {}) };
		} finally {
			read.ydoc.destroy();
		}
	} finally {
		room.template.free();
	}
}

export interface WriteLogOpts extends ReadLogOpts {
	/** The revision the writer read. */
	base: Revision;
	/** Who the edit is by. */
	writer: string;
	/** Write the edit once under this key, for a writer that may retry, such as a tool call id. */
	key?: string;
	/** Make the edit on the Document as it stood at `base`; return its card operations, if any. */
	edit(doc: Document): CardOp | CardOp[] | void;
}

export type LogWrite =
	/** Appended. `revision` holds the edit, to read from next. */
	| { status: 'written'; revision: Revision; changes: Change[] }
	/** Not appended: changes since `base` touch what the edit does. Read again and redo it. */
	| { status: 'conflict'; conflicts: Change[] }
	/** Not appended: `base` names a session that has ended or a state the log no longer holds,
	 *  or the log kept moving. Read again. */
	| { status: 'stale' }
	/** Not appended: an entry is already kept under `key`. */
	| { status: 'duplicate' };

const ATTEMPTS = 3;

/** Make `edit` from `base` and append it to the room's log. */
export async function writeLog(opts: WriteLogOpts): Promise<LogWrite> {
	const { log, quill, base } = opts;
	if (!validRevision(base)) return { status: 'stale' };
	const room = await open(opts);
	try {
		const seed = seedDocument(room.template, quill);
		let opened = await log.current();
		if (base.epoch === '') {
			if (opened && (await settled(log, opened, room.saved, opts.lease))) {
				await log.end(opened.epoch);
				opened = await log.current();
			}
			// A session opened from the save the writer read starts from the same seed (I5).
			if (opened && !sameBytes(opened.seed, seed)) return { status: 'stale' };
		} else if (opened?.epoch !== base.epoch) return { status: 'stale' };
		for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
			const read = opened ? await history(log, opened) : fromSeed(seed);
			if (!read || base.count > read.count) return { status: 'stale' };
			try {
				const at = opened
					? await snapshotAt(log, opened, base.count, read.count)
					: Y.encodeSnapshot(Y.snapshot(read.ydoc));
				if (!at || (base.epoch !== '' && checkOf(at) !== base.check)) return { status: 'stale' };
				const written = writeFrom({
					history: read.ydoc,
					base: at,
					quill,
					doc: room.template,
					edit: opts.edit
				});
				if (written.conflicts.length) return { status: 'conflict', conflicts: written.conflicts };
				if (!opened) {
					opened = await log.open(seed);
					if (!sameBytes(opened.seed, seed)) return { status: 'stale' };
				}
				const appended = await log.append(opened.epoch, written.update, {
					writer: opts.writer,
					after: read.count,
					...(opts.key === undefined ? {} : { key: opts.key })
				});
				if (appended === 'moved') continue;
				if (appended === 'closed') return { status: 'stale' };
				if (appended === 'duplicate') return { status: 'duplicate' };
				Y.applyUpdate(read.ydoc, written.update);
				await save(log, opened.epoch, read.ydoc, quill, room.template);
				return {
					status: 'written',
					revision: {
						epoch: opened.epoch,
						count: read.count + 1,
						check: checkOf(Y.encodeSnapshot(Y.snapshot(read.ydoc)))
					},
					changes: written.changes
				};
			} finally {
				read.ydoc.destroy();
			}
		}
		return { status: 'stale' };
	} finally {
		room.template.free();
	}
}

/** The room's saved Document, checked against `quill`. The caller frees `template`. */
async function open(opts: ReadLogOpts): Promise<{ saved: Saved; template: Document }> {
	const { Document } = await init();
	const saved = await opts.log.load();
	if (!saved) throw new Error('the room holds no document');
	const template = Document.fromStored(saved.stored);
	if (template.quillRef.split('@')[0] !== opts.quill.metadata.name) {
		template.free();
		throw new QuillMismatch(template.quillRef);
	}
	return { saved, template };
}

/** The session's Y state with its history, and how many entries it holds; `undefined` when the
 *  session is no longer open. */
async function history(
	log: SessionLog,
	opened: Opened
): Promise<{ ydoc: Y.Doc; count: number } | undefined> {
	const read = await log.since(opened.epoch);
	if (!read) return undefined;
	const ydoc = new Y.Doc({ gc: false });
	Y.applyUpdate(ydoc, Y.mergeUpdates([opened.seed, ...read.updates]));
	return { ydoc, count: read.count };
}

/** A session's state at its seed alone, before any entry. */
function fromSeed(seed: Uint8Array): { ydoc: Y.Doc; count: number } {
	const ydoc = new Y.Doc({ gc: false });
	Y.applyUpdate(ydoc, seed);
	return { ydoc, count: 0 };
}

/** `Y.encodeSnapshot` of the state after `count` entries, or `undefined` where the log cannot
 *  rebuild it. */
async function snapshotAt(
	log: SessionLog,
	opened: Opened,
	count: number,
	head: number
): Promise<Uint8Array | undefined> {
	if (count > head) return undefined;
	const updates = count === 0 ? [] : await log.upTo(opened.epoch, count);
	if (!updates) return undefined;
	const ydoc = new Y.Doc({ gc: false });
	Y.applyUpdate(ydoc, Y.mergeUpdates([opened.seed, ...updates]));
	const snapshot = Y.encodeSnapshot(Y.snapshot(ydoc));
	ydoc.destroy();
	return snapshot;
}

/** Save what `ydoc` projects to. The edit is in the log whether or not the save is kept, so a
 *  refused or failed save is not the writer's failure: the next save carries it. */
async function save(
	log: SessionLog,
	epoch: string,
	ydoc: Y.Doc,
	quill: Quill,
	template: Document
): Promise<void> {
	if (!log.save) return;
	try {
		const doc = projectDocument(ydoc, quill, template);
		try {
			await log.save({
				epoch,
				stored: doc.toStored(),
				version: Y.encodeSnapshot(Y.snapshot(ydoc))
			});
		} finally {
			doc.free();
		}
	} catch {
		return;
	}
}

function validRevision(r: Revision): boolean {
	return (
		typeof r?.epoch === 'string' &&
		Number.isSafeInteger(r.count) &&
		r.count >= 0 &&
		typeof r.check === 'string' &&
		(r.epoch !== '' || (r.count === 0 && r.check === ''))
	);
}

/** A digest of the state `snapshot` names: its state vector and delete set, in a fixed order, as
 *  eleven base-36 digits. */
function checkOf(snapshot: Uint8Array): string {
	const { sv, ds } = Y.decodeSnapshot(snapshot);
	const parts: number[] = [];
	for (const client of [...sv.keys()].sort((x, y) => x - y)) parts.push(client, sv.get(client)!);
	parts.push(-1);
	for (const client of [...ds.clients.keys()].sort((x, y) => x - y))
		for (const { clock, len } of ds.clients.get(client)!) parts.push(client, clock, len);
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (const n of parts)
		for (const unit of String(n)) {
			const c = unit.charCodeAt(0);
			h1 = Math.imul(h1 ^ c, 2654435761);
			h2 = Math.imul(h2 ^ c, 1597334677);
		}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((x, i) => x === b[i]);
}
