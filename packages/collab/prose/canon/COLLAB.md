# Collab

## TL;DR

Several clients edit one Quillmark document at once and end holding the same content. Each client keeps its own WASM `Document`, and `bindDocument` keeps it equal to a shared Yjs state in both directions. A session is one stretch of live editing over the saved Document, carried by a log of Y updates that `joinSession` reads and writes through a `SessionLog` the host provides. The saved Document (`doc.toStored()`) stays the record; the Y state lasts one session. The package knows nothing of the editor: the host wires `onRemote` to the editor's host verbs (VISUAL_EDITOR §Surface).

## Invariants

- **I1** Within a session the Y state is the truth. A Document's synced content is `project(y)`, a pure function, so two clients holding one Y state hold one Document.
- **I2** A local commit is written to Y as the fewest operations that make Y project to the Document's value (`write.ts`), never as a whole-value replace.
- **I3** Identity lives in Y, positions are derived. A list item, a list, a quote and an island carry ids; `ordinal` and `instance` are computed by the projection, so two clients inserting into one list never fight over a number.
- **I4** An island slot the edit kept is never deleted and re-inserted. An island id is unique within its field: an id the store mints by position (`isl-0`) or one the field already holds is re-minted on write, and two slots that still meet one id after a merge are told apart by the projection (`id~1`), the first in text order keeping it.
- **I5** A session is seeded once, by an update every client writes byte for byte the same (`seedDocument`: client id 0, ids minted from it), so two clients that race to seed land one copy.
- **I6** After every transaction the Y text of each content root equals the Document's text for that field.
- **I7** Updates from two sessions never meet: every log entry belongs to one epoch, and a client applies only entries of the epoch it joined.
- **I8** Seeding a Document and projecting it back is lossless for everything that has a Y form.

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

The writer diffs one field at a time. The island ids the edit kept, by longest common subsequence, are fixed points; each stretch between two of them is one splice over the common prefix and suffix. Containers get the identities their old lines held wherever the run is the same run (`assignIds`), so restating every line's ordinals, as the codec does on a structural edit, writes no container change.

## Sessions

```ts
interface SessionLog {
	epoch(): Promise<string>;
	end(epoch: string): Promise<void>;
	append(epoch: string, update: Uint8Array): Promise<boolean>;
	since(epoch: string, cursor?: unknown): Promise<{ updates; cursor; touched } | undefined>;
	subscribe(onChange: () => void): () => void;
	load(): Promise<Saved | undefined>;
	save(saved: Saved): Promise<boolean>;
}
```

- **Join.** Read the saved Document, then the open epoch's log, in that order, so a log found empty was empty when the save was read and a seed is of the Document every seeder saw. A room with no save takes the host's initial Document as its first. An empty log takes the seed, then every entry is applied.
- **Edit.** Every local Y update is appended; a log that refuses it says the epoch closed, and the session ends.
- **Save.** Each client saves what it holds a delay after its last change, with the Y state vector it reflects. A store keeps a save of the same epoch only when it moves past the one held, so a stale tab never overwrites a newer save, and refuses a save of an epoch that is not open.
- **End.** A join that finds the log idle past the lease, with the save reflecting every entry, ends the epoch; the next one opens from the save. A client whose epoch ends hears `onEnded` and rejoins. Ending is decided by the lease and the save, never by a disconnect, which a stateless store cannot see.

`localLog({ room })` is the Web Storage store: one key per entry under `qm-collab:<room>:log:<epoch>:<writer>:<n>`, base64, so tabs append without a lock; the `storage` event is the wake-up; an epoch past `compactAt` entries is merged into one entry, written before the keys it merged are deleted. `sessionStorage` cannot carry a session: it is private to one tab. A server store keeps the same protocol with the save and the epoch check in one transaction beside the document's row.

## Pitfalls

- A write to the saved Document while a session is open is overwritten by the session's next save. Route it through the session, or end the session first.
- Anything with no Y form survives a session only through the saved Document, and a save is one client's Document: another client's anchors and tips state are not in it. A field type that gains a Y form needs a round-trip test (I8).
- A change of quill reference is not a field edit. A Document under another quill than `$session.quill` is reported through `onError`; the host ends the session and every client rejoins.

## Testing

Vitest under Node, real WASM and real Yjs. `fuzz.test.ts` runs three peers over the reference quill through random concurrent edits and random delivery, and asserts one Document, no errors, I6, and a canonical projection, over 120 seeds. `binding.test.ts` holds the cases one at a time, `roundtrip.test.ts` I8, and `session.test.ts` the session protocol over a fake origin's storage. The editor half is checked in the playground under `?collab=` (PLAYGROUND §"Live editing").
