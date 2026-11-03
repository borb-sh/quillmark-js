A throwaway spike, not an integration: a collab room over the Automerge-canonical `@quillmark/wasm` (0.135.0 pre-release, quillmark branch `claude/project-thread-oq3n16`), to get feedback on the core before `@quillmark/collab` moves. `room.mjs` is the room; `run.mjs` runs it against a local build (`QUILLMARK_WASM=<quillmark>/pkg node spikes/automerge-room/run.mjs`).

## What the room is

The WASM `Document` is the CRDT. The host's row is `doc.save()`; an append is `doc.saveSince(heads)` since the client's last append; a join is `Document.fromBytes(row)` and a `merge` of each entry; a compaction folds the log into a new row. Two peers on a socket run `generateSyncMessage` / `receiveSyncMessage` instead of a log. About 100 lines in place of the Y shape, the binding, `write.ts`'s diffing, `project`/`repaired`, and `fork.ts`'s conflicts.

The run: two people type, a slow writer revises from an old read, every client converges on `"Q3: Revenue grew 15% this quarter.\nShip v2 in May. Then v3."`, three entries compact from 920 to 763 bytes, and two peers sync in four messages.

## What `@quillmark/collab` would drop

- The Y shape (`$cards`, `<card>/$body`, `#block0`, `#containers`) and I3, I4, I6 and I8: identity, slots and records live in the one Automerge document the core writes.
- `bindDocument`'s two-way pull and push, and I2's fewest-operations writer: every core write is already one Automerge change.
- I5's seed protocol: a session starts from the row's bytes, which every client reads alike.
- I9's `writeFrom` rebuild and `fork.ts`'s `conflicts`: a slow writer's own `Document`, read at the revision it read and never pulled, is the fork; its append merges as Automerge merges and refuses nothing.
- A `Revision` becomes `doc.heads()`.

## What the core still lacks for it

1. **A base the bytes carry.** A content write's `base` is a hash, found among heads the writing process noted. The same hash in another process, one that read the row and pulled since, throws `edit::stale_base` (the run shows it). The Automerge answer is a heads base, `{ baseHeads: doc.heads() }`, which any process holding the history reaches; with it the hash lookup and its 1024-entry window go.
2. **A receipt per merge.** `merge` and `receiveSyncMessage` answer nothing, so a client cannot tell which fields or cards a remote change touched, or which anchors it dropped, without diffing reads. Automerge's patches would answer it.
3. **A view at heads.** A server answering a tool call from a revision has to keep a `Document` at that revision alive. `Document.fromBytes(row)` plus a `view at heads` (Automerge `isolate`) would let it read any revision from one document.
4. **Presence and cursors.** Not in scope here, and not in the core: carets would ride Automerge cursors, which the core does not expose.
5. **Speed.** 500 one-character applies with an append each took 4.6 s on the fast-compile WASM build, so about 9 ms a keystroke; an optimized build needs measuring before a judgment.
