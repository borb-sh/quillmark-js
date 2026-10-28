// `?collab=<room>`: the body shared live between every tab of this browser open on the same room.
//
// The transport is a `BroadcastChannel`: a tab joining says hello, every tab answers with its
// whole Y state, and from then on each Y update is posted as it happens. Each tab seeds the body
// with the same deterministic update (`seedUpdate`), so tabs opened on one quill's example start
// from one copy rather than two.
import type { Content, Document } from '@quillmark/wasm';
import * as Y from 'yjs';
import { bindField, seedUpdate } from '@quillmark/collab';

export interface Room {
	/** After a local commit: write it to the room. Whether the document changed in turn. */
	push(): boolean;
	close(): void;
}

export function joinRoom(doc: Document, room: string, onRemote: () => void): Room {
	const ydoc = new Y.Doc();
	const channel = new BroadcastChannel(`qm-collab:${room}`);
	Y.applyUpdate(ydoc, seedUpdate(doc.getStored({}) as Content), channel);
	const binding = bindField({ doc, ydoc, onRemote });

	ydoc.on('update', (update: Uint8Array, origin: unknown) => {
		if (origin !== channel) channel.postMessage(update);
	});
	channel.onmessage = (event: MessageEvent<Uint8Array | 'hello'>) => {
		if (event.data === 'hello') channel.postMessage(Y.encodeStateAsUpdate(ydoc));
		else Y.applyUpdate(ydoc, event.data, channel);
	};
	channel.postMessage('hello');

	return {
		push: () => binding.push(),
		close() {
			binding.destroy();
			channel.close();
			ydoc.destroy();
		}
	};
}
