// A `SessionLog` in Web Storage, for every tab of one origin: the playground's database.
//
// The open session is one key, its epoch and its seed written together. Each entry has a key of
// its own, `qm-collab:<room>:log:<epoch>:<writer>:<n>`, written by one tab alone, so tabs need no
// lock to append. The `storage` event, which fires in every other tab of the origin, is the
// wake-up. Once an epoch passes `compactAt` entries, the appending tab merges them into one entry,
// writing it before deleting the keys it merged, and a reader that finds a key it listed gone
// lists again. Web Storage has no transactions: two tabs opening a session at once each write
// one, the later write stands, and the other tab's session ends at its first append.
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
		log: (epoch: string) => `${prefix}log:${epoch}:`
	};
	const writer = randomId();
	let n = 0;
	const entries = (epoch: string): string[] => {
		const out: string[] = [];
		const head = key.log(epoch);
		for (let i = 0; i < storage.length; i++) {
			const k = storage.key(i);
			if (k?.startsWith(head)) out.push(k);
		}
		return out;
	};
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
	const write = (epoch: string, update: Uint8Array) =>
		storage.setItem(`${key.log(epoch)}${writer}:${n++}`, toBase64(update));
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
			for (const k of entries(epoch)) storage.removeItem(k);
		},
		async append(epoch, update) {
			if (!isOpen(epoch)) return false;
			write(epoch, update);
			touch();
			const all = entries(epoch);
			if (all.length > (opts.compactAt ?? 100)) {
				const updates = all.flatMap((k) => {
					const v = storage.getItem(k);
					return v === null ? [] : [fromBase64(v)];
				});
				write(epoch, Y.mergeUpdates(updates));
				for (const k of all) storage.removeItem(k);
			}
			return true;
		},
		async touch(epoch) {
			if (isOpen(epoch)) touch();
		},
		async since(epoch, cursor) {
			const seen = cursor instanceof Set ? (cursor as Set<string>) : new Set<string>();
			for (;;) {
				if (!isOpen(epoch)) return undefined;
				const present = entries(epoch);
				const updates: Uint8Array[] = [];
				let vanished = false;
				for (const k of present) {
					if (seen.has(k)) continue;
					const v = storage.getItem(k);
					if (v === null) vanished = true;
					else updates.push(fromBase64(v));
				}
				if (vanished) continue;
				return {
					updates,
					cursor: new Set(present),
					touched: Number(storage.getItem(key.touched) ?? 0)
				};
			}
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
