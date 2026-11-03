// Peers over the live-document surface: Documents that each hold one value's Automerge document,
// a SyncState per ordered pair, and messages that travel only when a test says.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	init,
	type Addr,
	type Change,
	type Content,
	type Document,
	type Quill,
	type Receipt,
	type SyncState
} from '@quillmark/wasm';

export const core = await init();
export const { Document: Doc } = core;

const SHOWCASE = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
	'..',
	'fixtures',
	'quills',
	'showcase',
	'1.0.0'
);

let held: Quill | undefined;
export function quill(): Quill {
	if (held) return held;
	const tree = new Map<string, Uint8Array>();
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			const abs = join(dir, entry);
			if (statSync(abs).isDirectory()) walk(abs);
			else
				tree.set(relative(SHOWCASE, abs).split(sep).join('/'), new Uint8Array(readFileSync(abs)));
		}
	};
	walk(SHOWCASE);
	held = core.Quill.fromTree(tree);
	return held;
}

export const BODY: Addr = {};
export const ABSTRACT: Addr = { field: 'abstract' };

/** A showcase document whose body is `body` and whose `abstract` is `abstract`, bound-parsed so
 *  every content field is in its stored form. */
export function docMd(body: string, abstract = 'Alpha beta gamma.', cards = ''): string {
	return `~~~\n$quill: showcase@1.0\n$kind: main\ntitle: T\nabstract: ${JSON.stringify(abstract)}\n~~~\n\n${body}\n${cards}`;
}

export function parse(md: string): Document {
	return quill().parse(md);
}

export interface Peer {
	name: string;
	doc: Document;
	actor: string | undefined;
	/** What this peer knows each other peer holds, per address key. */
	states: Map<string, SyncState>;
	receipts: Receipt[];
	errors: unknown[];
}

const key = (addr: Addr) => `${addr.card ?? ''}/${addr.field ?? ''}`;

/** `n` peers, each from `start()`, each writing under `actor-<i>` unless `actors` says otherwise. */
export function peers(
	n: number,
	start: () => Document,
	actors: (string | undefined)[] = Array.from({ length: n }, (_, i) => `peer${i}`)
): Peer[] {
	return Array.from({ length: n }, (_, i) => ({
		name: `p${i}`,
		doc: start(),
		actor: actors[i],
		states: new Map(),
		receipts: [],
		errors: []
	}));
}

function state(p: Peer, other: Peer, addr: Addr): SyncState {
	const k = `${other.name}|${key(addr)}`;
	let s = p.states.get(k);
	if (!s) p.states.set(k, (s = Doc.syncState()));
	return s;
}

/** One message from `from` to `to` at `addr`, if `from` has one. Answers whether one travelled. */
export function step(from: Peer, to: Peer, addr: Addr): boolean {
	const m = from.doc.generateSyncMessage(addr, state(from, to, addr));
	if (!m) return false;
	to.receipts.push(to.doc.receiveSyncMessage(addr, state(to, from, addr), m));
	return true;
}

/** Sync every pair at `addr` until no peer has a message. Answers the messages sent. */
export function settle(all: Peer[], addr: Addr, max = 1000): number {
	let sent = 0;
	for (let round = 0; round < max; round++) {
		let any = false;
		for (const a of all)
			for (const b of all) if (a !== b && step(a, b, addr)) ((any = true), sent++);
		if (!any) return sent;
	}
	throw new Error(`no quiescence after ${max} rounds`);
}

/** A local edit through `apply`, base the value's hash now and the peer's actor. */
export function write(p: Peer, addr: Addr, change: Change): Receipt {
	const base = p.doc.hash(addr);
	const r = p.doc.apply(addr, change, { base, ...(p.actor ? { actor: p.actor } : {}) });
	p.receipts.push(r);
	return r;
}

/** Insert `text` at `at` (UTF-16) as one splice, no `\n` in it. */
export function typeAt(p: Peer, addr: Addr, at: number, text: string): Receipt {
	return write(p, addr, { steps: [{ splice: { at, insert: text } }] });
}

/** Delete `[from, to)` as one splice. */
export function deleteAt(p: Peer, addr: Addr, from: number, to: number): Receipt {
	const t = p.doc.read(addr).text;
	return write(p, addr, {
		steps: [{ splice: { at: from, delete: t.slice(from, to), insert: '' } }]
	});
}

/** Rewrite the text between `from` and `to` of the value now with `after`, lowered by
 *  `diffRange` as an editor's ReplaceStep is. */
export function rewrite(p: Peer, addr: Addr, after: Content, from: number, to: number): Receipt {
	const before = p.doc.read(addr);
	return write(p, addr, core.diffRange(before, after, { from, to }));
}

/** Every peer holds one document, and each value at `addrs` validates: it reads, and `normalize`
 *  is the identity on it. */
export function converged(all: Peer[], addrs: Addr[]): { stored: string; values: Content[] } {
	const stored = all[0].doc.toStored();
	for (const p of all.slice(1))
		if (p.doc.toStored() !== stored) throw new Error(`${p.name} diverged`);
	const values = addrs.map((a) => {
		const c = all[0].doc.read(a);
		const n = core.normalize(c);
		if (JSON.stringify(n) !== JSON.stringify(c)) throw new Error(`not canonical at ${key(a)}`);
		return c;
	});
	return { stored, values };
}

/** The diagnostic code a throw carries. */
export function code(f: () => unknown): string | undefined {
	try {
		f();
	} catch (e) {
		const d = (e as { diagnostics?: { code?: string }[] }).diagnostics;
		return d?.[0]?.code ?? `untyped: ${(e as Error).message}`;
	}
	return undefined;
}
