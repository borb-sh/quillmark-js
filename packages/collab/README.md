# @quillmark/collab

Live editing for Quillmark documents. Each client keeps its own WASM `Document`; this package keeps it equal to a shared [Yjs](https://yjs.dev) state, and carries that state between clients as a log of updates. The saved Document stays the record: a session is one stretch of live editing over it.

Quillmark is pre-1.0. Its [stability statement](https://github.com/borb-sh/quillmark#status) says what any release can change and what every release keeps.

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

The invariants, the reasons behind them and the host rules: [`prose/INVARIANTS.md`](prose/INVARIANTS.md).
