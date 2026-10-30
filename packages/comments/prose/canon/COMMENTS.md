# Comments

> **Implementation**: `src/`

## TL;DR

A comment thread is a conversation about a run of a document's text. The document holds the run, as an identity anchor the core carries through every edit; the thread holds everything else, in a store the host owns, keyed by the anchor's id. The two meet through a selector, a W3C `TextQuoteSelector` at a `DocPath`, which is what a thread keeps of its run when the anchor is gone and what places the anchor again. Every markdown write runs one flow: read the contexts before, write, hand what the receipt says was dropped to `reattach`, and record what came back. Nothing here renders into an artifact; a comment is never in the document's payload.

## The thread

A `CommentThread` is plain data: `id`, `status` (`open` or `resolved`), `selector`, `messages` (each with an `author`, a `body`, `createdAt` and an optional `editedAt`), `createdAt`, `updatedAt`, and `anchored`. The id is the anchor's id, minted by the client that placed it (`newThreadId`, a UUID), so a thread names its anchor and nothing joins the two.

`anchored` is derived, never trusted. It says whether the document the thread was last synced against holds an anchor with its id, and a store that persists it is persisting a fact about one client's document at one moment. The controller recomputes it on every `sync`, every `reconcile` and every `recover`, and overlays it on every list the store hands back.

The selector is the W3C `TextQuoteSelector` plus the path: `{ path, quote, prefix, suffix }`, as the core's `AnchorContext` reports it, with the quote keeping its `U+FFFC` island slots. A point anchor has an empty quote. A collapsed anchor, one whose run was deleted from under it, keeps the last non-empty quote it had: a selector is never refreshed to empty, because an empty quote places nothing and the last one is the best chance of finding the run again.

## The store

`CommentStore` is the shape a host's persistence takes: `list`, `create(thread)`, `reply(id, message)`, `setStatus`, `setSelector`, `remove`, and an optional `subscribe` for a store several clients write. Every write names one thread and one field, so a store over a database writes a row and not a document. `MemoryCommentStore` is the one a host with no database runs on, the playground and a test among them; its `export()` is a versioned envelope a host can write beside the document, and `MemoryCommentStore.import` refuses any other shape.

## The controller

`createComments({ store, author, onError?, now? })` is what a host or the editor holds. It keeps a synchronous index the UI reads (`threads`, `thread(id)`, `drifted`, `subscribe`) and writes through the store optimistically: a verb lands in the index at once and reverts, rethrowing, where the store refuses. `create(context, body)` takes the `AnchorContext` of an anchor the caller has just placed, so the thread is born attached; `remove(id)` deletes the thread and leaves the anchor to the caller, whose editor verb drops both. `setAnchored(id, anchored, selector?)` is a re-anchor over a fresh selection.

`sync(doc)` derives `anchored` and drift against the live document and writes nothing: what runs after a structure op, on open, and after any path that produced no receipt. Drift is a surviving anchor whose live quote is non-empty and differs from the stored one; `refresh(doc)` stores the live selector of every drifted thread, which a host calls before a save.

## The reconcile flow

Every markdown write of a document holding threads runs this flow, and `reviseDocument(doc, writer, markdown)` is it in one call:

1. `before = doc.anchorContexts()`, read ahead of the write.
2. The write, through `revise`, `reviseContent`, or the writer's `reviseBody`, `reviseField` or `reviseDocument`. The core relocates every anchor whose quote survives, so a receipt's `droppedAnchors` names only the anchors whose run the write rewrote.
3. For each dropped id with a thread: its selector from `before`, with the card index remapped through a `DocumentRevised.from` where the receipt is one (`remapPath`), which orphans a thread on a card the write removed.
4. `doc.reattach(selectors, deltas?)`, with the write's text delta keyed by the path it revised where the rung has one, so a quote the write inserted elsewhere is still found.
5. Each reattached thread is stored `anchored` with its refreshed selector; each orphaned one keeps its selector and status, unanchored.
6. `sync`, so `anchored` and drift stand against the document as written.

A dropped id with no thread is a stray the flow leaves alone. A collab `RemoteChange.content[i]` carries `droppedAnchors` as the contexts read before the pull, so a host passes them as `before` and as the receipt in one call.

## The hosting rule

A host holding threads never reopens a document from markdown while it holds the live one: the reopen drops every anchor, and the selectors are the only way back. The host persists a `StoredDocument` beside the threads, or revises the live document through the flow above. `recover(doc)` is the migration for a document that was reopened from markdown anyway: `reattach` over every stored selector, each thread landing where its quote and context are found once.

## Not owned

- The anchor, its relocation through an edit, `reattach` and the receipts: the core's (`quillmark`, ANCHORS.md).
- The editor's comment button, the highlights, the seat a panel reads and the verbs over a thread: [VISUAL_EDITOR.md](../../../svelte/prose/canon/VISUAL_EDITOR.md) §Comments.
- Where a host persists the threads, and when it refreshes them: [HOSTING.md](../../../svelte/prose/canon/HOSTING.md) §Comments.
- Table cells: a cell is outside the field's coordinate space, and no anchor is placed in one.
