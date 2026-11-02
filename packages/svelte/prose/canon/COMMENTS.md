# Comments

> **Implementation**: `src/lib/core/comments/` (the model, the store seam, the controller) · `src/lib/core/codec/field.ts` (`onAnchorsDropped`) · `src/lib/visual/comments.ts` (the editor's channel to the controller)

## TL;DR

A comment is a thread the host stores, joined to the document by one anchor over the text it discusses. The anchor contract is quillmark's (quillmark `prose/canon/COMMENTS.md`): the document holds the anchor and nothing else, every write names the anchors it dropped with their selectors as read before it, and `doc.reattach` places a dropped anchor again where its quote is found exactly once. This package adds the thread model, the store a host implements, and the one flow that answers a drop. It lives in `/core` so a host with no editor runs the same flow the editor does.

## The model

**A thread's id is its anchor's id.** `newThreadId()` mints `c-` and a UUID, the namespaced mint the anchor contract asks for. Nothing parses one, and a host may mint its own.

**Two axes, kept apart.** `status` (`open` / `resolved`) is what people decided, and the store keeps it. `anchored` is whether this client's document holds the anchor now: derived against the live document by `sync` and after every reconcile, never read from a store, since another collab client's anchors are not in this client's document. A thread's `selector` is its last known place, an `AnchorContext` less its id, and its `cardId` lets `reattach` follow a card wherever it moved.

**The store is the host's.** `CommentStore` is async so a network store fits, and the controller keeps a synchronous index the UI reads: a verb lands in the index first and reverts it when the store refuses. `MemoryCommentStore` is the store a host with no database runs on, its `{version: 1, threads}` export the envelope a persisting store writes. A message body is plain text.

## Reconcile

**A drop is answered once: placed again, or the thread is deleted with its text.** `reconcile(doc, dropped, deltas?)` takes the selectors a write dropped, passes the ones a thread holds to `doc.reattach` (every one, before the store's first list lands, since none can yet be told a stray), stores each placed thread's new selector, and deletes each thread `reattach` could not place. The document is written before the first await, so a caller that re-reads after the call sees the placed anchors.

**Only a drop deletes; an absence never does.** A thread whose anchor is missing without a write having dropped it (another collab client's thread, a document reopened from markdown, a card removed) stays, unanchored, and `recover` runs `reattach` over every stored selector for a host that opened from markdown. Deleting there would let opening a document erase other people's threads.

**Every writer reaches the flow with what it already holds.** A `Receipt` (`apply`, `replace`, `revise`) carries full selectors in `droppedAnchors`. A writer's `Revised` and `DocumentRevised` name drops by id alone, so the caller reads `doc.anchorContexts()` before the write and `droppedSelectors` joins the two; `reviseDocument` does that around `writer.reviseDocument`. A prose leaf reports through `onAnchorsDropped`, and a collab pull through `RemoteChange.content[i].droppedAnchors`.

**A leaf's drop is a range whose text an edit deleted.** The leaf lowers its edit by diff, and an anchor the diff removes is a step, not a drop, so `onAnchorsDropped` names the anchors the commit's old content held and its new one does not, other than those `removeAnchor` took out, read before the write, joined with the receipt's own drops. After the hook the leaf re-reads the field, so an anchor the flow placed again draws. A table cell's anchors are carried by the cell's own edit and reported by no leaf. `DocumentRevised` names no cell anchor either, so a cell's thread a whole-document revise drops is left unanchored rather than deleted.

**Drift is shown, not fixed.** A surviving anchor whose quote differs from the stored one is in `drifted` until the next `refresh`, which stores the live selector of every anchored thread for a save. A point never overwrites a stored quote.

## In the editor

`<VisualEditor comments={…}>` publishes the controller to the mounted tree. A prose leaf hands its drops to `comments.reconcile`, and a mount and every edit call `comments.sync`, so `anchored` and `drifted` follow each keystroke, and the editor draws nothing for a thread yet.

## Not owned here

- The anchor contract, the selector and the matching rule: quillmark `prose/canon/COMMENTS.md`.
- What a host persists and the never-reopen-from-markdown rule: [HOSTING.md](HOSTING.md) §Comments.
- How an anchor rides a leaf's edits: [CODEC.md](CODEC.md) §Seams.
