# Collab

## TL;DR

Several clients edit one Quillmark document at once and end holding the same content. Each client keeps its own WASM `Document`, and `bindDocument` keeps it equal to a shared Yjs state in both directions. A session is one stretch of live editing over the saved Document, carried by a log of Y updates that `joinSession` reads and writes through a `SessionLog` the host provides. The saved Document (`doc.toStored()`) stays the record; the Y state lasts one session. The package knows nothing of the editor: the host wires `onRemote` to the editor's host verbs (VISUAL_EDITOR §Surface). A writer that answers late, a model above all, writes from the revision it read (`writeFrom`), and its edit merges with whatever was typed since.

## Invariants

- **I1** Within a session the Y state is the truth. A Document's synced content is `project(y)`, a pure function, so two clients holding one Y state hold one Document.
- **I2** A local commit is written to Y as the fewest operations that make Y project to the Document's value (`write.ts`), never as a whole-value replace.
- **I3** Identity lives in Y, positions are derived. A list item, a list, a quote and an island carry ids; `ordinal` and `instance` are computed by the projection, so two clients inserting into one list never fight over a number.
- **I4** An island slot the edit kept is never deleted and re-inserted. An island id is unique within its field: an id the store mints by position (`isl-0`) or one the field already holds is re-minted on write, and two slots that still meet one id after a merge are told apart by the projection (`id~1`), the first in text order keeping it.
- **I5** A session has one seed, stored with its epoch when it opens, and every client starts from it. The seed is written by client id 0 with ids minted from it (`seedDocument`), so the same Document seeds the same bytes.
- **I6** After every transaction the Y text of each content root equals the Document's text for that field.
- **I7** Updates from two sessions never meet: every log entry belongs to one epoch, and a client applies only entries of the epoch it joined.
- **I8** Seeding a Document and projecting it back is lossless for everything that has a Y form.
- **I9** A write from a revision is made on the Y state at that revision and merged as a concurrent edit, never applied to the live Document: what anyone wrote since stays wherever the write leaves it.

## The Y shape

| Name | Type | Holds |
| --- | --- | --- |
| `$cards` | `Y.Array<string>` | The composable cards' ids, in order |
| `$session` | `Y.Map` | `quill`, the quill reference the session was seeded under |
| `main`, `<card id>` | `Y.Map` | A card: `$kind` (composable cards), `$title`, each whole-value field by name, `@<field>` for a field held in a root |
| `<card>/$body` | `Y.Text` | The card's body |
| `<card>/<field>` | `Y.Text` | A `richtext` field, or a `text` field as plain text |
| `<root>#line0` | `Y.Map` | Line 0's metadata, which has no `\n` to sit on |

A content root's text is the field's text in Y's units, an island slot an embedded `Y.Map` of `id`, `type` and `props`. Formatting marks are character attributes; each `\n` carries the metadata of the line it opens, its kind as a JSON string and its containers by identity. Anchors have no Y form: they are the Document's own, `reviseContent` carries them through every remote change, and comparisons strip them.

A field's form follows its declared type on the card's current kind: `richtext` is a content root (`@f` = `content`), `text` a plain root (`@f` = `plain`), anything else a value under `f`. The writer always writes the form the kind declares and clears a root whose form changes; the reader takes whichever form a field arrives in, so a retype racing an edit converges.

Not synced, and carried by the saved Document: the rest of `$ext` (the tips channel is one person's), `$seed` overlays, anchors, and comments in the payload. A card's Y id lasts one session; the Document addresses cards by index.

## The binding

`bindDocument({ doc, quill, ydoc, onRemote, onError })` adopts a Y state that holds a session, cards by position where their kinds line up, and projects it into the Document; over an empty Y state it mints ids and writes the Document. `push(op?)` writes the committed Document to Y after a local edit, in one transaction: the card operation the edit was, then every root whose value differs from the one last synced. It returns the content fields whose new islands took a minted id, which the host re-reads. A card insert, remove or move is passed as `op`, since a diff of the list cannot tell a move from two edits; a count change with no op reads as cards added or dropped at the end.

A transaction from any other origin is pulled whole: the card list first (removes, then moves and inserts toward `$cards`, an id held twice counting once), then each card's kind, title and values, then each content root it touched, through `reviseContent` so the Document keeps its anchors. `onRemote` hears what moved: `cards`, the ops applied in order; `fields`, the cards whose kind, title or values changed; `content`, each text or content field, a revised one with the delta from its previous text that the host maps its caret through.

The writer diffs one field at a time. The island ids the edit kept, by longest common subsequence, are fixed points. Within each stretch between two of them the lines both sides hold whole are kept, by longest common subsequence again, and each run of lines that differs is one splice over its common prefix and suffix: two changes far apart in a field are two splices, and what someone typed meanwhile between them stays on the line it was typed on. A `text` field is written the same way, by line. Containers get the identities their old lines held wherever the run is the same run (`assignIds`), so restating every line's ordinals, as the codec does on a structural edit, writes no container change.

## Sessions

```ts
interface SessionLog {
	current(): Promise<Opened | undefined>; // { epoch, seed, quill? }
	open(seed: Uint8Array, quill?: string): Promise<Opened>;
	end(epoch: string): Promise<void>;
	append(epoch: string, update: Uint8Array, opts?: { writer?; after?; key? }): Promise<Appended>;
	touch(epoch: string): Promise<void>;
	since(epoch: string, cursor?: unknown): Promise<{ updates; cursor; count; touched } | undefined>;
	upTo(epoch: string, count: number): Promise<Uint8Array[] | undefined>;
	subscribe(onChange: () => void): () => void;
	load(): Promise<Saved | undefined>;
	save?(saved: Saved): Promise<boolean>;
}
```

- **Open.** A session opens with its seed and its quill (`name@version`) in one write: `open(seed, quill)` returns the session already open where there is one. A client on another version of the quill than the session's is refused (`QuillMismatch`), since a value one version takes the other can refuse. Every client applies that seed and none writes its own, so an epoch never holds two seeds, which under one client id would leave clients that received them in different orders apart for good. A room with no save takes the host's initial Document as its first, and a Document under another quill than the host's is refused (`QuillMismatch`).
- **Join.** Apply the seed and every entry, then bind the saved Document. A save the log has moved past is fine: cards that do not line up with Y's leave, and Y's are projected in. Remote changes reach `onRemote` only once `joinSession` has returned.
- **Edit.** Every local Y update is appended, under the session's `writer` where the host named one. Updates made while an append is out are merged into the next, and an append that throws is tried again after each delay in `retry`: an update applied twice changes nothing, so a retry of an append that landed unseen costs one entry and no content. Entries are numbered from 1 in the order the store keeps them, with no gaps; `since` says how many there are, and `upTo` returns the first `count`, or `undefined` once compaction has merged an entry past `count` with one before it. An append with `after` is kept only while the epoch holds exactly that many entries, and one with `key` only once (`Appended`: `appended`, `closed`, `moved`, `duplicate`). An update that does not reach the log, refused because the epoch closed or still failing after the last retry, ends the session, since every later update builds on it; `onEnded(lost)` says an edit made here is not in the log.
- **Save.** Each client saves what it holds a delay after its last change, with the Y snapshot it reflects, state vector and delete set both: a deletion moves no state vector. A store keeps a save of the same epoch only when it covers the held one and the held one does not cover it, so a stale tab never overwrites a newer save, and refuses a save of an epoch that is not open. A client that holds a remote value its Document refused does not save: its Document is not the Y state's projection, and a save of it would cover that value without holding it. A store that saves the log's projection itself leaves `save` out, and then no client saves.
- **End.** Each client touches the log while it is in the session. A join that finds nobody appending or present within the lease, and the save covering the seed and every entry, ends the epoch; the next one opens from the save. A read through the log reports such a session as the save, and a write from the save ends it, so a room only a server writes to opens a new epoch at the first write after each lease. Ending is decided by the lease and the save, never by a disconnect, which a stateless store cannot see; a tab asleep through the lease wakes to a session that has ended.
- **Refusals.** A remote value the Document refuses leaves its field or card held: a push writes nothing there, so the refusal does not revert anyone's edit, and the next remote value that lands releases it. A card-list change the Document refuses stops the binding (`Diverged`) and the session ends.

`localLog({ room })` is the Web Storage store: the open session is one key holding its epoch and seed; one key per entry under `qm-collab:<room>:log:<epoch>:<tab>:<n>`, its range of entry numbers and its update in base64, so tabs append without a lock; the entry count and each `key` are keys of their own; the `storage` event is the wake-up; an epoch past `compactAt` entries is merged into one entry, written before the keys it merged are deleted, and a read that finds a listed key gone lists again. Web Storage has no transactions, so two tabs opening a session at once each write one and the later stands: the other's session ends at its first append, having lost nothing but that append. Two tabs appending in one instant can take one entry number, which `after` does not catch; the writers that use `after` run on a server. `sessionStorage` cannot carry a session: it is private to one tab. A server store keeps the same protocol with `open`, the save, and the append with its epoch check, count and key, each in one transaction beside the document's row; the count is a per-session counter bumped in that transaction, not a sequence, whose values can commit out of order. Nothing in an update says who made it or whether they may: a server store sets an entry's `writer` from the caller's identity rather than the client's word, refuses an append from anyone who may only read, and bounds an update's size, since one written under client id 0 collides with the seed and stops every client (`Diverged`).

## Writes from a revision

A writer that takes seconds to answer reads the document at one state and answers after people have moved past it. Its edit is made on that state and merged (I9). The session's `Y.Doc` keeps its history (garbage collection off), since a state at an older snapshot is rebuilt from content deleted since.

`writeFrom({ history, base, quill, doc, edit })` takes `base` as `Y.encodeSnapshot` of the state read. It rebuilds the Y state there, binds a scratch Document to it over `doc`'s parts with no Y form, runs `edit`, and pushes it, so the edit is written as the fewest operations that carry it (I2): a whole body rewritten from its old text writes only the lines that differ. `edit` returns the card operations it made, in order, since a card list diff cannot tell an insert from an append (§"The binding"); an edit whose card count disagrees with its operations is refused (`Unwritable`). So is an edit the update does not carry whole, one that writes where the session holds a value the Document refused; a refusal elsewhere in the document is held as in a session and does not stop the write. A whole-document `reviseDocument` names its operations through `cardOps(receipt.from, count)`, `count` the cards before it: the receipt says which stored card each card revises, and `cardOps` removes the cards it names none of, keeps in place the longest run of the rest that both orders share, picked as `changesSince` picks it, and moves or inserts every other card once. The update then moves exactly the cards the conflict check reads as moved; one it moved that the check read as staying would merge with a move made since without either being reported. `writeFrom` returns the update, the `changes` the edit made from `base`, and the `conflicts`: the changes made in `history` since `base` at a place the edit changed too: lines of a text or content field both rewrote, a whole-value field both set, a card both moved, or a card one side removed or retyped that the other wrote. Lines are compared as Y holds them, each with its characters, islands, kind, containers and marks, so a change to a table's props is a change to its line; two changes meet where they share a line, insert at one place, or one inserts inside the other. `changesSince` is the same comparison alone: cards are matched by their Y ids, so a move reads as a move, and each changed field carries its value before and after in the authoring form, and for text the `hunks`, each run of lines that differs.

- **In a session.** The host takes `session.snapshot()` when the writer reads, and when its edit is accepted runs `writeFrom` over `session.ydoc` and `session.apply(update, writer)` in one task, so the conflicts it reported are those of the state the update lands on. `apply` appends the update under `writer`, and the Document hears it through `onRemote`. A server that runs a model hands its answer to the tab as an edit to make, not as an update: an update made from the server's history can depend on entries the tab has not pulled.
- **Through the log.** A writer with no session, a server answering a tool call, names a state by a `Revision`, `{ epoch, count, check }`: the session, how many entries the state holds, and a digest of that state, short enough to hand a model; with no session open, or one nobody is in whose entries are saved, it is `{ epoch: '', count: 0, check: '' }`, the save. A count the writer did not read fails its check, so a model that hands back a later count than it read is refused rather than written over what came between; a host keeps the revision it handed out where it can, rather than trusting the one handed back. `readLog({ log, quill, since? })` changes nothing; it returns the Document, its revision, and the changes since `since` where that revision can still be rebuilt. `writeLog` from the save ends a session nobody is in, and opens one from the save once it has an edit to append; it refuses a revision of an ended session, one ahead of the log, one whose check fails, or one compaction merged past (`stale`), and an edit with conflicts (`conflict`); otherwise it appends with `after` set to the entries it checked against, and makes the edit again from the new head when the log moved. With a `key` a retried write lands once (`duplicate`); a retried field rewrite meets its own first landing as a conflict. It saves the Document the log then projects to; a save refused or failed after the append is not the write's failure, since the next save carries it.

## Pitfalls

- A write to the saved Document while a session is open is overwritten by the session's next save. Route it through the session, or end the session first.
- Anything with no Y form survives a session only through the saved Document, and a save is one client's Document: another client's anchors and tips state are not in it. A field type that gains a Y form needs a round-trip test (I8).
- A change of quill reference is not a field edit. A Document under another quill than `$session.quill` is reported through `onError`; the host ends the session and every client rejoins.
- `push` reads every card on each call, so its cost grows with the document. A host with large documents debounces it.
- A whole-value field is written whole: two people editing different rows of an array of records keep one row's edit. So does an undo of one, which restores the value it held.
- A write applied over a conflict merges two rewrites of one span into neither: a word typed into a sentence the write replaces survives beside the new sentence. Redo the edit from the current state instead.
- An undo of a write from a revision, by a `Y.UndoManager` over its origin, leaves behind text people typed inside what the write added.
- A session's history grows with every edit until the session ends; a server holds it only for the length of a `readLog` or `writeLog`.
- The host owns `session.doc` and frees it after `leave`. `joinSession` frees the Document `initial()` returns.

## Testing

Vitest under Node, real WASM and real Yjs. `fuzz.test.ts` runs three peers over the reference quill through random concurrent edits and random delivery, and asserts one Document, no errors, I6, and a canonical projection, over 120 seeds. `binding.test.ts` holds the cases one at a time, `roundtrip.test.ts` I8, `fork.test.ts` writes from a revision and line-level conflicts, and `session.test.ts` the session protocol over a fake origin's storage: saves that delete, a joiner behind the log, a session ended under a tab, a full store, and writes applied in a session and through the log. The fuzz makes some of its edits from a revision a peer held earlier. The editor half is checked in the playground under `?collab=` (PLAYGROUND §"Live editing").
