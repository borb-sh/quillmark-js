# Automerge surface for @quillmark/collab: spike gaps

**Verdict: yes, with additions.** The binding does the content half of COLLAB.md well, better than the Yjs binding in places. Bodies, `richtext` fields and `text` fields converge through the sync verbs under random three-peer interleaving. Anchors and `x-` marks, blocks and islands now sync, where Yjs had no form for them. Inserting repairs converge and are not written back, and stale writes rebase. The package still cannot be rebuilt on this surface alone, for three reasons. First, the live document is per value, so the card list, kinds and whole-value fields have no live form. Second, every write that names no actor shares one Automerge actor, and two peers writing under it stop that value's sync for good: on receive this happens in 3 of 120 random sessions with no host mistake. Third, there is no incremental export or byte merge, so the `SessionLog` over a stateless store cannot be built. With A to C below closed, a rebuild is feasible. Until then the only buildable shape is a hybrid: Yjs for structure, the binding for content values.

## Gaps, most blocking first

**A. No whole-document live state. CONFIRMED.** COLLAB.md needs `$cards`, each card's `$kind`, title and whole-value fields, and `$session.quill` to sync (§"The Y shape"). The binding has a live document per body or content field only, addressed by `Addr`. A card added on one peer never reaches the other. A message for a card the receiver lacks throws `edit::unknown_card_id`. A scalar `set` never syncs.

- Tests: `session.test.ts` "GAP: a card one peer adds reaches the other through sync", "GAP: a scalar field one peer sets…", "a message for a card the receiver lacks refuses with edit::unknown_card_id".
- Smallest change: an address-free `doc.save()` / `load(bytes)` / `generateSyncMessage(state)` / `receiveSyncMessage(state, msg)` over one Automerge document holding the card list, payloads and every value, one `SyncState` per peer. Its receipt names card ops and a per-value `Receipt`.

**B. The shared no-actor id breaks sessions. CONFIRMED.** COLLAB.md's I1/I4 expect any interleaving of valid client edits to converge. The binding writes under the no-actor id `7e` wherever no actor is named. Two peers making different changes under it reuse a sequence number, and `edit::automerge` then refuses every later message on that value. This happens in five places:

- **Repair write-back on receive.** A non-inserting repair (`split_run`, a list over two runs) is written back under `7e` from each peer's own heads. CONTENT.md law 6 ("any peer may write back") holds only when the two write-backs are byte-identical. Test: `fuzz.test.ts` "GAP: seed 34 converges" (seeds 34, 50 and 51 of 120 fail this way, and no other way).
- **The typed writer.** `writer.revise`, `reviseDocument`, `set` and `unchecked.storeField` take no actor, so a model writing in two tabs breaks the session. Tests: `actors.test.ts` "GAP: two peers revising one value through quill.writer…", "GAP: two peers each writer.set…".
- **A live document rebuilt from the stored row.** Test: `session.test.ts` "GAP: a peer reloaded from the stored row alone rejoins".
- **A card removed and reinserted under its id.** Test: `session.test.ts` "removing and re-adding a card under its id starts a new live document".
- **One host actor on two peers** (as documented): `actors.test.ts`.

Smallest change: `receiveSyncMessage(addr, state, msg, { actor })`, or `Document.syncState({ actor })`, with repairs written back under that actor or not at all, since every peer already reads through `repair`. Give the writer verbs `{ actor }`, and diff an out-of-band write into the live document under the next write's actor. Fix law 6 in the docs.

**C. No log primitive. CONFIRMED.** COLLAB.md's `SessionLog` needs the operations below, and Web Storage needs a store with no server peer:

- appending an update;
- reading entries `since` a cursor and `upTo` a count;
- compaction, `after` and `key`.

The binding has a whole `save`, a `load` that replaces (a local edit not yet synced is lost) and a stateful sync. Two saves merge only through two scratch Documents synced together. Replaying a server's inbound message log into a fresh peer happens to work, but nothing specifies it.

- Tests: `session.test.ts` "there is no incremental change export…", "load replaces…", "two saves merge only through two scratch Documents…", "replaying a client-to-server message log… (unspecified)".
- Smallest change: `saveIncremental(addr)` → bytes since the last call, and an idempotent merging `loadIncremental(addr, bytes)` or `merge(addr, bytes)`. With these, a log entry is a change chunk and compaction is a `save`.

**D. Persistence and rejoin. CONFIRMED.** COLLAB.md §Save and §Join need a client to save, reload and rejoin. The binding needs the row plus one `save` per value, and the host enumerates the values itself, since no verb lists them. The row alone collides (B). A tab that reloads a save older than its last sent change and keeps its actor reuses a sequence number, and nothing warns at load.

- Tests: `session.test.ts` "a row and its saves reload…" (works), "GAP: …stored row alone…"; `actors.test.ts` "GAP: a peer reloading an older save under its own actor rejoins".
- Smallest change: `doc.saveLive()` / `loadLive(bytes)` over every value (or the bytes inside `toStored`), plus one documented rule: a peer takes a fresh actor per load.

**E. Revisions for a writer in another process. CONFIRMED.** COLLAB.md's `writeFrom(base snapshot)` and `readLog`/`writeLog` need a `Revision`, `conflicts` and `changesSince`. The binding keeps hash→heads in memory only, so after a `load` every earlier `baseHash` is `edit::stale_base`. `apply` has no `baseContent`. A rebased value receipt has no `conflicts`: text both sides rewrote interleaves without a report. What works: load the `save` bytes taken at read time into a scratch Document, write there, and sync. That is `writeFrom` with bytes as the snapshot.

- Tests: `late-writer.test.ts` "a baseHash read before the server loaded the bytes is stale", "GAP: apply takes the value it read as its base", "text a peer typed inside the span … interleaves, unreported", "a write made on the snapshot bytes and synced…".
- Smallest change: `apply`/`replace` accept `baseContent`. A rebased receipt gains `conflicts`: spans both sides changed, with their before and after. `doc.heads(addr)` → `string[]`, plus `save(addr, { at: heads })`.

**F. A remote change is a word diff, not the merge's splice. CONFIRMED.** COLLAB.md's `onRemote.content` carries the delta the host maps its caret through. The receive receipt's `applied` diffs the old value against the new by word. `XYZ` typed at 0 arrives as `delete "Hello" insert "XYZHello"`, so a caret inside the word lands at its end.

- Test: `converge.test.ts` "GAP: a caret inside a word maps through a remote insert ahead of it".
- Smallest change: lower the received Automerge patches into `applied` as exact splices, the way a write lowers its trace.

**G. Repairs are invisible on the live path. CONFIRMED.** COLLAB.md's I1 needs to know a merge read through `repair`, and which repairs insert. Receipts hold no `repairs`, and no verb reads the merged `RawContent`.

- Test: `repair.test.ts` "GAP: the receive receipt names the repair it read the merge through".
- Smallest change: `Receipt.repairs: Repair[]` on `receiveSyncMessage` and `load`.

**H. A sync message names no value. CONFIRMED.** Every value built from equal content shares one history, so a message routed to the wrong address merges silently into the wrong field. COLLAB.md would multiplex every value of every card over one channel.

- Test: `session.test.ts` "GAP: a message for one field delivered at another, equal-valued one is refused".
- Smallest change: build each live document under an id derived from its address, or refuse a message whose root does not match.

**I. Receive cost. PLAUSIBLE (measured, a blocker for large bodies).** A received message costs about 52 ms at 20k characters, against about 4 ms for a local `apply`. That is roughly 50 ms of main thread per remote keystroke. CONTENT.md's interactive target is 5 ms at 100k characters, but only for a local apply. Smallest change: the same patch lowering as F rather than re-reading the whole value.

**J. Docs. PLAUSIBLE.** Two peers that build a live document from equal values without a seed converge (`converge.test.ts` "converge with no seed…"). This holds because the build is deterministic under `7e`, and nothing says so. A collab seed can rely on it only if it is stated, across versions too. The docs also do not say that a host needs one `SyncState` per value per peer, or how to route messages. Smallest change: state the build rule, or require `save`/`load` seeds, in CONTENT.md §"Live state and merge".

**K. Minor. PLAUSIBLE.** Passing a `CardInput` object as `writer.addCard`'s first argument aborts with `RuntimeError: unreachable` (a wasm-bindgen `old_size > 0` assertion) instead of throwing a `QuillmarkError`. Seen while writing `session.test.ts`; no committed test.

## Measured

Core-only release build (`wasm-release`, as `build-wasm.sh` makes it). Node 22, `tests/cost.test.ts`:

|                                | published 0.134.1 | this branch                     |
| ------------------------------ | ----------------- | ------------------------------- |
| core `wasm_bg.wasm` raw / gzip | 3.28 MB / 1.10 MB | 4.71 MB / 1.56 MB (+44% / +43%) |
| core `wasm.js` gzip            | 20.6 KB           | 21.9 KB                         |

The size difference covers everything between the two versions, not Automerge alone. The `--ci` build is 35.7 MB / 5.18 MB (core) and is not comparable.

A 20,199-character body:

| What                          | Result                                    |
| ----------------------------- | ----------------------------------------- |
| Build and `save` the seed     | 197 ms, 2,091 bytes                       |
| `load` on two peers           | 453 ms                                    |
| 49 edits, one sync round each | 101 messages in 3.99 s, 39 ms per message |
| `receiveSyncMessage`          | 52 ms per message                         |
| `generateSyncMessage`         | 0.2 ms per call                           |
| Local `apply`                 | 4.1 ms per edit                           |
| Late join from the seed       | 4 messages, 186 ms                        |
| Save after 49 edits           | 3,565 bytes                               |

The fuzz runs 40 seeds in about 10 s. On the `--ci` build every timing is about 4× slower.

## Worked as documented

- Two peers converge on a body, a `richtext` field, a `text` (plain) field and a card body by `$id`, through `apply`, `diffRange` and `splitBlock` under distinct actors.
- Concurrent inserts and a delete in one word, a list indent against an item insert, and a table row against a column (both land, and repair supplies the empty cell) all converge canonical.
- A mark against typing at either edge: the typed characters take no mark (no edge grows).
- In 117 of 120 random three-peer sessions, every value reads and `normalize` is the identity; every local refusal is `edit::content_apply`.
- Anchors sync. A deletion's drop is named in both peers' `droppedAnchors`.
- An anchor placed concurrently with the deletion of its text is named on the placer only.
- A point anchor survives a concurrent insert; one id placed concurrently by two peers is kept once.
- `x-` marks, `x-` block kinds and `x-` islands survive sync.
- `writer.revise` under `baseHash` rebases in-process and syncs; under `baseContent` it rebases on a server.
- `apply` under a stale `base` rebases.
- A `setBlock` over a block re-kinded since refuses with `edit::rebase_conflict`.
- A seed via `save` + `load`; a late join from the seed; a reload from the latest save under the same actor; `clone` keeping the live document; `moveCard` keeping a card's live document.
- Inserting repairs (empty cell, text beside a table island) converge and are not written back. Later edits by both peers in the repaired region do not land the repair twice.
- `edit::automerge` for one actor or none on two peers, `edit::invalid_actor`, and `edit::unknown_card_id` as documented.
- `invert` of a receive receipt's `applied` undoes it.

## Running

The spike is not a workspace package: it installs on its own and links a local build of the binding in place of the published one, which stays installed as `@quillmark/wasm-published` for the size comparison.

```sh
cd spikes/automerge-collab
npm install --legacy-peer-deps --no-package-lock
QUILLMARK_WASM_PKG=/path/to/quillmark/pkg npm run link   # after ./scripts/build-wasm.sh there
npx vitest run                                           # SEEDS=120 for a longer fuzz
```

Each gap a test can show is an `it.fails` named `GAP: …`, which passes while the gap stands and fails once the binding closes it.
