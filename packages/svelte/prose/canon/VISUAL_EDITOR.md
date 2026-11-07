# Visual Editor

> **Implementation**: `src/lib/visual/`

## TL;DR

The WYSIWYG surface over a Quillmark document: cards, schema-driven fields and prose bodies composed into one editable tree. This doc owns the **composition**. Content ↔ ProseMirror is [CODEC.md](CODEC.md), the rendered view and its bridge are [PREVIEW.md](PREVIEW.md), and the WASM boundary is [DOCUMENT_MODEL.md](DOCUMENT_MODEL.md). Grounds on quillmark `CARDS.md`, `SCHEMAS.md` and `DOCUMENT_STORAGE.md`.

## Federated, not monolithic

The editor is a thin composition over many small editors, not one ProseMirror document spanning the page. The schema is the outline, a Svelte tree renders it, and each content leaf (a body, a `richtext` or `text` field) is its own PM state, view, history and plugins. Scalars are plain form controls.

The document already stores separate leaves at distinct addresses of distinct types. One PM document would re-encode that schema tree as nodes and re-derive every address from tree position, through a serializer, a patched parser and a lossy fallback. Federation deletes that layer: the editor renders the schema directly, lets each leaf pick its editor by type, and owns only structure, focus, card operations, command dispatch and diagnostics routing.

## Structure mirrors the schema

The layout is a direct projection of `quill.schema` joined against the live payload. The editor performs that join itself (`structure.ts`); quillmark has no projection for an editing surface.

**A card is its fields in declaration order, then a body.** A body and a `richtext` field are the same kind of leaf, differing only in address, so there is one field list with controls chosen by type and no metadata-vs-body mode.

**A control per type.** `richtext` and `text` mount a prose leaf whose line shape and codec narrow its PM schema ([CODEC.md](CODEC.md) §Inline mode); scalars take form controls; an optional `t?` takes its base type's control. An `array` is a repeater committing by value, an `object` a nested subform, an `enum` with `variants:` a select over a subform (§"Enum variants"), and a `matrix` grouped ticks (§"The matrix"). A prose leaf over content its schema cannot edit holds read-only rather than writing the loss back, judged off the value itself (`fitsLeaf`).

**Controls compose by nesting.** A nested container mounts its own control one rung in, so depth is bounded by what is open, not by the schema. Commit stays by value all the way up, since a nested row has no op address; at depth that is the whole field per keystroke, a bound the design accepts.

**Two controls compose by position.** An `array` of short-celled `object`s asking `ui.layout: table` draws as a grid over the same row machinery, and a matrix draws its roster. Neither recurses.

**`ui` hints drive layout, not structure.** `ui.compact` asks to share a row and defaults from the type. A card's top-level `object` is a panel, opening and closing on its own and `inert` when closed; the legacy `ui.groups` registry draws as panels too.

**Layout is CSS's, not JavaScript's.** A section is one grid: `placeFields` gives each field a span, a container query steps the column count, and nothing measures, so there is no observer to loop and no resize that remounts a prose leaf.

## The commitment ladder

Per field: show the authored value; else the `default:` where it prints; else words about the value.

- **A default that prints is the control's value**, drawn a step off the ink so it never reads as written, and nothing is written until an edit takes it, so tabbing through a card freezes nothing against the next quill version.
- **Where nothing prints, the control draws words** (an optional cell's `none`, an enum's blank title, a date's segments), or nothing.
- **Emptying a control writes what empty means for its field**: the empty answer where a default would otherwise print, a removed key for an optional cell, an unset for a number.

**No field is required and nothing gates.** An incomplete document edits and renders; completeness is the host's read of `quill.validate(doc)`. Document-level guidance rides the `$ext.editor.tips` card (§"Card operations"), never a per-field surface.

## The address is the spine

Every editable unit is keyed by an address: `Addr` for a leaf, a path for a scalar, a position for a card. It is what `apply` targets, what the preview bridge speaks, what a diagnostic routes to and what Svelte keys the tree on.

Cards are positional in the document, so the editor keys each card instance by a **session key** and resolves it to an index only at the mutation boundary. A reorder moves keys; no leaf remounts and no caret is lost.

The key leaves the editor: every payload naming a card carries its `cardId` beside its address, because an address names a different card after a move. With no card handle in the document, the key list *is* the identity, so the editor owns structural mutation for the session; a host that changes the card array behind it says so (§Surface).

### One vocabulary in the hooks

Every hook naming a place speaks the canonical `DocPath`, the grammar diagnostics and preview geometry already key on, so wiring the editor to the preview is a pass-through. `Addr` stays the mutator currency. `/core`'s `fieldPathForAddr` and `addrForFieldPath` hop between the two.

## Edits are ops to the live Document

The editor writes ops at an address, never markdown and never a whole-document re-serialize:

- **prose leaf**: each transaction lowers to a `Change` for `doc.apply` ([CODEC.md](CODEC.md)), so anchors move with their text. A `text` leaf commits its literal string through the writer.
- **scalar, array, object**: the schema-checked typed writer.
- **structure**: `insertCard`, `removeCard`, `moveCard`.

All three lanes report through `onChange` with an `EditorChange` whose `source` names the lane, so a host recompiles off one hook and reads `source` only to schedule: structure at once, prose and fields debounced. `onCaretMove` is the separate selection signal, reporting a place and dropping repeats.

Reconciliation is field-scoped ([CODEC.md](CODEC.md) §Reconciliation). A by-value leaf (an array element, a subform cell) reconciles against its parent's re-derive instead, since it has no address of its own.

## Card operations

- **Add** seeds the card from the document's `$seed` overlay or the kind's `seed:` and inserts it in one mutation; no placeholder card exists before it is real.
- **Reorder and delete** run over session keys. A delete is offered back once on a toast, and any other card operation withdraws the offer, since the index it restores to has moved.
- **Retype** is for a card whose kind the schema does not declare, and for a host's `setKind`; the chrome offers no switch for a declared kind. It inserts the new card before removing the old, so a refusal leaves the document as it was.
- **Rename** writes `$ext.editor.title`, editor state the backend never sees.
- **Tips** are `$ext.editor.tips` on `main`: hints a quill or host seeds, drawn as a dismissable card and never added to.

**The `editor` namespace is the write unit, and one verb owns it.** `storeExt` replaces the whole `$ext` map, so every write goes through `patchEditorExt` (`ext.ts`), which merges and drops keys; that is what keeps a tips dismissal from wiping every card's title. An emptied namespace removes itself.

## Focus and the preview bridge

**One active field holds the focus**, reported as an `ActiveLeaf` (its `DocPath` and its card's key) for a control as for a prose leaf.

**Every mounted field is a landing target** (`leaves.ts`): a registry holds a focus-and-box lane for every field and a caret lane for prose leaves, since on a memo the scalar front matter is half of what the preview can name.

- **Preview → editor**: `setCaret(hit)` resolves the field and places a caret where the hit has an offset, or focuses the field where it does not. A landing reveals first (opening a panel or a row), so it is async.
- **Editor → preview**: `onCaretMove={preview.focusPosition}` and `onActiveLeafChange={preview.endFollow}`, two pass-throughs wired together so a focus into a leaf with no caret ends the follow.

A landing marks itself with a wash that decays (`core/bloom.ts`); resting ink would outlive the hop. A landing reveals with the minimum scroll, a line clear of the fold and never a centring, since its commonest target is the leaf already focused.

## Teardown

One order, held by every surface: **unregister, cancel, then free**. `core/teardown.ts` carries it as a `Lifespan`. Continuations that cross an `await tick()` ask the span whether the surface still exists before acting, so a destroy that lands mid-flight cannot dispatch into a dead view.

## The document swap

`VisualEditor` is a door whose content is `{#key doc}`: a different document remounts the editor. The state a swap invalidates is spread across every leaf, so a remount is the one correct reset. `quill` is outside the key, since the schema is re-read on every derive; a quill swapped without its document reports `rebind-ignored`, as `Preview` does for any once-bound prop (`core/rebind.svelte.ts`).

## Chrome

Editing chrome is thin and per leaf; structural chrome is Svelte in the shell.

- **Formatting**: one selection popover over the active leaf, in the content mark vocabulary, plus a keymap. It answers a selection, never a pointer, and asks the view it would act on, so it withholds itself over a `text` leaf. Link and font family carry values, so they are prompts and pickers rather than toggles. Font families come from the host's library, not the quill's.
- **Input rules**: markdown shorthands over the same block commands the slash menu runs. A rule declines only where its result is unrepresentable or belongs to another gesture, never on how a quill would render it. Backspace right after a rule takes it back.
- **Insert menu**: `/` raises block commands at the caret (`slash.ts`, `SlashMenu.svelte`), the leaf's own surface since a trigger belongs to one caret.
- **Structural keys**: each body key is one chain of links, innermost surface first (`codec/keymap.ts`), so the nearest surface answers. The guiding rules: a key edits its own block; an item's number is its position and no keystroke writes one; Tab is structural in a body and free for navigation in a one-line field; Escape gives the focus up; no gesture nests past the store's depth bound. Per-key behaviour is the chain's and `tests/codec/`'s.
- **Tables**: the island is the one chrome the codec draws rather than the shell, as PM node-view DOM ([CODEC.md](CODEC.md) §"The table island").
- **Guidance**: a field's `description` raises a popover from a glyph beside its label, reached through the control's own `aria-describedby`.

**Every floating surface tracks a live element, never a rect measured once**, so it follows scroll and reflow; a text range passes a virtual anchor carrying its `contextElement`. Floating surfaces portal into the nearest `[data-qm-root]` so the consumer's dials reach them.

## Diagnostics

Three sources, each routed to a field and drawn inline: `quill.validate(doc)`, the host's `diagnostics` prop, and local commit errors. Only errors draw; warnings stay the host's to read. Routing parses the canonical `DocPath` and resolves the card index to the session key (`diagnostics.ts`).

**A diagnostic draws at the nearest cell the tree holds.** It routes to its field, and the field walks it down to the cell its path names, or carries it under a collapsed row's head or a closed panel's header, so nothing is lost on the way down.

**What a diagnostic says is the consumer's, up to a residue.** `formatDiagnostic(d)` can re-word it from `d.args` and the schema; validation and edit codes can be re-worded, while parse and render messages carry backend prose no string table can key, so the built-in text stands there.

**Diagnostics are not the error channel** (`core/errors.ts`). A `Diagnostic` is about the document and draws on its field; an `EditorError` is about the surface, a failure it already recovered from, and reaches `onError`.

## What the surface says

Every built-in string is a key on `strings`, partial, so wording is an override rather than a fork. Many are accessible names, which is why this is a seam. The strings reach the tree through context, with getters so a locale swap re-renders. `Preview` carries its own set, since a shared module would be an edge back into the editor.

## Enum policy

`enumOptionAllowed(addr, value)` marks an option unavailable, and `enumDisallowed` says whether the control disables it (the default) or hides it. Disabled is a promise that some state would allow it; hide is for an option the deployment does not carry at all. It is a deployment policy, so it is a prop rather than a per-option verdict. The selected value is always drawn, disabled when refused. The blank is the boundary's and the control mints none.

## Enum variants

An `enum` declaring `variants:` rests as a container `{value, …that member's fields}` and draws as the discriminant's select over the object subform, unchanged. The drawn world is the one the document renders as, the default's while unset. A flip keeps the other worlds' answers, because the boundary deliberately carries them (`validation::out_of_variant`) so comparing worlds costs nothing.

## The matrix

A `matrix` is a vocabulary someone ticks: a member is held by being present, and a held member unfolds its columns as an object subform. The control composes each member's schema from the roster and the field's properties, since the boundary serializes only the roster. The document keeps no answer for an unheld member, so the control keeps an unticked member's columns for the mount. An open matrix's added items follow the roster. Commit is whole, through one `writer.set`.

## Surface

The core seam is one prose leaf: `createField` (`core/codec/field.ts`) mounts a leaf over an `Addr` and returns the `FieldController` the composition drives. The Svelte composition is the rest.

```svelte
<VisualEditor
  bind:this={visualEditor}
  {doc} {quill}
  onActiveLeafChange={preview.endFollow}
  onCaretMove={preview.focusPosition}
  onChange={(change) => change.source === 'structure' ? recompileNow() : schedule()}
  onError={(err) => …}
/>
```

The instance verbs are the card header's own (`insertCard`, `removeCard`, `moveCard`, `setKind`) plus the landing verbs (`setCaret`, `focusField`, `washField`), all speaking `CardId` and `DocPath` and reporting through `onChange` as a click does. Three more run the other way, for a host that changed the document itself (a live session): `applyExternal` re-reads one prose leaf, `refresh` re-derives the card tree, and `applyCardOps` moves card keys through inserts, removes and moves so surviving cards keep their leaves and carets. A target the surface does not hold is a no-op reporting `target-unknown`.

**A nested address is a target through its field.** The boundary names elements and cells `Addr` cannot reach, so a landing parses the path, checks each step against the schema, and hands the walk to the field's control, each rung resolving its own step (an index to a session id, a key to a cell) at the point of use.

## Not owned

- Content ↔ PM, positions, mark and island translation: [CODEC.md](CODEC.md).
- Paint, geometry, click → content: [PREVIEW.md](PREVIEW.md).
- Document truth, mutators, `validate`: [DOCUMENT_MODEL.md](DOCUMENT_MODEL.md).
- Persistence, quill resolution and the split shell: the host's ([HOSTING.md](HOSTING.md)).

## Settled and open

- **Card identity is a session key**, owned by the editor and gone on reload.
- **Layout is schema-driven**, with no responsive policy beyond the container query.
- **Reorder** is buttons for cards and drag for `object` rows and table lines, each with a keyboard twin (Alt+↑/↓). Scalar lists have neither; a mis-order there is a retype.
- **Undo is per leaf.** A card or row removal is the one structural op with a step back, offered on the toast.
- **A card's kind is fixed once it exists**; a mis-picked kind is a delete and a re-add.
- **Touch is not a target**: the surface is held to a pointer and a keyboard.
- **Declined**: per-control render slots (they would hand reconciliation to consumer code), a pointer door onto the insert menu, image authoring (no asset story), and a touch accessory bar.
