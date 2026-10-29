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
	extra: { lease?: number; compactAt?: number; quill?: FixtureName } = {}
): Tab {
	const q = quill(extra.quill);
	const tab: Tab = { join: undefined!, ended: {}, errors: [], remote: 0 };
	tab.join = () =>
		joinSession({
			log: localLog({ room: 'r', ...origin.tab(), compactAt: extra.compactAt }),
			quill: q,
			initial: () => q.exampleDocument()!,
			lease: extra.lease,
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

	it('ends a session whose write failed, rather than leave its later edits stranded', async () => {
		const origin = new Origin();
		const tab = open(origin);
		const a = await tab.join();
		origin.full = true;
		type(a, 'nowhere ');
		await settle();
		expect(tab.ended.lost).toBe(true);
		expect(tab.errors).toHaveLength(1);
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

	it('applies an edit made from an older revision under its writer, and undoes it alone', async () => {
		const origin = new Origin();
		const writers: (string | undefined)[] = [];
		const base = localLog({ room: 'r', ...origin.tab() });
		const log: SessionLog = {
			...base,
			append: (epoch, update, writer) => {
				writers.push(writer);
				return base.append(epoch, update, writer);
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
		const before = abstract(a);
		const { snapshot: at } = a.revision();
		type(a, 'Typed. ');
		const { update } = writeFrom({
			history: a.ydoc,
			base: at,
			quill: q,
			doc: a.doc,
			edit: (doc) => rewrite(doc, 'Rewritten.')
		});
		const undo = a.apply(update, 'ai:1');
		await settle();
		expect(abstract(a)).toBe('Rewritten.');
		expect(abstract(b)).toBe('Rewritten.');
		expect(writers).toEqual(['ada', 'ai:1']);
		undo.undo();
		await settle();
		expect(abstract(a)).toBe(before);
		expect(text(a).startsWith('Typed. ')).toBe(true);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
		expect(writers.at(-1)).toBe('ada');
	});

	it('reads and writes a room through its log with no session joined', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		const log = localLog({ room: 'r', ...origin.tab() });
		const read = await readLog({ log, quill: quill() });
		expect(read.revision.epoch).toBe(a.epoch);
		expect(snapshot(read.doc)).toBe(snapshot(a.doc));
		read.doc.free();
		type(a, 'Typed. ');
		await settle();
		const written = await writeLog({
			log,
			quill: quill(),
			base: read.revision,
			writer: 'ai:1',
			edit: (doc) => rewrite(doc, 'Rewritten.')
		});
		expect(written.status).toBe('written');
		await settle();
		expect(abstract(a)).toBe('Rewritten.');
		expect(text(a).startsWith('Typed. ')).toBe(true);
		const saved = await log.load();
		expect(saved?.stored).toBe(a.doc.toStored());
	});

	it('opens a session to read a room that has none open', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		await a.leave();
		const log = localLog({ room: 'r', ...origin.tab() });
		await log.end(a.epoch);
		const read = await readLog({ log, quill: quill() });
		expect(read.revision.epoch).not.toBe(a.epoch);
		expect((await log.current())?.epoch).toBe(read.revision.epoch);
		read.doc.free();
	});

	it('refuses a write that rewrites a field changed since its revision', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		const log = localLog({ room: 'r', ...origin.tab() });
		const read = await readLog({ log, quill: quill() });
		read.doc.free();
		rewrite(a.doc, 'By a person.');
		a.push();
		await settle();
		const written = await writeLog({
			log,
			quill: quill(),
			base: read.revision,
			writer: 'ai:1',
			edit: (doc) => rewrite(doc, 'By the writer.')
		});
		expect(written).toEqual({
			status: 'conflict',
			conflicts: [
				expect.objectContaining({ type: 'field', field: 'abstract', after: 'By a person.' })
			]
		});
		await settle();
		expect(abstract(a)).toBe('By a person.');
	});

	it('refuses a write from a session that has ended', async () => {
		const origin = new Origin();
		const log = localLog({ room: 'r', ...origin.tab() });
		const a = await open(origin).join();
		const read = await readLog({ log, quill: quill() });
		read.doc.free();
		await a.leave();
		await log.end(a.epoch);
		const written = await writeLog({
			log,
			quill: quill(),
			base: read.revision,
			writer: 'ai:1',
			edit: (doc) => rewrite(doc, 'Late.')
		});
		expect(written).toEqual({ status: 'stale' });
	});
});
