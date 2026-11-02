# Changelog

`@quillmark/collab`. An entry is written into `## Unreleased` by the change that earns it; a release promotes that body to its own version section.

## Unreleased

**A field's Y form follows its value, not the card's kind.** A content value stays in its root under `@f` through a retype to a kind that does not declare `f`, so an edit to that root racing the retype lands on every client instead of being dropped with the root (fuzz seed 249). The fuzz now asserts that every content root Y holds equals the Document's value for it.

**No client writes back a repair that inserts.** A mend `repair` makes by inserting (a split block's `\n` and record, the space a heading's hard break becomes, a missing cell's empty slot) is read through `repair` on every client and written back by none, as a session has no single writer: a client's next edit to that field writes its own change, and each block the repair mended that the edit left alone stays as Y holds it. Two clients editing after such a merge no longer write the repair twice, which duplicated text (`"Title words\nbody A words\nbody B"`).

## v0.2.0 - 2026-11-02

**On the content model of `@quillmark/wasm` 0.134.1.** The peer range is `>=0.134.1-0 <0.135.0-0`. The Y shape follows the model: each `\n` carries its block's id, kind and container path, containers are records by id in `<root>#containers`, block 0's record sits in `<root>#block0`, and each island slot is its own key of the island's map. The projection reads a merged state through the store's `repair`, so two clients' concurrent edits that no single edit could make read as one valid value on every client. A remote value lands through `replace`, its card named by `$id`, and an id `replace` re-mints is written back to Y. `onRemote`'s delta counts UTF-16. A Y state an earlier version wrote carries no block ids or containers, so a host ends its open sessions before it upgrades, and the next one opens from the save.

**`init()`.** The binding's sync verbs read the core's free functions, so a host awaits `init()` from `@quillmark/collab` before `bindDocument`, `seedDocument`, `writeFrom` or `changesSince`. `joinSession`, `readLog` and `writeLog` await it themselves.

## v0.1.1 - 2026-11-02

**The `@quillmark/wasm` peer range stops below 0.134.0.** 0.134 removes `overwrite` and `reviseContent`, which a bound document calls, so a range admitting it installed a wasm the binding throws on at its first remote edit.

**Card operations from a whole-document revise.** `cardOps(from, count)` derives the card operations a `writeFrom` or `writeLog` edit returns from a `reviseDocument` receipt's `from`: the removals, then a move for each card outside the longest run both orders share, picked as `changesSince` picks it, and the inserts. A reorder, removal or insertion then keeps each card's identity, so what was typed into a moved card since stays in it, and the update moves exactly the cards the conflict check reads as moved. An alignment that names a card twice or past the list throws `RangeError`.

## v0.1.0 - 2026-10-30

**Live editing of one document by several clients.** `bindDocument` keeps a WASM `Document` equal to a shared Yjs state in both directions: every body and `richtext` field as text with its lines, containers, marks and islands, every `text` field as plain text, every other field as a value, and the card list, kinds and titles. `push(op)` writes a local commit; `onRemote` says what a remote one moved, with the text delta a host maps its caret through. `seedDocument` writes the update a session starts from, the same bytes on every client. `joinSession` runs a session over a `SessionLog`: the session opens with its seed and quill version in one write, every local update is appended, batched while an append is out and retried when one fails, every other client's is applied, each save carries the Y snapshot it reflects so a stale save is refused and a deletion is saved, a client holding a value its Document refused does not save, and a session nobody is in ends once saved so the next join starts afresh from the save. `localLog` is a `SessionLog` in `localStorage`, for every tab of one origin.

**Writes from a revision.** `writeFrom` makes an edit on the state a slow writer read and returns it as an update that merges with whatever was written since, written and compared by line, with the changes it made and the conflicts it meets; an edit the update cannot carry whole is refused with `Unwritable`. `changesSince` reads what moved between two states, cards matched by identity and text as hunks. An edit names any number of card operations. `session.snapshot()` names the state a writer reads, and `session.apply(update, writer)` applies such an edit under its writer. `readLog` and `writeLog` do the same through a `SessionLog` with no session joined, naming a state by a short `Revision`, `{ epoch, count, check }`, whose check refuses a count the writer did not read: the read changes nothing, and the write appends only while the log holds what its conflict check saw, once per `key`, ending a session nobody is in and opening one only when it has an edit to append. `SessionLog.append` takes the writer, the expected entry count and a key, and answers how it went; `since` reports the entry count, and `upTo` returns the first entries. `joinSession` takes the session's own writer.
