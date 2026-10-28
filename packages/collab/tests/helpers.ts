import * as Y from 'yjs';
import { init, type Content, type Document } from '@quillmark/wasm';
import {
	bindField,
	readField,
	fieldTypes,
	project,
	seedUpdate,
	type FieldBinding
} from '../src/index.js';

const core = await init();

export const markdown = (body: string): string => `~~~\n$quill: collab@1.0\n~~~\n\n${body}`;

export interface Peer {
	doc: Document;
	ydoc: Y.Doc;
	binding: FieldBinding;
	inbox: Uint8Array[];
	remotes: number;
}

/** `n` peers over one starting body, each seeded with the same update and wired so every update
 *  one of them makes lands in the others' inboxes, delivered only when a test says. */
export function peers(n: number, body: string): Peer[] {
	const seed = seedUpdate(core.Document.fromMarkdown(markdown(body)).getStored({}) as Content);
	const all: Peer[] = [];
	for (let i = 0; i < n; i++) {
		const ydoc = new Y.Doc();
		ydoc.clientID = i + 1;
		Y.applyUpdate(ydoc, seed, 'net');
		const doc = core.Document.fromMarkdown(markdown(body));
		const peer: Peer = { doc, ydoc, inbox: [], remotes: 0 } as unknown as Peer;
		peer.binding = bindField({ doc, ydoc, onRemote: () => peer.remotes++ });
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

/** Deliver everything, including what delivering makes (a repair writes back). */
export function settle(all: Peer[]): void {
	for (let round = 0; round < 20 && all.some((p) => p.inbox.length); round++)
		for (const p of all) deliver(p);
}

export const body = (peer: Peer): Content => peer.doc.getStored({}) as Content;

/** The text the peer's Y state holds for the field. */
export const yText = (peer: Peer): string =>
	project(readField(fieldTypes(peer.ydoc, 'main.body'))).content.text;

/** Apply a bundle locally the way the editor commits: `applyChange`, then the binding's push. */
export function edit(peer: Peer, bundle: Parameters<Document['applyChange']>[1]): boolean {
	try {
		peer.doc.applyChange({}, bundle);
	} catch {
		return false;
	}
	peer.binding.push();
	return true;
}

export { core };
