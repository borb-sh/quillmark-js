import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { checkServerStore, type Caller } from '../src/conformance.js';
import { localLog, type Appended, type Opened, type SessionLog } from '../src/index.js';

const MAX = 1 << 12;
const SERVER = 'server';

interface Room {
	opened?: Opened;
	entries: { update: Uint8Array; writer: string; key?: string }[];
	touched: number;
}

/** A server store held in memory: the reference the check is written against. */
function memoryStore() {
	const rooms = new Map<string, Room>();
	const roomOf = (name: string) => {
		let room = rooms.get(name);
		if (!room) rooms.set(name, (room = { entries: [], touched: 0 }));
		return room;
	};
	const byClientZero = (update: Uint8Array) =>
		Y.decodeUpdate(update).structs.some((s) => s.id.client === 0);
	const store = (name: string, caller: Caller): SessionLog => {
		const room = roomOf(name);
		const isOpen = (epoch: string) => room.opened?.epoch === epoch;
		return {
			current: async () => room.opened,
			async open(seed, quill) {
				room.opened ??= { epoch: `e${rooms.size}`, seed, quill, writer: SERVER };
				return room.opened;
			},
			async end(epoch) {
				if (!isOpen(epoch)) return;
				room.opened = undefined;
				room.entries = [];
			},
			async append(epoch, update, opts = {}): Promise<Appended> {
				if (caller.role !== 'writer') throw new Error('readers do not append');
				if (update.length > MAX) throw new Error('update too large');
				if (byClientZero(update)) throw new Error('client id 0 is the seed');
				if (!isOpen(epoch)) return 'closed';
				if (opts.key !== undefined && room.entries.some((e) => e.key === opts.key))
					return 'duplicate';
				if (opts.after !== undefined && opts.after !== room.entries.length) return 'moved';
				room.entries.push({ update, writer: caller.id, key: opts.key });
				return 'appended';
			},
			async touch() {
				room.touched = Date.now();
			},
			async since(epoch) {
				if (!isOpen(epoch)) return undefined;
				const updates = room.entries.map((e) => e.update);
				return { updates, cursor: updates.length, count: updates.length, touched: room.touched };
			},
			async upTo(epoch, count) {
				return isOpen(epoch) ? room.entries.slice(0, count).map((e) => e.update) : undefined;
			},
			subscribe: () => () => {},
			load: async () => undefined
		};
	};
	return { store, writers: async (name: string) => roomOf(name).entries.map((e) => e.writer) };
}

describe('the server-store conformance check', () => {
	it('passes a store that holds what the client cannot', async () => {
		const { store, writers } = memoryStore();
		expect(await checkServerStore({ store, writers, maxUpdate: MAX })).toEqual([]);
	});

	it("fails a store that takes the client's word, as Web Storage must", async () => {
		const tabs = new Map<string, Map<string, string>>();
		const storage = (room: string): Storage => {
			const data = tabs.get(room) ?? new Map<string, string>();
			tabs.set(room, data);
			return {
				get length() {
					return data.size;
				},
				key: (i) => [...data.keys()][i] ?? null,
				getItem: (k) => data.get(k) ?? null,
				setItem: (k, v) => void data.set(k, v),
				removeItem: (k) => void data.delete(k),
				clear: () => data.clear()
			};
		};
		const failures = await checkServerStore({
			store: (room) => localLog({ room, storage: storage(room), events: new EventTarget() }),
			writers: async (room, epoch) =>
				[...(tabs.get(room)?.keys() ?? [])]
					.filter((k) => k.includes(`:log:${epoch}:`))
					.map(() => undefined),
			maxUpdate: MAX
		});
		expect(failures.map((f) => f.split(':')[0])).toEqual([
			"an entry's writer is the caller",
			"the session's single writer is the store's to name",
			'a reader appends nothing',
			'an update past the bound is refused',
			'an update by client id 0 is refused'
		]);
	});
});
