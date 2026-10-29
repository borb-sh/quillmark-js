// Sessions over the Web Storage log, with tabs of one origin sharing a storage whose writes fire
// `storage` in every other tab.
import { describe, expect, it } from 'vitest';
import type { Content } from '@quillmark/wasm';
import { joinSession, localLog, type Session } from '../src/index.js';
import { quill, snapshot } from './helpers.js';

class Origin {
	readonly data = new Map<string, string>();
	readonly tabs: EventTarget[] = [];

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

function open(origin: Origin, extra: { lease?: number; compactAt?: number } = {}) {
	const q = quill();
	const ended = { value: false };
	const errors: unknown[] = [];
	const join = () =>
		joinSession({
			log: localLog({ room: 'r', ...origin.tab(), compactAt: extra.compactAt }),
			quill: q,
			initial: () => q.exampleDocument()!,
			lease: extra.lease,
			saveDelay: 60_000,
			onEnded: () => (ended.value = true),
			onError: (e) => errors.push(e)
		});
	return { join, ended, errors };
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

	it('refuses a save older than the one held', async () => {
		const origin = new Origin();
		const a = await open(origin).join();
		const before = a.ydoc;
		const old = (await import('yjs')).encodeStateVector(before);
		type(a, 'x');
		await settle();
		expect(await a.save()).toBe(true);
		const log = localLog({ room: 'r', ...origin.tab() });
		expect(await log.save({ epoch: a.epoch, stored: '{}', version: old })).toBe(false);
		expect(await a.save()).toBe(false);
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

	it('ends an idle, saved session, and never applies its entries to the next', async () => {
		const origin = new Origin();
		const tab = open(origin, { lease: 0 });
		const a = await tab.join();
		type(a, 'saved ');
		await settle();
		await a.save();
		await new Promise((r) => setTimeout(r, 2));
		const c = await open(origin, { lease: 0 }).join();
		expect(c.epoch).not.toBe(a.epoch);
		expect(text(c).startsWith('saved ')).toBe(true);
		type(a, 'stale ');
		await settle();
		expect(tab.ended.value).toBe(true);
		expect(text(c).includes('stale')).toBe(false);
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
