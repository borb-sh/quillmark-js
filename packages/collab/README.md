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
	onEnded: (lost) => rejoin(lost)
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

`push` takes the card operation the edit was, which `EditorChange.op` carries for an add, a move and a removal, and returns the fields whose new islands took a minted id. `onRemote` hears what another client's edit moved in `session.doc`: card-list operations by index, cards whose kind, title or values changed, and text and content fields, a revised one with the text delta from its previous text. `onRemote` is first called after `joinSession` returns. `session.save()` saves at once, and `session.leave()` saves and stops; the host frees `session.doc` after it. `onEnded` says the session closed under this client, and whether an edit made here never reached it; a Document under another quill than the one passed is refused with `QuillMismatch`, which names the room's quill.

`localLog` keeps the room in `localStorage`, so every tab of one origin shares it and a reload rejoins. A server keeps the same `SessionLog` protocol: `current`, `open`, `end`, `append`, `touch`, `since`, `upTo`, `subscribe`, `load` and `save`.

## A slow writer

A model answering a request reads the document at one state and answers after people have typed past it. `writeFrom` makes its edit on the state it read, and the update merges with what came after:

```ts
const base = session.snapshot();
// … the model answers, the person accepts …
const { update, conflicts } = writeFrom({
	history: session.ydoc,
	base,
	quill,
	doc: session.doc,
	edit: (doc) => void quill.writer(doc).reviseField('summary', markdown)
});
if (!conflicts.length) session.apply(update, 'ai:run-1');
```

`conflicts` lists what changed since `base` at a place the edit changed too, such as a field someone rewrote meanwhile. Run `writeFrom` and `session.apply` in one task. An edit that inserts, removes or moves a card returns that `CardOp`. A server with no editor open goes through the log: `readLog({ log, quill, since })` returns the Document, its `Revision` (`{ epoch, count }`, short enough to hand a model) and what changed since an earlier one, and `writeLog({ log, quill, base, writer, key, edit })` appends the edit and saves, or answers `conflict`, `stale` or `duplicate`.

## Without a session

`bindDocument({ doc, quill, ydoc, onRemote })` binds a Document to any `Y.Doc` and leaves the transport to the host. `seedDocument(doc, quill)` is the update a Y state starts from, the same bytes on every client that seeds the same Document.

The design, its invariants and its pitfalls: [`prose/canon/COLLAB.md`](prose/canon/COLLAB.md).
