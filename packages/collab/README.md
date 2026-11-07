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

`push` takes the card operation the edit was, which `EditorChange.op` carries for an add, a move and a removal, and returns the fields whose new islands took a minted id. `onRemote` hears what another client's edit moved in `session.doc`: card-list operations by index, cards whose kind, title or values changed, and text and content fields, a revised one with the `Delta` (exported from this package) the Document's text took. `onRemote` is first called after `joinSession` returns. `session.save()` saves at once, and `session.leave()` saves and stops; the host frees `session.doc` after it. `onEnded` says the session closed under this client, and whether an edit made here never reached it; a Document under another quill than the one passed is refused with `QuillMismatch`, which names the room's quill.

`localLog` keeps the room in `localStorage`, so every tab of one origin shares it and a reload rejoins. A server keeps the same `SessionLog` protocol: `current`, `open`, `end`, `append`, `touch`, `since`, `checkpoint`, `checkpoints`, `keepVersion`, `versions`, `subscribe`, `load` and `save`, and leaves `save` out when it saves the log's projection itself. It sets each entry's author from the caller, refuses readers' appends, bounds an update's size and refuses one by client id 0; `since` names the leader it elects from the clients present, which writes back a repair that inserts. `checkServerStore` from `@quillmark/collab/conformance` checks all of it and answers what failed. A failed append is retried (`retry`) before the session ends.

## A slow writer

A model answering a request reads the document at one state and answers after people have typed past it. `writeFrom` makes its edit on the state it read, and the update merges with what came after:

```ts
const base = session.snapshot();
// … the model answers …
const { update, conflicts, held } = writeFrom({
	history: session.ydoc,
	base,
	quill,
	doc: session.doc,
	hold: 'hunk',
	edit: (doc) => {
		quill.writer(doc).revise('summary', summary);
		quill.writer(doc).revise({}, body);
	}
});
if (!conflicts.length) session.apply(update, 'ai:run-1');
// later, for each held part the person accepts:
const at = { history: session.ydoc, quill, doc: session.doc };
if (heldState(part, at).state !== 'gone') session.apply(writeHeld(part, at).update, 'ai:run-1');
```

Edits are compared word by word: a change lands unless someone changed the same words since (`scope: 'line'` compares whole lines). With `hold: 'hunk'`, each line that meets such a change is held back and the rest of the edit is written; `held` lists each held part with its text as the edit read it, as it stood when held, and as the edit wrote it. `heldState` says whether a held part is still `open`, `edited` since, `matched` by what someone typed, or `gone`, and `writeHeld` writes it over whatever its lines hold now, leaving every other line as it is. A whole-value field is held whole, and so is a card one side removed, moved or retyped while the other changed it. A held part is plain JSON a host can keep or send, valid for the session it was made in. With `hold: 'none'`, the default, nothing is held and `conflicts` lists what changed since `base` where the edit changed too. Run `writeFrom` and `session.apply` in one task. An edit that inserts, removes or moves cards returns those `CardOp`s; a `reviseDocument` edit returns `cardOps(receipt.from, count)`, `count` the cards before it. An edit runs a second time when part of it is held, and must make the same change each time it runs. A server with no editor open goes through the log: `readLog({ log, quill, since })` returns the Document, its `Revision` (`{ epoch, count, check }`, short enough to hand a model, and to be handed back as it was read) and what changed since an earlier one, and `writeLog({ log, quill, base, author, key, edit, hold })` appends the edit and saves, answering what it held, or answers `conflict`, `stale` or `duplicate`. `saveVersion({ log, quill, label })` keeps the Document as it stands under a label, past every session; `readVersion` reads it back, and `restoreVersion({ log, quill, label, author })` writes the room back to it as one edit.

## Without a session

`bindDocument({ doc, quill, ydoc, leader, onRemote })` binds a Document to any `Y.Doc` and leaves the transport to the host, once `await init()` from this package has instantiated the core it reads. `leader` is whether this binding writes back a repair that inserts: `true` for a binding alone on its `Y.Doc`, and for exactly one of several. `seedDocument(doc, quill)` is the update a Y state starts from, the same bytes on every client that seeds the same Document.

The invariants, the reasons behind them and the host rules: [`prose/INVARIANTS.md`](prose/INVARIANTS.md).
