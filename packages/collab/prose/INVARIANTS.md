# @quillmark/collab invariants

The rules a change to `@quillmark/collab` must keep, the reason behind each, and the designs already weighed and rejected. The binding, the session protocol and writes from a revision are walked through in the [README](../README.md) and documented in tsdoc; the Y shape is `src/shape.ts` and the `SessionLog` contract `src/session.ts`. A rule belongs here only if a capable reader of the code would plausibly break it, and a change that breaks one updates this page in the same commit, with the new reason.

## The model

Each client keeps its own WASM `Document`, and `bindDocument` keeps it equal to a shared Yjs state in both directions. A session is one stretch of live editing over the saved Document, carried by a log of Y updates. The saved Document (`doc.toStored()`) stays the record; the Y state lasts one session.

**Every merge is this package's.** Quillmark core is single-writer and refuses a write whose base has moved (`edit::stale_base`), so concurrent writers merge here, in Y, and the Document takes the merged value through `replace`. Rejected: a merge in core, which would need a history core does not keep.

**A write from a revision is written whole, or reported where it meets a change.** `writeFrom` holds nothing back: what it writes, it writes in one update, and where that meets a change made since it lists the change in `conflicts` for the host to answer. Rejected: holding back each part that meets a change for the host to write on request, a second rebase beside the editor's own, which carries an assistant's proposal through the reader's typing and has the reader answer it a paragraph at a time (svelte/INVARIANTS §"A proposal is an edit of the paragraph as its writer read it").

**The package knows nothing of the editor.** The host wires `onRemote` to the editor's host verbs (svelte/INVARIANTS §"A host that changes the document says so").

## Invariants

- **I1** Within a session the Y state is the truth. A Document's synced content is `project(y)`, a pure function, so two clients holding one Y state hold one Document. Two valid edits can merge into a state no single edit makes; the projection reads it through the store's `repair`, which is total and deterministic. A repair that inserts is written back only by the session's leader.
- **I2** A local commit is written to Y as the fewest operations that make Y project to the Document's value (`write.ts`), never as a whole-value replace. A write from a revision is written as the fewest that replace whole words.
- **I3** Identity lives in Y, positions are derived. Blocks, containers and islands carry their content ids; an item's number is computed, so two clients inserting into one list never fight over a number.
- **I4** An island slot the edit kept is never deleted and re-inserted. Ids two clients mint at once are told apart by `repair`, the first in text order keeping the id.
- **I5** A session has one seed, stored with its epoch when it opens, and every client starts from it. The seed is written by client id 0 with ids minted from it, so the same Document seeds the same bytes.
- **I6** After every transaction the projection of each content root equals the Document's value for that field.
- **I7** Updates from two sessions never meet: every log entry belongs to one epoch, and a client applies only entries of the epoch it joined.
- **I8** Seeding a Document and projecting it back is lossless for everything that has a Y form.
- **I9** A write from a revision is made on the Y state at that revision and merged as a concurrent edit, never applied to the live Document, so what anyone wrote since stays.

## The Y form

**What has no Y form is carried by the saved Document alone**: anchors, the rest of `$ext`, `$seed` overlays, payload comments and `x-` marks. Anchors survive remote changes because `replace` carries them. A field type that gains a Y form needs a round-trip test (I8).

**An island slot is an embedded `Y.Map`**, so edits to two cells of one table both land.

**A card's Y id lasts one session; its `$id` is synced.** Two clients that place a card at once mint one `$id` for two cards, and every client gives the first the claim and re-keys the second.

**A card operation is passed to `push`, never inferred.** A diff of the card list cannot tell a move from a remove and an insert, nor an insert from an append.

**The writer diffs one field at a time, by structure.** Kept island ids are fixed points; between them, whole lines both sides hold are kept by longest common subsequence, and each run that differs is one splice over its common prefix and suffix, so what someone typed meanwhile stays on its line. The writer derives ops from the value, not the edit, so an insertion that reads the same at two places can land at the wrong one under a concurrent edit. A write from a revision splits by words instead, so a replaced word leaves no letter behind for a concurrent edit to land beside.

**A refusal reverts nobody.** A remote value the Document refuses leaves its field held, and pushes write nothing there. A refused card-list change stops the binding (`Diverged`), since every later change would build on a list the Document does not hold.

## Sessions

**An epoch holds one seed.** A session opens with its seed and quill reference in one write, and a client on another version of the quill is refused (`QuillMismatch`).

**An update that never reaches the log ends the session** (`onEnded(lost)`), since every later update builds on it. Appends are retried freely, because applying an update twice changes nothing.

**A save covers or is dropped.** A store keeps a save only when it covers the held one, so a stale tab never overwrites a newer save, and a client holding a remote value its Document refused does not save.

**Ending is decided by the lease and the save, never by a disconnect**, which a stateless store cannot see.

**History belongs to the saved Document, not a session.** A named version is kept past every epoch; a checkpoint keeps garbage collection off so a snapshot alone rebuilds its state.

**A server store holds what a browser cannot be trusted to.** It sets an entry's `author` from the caller's identity, refuses appends from readers, bounds update size and refuses client id 0, with the append, its epoch check, count and key in one transaction. `checkServerStore` (`@quillmark/collab/conformance`) checks a store against the protocol. `localLog` has no transactions, so two tabs opening at once each write a session and the later stands.

## Host rules

- A write to the saved Document while a session is open is overwritten by the session's next save. Route it through the session, or end the session first.
- Anything with no Y form survives a session only through the saved Document, which is one client's: another client's anchors are not in it.
- A change of quill reference is not a field edit. The host ends the session and every client rejoins.
- `push` reads every card, so its cost grows with the document; debounce it for large documents.
- A whole-value field is written whole: two people editing different rows of an array of records keep one row's edit.
- A write applied over a conflict merges two rewrites into neither. Apply a write from a revision only when its `conflicts` is empty.
- The host owns `session.doc` and frees it after `leave`.

## Testing

A seeded fuzz runs several peers over the reference quill through random concurrent edits and random delivery, some from an earlier revision, and asserts convergence to one Document and I6. The editor half is checked in the playground under `?collab=`.
