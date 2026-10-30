# @quillmark/comments

Comment threads over a Quillmark document. The document carries each thread's run of text as an anchor the core keeps through every edit; this package holds the threads in a store you own, keyed by the anchor's id, and keeps the two attached through every write.

```sh
npm install @quillmark/comments @quillmark/wasm
```

## A controller over a store

```ts
import { createComments, MemoryCommentStore } from '@quillmark/comments';

const comments = createComments({
	store: new MemoryCommentStore(),
	author: { id: 'u1', name: 'Nibs' }
});
await comments.ready;
```

`MemoryCommentStore` is the store for a host with no database; `CommentStore` is the shape yours takes: `list`, `create`, `reply`, `setStatus`, `setSelector`, `remove`, and `subscribe` where several clients write it. Every write names one thread and one field.

## With the editor

Hand the controller to `VisualEditor` and mount the panel over the editor's seat:

```svelte
<VisualEditor bind:this={editor} {doc} {quill} {comments} />
<CommentPanel seat={editor.commentSeat()} />
```

The popover offers a Comment button over a selection; the panel holds the threads, the draft, replies, status and the verbs over a thread. The editor keeps `anchored` in step with its edits and draws every open thread's anchor.

## Writes from outside the editor

A markdown write runs the reconcile flow, which re-places each anchor the write dropped by its quote and context:

```ts
const revised = await comments.reviseDocument(doc, quill.writer(doc), markdown);
revised.orphaned; // threads whose run the write took away
```

Call `comments.sync(doc)` after a structure change and `comments.refresh(doc)` before a save. A host holding threads keeps the live document or a `StoredDocument` and never reopens from markdown; `comments.recover(doc)` is the migration for one that did.

The settled design is [`prose/canon/COMMENTS.md`](prose/canon/COMMENTS.md).
