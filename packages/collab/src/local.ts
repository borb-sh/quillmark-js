// A `SessionLog` in Web Storage, for every tab of one origin: the playground's database.
//
// The open session is one key, its epoch and its seed written together. Each entry has a key of
// its own, `qm-collab:<room>:log:<epoch>:<tab>:<n>`, written by one tab alone, so tabs need no
// lock to append; its value is the range of entry numbers it holds and the update. The `storage`
// event, which fires in every other tab of the origin, is the wake-up. Once an epoch passes
// `compactAt` entries, the appending tab merges them into one entry holding their whole range,
// writing it before deleting the keys it merged, and a reader that finds a key it listed gone
// lists again. Web Storage has no transactions: two tabs opening a session at once each write
// one, the later write stands, and the other tab's session ends at its first append; two tabs
// appending in the same instant can take one entry number, which a conditional append does not
// catch. An entry's `writer` is not kept: every tab of an origin is one person.
import * as Y from 'yjs';
import { covers, type Opened, type Saved, type SessionLog } from './session.js';

export interface LocalLogOpts {
	room: string;
	/** `localStorage` by default. `sessionStorage` is private to one tab, so it cannot carry a
	 *  session between tabs. */
	storage?: Storage;
	/** Where the `storage` event fires: `window` by default. */
	events?: EventTarget;
	compactAt?: number;
}

export function localLog(opts: LocalLogOpts): SessionLog {
	const storage = opts.storage ?? globalThis.localStorage;
	const events = opts.events ?? globalThis;
	const prefix = `qm-collab:${encodeURIComponent(opts.room)}:`;
	const key = {
		open: `${prefix}open`,
		saved: `${prefix}saved`,
		touched: `${prefix}touched`,
		log: (epoch: string) => `${prefix}log:${epoch}:`,
		count: (epoch: string) => `${prefix}count:${epoch}`,
		once: (epoch: string, k: string) => `${prefix}key:${epoch}:${encodeURIComponent(k)}`
	};
	const writer = randomId();
	let n = 0;
	const keysUnder = (head: string): string[] => {
		const out: string[] = [];
		for (let i = 0; i < storage.length; i++) {
			const k = storage.key(i);
			if (k?.startsWith(head)) out.push(k);
		}
		return out;
	};
	const entries = (epoch: string) => keysUnder(key.log(epoch));
	const count = (epoch: string) => Number(storage.getItem(key.count(epoch)) ?? 0);
	const current = (): Opened | undefined => {
		const raw = storage.getItem(key.open);
		if (!raw) return undefined;
		const { epoch, seed } = JSON.parse(raw) as Record<string, string>;
		return { epoch, seed: fromBase64(seed) };
	};
	const isOpen = (epoch: string) => current()?.epoch === epoch;
	const load = (): Saved | undefined => {
		const raw = storage.getItem(key.saved);
		if (!raw) return undefined;
		const { epoch, stored, version } = JSON.parse(raw) as Record<string, string>;
		return { epoch, stored, version: fromBase64(version) };
	};
	const write = (epoch: string, from: number, to: number, update: Uint8Array) =>
		storage.setItem(`${key.log(epoch)}${writer}:${n++}`, `${from}-${to} ${toBase64(update)}`);
	/** Every entry of `epoch` still stored: its range and update. A key listed and then gone,
	 *  merged away by another tab, has the whole listing read again. */
	const stored = (
		epoch: string
	): { key: string; from: number; to: number; update: Uint8Array }[] => {
		for (;;) {
			const out = [];
			let vanished = false;
			for (const k of entries(epoch)) {
				const v = storage.getItem(k);
				if (v === null) {
					vanished = true;
					break;
				}
				const [range, data] = v.split(' ');
				const [from, to] = range.split('-').map(Number);
				out.push({ key: k, from, to, update: fromBase64(data) });
			}
			if (!vanished) return out;
		}
	};
	const touch = () => storage.setItem(key.touched, String(Date.now()));

	return {
		current: async () => current(),
		async open(seed) {
			const held = current();
			if (held) return held;
			storage.setItem(key.open, JSON.stringify({ epoch: randomId(), seed: toBase64(seed) }));
			touch();
			return current()!;
		},
		async end(epoch) {
			if (!isOpen(epoch)) return;
			storage.removeItem(key.open);
			storage.removeItem(key.count(epoch));
			for (const k of [...entries(epoch), ...keysUnder(key.once(epoch, ''))]) storage.removeItem(k);
		},
		async append(epoch, update, append = {}) {
			if (!isOpen(epoch)) return 'closed';
			if (append.key !== undefined && storage.getItem(key.once(epoch, append.key)) !== null)
				return 'duplicate';
			const at = count(epoch) + 1;
			if (append.after !== undefined && append.after !== at - 1) return 'moved';
			write(epoch, at, at, update);
			storage.setItem(key.count(epoch), String(at));
			if (append.key !== undefined) storage.setItem(key.once(epoch, append.key), String(at));
			touch();
			const all = stored(epoch);
			if (all.length > (opts.compactAt ?? 100)) {
				const from = Math.min(...all.map((e) => e.from));
				const to = Math.max(...all.map((e) => e.to));
				write(epoch, from, to, Y.mergeUpdates(all.map((e) => e.update)));
				for (const e of all) storage.removeItem(e.key);
			}
			return 'appended';
		},
		async touch(epoch) {
			if (isOpen(epoch)) touch();
		},
		async since(epoch, cursor) {
			const seen = cursor instanceof Set ? (cursor as Set<string>) : new Set<string>();
			if (!isOpen(epoch)) return undefined;
			const all = stored(epoch);
			return {
				updates: all.filter((e) => !seen.has(e.key)).map((e) => e.update),
				cursor: new Set(all.map((e) => e.key)),
				count: count(epoch),
				touched: Number(storage.getItem(key.touched) ?? 0)
			};
		},
		async upTo(epoch, upTo) {
			if (!isOpen(epoch)) return undefined;
			const all = stored(epoch);
			if (all.some((e) => e.from <= upTo && e.to > upTo)) return undefined;
			return all.filter((e) => e.to <= upTo).map((e) => e.update);
		},
		subscribe(onChange) {
			const fn = (e: Event) => {
				const k = (e as StorageEvent).key;
				if (k === null || k === undefined || k.startsWith(prefix)) onChange();
			};
			events.addEventListener('storage', fn);
			return () => events.removeEventListener('storage', fn);
		},
		load: async () => load(),
		async save(saved: Saved) {
			const held = load();
			if (held) {
				if (!isOpen(saved.epoch)) return false;
				if (
					held.epoch === saved.epoch &&
					(!covers(saved.version, held.version) || covers(held.version, saved.version))
				)
					return false;
			}
			storage.setItem(
				key.saved,
				JSON.stringify({
					epoch: saved.epoch,
					stored: saved.stored,
					version: toBase64(saved.version)
				})
			);
			return true;
		}
	};
}

function randomId(): string {
	return Math.random().toString(36).slice(2, 10);
}

function toBase64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

function fromBase64(text: string): Uint8Array {
	const s = atob(text);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}
