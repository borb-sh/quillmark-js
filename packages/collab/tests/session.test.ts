// Sessions over the Web Storage log, with tabs of one origin sharing a storage whose writes fire
// `storage` in every other tab.
import { describe, expect, it } from 'vitest';
import type { Content, Document } from '@quillmark/wasm';
import * as Y from 'yjs';
import {
	joinSession,
	localLog,
	QuillMismatch,
	readLog,
	writeFrom,
	writeLog,
	type Revision,
	type Session,
	type SessionLog
} from '../src/index.js';
import { quill, snapshot, type FixtureName } from './helpers.js';

class Origin {
	readonly data = new Map<string, string>();
	readonly tabs: EventTarget[] = [];
	/** A full storage: every new log entry throws, as `localStorage` past its quota does. */
	full = false;

	tab(): { storage: Storage; events: EventTarget } {
		const events = new EventTarget();
		this.tabs.push(events);
		const { data, tabs } = this;
		const fire = (key: string) => {
			for (const t of tabs)
				if (t !== events) t.dispatchEvent(Object.assign(new Event('storage'), { key }));
		};
		const storage: Storage = {
			get length() {
				return data.size;
			},
			key: (i) => [...data.keys()][i] ?? null,
			getItem: (k) => data.get(k) ?? null,
			setItem: (k, v) => {
				if (this.full && k.includes(':log:'))
					throw new DOMException('the quota has been exceeded', 'QuotaExceededError');
				data.set(k, String(v));
				fire(k);
			},
			removeItem: (k) => {
				data.delete(k);
				fire(k);
			},
			clear: () => data.clear()
		};
		return { storage, events };
	}
}

const settle = async () => {
	for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Tab {
	join(): Promise<Session>;
	ended: { lost?: boolean };
	errors: unknown[];
	remote: number;
}

function open(
	origin: Origin,
	extra: { lease?: number; compactAt?: number; quill?: FixtureName; retry?: number[] } = {}
): Tab {
	const q = quill(extra.quill);
	const tab: Tab = { join: undefined!, ended: {}, errors: [], remote: 0 };
	tab.join = () =>
		joinSession({
			log: localLog({ room: 'r', ...origin.tab(), compactAt: extra.compactAt }),
			quill: q,
			initial: () => q.exampleDocument()!,
			lease: extra.lease,
			retry: extra.retry,
			saveDelay: 60_000,
			onRemote: () => tab.remote++,
			onEnded: (lost) => (tab.ended.lost = lost),
			onError: (e) => tab.errors.push(e)
		});
	return tab;
}

const type = (s: Session, word: string) => {
	s.doc.applyChange({}, { delta: { ops: [{ insert: word }] } });
	s.push();
};
const text = (s: Session) => (s.doc.getStored({}) as Content).text;

describe('sessions', () => {
	it('two tabs racing to join a new room hold one copy of the document', async () => {
		const origin = new Origin();
		const [a, b] = await Promise.all([open(origin).join(), open(origin).join()]);
		await settle();
		const want = snapshot(quill().exampleDocument()!);
		expect(snapshot(a.doc)).toBe(want);
		expect(snapshot(b.doc)).toBe(want);
		expect(a.epoch).toBe(b.epoch);
	});

	it("carries one tab's edits to the other", async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		const b = await open(origin).join();
		type(a, 'from a ');
		await settle();
		expect(text(b).startsWith('from a ')).toBe(true);
		type(b, 'from b ');
		await settle();
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
	});

	it('keeps a save only when it moves past the one held, deletions included', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		const old = Y.encodeSnapshot(Y.snapshot(a.ydoc));
		type(a, 'abc ');
		await settle();
		expect(await a.save()).toBe(true);
		expect(await a.save()).toBe(false);
		a.doc.applyChange({}, { delta: { ops: [{ delete: 4 }] } });
		a.push();
		await settle();
		expect(await a.save()).toBe(true);
		const log = localLog({ room: 'r', ...origin.tab() });
		expect(await log.save({ epoch: a.epoch, stored: '{}', version: old })).toBe(false);
	});

	it('opens one session from one seed, whoever asks second', async () => {
		const log = localLog({ room: 'r', ...new Origin().tab() });
		const first = await log.open(new Uint8Array([1]));
		const second = await log.open(new Uint8Array([2]));
		expect(second).toEqual(first);
	});

	it('keeps a session whose last entry is unsaved, past its lease', async () => {
		const origin = new Origin();
		const a = await open(origin, { lease: 0 }).join();
		type(a, 'unsaved ');
		await settle();
		const c = await open(origin, { lease: 0 }).join();
		expect(c.epoch).toBe(a.epoch);
		expect(text(c).startsWith('unsaved ')).toBe(true);
	});

	it('keeps a session open while a tab is in it, however idle', async () => {
		const origin = new Origin();
		const a = await open(origin, { lease: 60 }).join();
		await wait(150);
		const c = await open(origin, { lease: 60 }).join();
		expect(c.epoch).toBe(a.epoch);
	});

	it('ends a saved session nobody is in, deletions and removals kept', async () => {
		const origin = new Origin();
		const a = await open(origin, { lease: 0 }).join();
		type(a, 'abc ');
		await settle();
		await a.save();
		a.doc.applyChange({}, { delta: { ops: [{ delete: 4 }] } });
		a.doc.removeCard(0);
		a.push({ op: 'remove', at: 0 });
		const want = snapshot(a.doc);
		await a.leave();
		await wait(2);
		const c = await open(origin, { lease: 0 }).join();
		expect(c.epoch).not.toBe(a.epoch);
		expect(snapshot(c.doc)).toBe(want);
	});

	it('tells a tab whose session ended under it what it lost', async () => {
		const origin = new Origin();
		const tab = open(origin);
		const a = await tab.join();
		// Ended where this tab hears nothing of it, as a tab asleep through the lease does.
		for (const k of [...origin.data.keys()]) if (!k.endsWith(':saved')) origin.data.delete(k);
		type(a, 'stale ');
		await settle();
		expect(tab.ended.lost).toBe(true);
		const c = await open(origin).join();
		expect(c.epoch).not.toBe(a.epoch);
		expect(text(c).includes('stale')).toBe(false);
	});

	it('ends a session whose write failed past its retries, rather than leave its later edits stranded', async () => {
		const origin = new Origin();
		const tab = open(origin, { retry: [1] });
		const a = await tab.join();
		origin.full = true;
		type(a, 'nowhere ');
		await wait(20);
		expect(tab.ended.lost).toBe(true);
		expect(tab.errors).toHaveLength(2);
	});

	it('retries a failed write, and sends what was typed meanwhile with it', async () => {
		const origin = new Origin();
		const tab = open(origin, { retry: [20] });
		const a = await tab.join();
		const b = await open(origin).join();
		origin.full = true;
		type(a, 'one ');
		await settle();
		type(a, 'two ');
		origin.full = false;
		await wait(40);
		expect(tab.ended.lost).toBeUndefined();
		expect(text(b).startsWith('two one ')).toBe(true);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('refuses a join from a client on another version of the quill the session runs', async () => {
		const origin = new Origin();
		await open(origin).join();
		const opened = JSON.parse(origin.data.get('qm-collab:r:open')!);
		origin.data.set('qm-collab:r:open', JSON.stringify({ ...opened, quill: 'showcase@0.9.0' }));
		await expect(open(origin).join()).rejects.toThrow(QuillMismatch);
	});

	it('saves nothing while it holds a remote value its Document refused', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		a.ydoc.transact(() => a.ydoc.getMap('main').set('not a name', 1), 'net');
		expect(a.binding.holding).toBe(true);
		type(a, 'held ');
		await settle();
		expect(await a.save()).toBe(false);
	});

	it('joins from a save the log has moved past', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		const card = quill().seedCard('note', a.doc.seedOverlay('note'))!;
		a.doc.insertCard(card, 0);
		a.push({ op: 'insert', at: 0 });
		a.doc.insertCard({ ...a.doc.card(1), kind: 'note' }, 1);
		a.doc.removeCard(2);
		a.push();
		await settle();
		const b = await open(origin).join();
		await settle();
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
		expect(b.binding.ids).toEqual(a.binding.ids);
	});

	it('reports nothing remote until the join has returned', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		type(a, 'before ');
		await settle();
		const tab = open(origin);
		const b = await tab.join();
		expect(tab.remote).toBe(0);
		type(a, 'after ');
		await settle();
		expect(tab.remote).toBe(1);
		expect(text(b).startsWith('after before ')).toBe(true);
	});

	it('refuses a room whose document is under another quill', async () => {
		const origin = new Origin();
		await open(origin).join();
		await expect(open(origin, { quill: 'usaf_memo' }).join()).rejects.toBeInstanceOf(QuillMismatch);
	});

	it('rejoins a session after a reload', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		type(a, 'kept ');
		await a.leave();
		const b = await open(origin).join();
		expect(b.epoch).toBe(a.epoch);
		expect(text(b).startsWith('kept ')).toBe(true);
	});

	it('compacts the log and still joins to the same state', async () => {
		const origin = new Origin();
		const a = await open(origin, { compactAt: 4 }).join();
		for (let i = 0; i < 12; i++) type(a, `${i} `);
		await settle();
		const entries = [...origin.data.keys()].filter((k) => k.includes(':log:'));
		expect(entries.length).toBeLessThanOrEqual(5);
		const b = await open(origin).join();
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});
});

describe('writes from a revision', () => {
	const abstract = (s: Session) => quill().toAuthoring(s.doc).fields?.abstract;
	const rewrite = (doc: Document, words: string) =>
		void quill().writer(doc).reviseField('abstract', words);
	const logOf = (origin: Origin) => localLog({ room: 'r', ...origin.tab() });
	const write = (log: SessionLog, base: Revision, words: string, extra: { key?: string } = {}) =>
		writeLog({
			log,
			quill: quill(),
			base,
			writer: 'ai:1',
			edit: (doc) => rewrite(doc, words),
			...extra
		});

	it('applies an edit made from an older state under its writer', async () => {
		const origin = new Origin();
		const writers: (string | undefined)[] = [];
		const base = logOf(origin);
		const log: SessionLog = {
			...base,
			append: (epoch, update, opts) => {
				writers.push(opts?.writer);
				return base.append(epoch, update, opts);
			}
		};
		const q = quill();
		const a = await joinSession({
			log,
			quill: q,
			writer: 'ada',
			initial: () => q.exampleDocument()!,
			saveDelay: 60_000
		});
		const b = await open(origin).join();
		const at = a.snapshot();
		type(a, 'Typed. ');
		const { update, conflicts } = writeFrom({
			history: a.ydoc,
			base: at,
			quill: q,
			doc: a.doc,
			edit: (doc) => rewrite(doc, 'Rewritten.')
		});
		expect(conflicts).toEqual([]);
		a.apply(update, 'ai:1');
		await settle();
		expect(abstract(a)).toBe('Rewritten.');
		expect(text(a).startsWith('Typed. ')).toBe(true);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
		expect(writers).toEqual(['ada', 'ai:1']);
	});

	it('reads a room without changing it, and writes through its log', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		const log = logOf(origin);
		const before = JSON.stringify([...origin.data]);
		const read = await readLog({ log, quill: quill() });
		expect(JSON.stringify([...origin.data])).toBe(before);
		expect(read.revision.epoch).toBe(a.epoch);
		expect(snapshot(read.doc)).toBe(snapshot(a.doc));
		read.doc.free();
		type(a, 'Typed. ');
		await settle();
		const written = await write(log, read.revision, 'Rewritten.');
		expect(written).toMatchObject({ status: 'written', revision: { epoch: a.epoch, count: 2 } });
		await settle();
		expect(abstract(a)).toBe('Rewritten.');
		expect(text(a).startsWith('Typed. ')).toBe(true);
		expect((await log.load())?.stored).toBe(a.doc.toStored());
	});

	it('reads what changed since a revision, as hunks', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		const log = logOf(origin);
		const first = await readLog({ log, quill: quill() });
		first.doc.free();
		type(a, 'Typed. ');
		await settle();
		const next = await readLog({ log, quill: quill(), since: first.revision });
		next.doc.free();
		expect(next.changes).toEqual([
			expect.objectContaining({
				type: 'field',
				from: 'main',
				hunks: [
					{
						line: 0,
						before: expect.stringMatching(/^The body/),
						after: expect.stringMatching(/^Typed\. The body/)
					}
				]
			})
		]);
		expect(next.revision.count).toBe(first.revision.count + 1);
	});

	it('opens a session to write to a room that has none open, from the save it read', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		await a.leave();
		const log = logOf(origin);
		await log.end(a.epoch);
		const read = await readLog({ log, quill: quill() });
		read.doc.free();
		expect(read.revision).toEqual({ epoch: '', count: 0, check: '' });
		expect(await log.current()).toBeUndefined();
		const written = await write(log, read.revision, 'Rewritten.');
		expect(written.status).toBe('written');
		const b = await open(origin).join();
		expect(abstract(b)).toBe('Rewritten.');
	});

	it('lets one of two writes from one revision to one field through, and refuses the other', async () => {
		const origin = new Origin();
		await open(origin).join();
		const log = logOf(origin);
		const read = await readLog({ log, quill: quill() });
		read.doc.free();
		const out = await Promise.all([
			write(log, read.revision, 'Alpha version.'),
			write(logOf(origin), read.revision, 'Beta version.')
		]);
		expect(out.map((w) => w.status).sort()).toEqual(['conflict', 'written']);
		const b = await open(origin).join();
		expect(['Alpha version.', 'Beta version.']).toContain(abstract(b));
	});

	it('refuses a write that rewrites a field changed since its revision', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		const log = logOf(origin);
		const read = await readLog({ log, quill: quill() });
		read.doc.free();
		rewrite(a.doc, 'By a person.');
		a.push();
		await settle();
		expect(await write(log, read.revision, 'By the writer.')).toEqual({
			status: 'conflict',
			conflicts: [
				expect.objectContaining({ type: 'field', field: 'abstract', after: 'By a person.' })
			]
		});
		await settle();
		expect(abstract(a)).toBe('By a person.');
	});

	it('writes a card insert once under a key, however often it is retried', async () => {
		const origin = new Origin();
		await open(origin).join();
		const log = logOf(origin);
		const read = await readLog({ log, quill: quill() });
		read.doc.free();
		const insert = () =>
			writeLog({
				log,
				quill: quill(),
				base: read.revision,
				writer: 'ai:1',
				key: 'call-1',
				edit: (doc) => {
					quill().writer(doc).addCard('note', { label: 'Once' }, '', 0);
					return { op: 'insert', at: 0 };
				}
			});
		expect((await insert()).status).toBe('written');
		expect(await insert()).toEqual({ status: 'duplicate' });
		const b = await open(origin).join();
		expect(b.doc.cards.filter((c) => c.kind === 'note')).toHaveLength(2);
	});

	it('refuses a write from a session that has ended, or a revision that is not one', async () => {
		const origin = new Origin();
		const log = logOf(origin);
		const a = await open(origin).join();
		const read = await readLog({ log, quill: quill() });
		read.doc.free();
		const { check } = read.revision;
		expect(await write(log, { epoch: a.epoch, count: -1, check }, 'Bad.')).toEqual({
			status: 'stale'
		});
		expect(await write(log, { epoch: a.epoch, count: 99, check }, 'Ahead.')).toEqual({
			status: 'stale'
		});
		await a.leave();
		await log.end(a.epoch);
		expect(await write(log, read.revision, 'Late.')).toEqual({ status: 'stale' });
	});

	it('refuses a revision whose count is not the one read', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		const log = logOf(origin);
		type(a, 'one ');
		await settle();
		const read = await readLog({ log, quill: quill() });
		read.doc.free();
		type(a, 'Typed. ');
		await settle();
		const claimed = { ...read.revision, count: read.revision.count + 1 };
		expect(await write(log, claimed, 'Rewritten.')).toEqual({ status: 'stale' });
		expect(text(a).startsWith('Typed. ')).toBe(true);
	});

	it('reads a session nobody is in whose entries are saved as the save, and ends it to write', async () => {
		const origin = new Origin();
		const a = await open(origin, { lease: 0 }).join();
		type(a, 'Saved. ');
		await settle();
		await a.leave();
		await wait(2);
		const log = logOf(origin);
		const read = await readLog({ log, quill: quill(), lease: 0 });
		read.doc.free();
		expect(read.revision).toEqual({ epoch: '', count: 0, check: '' });
		const written = await writeLog({
			log,
			quill: quill(),
			lease: 0,
			base: read.revision,
			writer: 'ai:1',
			edit: (doc) => rewrite(doc, 'Rewritten.')
		});
		expect(written).toMatchObject({ status: 'written', revision: { count: 1 } });
		expect((await log.current())?.epoch).not.toBe(a.epoch);
		const b = await open(origin).join();
		expect(text(b).startsWith('Saved. ')).toBe(true);
		expect(abstract(b)).toBe('Rewritten.');
	});

	it('opens no session for a write from the save that writes nothing', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		await a.leave();
		const log = logOf(origin);
		await log.end(a.epoch);
		await expect(
			writeLog({
				log,
				quill: quill(),
				base: { epoch: '', count: 0, check: '' },
				writer: 'ai:1',
				edit: (doc) => void quill().writer(doc).addCard('note', { label: 'Lost' }, '', 0)
			})
		).rejects.toThrow();
		expect(await log.current()).toBeUndefined();
	});

	it('refuses a revision compaction has merged past', async () => {
		const origin = new Origin();
		const a = await open(origin, { compactAt: 3 }).join();
		const log = localLog({ room: 'r', ...origin.tab(), compactAt: 3 });
		type(a, 'one ');
		await settle();
		const read = await readLog({ log, quill: quill() });
		read.doc.free();
		for (let i = 0; i < 5; i++) {
			type(a, `${i} `);
			await settle();
		}
		expect(await write(log, read.revision, 'Late.')).toEqual({ status: 'stale' });
	});
});
