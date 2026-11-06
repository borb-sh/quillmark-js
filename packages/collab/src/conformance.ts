// The checks a server `SessionLog` passes before a room's clients trust it. Nothing in a Y update
// says who made it or whether they may, so a store on a server holds what the client's word
// cannot: who an entry is by, who may append, how large an update is, and the seed's client id.
// It also holds what every client relies on: a leader elected from the clients present, its
// checkpoints until the session ends, and its versions past every session.
//
// `checkServerStore` runs each check against fresh rooms of the host's store, reached as the
// callers it names, and answers what failed, empty when the store conforms. It takes no test
// runner: a host asserts the answer is empty in its own.
import * as Y from 'yjs';
import { sameBytes } from './shape.js';
import type { SessionLog } from './session.js';

/** Who reaches the store: an id the store authenticated, and whether they may only read. */
export interface Caller {
	id: string;
	role: 'writer' | 'reader';
}

export interface ServerStoreOpts {
	/** The store of room `room` as `caller` reaches it. A room name is fresh each time a check
	 *  asks for one, and every call naming it reaches the same room. */
	store(room: string, caller: Caller): SessionLog;
	/** Who each entry of `epoch` in `room` is by, in entry order, as the store keeps it. */
	authors(room: string, epoch: string): Promise<(string | undefined)[]>;
	/** The largest update, in bytes, the store keeps. */
	maxUpdate: number;
}

/** Each way the store fails to conform, empty when it conforms. */
export async function checkServerStore(opts: ServerStoreOpts): Promise<string[]> {
	const failures: string[] = [];
	let rooms = 0;
	const fresh = () => `conformance-${Date.now().toString(36)}-${rooms++}`;
	const ann: Caller = { id: 'conformance-ann', role: 'writer' };
	const bo: Caller = { id: 'conformance-bo', role: 'reader' };
	const seed = seedUpdate();
	const check = async (name: string, run: (room: string) => Promise<string | void>) => {
		try {
			const failed = await run(fresh());
			if (failed) failures.push(`${name}: ${failed}`);
		} catch (e) {
			failures.push(`${name}: threw ${e instanceof Error ? e.message : String(e)}`);
		}
	};
	const refuses = async (append: () => Promise<unknown>): Promise<boolean> => {
		try {
			return (await append()) !== 'appended';
		} catch {
			return true;
		}
	};

	await check('an open session is opened once', async (room) => {
		const log = opts.store(room, ann);
		const a = await log.open(seed, QUILL);
		const b = await log.open(seedUpdate('other'), QUILL);
		if (a.epoch !== b.epoch) return 'a second open opened another session';
	});

	await check("an entry's author is the caller", async (room) => {
		const log = opts.store(room, ann);
		const { epoch } = await log.open(seed, QUILL);
		await log.append(epoch, editUpdate(1), { author: 'someone-else' });
		await log.append(epoch, editUpdate(2));
		const authors = await opts.authors(room, epoch);
		if (authors.length !== 2 || authors.some((w) => w !== ann.id))
			return `entries are by ${JSON.stringify(authors)}, not ${ann.id}`;
	});

	await check('the leader is a client present in the session', async (room) => {
		const log = opts.store(room, ann);
		const { epoch } = await log.open(seed, QUILL);
		await log.touch(epoch, 5);
		await log.touch(epoch, 3);
		const leader = (await log.since(epoch))?.leader;
		if (leader !== 3 && leader !== 5) return `the leader is ${leader}, which touched nothing`;
	});

	await check('a checkpoint lasts its session', async (room) => {
		const log = opts.store(room, ann);
		const { epoch } = await log.open(seed, QUILL);
		await log.checkpoint(epoch, { count: 0, snapshot: SNAPSHOT });
		const kept = (await log.checkpoints(epoch)) ?? [];
		if (!kept.some((c) => c.count === 0 && sameBytes(c.snapshot, SNAPSHOT)))
			return 'the checkpoint was not kept';
		await log.end(epoch);
		if ((await log.checkpoints(epoch)) !== undefined)
			return 'an ended session still has checkpoints';
	});

	await check('a version outlives its session', async (room) => {
		const log = opts.store(room, ann);
		const { epoch } = await log.open(seed, QUILL);
		const version = { label: 'draft', stored: '{}', at: 1 };
		await log.keepVersion(version);
		await log.end(epoch);
		const kept = await log.versions();
		if (!kept.some((v) => v.label === version.label && v.stored === version.stored))
			return 'the version did not outlive the session';
	});

	await check('a reader appends nothing', async (room) => {
		const { epoch } = await opts.store(room, ann).open(seed, QUILL);
		const read = opts.store(room, bo);
		if (!(await refuses(() => read.append(epoch, editUpdate(1)))))
			return "a reader's append was kept";
		if ((await read.since(epoch))?.count !== 0) return "a reader's append is in the log";
	});

	await check('an update past the bound is refused', async (room) => {
		const log = opts.store(room, ann);
		const { epoch } = await log.open(seed, QUILL);
		const big = editUpdate(1, opts.maxUpdate + 1);
		if (big.length <= opts.maxUpdate) return 'could not build an update past the bound';
		if (!(await refuses(() => log.append(epoch, big)))) return 'an update past the bound was kept';
		if ((await log.since(epoch))?.count !== 0) return 'an update past the bound is in the log';
	});

	await check('an update by client id 0 is refused', async (room) => {
		const log = opts.store(room, ann);
		const { epoch } = await log.open(seed, QUILL);
		if (!(await refuses(() => log.append(epoch, editUpdate(0)))))
			return 'an update by client id 0 was kept';
		if ((await log.since(epoch))?.count !== 0) return 'an update by client id 0 is in the log';
	});

	await check('a conditional and a keyed append hold', async (room) => {
		const log = opts.store(room, ann);
		const { epoch } = await log.open(seed, QUILL);
		if ((await log.append(epoch, editUpdate(1), { after: 1 })) !== 'moved')
			return 'an append after the wrong count was not refused as moved';
		if ((await log.append(epoch, editUpdate(1), { after: 0, key: 'k' })) !== 'appended')
			return 'an append after the right count was not kept';
		if ((await log.append(epoch, editUpdate(2), { key: 'k' })) !== 'duplicate')
			return 'a repeated key was not refused as duplicate';
		await log.end(epoch);
		if ((await log.append(epoch, editUpdate(3))) !== 'closed')
			return 'an append to an ended session was not refused as closed';
	});

	return failures;
}

const QUILL = 'q@1.0.0';
const SNAPSHOT = Y.encodeSnapshot(Y.emptySnapshot);

/** A session seed, written by client id 0 as `seedDocument` writes one. */
function seedUpdate(text = 'seed'): Uint8Array {
	const ydoc = new Y.Doc();
	ydoc.clientID = 0;
	ydoc.getText('conformance').insert(0, text);
	const update = Y.encodeStateAsUpdate(ydoc);
	ydoc.destroy();
	return update;
}

/** An update by `client` that inserts at least `size` bytes of text. */
function editUpdate(client: number, size = 8): Uint8Array {
	const ydoc = new Y.Doc();
	ydoc.clientID = client;
	ydoc.getText('conformance').insert(0, 'x'.repeat(size));
	const update = Y.encodeStateAsUpdate(ydoc);
	ydoc.destroy();
	return update;
}
