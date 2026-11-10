# Changelog

`@quillmark/collab`. An entry is written into `## Unreleased` by the change that earns it; a release promotes that body to its own version section.

## Unreleased

**Holding the removal of a line someone edited no longer throws.** `writeFrom` with `hold: 'hunk'` holds such a line with an empty `after`, where it threw reading the held run of no lines.

## v0.3.0 - 2026-11-06

**A write from a revision is compared and written word by word.** `writeFrom` reports a conflict only where the edit and a change made since touch the same words, compared as Y holds them, marks, block records, containers and islands included; `scope: 'line'` keeps the comparison by line. The update replaces whole words, so two words an edit changed far apart in a line are two splices and what was typed between them stays, and a word it replaced leaves no letter for a concurrent edit to land beside. `writeLog` compares by word too.

**`writeFrom` holds back what meets a change and writes the rest.** `hold: 'hunk'` holds each line of the edit that meets a change made since and writes every other one in the same update; `hold: 'field'` holds each such field; a whole-value field is held whole, and so is everything the edit did to a card one side removed, moved or retyped while the other changed it, so a removal never deletes what someone typed and a move never brings back a card someone removed. `Written.held` lists each held part, a `HeldText`, `HeldValue` or `HeldCard`, with its text, value or card as the edit read it, as it stood when held and as the edit wrote it, in the authoring form. A held part is plain JSON, its lines placed by Y relative positions in their JSON form on the line breaks around them, and belongs to the session it was made in. `heldState(held, { history, quill, doc })` reads a held part as `open`, `edited`, `matched` or `gone`, and `writeHeld(held, { history, quill, doc })` writes it over the lines its span covers now, leaving every other line, or writes the held value or card. An edit runs a second time when part of it is held, and one that makes another change the second time is refused with `Unwritable`. `hold: 'none'` is the default and reports conflicts as before, two removals of one card no longer among them. `writeLog` takes `hold` and `scope` too and answers its held parts, for a client of the session to write with `writeHeld`.

**No plain-text roots.** A field is a content root or a value in its card's map; the plain-text root an earlier version wrote for a `text` field is no longer read or written, and a Y state that holds one is read as holding no value there. `writeHeld` and `writeFrom`'s holds work on content alone.

**`Change` names a card by `$id`.** Each change to a composable card carries `id`, its `$id`, beside its index.

**`writeFrom` reads less.** The history's projection is kept for the snapshot it was made at, so the writes of one answer read it once, and the update is checked against a fresh projection only when the session holds a refused value. One call writing five fields costs about what one field did.

**`onHolding`.** `bindDocument` takes `onHolding(holding)`, called when a remote value the Document refused starts or stops being held, so a host that saves the Document waits. A refused value removed from Y is no longer held.

**`deltaOf`** is exported: the `Delta` a write's receipt makes, as `onRemote` reports it.

**On `@quillmark/wasm` 0.135.** The peer range is `>=0.135.0-0`. `Delta` is this package's own, exported beside `RemoteChange`, and `onRemote`'s delta for a revised field is the text change the Document's `replace` answers in its receipt, so a caret maps through exactly what the write did, a repair's insertion included. A `text` field's plain codec rides Y as `qm:codec` in its root's `#block0` record, so it lands on every client as plain content. A card's `$id` rides Y on its card map: the first valid claim in `$cards` order holds it, a card with none takes its Y name, and the resolved id is written back, so two cards placed at once take one id each, the same on every client. A Y state an earlier version wrote carries no `$id`, and its cards take their Y names.

**The writer keeps a block's `\n` with its block, and places a lone insertion where it was typed.** A line is kept only where its text and the id of the block its `\n` opens both match, and a `\n` matches only the `\n` of the same block, so Enter at the start of a block another client re-kinds leaves that kind on the text rather than on the new empty block. An insertion with no deletion is written as far left as the text allows, so "the big " typed before "the cat" while another client deletes "the cat" converges to `"see the big "` and not `"see big the "`.

**A field's Y form follows its value, not the card's kind.** A content value stays in its root under `@f` through a retype to a kind that does not declare `f`, so an edit to that root racing the retype lands on every client instead of being dropped with the root (fuzz seed 249). The fuzz now asserts that every content root Y holds equals the Document's value for it.

**The session's leader writes back a repair that inserts, and the store elects it.** A mend `repair` makes by inserting (a split block's `\n` and record, the space a heading's hard break becomes, a missing cell's empty slot) is read through `repair` on every client and written back by one, the leader `since` names from the clients present, so it lands once and the state stops needing it. A client's edit to such a field writes its own change, and each block the repair mended that the edit left alone stays as Y holds it, so two clients editing after such a merge no longer write the repair twice. `touch(epoch, client)` takes the toucher's Y client id; `since` answers `leader`; `bindDocument` takes a required `leader`, `true` for a binding alone on its `Y.Doc`, and `binding.leader` follows the election, a binding made leader writing back what it reads then; `session.leader` says whether this client leads. `localLog` elects the lowest client id touched within its `lease`, so a tab that closes hands the lead on once its touch lapses.

**`author` names who an entry is by.** `AppendOpts.author`, `JoinSessionOpts.author`, `WriteLogOpts.author` and `session.apply(update, author)` replace `writer`, which now means only core's `quill.writer(doc)`.

**Checkpoints are required, and a revision nobody checkpointed is stale.** `SessionLog.checkpoint` and `checkpoints` keep a state by its entry count and snapshot for the life of its epoch; `readLog` and `writeLog` keep one for every revision they hand out, so compaction never makes it stale. `upTo` is gone. `open(seed, quill)` takes the quill, and a session `writeLog` opens or finds under another version of it is refused with `QuillMismatch`.

**Named versions outlive their session.** `saveVersion({ log, quill, label })` keeps the Document as it stands as a `Version`, `{ label, stored, at }`, through `SessionLog.keepVersion`, and `versions()` lists them past every epoch. `readVersion` answers the Document last kept under a label, and `restoreVersion({ log, quill, label, author, key? })` writes the room back to it as one edit from the head.

**`checkServerStore`** from `@quillmark/collab/conformance` runs against a host's server store and answers what failed: an entry's author is the caller, a reader appends nothing, an update past the bound and one by client id 0 are refused, the leader is a client present, a checkpoint lasts its session and a version outlives it.

## v0.2.0 - 2026-11-02

Tagged and never published: the release's npm publish was refused. Its changes ship in the next published version.

**On the content model of `@quillmark/wasm` 0.134.1.** The peer range is `>=0.134.1-0 <0.135.0-0`. The Y shape follows the model: each `\n` carries its block's id, kind and container path, containers are records by id in `<root>#containers`, block 0's record sits in `<root>#block0`, and each island slot is its own key of the island's map. The projection reads a merged state through the store's `repair`, so two clients' concurrent edits that no single edit could make read as one valid value on every client. A remote value lands through `replace`, its card named by `$id`, and an id `replace` re-mints is written back to Y. `onRemote`'s delta counts UTF-16. A Y state an earlier version wrote carries no block ids or containers, so a host ends its open sessions before it upgrades, and the next one opens from the save.

**`init()`.** The binding's sync verbs read the core's free functions, so a host awaits `init()` from `@quillmark/collab` before `bindDocument`, `seedDocument`, `writeFrom` or `changesSince`. `joinSession`, `readLog` and `writeLog` await it themselves.

## v0.1.1 - 2026-11-02

Tagged and never published: the release's npm publish was refused. Its changes ship in the next published version.

**The `@quillmark/wasm` peer range stops below 0.134.0.** 0.134 removes `overwrite` and `reviseContent`, which a bound document calls, so a range admitting it installed a wasm the binding throws on at its first remote edit.

**Card operations from a whole-document revise.** `cardOps(from, count)` derives the card operations a `writeFrom` or `writeLog` edit returns from a `reviseDocument` receipt's `from`: the removals, then a move for each card outside the longest run both orders share, picked as `changesSince` picks it, and the inserts. A reorder, removal or insertion then keeps each card's identity, so what was typed into a moved card since stays in it, and the update moves exactly the cards the conflict check reads as moved. An alignment that names a card twice or past the list throws `RangeError`.

## v0.1.0 - 2026-10-30

**Live editing of one document by several clients.** `bindDocument` keeps a WASM `Document` equal to a shared Yjs state in both directions: every body and `richtext` field as text with its lines, containers, marks and islands, every `text` field as plain text, every other field as a value, and the card list, kinds and titles. `push(op)` writes a local commit; `onRemote` says what a remote one moved, with the text delta a host maps its caret through. `seedDocument` writes the update a session starts from, the same bytes on every client. `joinSession` runs a session over a `SessionLog`: the session opens with its seed and quill version in one write, every local update is appended, batched while an append is out and retried when one fails, every other client's is applied, each save carries the Y snapshot it reflects so a stale save is refused and a deletion is saved, a client holding a value its Document refused does not save, and a session nobody is in ends once saved so the next join starts afresh from the save. `localLog` is a `SessionLog` in `localStorage`, for every tab of one origin.

**Writes from a revision.** `writeFrom` makes an edit on the state a slow writer read and returns it as an update that merges with whatever was written since, written and compared by line, with the changes it made and the conflicts it meets; an edit the update cannot carry whole is refused with `Unwritable`. `changesSince` reads what moved between two states, cards matched by identity and text as hunks. An edit names any number of card operations. `session.snapshot()` names the state a writer reads, and `session.apply(update, writer)` applies such an edit under its writer. `readLog` and `writeLog` do the same through a `SessionLog` with no session joined, naming a state by a short `Revision`, `{ epoch, count, check }`, whose check refuses a count the writer did not read: the read changes nothing, and the write appends only while the log holds what its conflict check saw, once per `key`, ending a session nobody is in and opening one only when it has an edit to append. `SessionLog.append` takes the writer, the expected entry count and a key, and answers how it went; `since` reports the entry count, and `upTo` returns the first entries. `joinSession` takes the session's own writer.
