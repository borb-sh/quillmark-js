# Collab

## TL;DR

Several clients edit one Quillmark document at once and end holding the same content. Each client keeps its own WASM `Document`, and `bindDocument` keeps it equal to a shared Yjs state in both directions. A session is one stretch of live editing over the saved Document, carried by a log of Y updates that `joinSession` reads and writes through a `SessionLog` the host provides. The saved Document (`doc.toStored()`) stays the record; the Y state lasts one session.

The package knows nothing of the editor: the host wires `onRemote` to the editor's host verbs (VISUAL_EDITOR §Surface). Quillmark core is single-writer and refuses a write whose base has moved (`edit::stale_base`), so every merge of concurrent writers is this package's, in Y, and the Document takes the merged value through `replace`. A writer that answers late, a model above all, writes from the revision it read (`writeFrom`), and its edit merges with whatever was typed since.

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

## The Y shape

| Name | Type | Holds |
| --- | --- | --- |
| `$cards` | `Y.Array<string>` | The composable cards' ids, in order |
| `$session` | `Y.Map` | `quill`, the quill reference the session was seeded under |
| `main`, `<card id>` | `Y.Map` | A card: kind, id, title, each whole-value field, and a marker for each field held in a root |
| `<card>/$body`, `<card>/<field>` | `Y.Text` | A body, or a `richtext` or `text` field |
| `<root>#block0`, `<root>#containers` | `Y.Map` | Block 0's record and codec; the field's container records |

A content root's text is the field's text in UTF-16. An island slot is an embedded `Y.Map`, so edits to two cells of one table both land. Formatting marks are character attributes under the built-in mark keys, so an `x-` mark has no Y form. Each `\n` carries the record of the block it opens.

**Not synced**, and carried by the saved Document alone: anchors, the rest of `$ext`, `$seed` overlays and payload comments. Anchors survive remote changes because `replace` carries them.

A card's Y id lasts one session; its `$id` is synced. Two clients that place a card at once mint one `$id` for two cards, and every client gives the first the claim and re-keys the second.

## The binding

`bindDocument({ doc, quill, ydoc, onRemote, onError })` adopts a Y state that holds a session and projects it into the Document; over an empty Y state it mints ids and writes the Document. A host awaits this package's `init()` first.

- **`push(op?)`** writes the committed Document to Y after a local edit, in one transaction: the card operation the edit was, then every root whose value changed. A card insert, remove or move is passed as `op`, since a diff of the list cannot tell a move from two edits.
- **A remote transaction is pulled whole**: the card list, then kinds, titles and values, then each content root through `replace` so the Document keeps its anchors. `onRemote` hears what moved, each revised content field with the `Delta` the host maps its caret through.

**The writer diffs one field at a time, by structure.** Kept island ids are fixed points; between them, whole lines both sides hold are kept by longest common subsequence, and each run that differs is one splice over its common prefix and suffix. So two changes far apart are two splices, and what someone typed meanwhile stays on its line. The writer derives ops from the value, not the edit, so an insertion that reads the same at two places can land at the wrong one under a concurrent edit. A write from a revision splits by words instead, so a replaced word leaves no letter behind for a concurrent edit to land beside.

## Sessions

The host provides a `SessionLog` (`src/session.ts`): open, end, append, touch, read since a cursor, checkpoints, versions, subscribe, load and save.

- **Open.** A session opens with its seed and quill reference in one write, so an epoch never holds two seeds. A client on another version of the quill is refused (`QuillMismatch`).
- **Join.** Apply the seed and every entry, then bind the saved Document.
- **Lead.** Clients touch the log while present, and the store elects a leader from them; the leader writes back inserting repairs. A lapsed touch hands the lead on, at a cost of at most one repair written twice.
- **Edit.** Every local Y update is appended, merged while an append is out and retried on failure, since applying an update twice changes nothing. Entries are numbered without gaps. An append can be conditional on the entry count (`after`) or idempotent (`key`). An update that never reaches the log ends the session (`onEnded(lost)`), since every later update builds on it.
- **Checkpoint.** A checkpoint is an entry count and a Y snapshot, with garbage collection off so a snapshot alone rebuilds its state. Every revision handed out has one.
- **Version.** A named version is the room's Document as it stood, kept past every epoch: history belongs to the saved Document, not a session.
- **Save.** Each client saves after a quiet delay, with the snapshot it reflects. A store keeps a save only when it covers the held one, so a stale tab never overwrites a newer save. A client holding a remote value its Document refused does not save.
- **End.** A session with nobody present within the lease, whose save covers every entry, ends; the next opens from the save. Ending is decided by the lease and the save, never by a disconnect a stateless store cannot see.
- **Refusals.** A remote value the Document refuses leaves its field held, and pushes write nothing there, so the refusal reverts nobody. A refused card-list change stops the binding (`Diverged`).

**`localLog({ room })`** is the Web Storage store: one key per entry so tabs append without a lock, the `storage` event as the wake-up, and compaction past a threshold. Web Storage has no transactions, so two tabs opening at once each write a session and the later stands. A **server store** keeps the same protocol with the append, its epoch check, count and key in one transaction beside the document's row. It sets an entry's `author` from the caller's identity, refuses appends from readers, bounds update size and refuses client id 0. `checkServerStore` (`@quillmark/collab/conformance`) checks a store against all of it.

## Writes from a revision

A writer that takes seconds to answer reads the document at one state and answers after people have moved past it, so its edit is made on that state and merged (I9).

`writeFrom({ history, base, quill, doc, edit })` rebuilds the Y state at the `base` snapshot, binds a scratch Document, runs `edit`, and pushes it, returning the update, its `changes`, any `conflicts` and any `held` parts. `edit` returns the card operations it made, since a card-list diff cannot tell an insert from an append.

**A conflict** is a change made since `base` at a place the edit changed too: the same words, the same whole-value field, the same card moved, or a card one side removed that the other wrote. Comparison is by word by default, or by line. `hold` says what becomes of the conflicting part: write it anyway (`none`), hold back each conflicting line (`hunk`) or field (`field`). A held part is plain JSON naming its place by Y relative positions, so a host can keep it and offer it later; `heldState` reports whether it still reads as it did, and `writeHeld` writes it over the current state.

- **In a session**, the host takes `session.snapshot()` when the writer reads, and runs `writeFrom` and `session.apply` in one task when the edit is accepted.
- **Through the log**, a writer with no session names a state by a `Revision` (`{ epoch, count, check }`), short enough to hand a model; the check refuses a count the writer did not read. `readLog` returns the Document, its revision and the changes since an earlier one. `writeLog` refuses a stale revision or an unheld conflict, appends conditionally, and remakes the edit from the new head when the log moved. `saveVersion`, `readVersion` and `restoreVersion` keep and restore named versions.

## Pitfalls

- A write to the saved Document while a session is open is overwritten by the session's next save. Route it through the session, or end the session first.
- Anything with no Y form survives a session only through the saved Document, which is one client's: another client's anchors are not in it. A field type that gains a Y form needs a round-trip test (I8).
- A change of quill reference is not a field edit. The host ends the session and every client rejoins.
- `push` reads every card, so its cost grows with the document; debounce it for large documents.
- A whole-value field is written whole: two people editing different rows of an array of records keep one row's edit.
- A write applied over a conflict merges two rewrites into neither. Hold the part and write it with `writeHeld`.
- A held part belongs to the session it was made in. A host drops it when the session ends.
- A session's history grows with every edit until it ends.
- The host owns `session.doc` and frees it after `leave`.

## Testing

Vitest under Node, real WASM and real Yjs. A seeded fuzz runs several peers over the reference quill through random concurrent edits and random delivery, some from an earlier revision, and asserts convergence to one Document and I6. Case tests hold the binding, the round trip (I8), writes from a revision and their conflicts, the server-store check and the session protocol. The editor half is checked in the playground under `?collab=` (PLAYGROUND §"Live editing").
