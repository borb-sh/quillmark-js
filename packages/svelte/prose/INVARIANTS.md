# @quillmark/svelte invariants

The rules a change to `@quillmark/svelte` must keep, the reason behind each, and the designs already weighed and rejected. What the package exports and how a host mounts it is the [README](../README.md); the theming contract is [THEMING.md](../THEMING.md); the document model, the WASM boundary and diagnostics are quillmark's (quillmark/INVARIANTS). A rule belongs here only if a capable reader of the code would plausibly break it, and a change that breaks one updates this page in the same commit, with the new reason.

## Core vs chrome

**The core carries the substance and the chrome stays thin.** A vanilla TS core with no UI framework holds the WASM boundary, the codec and its ProseMirror integration, and the preview's paint loop, and its `.d.ts` depend on no framework. The Svelte chrome is components and `.svelte.ts` modules over it. A second binding would be a re-export of `/core`, not a rewrite.

**The chrome is Svelte 5 throughout.** Every component compiles in runes mode, and where Svelte 5 names a successor to a Svelte 4 idiom, the code writes the successor. The compiler refuses half of the old forms and `check:svelte` the rest; the framework-free core is outside the rule and keeps its own listeners.

## Packaging

**One package with subpath exports.** Rejected: separate packages. The one thing a split would buy, a preview-only consumer not pulling ProseMirror, is what separate module roots already give, and the surfaces share a substrate that co-evolves, so independent versions would be cost with no payer.

**A subpath is a promise**, so it carries a surface a consumer builds with, not a wrapper over one public call.

**`/core` declares what more than one surface speaks, and nothing more**: the address vocabulary and the error channel. Declaring either per subpath would force an import across a boundary the package keeps closed, or a structural copy that drifts.

**The `@quillmark/wasm` API is not re-exported.** Package code and consumers import it from the peer directly, so every symbol has one import path (`check:deps`).

**`/preview` imports nothing editor-side.** Its audience (a viewer, a share page, a CI screenshot) is not editing, and bundle weight is what makes the subpath claim true. `check:deps` holds the edge.

## Styling

**A plain skin over dense behaviour**: monochrome and typographic, with hierarchy from size, tone and whitespace, so a consumer's override is the design rather than a fight with a decorated one. The chrome names everything at one weight; a second weight is reserved for a run where weight is the only signal it has.

**A component reads a rung, it does not mint a value.** `core/theme.css` is the only file that mints a value for the surfaces: the public `--qm-*` dials in, a closed private `--_qm-*` scale out. The shared recipes (`visual/controls.css`, `codec/prose.css`) are rules more than one component draws; the preset is the same shape one level up, for the host page. `check:style` holds the rule over the package and each app.

**Consumer CSS outranks the package without `!important`.** Every package selector is wrapped in `:where()` with no layer, whatever order a bundler emits the sheets in, and the promised root classes are drawn `:global(:where(…))`. `check:style` holds the zero rank on every class THEMING promises.

**The shell is CSS on the host's own elements, never a component**, so the wiring stays the consumer's.

**Light and dark is the host's declared `color-scheme`**, read through `light-dark()`, so a colour pole states both arms. Motion durations are rungs, so `prefers-reduced-motion` collapses the scale rather than a roster of selectors. A surface hidden by geometry is `inert`, not merely unpainted.

**The interior DOM is not contract**, so the surfaces can re-cut it. The contract is THEMING's dials and mounted root classes.

### A plane is a tone, not an outline

**A surface in the flow is lifted off what it sits on by its fill, never by a line around it**, and the raised plane is the brighter one in both schemes. Where a card reads too faint against the ground, the fix is the derivation's, never a border. Three kinds of stroke survive, each saying something a fill cannot:

- **A stroke that structures**: a section's vertical, a table's rules, an `hr`. Depth is a ladder of verticals one `--_qm-nest` apart, never a rule across the block.
- **A stroke on something floating**: a menu, a popover, the table island's alignment cluster, which have no plane under them to step off.
- **A stroke that is a state**: the dashed edge on a card the schema cannot project.

## The boundary

**Adding a construct upstream is a compile error here.** Block kinds, container kinds, mark types and island types are closed past their `x-` names, and each place that names a set names it against the boundary's own union (an exhaustive `switch`, a `satisfies`, a `Record` keyed by the union). Rejected: a literal check, which compiles unchanged against a widened union and silently drops the new member.

**Shapes are read straight off the boundary**, with no local duplicates. A `props` that crossed the DOM as JSON is the one place the codec reads a shape itself.

**One address crosses.** `Diagnostic.path`, `ContentHit.field` and `FieldRegion.field` are one canonical `DocPath`, so a diagnostic and a geometry address for one place join on equality. The package routes with `parseDocPath` and builds with `formatDocPath`. Rejected: a hand-rolled grammar.

**A content field is read through the schema, never raw.** A field can rest as a content object or as the authored string a transport-door load left, and the reader decodes by declared type at any depth, so the storage form is never the editor's business.

**The editor drives neither ingestion verb.** It is handed a `Document` and edits it; which door built one is the host's business.

**`init` latches.** Code that cannot await (the `DocPath` formatter, the codec inside a transaction) reads the latched gate, which throws naming the fix rather than reading `undefined`.

## The visual editor

### Federated, not monolithic

**Each content leaf is its own ProseMirror state, view, history and plugins**, and a Svelte tree renders the schema around them. Rejected: one PM document spanning the page, which would re-encode the document's schema tree as nodes and re-derive every address from tree position, through a serializer, a patched parser and a lossy fallback.

### Structure mirrors the schema

**The layout is a projection of `quill.schema` joined against the live payload**, and the editor performs that join itself; quillmark has no projection for an editing surface.

**A body and a `richtext` field are one kind of leaf**, differing only in address, so there is one field list with controls chosen by type and no metadata-vs-body mode.

**A prose leaf over content its schema cannot edit holds read-only** rather than writing the loss back, judged off the value itself.

**Commit is by value below a field's address.** A nested row has no op address, so at depth a keystroke commits the whole field, a bound the design accepts.

**A run of commits to one field derives once.** Its commits past the first rebuild the one card from the one field's value, and the whole-document derive, validation with it, lands when the run rests, so a by-value keystroke costs what its card holds rather than what the document does. A commit that sets or unsets the field derives at once, since it moves what the field's default shows.

**`ui` hints drive layout, not structure.**

**Layout is CSS's, not JavaScript's.** A section is one grid and a container query steps the column count. Nothing measures, so there is no observer to loop and no resize that remounts a prose leaf.

### The commitment ladder

**Per field: the authored value, else the `default:` where it prints, else words about the value.**

- **A default that prints is drawn a step off the ink, and nothing is written until an edit takes it**, so tabbing through a card freezes nothing against the next quill version.
- **Emptying a control writes what empty means for its field**: the empty answer where a default would otherwise print, a removed key for an optional cell, an unset for a number.

**No field is required and nothing gates.** An incomplete document edits and renders; completeness is the host's read of `quill.validate(doc)`. Document-level guidance rides the tips card, never a per-field surface.

### The address is the spine

**Every editable unit is keyed by an address**: what `apply` targets, what the preview bridge speaks, what a diagnostic routes to and what Svelte keys the tree on.

**A card is keyed by a session key, resolved to an index only at the mutation boundary.** A reorder moves keys, so no leaf remounts and no caret is lost. Card identity is gone on reload.

**Every payload naming a card carries its `cardId` beside its address**, because an address names a different card after a move. With no card handle in the document, the key list is the identity, so the editor owns structural mutation for the session.

**Every hook naming a place speaks the canonical `DocPath`**, so wiring the editor to the preview is a pass-through. `Addr` stays the mutator currency.

### Edits are ops

**The editor writes ops at an address, never markdown and never a whole-document re-serialize.** A prose leaf lowers each transaction to a `Change` for `doc.apply`, so anchors move with their text; a scalar, an array or an object goes through the typed writer; structure goes through the card verbs.

**One hook reports every lane.** `onChange` carries an `EditorChange` whose `source` names the lane, so a host recompiles off one hook and reads `source` only to schedule.

### Card operations

**A card is seeded and inserted in one mutation**; no placeholder card exists before it is real.

**A retype inserts the new card before removing the old**, so a refusal leaves the document as it was. The chrome offers no switch for a declared kind: a card's kind is fixed once it exists.

**A delete is offered back once**, and any other card operation withdraws the offer, since the index it restores to has moved.

**The `$ext.editor` namespace is the write unit, and one verb owns it.** `storeExt` replaces the whole `$ext` map, so every write goes through `patchEditorExt`, which merges and drops keys; that is what keeps a tips dismissal from wiping every card's title. An emptied namespace removes itself. The backend never sees the namespace.

### Focus and the preview bridge

**Every mounted field is a landing target**, a scalar as much as a prose leaf, since on a memo the scalar front matter is half of what the preview can name.

**A landing reveals first, with the minimum scroll**: a line clear of the fold and never a centring, since its commonest target is the leaf already focused.

**A landing's mark decays.** Resting ink would outlive the hop.

### Teardown and the swap

**One order, held by every surface: unregister, cancel, then free.** A continuation that crosses an `await tick()` asks the surface's `Lifespan` whether it still exists before acting, so a destroy that lands mid-flight cannot dispatch into a dead view.

**A different document remounts the editor.** The state a swap invalidates is spread across every leaf, so a remount is the one correct reset. A once-bound prop swapped under a mounted surface reports `rebind-ignored`.

### Chrome

**Editing chrome is per leaf; structural chrome is Svelte in the shell.**

- **The formatting popover answers a selection, never a pointer**, and asks the view it would act on, so it withholds itself over a `text` leaf. Font families come from the host's library, not the quill's.
- **An input rule declines only where its result is unrepresentable or belongs to another gesture**, never on how a quill would render it, since what a quill typesets is not knowable here. Backspace right after a rule takes it back.
- **An input rule runs the command its slash pick runs**, so a construct's two doors are one implementation and cannot drift apart.
- **Each body key is one chain of links, innermost surface first**, so the nearest surface answers. A key edits its own block; an item's number is its position and no keystroke writes one; Tab is structural in a body and free for navigation in a one-line field; Escape gives the focus up; no gesture nests past the store's depth bound.
- **A floating surface tracks a live element, never a rect measured once**, so it follows scroll and reflow, and portals into the nearest `[data-qm-root]` so the consumer's dials reach it.

### Diagnostics

**Only errors draw**; warnings stay the host's to read.

**A diagnostic draws at the nearest cell the tree holds.** It routes to its field, and the field walks it down to the cell its path names, or carries it under a collapsed row's head or a closed panel's header, so nothing is lost on the way down.

**What a diagnostic says is the consumer's, up to a residue.** Validation and edit codes can be re-worded from `args`; parse and render messages carry backend prose no string table can key, so the built-in text stands there.

**Diagnostics are not the error channel.** A `Diagnostic` is about the document and draws on its field; an `EditorError` is about the surface, a failure it already recovered from, and reaches `onError`.

### What the surface says

**Every built-in string is a key, and `strings` is partial**, so wording is an override rather than a fork. Many are accessible names, which is why this is a seam. `Preview` carries its own set, since a shared module would be an edge back into the editor.

### Enums

**Enum policy is a deployment's, so it is a prop rather than a per-option verdict.** Disabled is a promise that some state would allow the option; hidden is for one the deployment does not carry at all. The selected value is always drawn. The blank is the boundary's and the control mints none.

**A variant flip keeps the other worlds' answers**, because the boundary deliberately carries them, so comparing worlds costs nothing.

### The matrix

**The control composes each member's schema from the roster and the field's properties**, since the boundary serializes only the roster. The document keeps no answer for an unheld member, so the control keeps an unticked member's columns for the mount. Commit is whole, through one `writer.set`.

### Surface

**A host that changes the document says so.** The editor owns structural mutation, so a host that wrote the document itself re-reads one prose leaf, re-derives the card tree, or moves card keys through inserts, removes and moves so surviving cards keep their leaves and carets. A target the surface does not hold is a no-op reporting `target-unknown`.

**A nested address is a target through its field.** The boundary names elements and cells `Addr` cannot reach, so a landing checks each step against the schema and hands the walk to the field's control, each rung resolving its own step at the point of use.

### Declined

Per-control render slots, which would hand reconciliation to consumer code; a pointer door onto the insert menu; image authoring, which has no asset story; touch as a target, and its accessory bar. Undo is per leaf and per list, never one stack for the document: a list keeps the changes to its rows as steps of its own (ArrayField), and a card removal is the one card op with a step back, offered on the toast.

## The codec

The bidirectional codec between one content field and one ProseMirror document. Markdown is not in this loop.

### Direction

**The content is truth, PM is its projection, and edits are ops.** Encode projects the new PM doc back to content and asks the store's own `diff` for the `Change`. Ops rather than a replace, because a `Change` moves each anchor exactly as it moves its text. A whole-field diff rather than a step replay, because the codec then restates none of the store's rules about where a mark or an anchor lands.

**`replace` is the exception**: a field not yet at content rest, and an `apply` that throws.

### Decode

**Decode is a pure function, and every node carries its id**, so the projection hands each back under the id it was read with. A construct no leaf edits holds the leaf read-only rather than being flattened.

### Encode

**The projection is total over the schema.** Every document the leaf's commands can reach projects to a valid `Content`; a projection the store refused would leave the leaf diverged from its field for the session. `tests/codec/roundtrip.test.ts` asserts it over the whole chain.

**The leaf holds one spelling of each shape**, normalizing what commands leave, so `decode(stored)` is the document the leaf is holding.

### Positions

**The position map is built in the same walk as the projection**, so the two cannot disagree. Offsets are UTF-16 code units.

### Marks

**Identity is kept off PM's mark mechanism.** Formatting is a property of a range and maps to PM marks; an anchor is a zero-width handle and maps to plugin-held positions keyed by id. Overlap only bites where identity and formatting coexist, and they never share a mechanism. So an anchor draws as a decoration, a span carrying `data-qm-anchor` that the host styles, never as a mark the schema would serialize.

**An anchor's id is the caller's**: supplied at `insertAnchor`, unique, and never changed afterwards, since no content determines what a comment refers to and the codec mints none.

**A link's scheme allowlist is the render's, not the model's**: a refused href stays on the mark and round-trips.

**An applied commit leaves new block ids to the store.** A commit that lands as a change sends each block the store does not hold as a placeholder, and the nodes then take the ids the store holds, because the store does not mint an id it retired except on a write against the value it was minted on, which in practice is an undo: a writer naming a retired id, a model among them, is refused rather than landing on a stranger. The projection's own id for a new block is provisional, and a `replace` writes it as it stands.

### Islands

**A minted island id continues the field's `isl-{n}` sequence**, never a UUID or a clock, because the id is part of the document's canonical bytes.

### The table island

- **The rectangle is an invariant with no error channel**, so every row and column op goes through one rectangularizing constructor. A ragged table would leave PM and the store disagreeing silently.
- **A pointer press resolves to a caret, and a drop to the cell it is over.** Only a grip acts on a line, and a drop on a cell's padding or beside its text lands in its text rather than in the field around the table.
- **A selection is the subject of the next command**, never armed for replacement: a printable key over a selected island types after it.
- **The chrome occupies no layout.** Grips, add bars and the alignment cluster hang outside the grid, positioned by construction rather than measured, and out of the tab order; the cells are the whole tab order.
- **A cell edit is one `nested` step**, so every anchor in the field survives it.

### Task items

**The checkbox is outside the item's content**, so no caret reaches it and a toggle is one transaction. No shorthand mints a task item.

### Vocabularies

**The PM schema names the whole vocabulary and nothing beside it**, so no projection writes a name the store does not hold. A paste reaches a node without having been `Content`, so the island rule refuses a type no leaf edits.

### Inline mode

**A `text` field's schema declares no mark types.** Mark-freedom is the schema's rather than a rule per path, because the boundary refuses a marked `text` value only at render, where no commit-time gate catches it.

**A `text` field writes its whole literal string through `writer.set`.** A content object would round-trip through markdown and change what the author typed.

**`codec/prose.css` predicts nothing about the size a quill sets a span at.**

### Markdown at the edges

**Markdown never represents an edit.** It reaches a field only at serialize, paste and copy.

**Paste parses HTML against the schema, so markdown spelled inside markup arrives literally.** Plain text that opens a markdown block is parsed; a one-line or `text` leaf never parses.

**Copy and paste are a tier**: every attribute the schema writes to the DOM is read back, so an ordinary copy destroys nothing. An island id a field already holds is re-minted on the way in. Nothing writes markdown to the clipboard.

### Reconciliation

**A leaf re-hydrates only on an external change**, gated by canonical-content equality scoped to that field. Content normalizes on write, so `decode ∘ lower` is idempotent only up to normalization, and caret continuity across a leaf's own edits is PM's step mapping.

**A re-hydrate is one step outside the undo history**, replacing only the span that differs, so undo takes back the leaf's own edits and leaves another writer's.

## The preview

**The preview is a pure view.** It paints and reads geometry off a `LiveSession` the consumer opened, and never mutates it, so one session can take edits from any source. Every option is bound once; a swap is the consumer's.

**The preview leaves no ink of its own on the page.** It is the surface a user proofs against, so nothing advertises clickability and nothing marks the editor's active field.

**Paint is bounded by what is visible.** A canvas per visible page plus a margin, mounted and unmounted on scroll. A page that fails to paint shows a message in its slot rather than blanking the pane.

**One zoom for every page**, as a fraction of actual size, so type is one size across a portrait memo and its landscape attachment.

### Click bridge

**Two rungs and no third.** `positionAt` answers with an offset over span-tracked content; `fieldAt` answers with no offset over every placement the compile tracks, and the bridge asks the finer first. An absent `pos` is the coarse rung; a fabricated `0` would be an invented offset. Rejected: a rung over `regions()`, whose rects are bounding boxes over ink the field does not fill, so hit-testing them would land clicks the compile never claimed.

**The slack is the pointer's imprecision**, so it is fixed in screen pixels and converted per click.

**The consumer completes the caret move**, because only the editor's codec maps a content offset to a ProseMirror position.

### Follow-the-caret scroll

**The preview scrolls its own scrollport and nothing else.** `scrollIntoView` would walk every scrollable ancestor and drag the host page away from the surface the user is typing in.

**The discrete hop centres; the follow moves only when the caret leaves the fold.** The hop outranks the follow and ends it, and a focus change ends it too, since a leaf with no caret would otherwise keep pulling the pane back.

**A miss is an answer, not a failure.** The plate places plenty it does not track, so a field the compile placed nothing for is not an `onError` report.

**A wash moves nothing**: a pane that jumped to it would take the reader off what they were reading.

## Hosting

The seam a consumer owns once it mounts the surfaces over live handles.

**A host that stores markdown owns the round trip**, and projects on the change, not on a timer: a keystroke lost to a projection debounce is lost to a crash. Debounce the recompile instead.

**Guard a reopen with `doc.equals`.** An autosave whose store echoes the saved text back would otherwise reparse and remount on its own output, dropping the caret mid-keystroke.

**The editor lands before the session.** The editor needs only `doc` and `quill`; the first open loads the render build, which is large, so the host opens the session behind the editor over the document as it stands. A reopen is async and can race, and the loser frees what it opened rather than installing it.

**The host frees what it made, and nothing else.** A `Quill` from `@quillmark/quiver`'s `getQuill` is borrowed, so freeing it breaks the next caller.

**`session.update` is transactional**: a document that cannot compile leaves the last good compile painted, so a host shows the failure beside the preview, not instead of it.

**A field is addressable only where the compile placed something it can name**, which is the quill's decision, not the editor's. A bridge that reaches too little is answered in the quill.

## The playground

`packages/playground` is the reference wiring for the glue the primitives push outward, the manual harness for what unit tests cannot reach, and the project's landing page. How to reach it from source is its [README](../../playground/README.md).

**The playground consumes only the published subpaths**, so a needed internal is an API gap to fix.

**It stays a harness, not a product**: no auth, no multi-doc management, and no persistence but a `?collab=` room's.

**The bridge between the panes is consumer-layer glue.** The editor emits places and the preview emits hits, and the shell joins them, so neither surface imports the other.

**It draws with the preset, the import a third-party consumer makes**, so it looks like the endorsed version by construction. An app scale may not restate a name the preset defines, and two app scales may not mint one concept at two values; a rung two app scales have to keep agreeing on belongs in the preset.

**The front page mounts what it describes**, over a session opened exactly as a consumer's is, so nothing on it claims a capability the mounted surface is not already showing. What only a hand driving the harness needs is a query flag rather than chrome.

**A harness flag lives in the URL, not the browser**, so a link in a report reproduces the document it was copied from.

**Every quill comes from a quiver, not the bundler**, so no Typst source or font bytes are in the JS bundle. The app is the workspace's one edge to `@quillmark/quiver`, and where the two tiers meet.
