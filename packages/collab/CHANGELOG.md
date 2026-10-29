# Changelog

`@quillmark/collab`. An entry is written into `## Unreleased` by the change that earns it; a release promotes that body to its own version section.

## Unreleased

**Live editing of one document by several clients.** `bindDocument` keeps a WASM `Document` equal to a shared Yjs state in both directions: every body and `richtext` field as text with its lines, containers, marks and islands, every `text` field as plain text, every other field as a value, and the card list, kinds and titles. `push(op)` writes a local commit; `onRemote` says what a remote one moved, with the text delta a host maps its caret through. `seedDocument` writes the update a session starts from, the same bytes on every client. `joinSession` runs a session over a `SessionLog`: it seeds an empty log once, appends every local update, applies every other client's, saves with the Y state the save reflects so a stale save is refused, and ends an idle, saved session so the next join starts afresh from the save. `localLog` is a `SessionLog` in `localStorage`, for every tab of one origin.
