// The fixture quills, and peers: Documents each bound to their own Y.Doc, wired so every update
// one makes lands in the others' inboxes, delivered only when a test says.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { init, type Document, type Quill } from '@quillmark/wasm';
import {
	bindDocument,
	seedDocument,
	type DocumentBinding,
	type RemoteChange
} from '../src/index.js';
import { canonical } from '../src/document.js';

export const core = await init();

const FIXTURES = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
	'..',
	'fixtures',
	'quills'
);
const ROOTS = { showcase: 'showcase/1.0.0', usaf_memo: 'usaf_memo/0.0.0' } as const;
export type FixtureName = keyof typeof ROOTS;

const quills = new Map<FixtureName, Quill>();
export function quill(name: FixtureName = 'showcase'): Quill {
	let held = quills.get(name);
	if (held) return held;
	const root = join(FIXTURES, ROOTS[name]);
	const tree = new Map<string, Uint8Array>();
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			const abs = join(dir, entry);
			if (statSync(abs).isDirectory()) walk(abs);
			else tree.set(relative(root, abs).split(sep).join('/'), new Uint8Array(readFileSync(abs)));
		}
	};
	walk(root);
	held = core.Quill.fromTree(tree);
	quills.set(name, held);
	return held;
}

export interface Peer {
	doc: Document;
	ydoc: Y.Doc;
	binding: DocumentBinding;
	inbox: Uint8Array[];
	changes: RemoteChange[];
	errors: unknown[];
}

/** `n` peers over one starting Document, each joining from the same seed. */
export function peers(n: number, start: () => Document, q: Quill = quill()): Peer[] {
	const seed = seedDocument(start(), q);
	const all: Peer[] = [];
	for (let i = 0; i < n; i++) {
		const ydoc = new Y.Doc();
		ydoc.clientID = i + 1;
		Y.applyUpdate(ydoc, seed, 'net');
		const doc = start();
		const peer = { doc, ydoc, inbox: [], changes: [], errors: [] } as unknown as Peer;
		peer.binding = bindDocument({
			doc,
			quill: q,
			ydoc,
			onRemote: (c) => peer.changes.push(c),
			onError: (e) => peer.errors.push(e)
		});
		ydoc.on('update', (update: Uint8Array, origin: unknown) => {
			if (origin === 'net') return;
			for (const other of all) if (other !== peer) other.inbox.push(update);
		});
		all.push(peer);
	}
	return all;
}

/** Deliver up to `max` of `peer`'s pending updates, in the order `pick` chooses. */
export function deliver(peer: Peer, pick: (n: number) => number = () => 0, max = Infinity): void {
	for (let k = 0; k < max && peer.inbox.length; k++) {
		const [update] = peer.inbox.splice(pick(peer.inbox.length), 1);
		Y.applyUpdate(peer.ydoc, update, 'net');
	}
}

/** Deliver everything, including what delivering makes. */
export function settle(all: Peer[]): void {
	for (let round = 0; round < 20 && all.some((p) => p.inbox.length); round++)
		for (const p of all) deliver(p);
}

/** The Document as a comparable value: its cards in order, each card's fields by name. */
export function snapshot(doc: Document): string {
	const card = (c: ReturnType<Document['card']>) => ({
		kind: c.kind,
		title: (c.ext?.editor as { title?: string } | undefined)?.title,
		fields: Object.fromEntries(
			c.payloadItems.flatMap((i) => (i.type === 'field' ? [[i.key, i.value]] : []))
		),
		body: c.body
	});
	return canonical({ main: card(doc.main), cards: doc.cards.map(card) });
}

export { canonical };
