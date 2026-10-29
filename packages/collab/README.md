# @quillmark/collab

Live editing for Quillmark documents. Each client keeps its own WASM `Document`; this package keeps it equal to a shared [Yjs](https://yjs.dev) state, and carries that state between clients as a log of updates. The saved Document stays the record: a session is one stretch of live editing over it.

```sh
npm install @quillmark/collab yjs @quillmark/wasm
```

## A session

```ts
import { joinSession, localLog } from '@quillmark/collab';

const session = await joinSession({
	log: localLog({ room: 'memo-42' }),
	quill,
	initial: () => quill.exampleDocument()!,
	onRemote(change) {
		editor.applyCardOps(change.cards);
		if (change.fields.length) editor.refresh();
		for (const { addr, delta } of change.content)
			editor.applyExternal(session.doc.pathFor(addr), delta);
	},
	onEnded: () => location.reload()
});
```

Mount the editor over `session.doc`, and push each local edit after it commits:

```svelte
<VisualEditor
	bind:this={editor}
	doc={session.doc}
	{quill}
	onChange={(change) => {
		for (const addr of session.push(change.op)) editor.applyExternal(session.doc.pathFor(addr));
	}}
/>
```

`push` takes the card operation the edit was, which `EditorChange.op` carries for an add, a move and a removal, and returns the fields whose new islands took a minted id. `onRemote` hears what another client's edit moved in `session.doc`: card-list operations by index, cards whose kind, title or values changed, and text and content fields, a revised one with the text delta from its previous text. `session.save()` saves at once, and `session.leave()` saves and stops.

`localLog` keeps the room in `localStorage`, so every tab of one origin shares it and a reload rejoins. A server keeps the same `SessionLog` protocol: `epoch`, `end`, `append`, `since`, `subscribe`, `load` and `save`.

## Without a session

`bindDocument({ doc, quill, ydoc, onRemote })` binds a Document to any `Y.Doc` and leaves the transport to the host. `seedDocument(doc, quill)` is the update a Y state starts from, the same bytes on every client that seeds the same Document.

The design, its invariants and its pitfalls: [`prose/canon/COLLAB.md`](prose/canon/COLLAB.md).
