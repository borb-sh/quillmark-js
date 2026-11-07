# Document Model: Boundary Ledger

> **Implementation**: `@quillmark/wasm` (the consumed surface, imported from the peer directly) · `src/lib/core/` (what the package adds at the seam)

## TL;DR

This is not a document-model design. The `Document`, its mutators, the WASM boundary and diagnostics are quillmark's, each with a home in quillmark canon. This ledger says which parts of that surface `@quillmark/svelte` stands on and where the seam is. The version is pinned in the root `package.json` and held by `check:deps`; the exact verbs are held by `tsc`, which fails the moment package code calls one the artifact stopped exporting.

Cross-repo references read `quillmark prose/canon/X.md` (a different repo; links do not resolve).

## What the package stands on

| Concern | Consumed by | Quillmark canon |
| --- | --- | --- |
| The `init` gate, the only door to `Quill`, `Document` and the free functions | everything | `BINDINGS.md` |
| Seeding, schema and card kinds | VisualEditor | `SCHEMAS.md`, `CARDS.md`, `QUILL.md` |
| The schema-bound writer and reader (`quill.writer(doc)`, `quill.reader(doc)`) | VisualEditor | `PROGRAMMATIC.md`, `SCHEMAS.md` |
| Card structure and the `$ext` map | VisualEditor | `CARDS.md`, `DOCUMENT_STORAGE.md` |
| Op-grained content edits (`apply`, `diff`, `replace`) over one `Addr` | codec | `DOCUMENT_STORAGE.md`, `CONVERT.md` |
| Markdown edges and `DocPath` parse/format | codec, routing | `CONVERT.md`, `references/markdown-spec.md` |
| Validation and diagnostics | VisualEditor | `SCHEMAS.md`, `ERROR.md` |
| `LiveSession`: paint, geometry, hit-testing | Preview | `PREVIEW.md` |
| The host's font library (`FontFace`) | VisualEditor, host | `BINDINGS.md` |
| The host's text edge (`Document.parse`, `toMarkdown`, `equals`) | the host alone ([HOSTING.md](HOSTING.md)) | `DOCUMENT_STORAGE.md` |

Nothing re-exports this surface. `/core` carries only what the package itself declares over it: the address vocabulary, the error channel, and `init`.

**A content field is read through the schema, never raw.** A field can rest as a content object or as the authored string a transport-door load left, and `reader.getContent` / `getContentAt` decode by declared type at any depth, so the storage form is never the editor's business. Writes go by op where the field has an address and by value (the whole containing field) where it does not, since `Addr` has no element axis.

**The editor drives neither ingestion verb** (`quill.parse`, `quill.conform`). It is handed a `Document` and edits it; which door built one is the host's business.

**Moving the pin reads upstream.** The break record for a version step is quillmark `docs/migrations/`. A type checker reports most breaks; the rest (address respellings, schema rules, canonical-byte changes) are held by the tests beside the code that reads them.

## Stability seams

**The content vocabularies are closed past their `x-` names.** Block kinds, container kinds, mark types and island types each admit their built-ins, and a name spelled `x-` is one this build does not know, held as written. Every member spells its payload in `attrs` (`props` for an island), so a bare discriminant check narrows to the payload.

**Adding a construct upstream is a compile error here.** Nothing restates a set as a literal check, which would compile unchanged against a widened union and silently drop the new member. Each place that names a set names it against the boundary's own union (an exhaustive `switch`, a `satisfies`, a `Record` keyed by the union), so a member added upstream is a missing case.

**Shapes are read straight off the boundary**: `ContentIsland.props` per island type and `QuillCardUi.groups`, with no local duplicates. A `props` that crossed the DOM as JSON is the one place the codec reads a shape itself.

**Field addresses are one canonical `DocPath`** across `Diagnostic.path`, `ContentHit.field` and `FieldRegion.field`: `main.<field>`, `cards.<kind>[<i>].<field>`, cards by absolute document index, elements bracketed. A diagnostic and a geometry address for one place are the same string, so they join on equality. The package routes with `parseDocPath` and builds with `formatDocPath` rather than a hand-rolled grammar.

## What the editor owns at this boundary

- **Handle lifecycle**: the package's `init` (`/core`) awaits the artifact's gate and latches the result for code that cannot await (the `DocPath` formatter, the codec inside a transaction). The latch throws naming the fix rather than reading `undefined`. Who holds and frees handles is [HOSTING.md](HOSTING.md).
- **Diagnostics routing**: producers merged, keyed to field addresses and drawn inline ([VISUAL_EDITOR.md](VISUAL_EDITOR.md) §Diagnostics).

Content types and their ProseMirror mapping are the codec's ([CODEC.md](CODEC.md)); paint and geometry are the preview's ([PREVIEW.md](PREVIEW.md)).
