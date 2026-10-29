// A writer with no editor open, such as a server answering a model's tool call: it reads a room's
// document at a revision, and later writes an edit from that revision, straight through the log.
//
// Neither call joins as a session client. A read opens a session when none is open, so the
// revision it hands out names an epoch, and marks the session present. A write rebuilds the log's
// history, makes the edit from the writer's revision (`writeFrom`), appends it, and saves the
// Document the log now projects to, so the save follows the write even with no client open.
import * as Y from 'yjs';
import { init, type Document, type Quill } from '@quillmark/wasm';
import { seedDocument, type CardOp } from './document.js';
import { projectDocument, writeFrom, type Change, type Revision } from './fork.js';
import { covers, QuillMismatch, type SessionLog } from './session.js';

export interface ReadLogOpts {
	log: SessionLog;
	/** The quill the room's Document is under. */
	quill: Quill;
}

export interface LogRead {
	revision: Revision;
	/** The Document at `revision`. The host frees it. */
	doc: Document;
}

/** The room's Document as it stands, and the revision it stands at. */
export async function readLog(opts: ReadLogOpts): Promise<LogRead> {
	const { log, quill } = opts;
	const { Document } = await init();
	for (let attempt = 0; attempt < 3; attempt++) {
		const saved = await log.load();
		if (!saved) throw new Error('the room holds no document');
		const template = Document.fromStored(saved.stored);
		try {
			if (template.quillRef.split('@')[0] !== quill.metadata.name)
				throw new QuillMismatch(template.quillRef);
			const opened = (await log.current()) ?? (await log.open(seedDocument(template, quill)));
			const history = await historyOf(log, opened.epoch, opened.seed);
			if (!history) continue;
			await log.touch(opened.epoch);
			const doc = projectDocument(history, quill, template);
			const revision = { epoch: opened.epoch, snapshot: Y.encodeSnapshot(Y.snapshot(history)) };
			history.destroy();
			return { revision, doc };
		} finally {
			template.free();
		}
	}
	throw new Error('the room kept closing its session while it was read');
}

export interface WriteLogOpts extends ReadLogOpts {
	/** The revision the writer read. */
	base: Revision;
	/** Who the edit is by, passed to `append`. */
	writer: string;
	/** Make the edit on the Document as it stood at `base`; return its card operation, if any. */
	edit(doc: Document): CardOp | void;
	/** Append the edit even where it conflicts with a change made since `base`. */
	force?: boolean;
}

export type LogWrite =
	/** Appended and saved. `revision` holds the edit, to read from next. */
	| { status: 'written'; revision: Revision; changes: Change[] }
	/** Not appended: changes since `base` touch what the edit does. Read again and redo it. */
	| { status: 'conflict'; conflicts: Change[] }
	/** Not appended: `base`'s session has ended, or the log does not hold `base`. Read again. */
	| { status: 'stale' };

/** Make `edit` from `base` and append it to the room's log. */
export async function writeLog(opts: WriteLogOpts): Promise<LogWrite> {
	const { log, quill, base } = opts;
	const { Document } = await init();
	const opened = await log.current();
	if (opened?.epoch !== base.epoch) return { status: 'stale' };
	const history = await historyOf(log, opened.epoch, opened.seed);
	if (!history) return { status: 'stale' };
	const saved = await log.load();
	if (!saved) throw new Error('the room holds no document');
	const template = Document.fromStored(saved.stored);
	try {
		if (!covers(Y.encodeSnapshot(Y.snapshot(history)), base.snapshot)) return { status: 'stale' };
		const written = writeFrom({
			history,
			base: base.snapshot,
			quill,
			doc: template,
			edit: opts.edit
		});
		if (written.conflicts.length && !opts.force)
			return { status: 'conflict', conflicts: written.conflicts };
		if (!(await log.append(opened.epoch, written.update, opts.writer))) return { status: 'stale' };
		Y.applyUpdate(history, written.update);
		const version = Y.encodeSnapshot(Y.snapshot(history));
		const doc = projectDocument(history, quill, template);
		try {
			await log.save({ epoch: opened.epoch, stored: doc.toStored(), version });
		} finally {
			doc.free();
		}
		return {
			status: 'written',
			revision: { epoch: opened.epoch, snapshot: version },
			changes: written.changes
		};
	} finally {
		template.free();
		history.destroy();
	}
}

/** `epoch`'s Y state with its history; `undefined` when `epoch` is no longer open. */
async function historyOf(
	log: SessionLog,
	epoch: string,
	seed: Uint8Array
): Promise<Y.Doc | undefined> {
	const read = await log.since(epoch);
	if (!read) return undefined;
	const history = new Y.Doc({ gc: false });
	Y.applyUpdate(history, Y.mergeUpdates([seed, ...read.updates]));
	return history;
}
