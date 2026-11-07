# Codec

> **Implementation**: `src/lib/core/codec/`

## TL;DR

The bidirectional codec between one content field (`Content`) and one ProseMirror document: decode (content → PM), encode (a PM edit → a `Change` for `apply`), and the position map that carries the caret between them. One field, one PM doc; the VisualEditor composes many. Markdown is not in this loop: it is an edge format (§"Markdown at the edges"), never the edit representation.

Grounds on quillmark's content model and edit surface (quillmark `prose/canon/CONTENT.md`, `DOCUMENT_STORAGE.md`, `CONVERT.md`).

## The two models

`Content` is one flat `text` (`\n` opening a block, `U+2028` a hard break, `U+FFFC` an island slot) plus records over it: `blocks` with a kind and a path of container ids, the `containers` those paths name, freely overlapping `marks`, comment `anchors`, and `islands` whose cells are nested `Content`. Every part carries an id and nothing positional is stored. Offsets are UTF-16 code units.

ProseMirror is a nested node tree whose text carries a set of marks and whose positions count node boundaries.

The codec's whole job is **flat text with attributes ↔ nested tree**. It is a translation layer, not a thin adapter: content normalizes on every write, PM has no overlapping or zero-width marks, and neither side's positions are the other's.

## Direction: the content is truth; PM is its projection; edits are ops

Decode is a pure function. Encode does not hand the store a rebuilt `Content`: it projects the new PM doc back to content and asks the store's own `diff` for the `Change` between the stored value and the projection, which `doc.apply` takes. Ops rather than a replace because **anchors survive** (a `Change` moves each anchor exactly as it moves its text), and a whole-field diff rather than a step replay because the codec then restates none of the store's rules about where a mark or an anchor lands.

`replace` is left for a field not yet at content rest (unset, or an authored string) and for an `apply` that throws. A `text` leaf commits its whole literal string through the typed writer instead (§Inline mode).

## Decode

Fold the flat segments into the tree: a run of blocks sharing a container id is that container, and a block's kind selects its node. Every block and container node carries its id, so the projection hands each back under the id it was read with. Marks apply over their ranges, PM splitting text at mark boundaries, so overlapping formatting survives. An island slot decodes to an inline node, or to a block node when a block island stands alone on its line. A construct no leaf edits (a footnote, an equation) holds the leaf read-only rather than being flattened.

## Encode

`lower(old, new)` projects the PM doc to `Content` (`pmToContent`) and answers the store's `diff`, or `null` where the two are one value. Node ids carry over; a new node takes the next id past the highest the field holds.

**The projection is total over the schema.** Every document the leaf's commands can reach projects to a valid `Content`; a projection the store refused would leave the leaf diverged from its field for the session. The property is asserted over the whole chain (`decode → edit → project → lower → apply`) in `tests/codec/roundtrip.test.ts`. The leaf also holds one spelling of each shape, normalizing what commands leave (`breaks.ts`), so `decode(stored)` is the document the leaf is holding.

## Positions

`offsetToPM` / `pmToOffset` (`positions.ts`) map a UTF-16 content offset to a PM position and back. The map is a list of runs tiling the text, built in the same walk as the projection so the two cannot disagree, and searched by bisection so mapping every anchor on every commit stays cheap. A preview hit and a caret signal both pass through it.

## Marks

The content's marks are two classes routed to two PM mechanisms:

- **Formatting** (`strong`, `emph`, `underline`, `strike`, `code`, `font_family`, `link`) is a property of a range, so it maps to PM marks.
- **Identity** (an anchor for a comment thread or a stable reference) is a zero-width handle, not a property, so it maps to plugin-held positions keyed by id and carried through `tr.mapping`.

Keeping identity off PM's mark mechanism is what dissolves the overlap problem: overlap only bites where identity and formatting coexist, and they never share a mechanism.

A link renders through a scheme allowlist, since an `href` is an attribute value the markup escaping never reaches. The gate is the render's, not the model's: a refused href stays on the mark and round-trips.

## Islands

A table, image, footnote or equation is one `U+FFFC` slot plus an island entry `{id, type, props, slots?}`, and the whole entry rides one PM node. An island edit lowers through the same `diff`: a props change is an `island` step and a cell edit a `nested` step, so every anchor in the field survives it. A minted island id continues the field's `isl-{n}` sequence rather than using a UUID or a clock, because the id is part of the document's canonical bytes.

## The table island

A table's props are a rectangular grid whose cells hold inline text and marks. It is edited through a NodeView (`table-view.ts`, `table.ts`) holding one nested `EditorView` per cell, on an inline schema plus hard breaks, sharing the leaf's undo history.

The decisions that shape it:

- **The rectangle is an invariant with no error channel**, so every row and column op goes through one rectangularizing constructor. A ragged table would leave PM and the store disagreeing silently.
- **A pointer press resolves to a caret.** The table has cells, so a press inside the frame focuses the nearest cell and a press beside it lands a caret beside the table. Only a grip acts on a line.
- **A selection is the subject of the next command**, never armed for replacement: a printable key over a selected island types after it rather than destroying it.
- **The chrome occupies no layout.** Grips, add bars and the alignment cluster hang in a band outside the grid, positioned by construction rather than measured, and are pointer chrome out of the tab order; the cells are the whole tab order.
- **A cell edit is one `nested` step**, so a keystroke in a cell is a splice in that cell's slot.

The keyboard model (Tab and Enter growth, Escape and select-all climbing a rung a press, line verbs on a held rectangle) and merge, split, alignment and widths are the code's and `tests/codec/table.test.ts`'s.

## Task items

A task item is a list item whose `checked` is a boolean (`tasks.ts`). The checkbox is the item's control, outside its content, so no caret reaches it; a toggle is one transaction. Task items arrive by source mode and by paste; no shorthand mints one.

## Vocabularies: closed sets, and the `x-` names

Block kind, container kind, mark type and island type each name a closed built-in set, and a block, mark or island spelled `x-` is held as written and round-trips. The PM schema names the whole vocabulary and nothing beside it, so no projection writes a name the store does not hold. Each place that names a set names it against the boundary's union ([DOCUMENT_MODEL.md](DOCUMENT_MODEL.md) §"Stability seams").

The DOM is the one door with no decode behind it: a paste reaches a node without having been `Content`, so the island rule refuses a type no leaf edits.

## Inline mode

The same decode, lower and position machinery runs over narrower schemas:

- A **one-line** field runs one textblock with no splitting.
- A **`text`** field declares no mark types at all. Mark-freedom is the schema's rather than a rule per path, because the boundary refuses a marked `text` value only at render, where no commit-time gate catches it. A one-line `text` is one mark-free textblock; a multi-line one runs `plainSchema`, paragraphs and breaks.
- A `text` field's codec is the boundary's: it reads through `reader.getContent` and writes its whole literal string through `writer.set`. A content object would round-trip through markdown and change what the author typed.

`codec/prose.css` is the stylesheet every prose leaf shares; it states that a span is code and a line is a heading, and predicts nothing about the size the quill sets them at.

## Markdown at the edges

Markdown never represents an edit. It reaches a field at three doors:

- **Serialize**: `Document.toMarkdown()`, read-only and canonical.
- **Paste**: HTML runs through ProseMirror's DOM parse against the schema, so lists, headings and marks survive and markdown spelled inside markup arrives literally. A few deliberate readers reach past that: a table from HTML or tab-separated text becomes a table island, Word's list paragraphs become lists, and plain text that opens a markdown block is parsed through `importMarkdown`. A one-line or `text` leaf never parses. A pasted list takes the numbering of where it lands.
- **Copy**: PM's own serialization, plus a table as HTML and tab-separated text. Nothing writes markdown.

The copy and paste pair is a tier: every attribute the schema writes to the DOM is read back, so an ordinary copy destroys nothing. An island id a field already holds is re-minted on the way in.

## Reconciliation

Content normalizes on write, so `decode ∘ lower` is idempotent only up to normalization. The editor therefore holds its optimistic PM state and re-hydrates a leaf only on an **external** change (another writer, a `revise`), gated by canonical-content equality scoped to that field. Caret continuity across a leaf's own edits is PM's step mapping, so an own edit never re-hydrates.

A re-hydrate is one step, not a rebuild: the decoded content replaces only the span that differs, outside the undo history, so undo takes back the leaf's own edits and leaves another writer's (`remote.ts`). A caller holding the remote change's delta maps the caret through it.

## Seams

- **Anchors are plugin positions, not marks.** A selection mints one through `insertAnchor(id, pos)` / `removeAnchor(id)`; the id is caller-supplied, unique and invariant per the boundary's anchor-id policy.
- **The `replace` fallback** is the exception, not the path: an unset field and an `apply` that throws.
- **Input rules are shorthands.** Each block rule runs the same command a slash pick runs (`blocks.ts`), so a construct's two doors are one implementation. A table is inserted by the slash menu or a paste, not a rule.
