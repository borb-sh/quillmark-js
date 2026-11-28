// Sessions over the Web Storage log, with tabs of one origin sharing a storage whose writes fire
// `storage` in every other tab.
import { describe, expect, it } from 'vitest';
import type { Content } from '@quillmark/wasm';
import * as Y from 'yjs';
import { joinSession, QuillMismatch, type Session } from '../src/session.js';
import { localLog } from '../src/local.js';
import { edit, quill, snapshot, type FixtureName } from './helpers.js';

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
			log: localLog({ room: 'r', ...origin.tab(), compactAt: extra.compactAt, lease: extra.lease }),
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
	edit(s.doc, {}, [{ insert: word }]);
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
		edit(a.doc, {}, [{ delete: 4 }]);
		a.push();
		await settle();
		expect(await a.save()).toBe(true);
		const log = localLog({ room: 'r', ...origin.tab() });
		expect(await log.save({ epoch: a.epoch, stored: '{}', version: old })).toBe(false);
	});

	it('elects one leader from the tabs present, and hands the lead on when it leaves', async () => {
		const origin = new Origin();
		const a = await open(origin, { lease: 60 }).join();
		const b = await open(origin, { lease: 60 }).join();
		await wait(30);
		expect([a.leader, b.leader].filter(Boolean)).toHaveLength(1);
		const [lead, other] = a.leader ? [a, b] : [b, a];
		expect(lead.ydoc.clientID).toBeLessThan(other.ydoc.clientID);
		await lead.leave();
		await wait(150);
		expect(other.leader).toBe(true);
		await other.leave();
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
		edit(a.doc, {}, [{ delete: 4 }]);
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
		const tab = open(origin, { retry: [200] });
		const a = await tab.join();
		const b = await open(origin).join();
		origin.full = true;
		type(a, 'one ');
		await settle();
		type(a, 'two ');
		origin.full = false;
		await wait(400);
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
		a.doc.unchecked.insertCard(card, 0);
		a.push({ op: 'insert', at: 0 });
		const was = a.doc.card(1);
		a.doc.removeCard(1);
		a.doc.unchecked.insertCard({ ...was, kind: 'note' }, 1);
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
