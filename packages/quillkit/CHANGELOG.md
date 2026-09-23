# Changelog

`quillkit`. An entry is written into `## Unreleased` by the change that earns it; a release promotes that body to its own version section.

## Unreleased

**`quillkit site --drafts` packs the draft space.** Versions below `0.1.0` reach the laid-out quiver, so a deployed studio previews a collection's prototypes as `quillkit studio` does locally. Without the flag `site` takes quiver's floor as before.

## v0.7.0 - 2026-09-23

**The carried `@quillmark/wasm` is 0.115.0, and a quill may declare three shapes it could not.** `type: matrix` with a `members:` roster, one flat `{id: Title}` mapping, `ui.layout: "table"` on an `array<object>`, and `max:` on an array all load and reach `schema()`; `quillkit test` passes what it passed, every addition being a key a quill may declare rather than one it must. Every column of a `ui.layout: table` array is a leaf, a container column failing the load (`quill::table_column_not_flat`). A matrix member stored as a mapping is ticked only where it names `held: true`: `{ detail: X }` is unheld with its detail retained, and nothing reports it. Two more are worth knowing before an author writes one. A `max:` never gates render — an overflowing document warns `validation::cardinality` at the field's own path and renders — while a `default:` or `example:` longer than the cap fails the load (`quill::{default,example}_over_max`). And a card kind declaring `body.enabled: false` warns (`quill::bodiless_card_kind`): a repeated record someone fills in is a row, an `array<object>` on the card that owns it, and the warning says so at load rather than at review. It is a warning and not a refusal because a bodiless positional kind — a page break, a rule, an inserted signature block — is a card, and nothing in `Quill.yaml` tells the loader which it is looking at.

**The studio fills what the carried release loads.** The client compiles `@quillmark/svelte` in, so what that package releases is what an author here works in: a `matrix` draws its roster as ticks with columns under a held member, a `ui.layout: table` array a grid, a `max:` a disabled add chip beside its count, and a container nested at any depth its own control at the next rung, where the studio drew a line pointing at the source view. A preview click at a nested address opens each row on the way to the cell it names.

**0.6.0's notes misname both siblings its client carries, and 0.2.2's the quiver.** `carried.json` reads each sibling's manifest at the commit a release builds from, and a sibling whose own release has not merged yet states its previous version over source that is already the next one's. 0.6.0 compiles in `@quillmark/svelte` 0.11.0 and `@quillmark/quiver` 0.28.0 under 0.10.1 and 0.27.0; 0.2.2 compiles in `@quillmark/quiver` 0.22.0 under 0.21.0. The 0.2.2 section is corrected here. Those tarballs' `carried.json`, and the `__CARRIED__` their clients report, keep the numbers they were built with.

## v0.6.0 - 2026-09-16

**The carried `@quillmark/wasm` is 0.113.0, and a quill loads under a stricter reader.** Five shapes `quillkit test` passed now fail the load, each naming itself: a `main:` that is not a mapping or carries an unknown key (`quill::invalid_card_schema`), a `ui.group` on a card with no `ui.groups` registry (`quill::implicit_group`, promoted from a warning a binding host never saw), more than 1000 declared fields on one card (`quill::too_many_fields`), a retired `Quill.yaml` key — `must_fill`, `enum`, `ui.order`, `richtext(inline)`, `markdown` — under serde's unknown-key text in place of its own sentence, and a vendored `packages/<dir>/` with no `typst.toml`, which is skipped with a `typst::package_manifest` warning where it used to load under a synthesized `@local/<dir>:0.1.0`. Write the two-line manifest the fallback stood in for.

**The studio hands the document back as a file.** **Download PDF** in the head writes `name@x.y.z.pdf` from the compile the preview is painting, so what is on screen is what is in the file — including a stale paint, which the strip over the preview already names. It is drawn where the quill's backend emits a PDF, that being the one format a document leaves as one file in; `svg` and `png` emit a page apiece. A quill whose PDF spine refuses what its canvas paints says so in that same strip, the emit being a lane the preview does not run. Beside it, **Edit source**'s own download says `.md`, the two doors now naming what they write.

**A plate's `form-field` keeps `text` and `signature`.** A checkbox or a dropdown widget fails the helper's type assert, and `options:` is not a parameter: an interactive non-text widget is the form backend's, so such a form moves to an `acroform` quill or the plate draws the box itself. The backend `pdfform` is `acroform` at every layer — the `backend:` key, the `pdfform::*` diagnostic namespace, the cargo feature — with no alias, so an unmigrated quill fails at render with `engine::backend_not_found` and a half-migrated one at load with `quill::unknown_section`.

**A document is fenced `~~~` and nothing else.** A `---` at document start opens no root block: it is a thematic break and a setext underline again, so a document fenced that way fails `parse::missing_quill`, whose message names the edit when the block declares `$quill`. Every column-zero `~~~` block is a card whatever its info string, `~~~rust` included, so a backtick fence is the whole escape hatch. A `.quillignore` is not read: a bundle carrying one ships it as an ordinary file, and whatever it excluded ships too.

**An image in a content field draws nothing and warns.** What a content image's `url` names is undecided, so the Typst backend lowers the island to nothing and mints one `backend::declined_construct` warning per content field — a sixth warning family, and the first a backend observes rather than a quill declares. The example render still passes: `quillkit test` asks for artifacts and reads no warnings, so this reaches an author through `RenderResult.warnings` at a surface that prints them. Storage is untouched: the island still parses, stores and round-trips.

**Every member of the content vocabulary spells its payload in `attrs`, and the vocabularies are closed.** A quill under test is unaffected by either: both are wire shapes, `quillkit test` reads diagnostics rather than content, and a quill's own markdown and Typst are untouched. What moves is a golden held over rendered bytes — coincident marks reorder on the tie-break and the generated Typst nests their wraps the other way for identical glyphs — so a content hash or a Typst golden recomputes once.

**The previous carried step, 0.111.0, made the PDF spine check what it was trusting.** `quillkit test` refuses two shapes it passed: a pdfform base carrying its own `/AcroForm` (`pdf::existing_acroform`), which shipped a double-form PDF whose behavior was the reader's choice, and a non-finite widget rect (`pdf::bad_rect`), which wrote an unparseable PDF. Both are the quill's to fix — strip the background, correct the `form.json` geometry — and both are PDF output only, SVG and PNG drawing values regardless.

**A `quillkit.config.js` that throws fails the gate, and an artifact that will not load says what broke.** A config carrying a syntax error, a specifier that does not resolve or a throwing statement names the file and the error under it, where it read as a config that was not there and the gate rendered every quill through `@quillmark/wasm` and printed a pass table for it. Absence is the only fall-through and it is the filesystem's answer, not an error's. The artifact splits the same way: one that will not resolve names its install, and one that will not import or will not instantiate carries what threw.

**`--quiver=<dir>` is read.** A verb took the flag as `--quiver <dir>` alone, so the `=` form matched nothing and every verb fell back to the working directory — `quillkit test`, the documented gate, graded the wrong tree and exited 0 on it. Both spellings are read now.

**Studio's address bar names the quill on screen.** `?quill=showcase@1.0.0`, the grammar `getQuill` already takes, so a selector (`?quill=showcase`, `?quill=showcase@1`) resolves through the quiver. A boot opens what the URL asks for where the quiver holds it and the catalog's first quill otherwise, and a pick, a document that names its own quill, or a repack writes the ref back. A query rather than a path segment: a deploy is static files behind whatever host the author has, and a query participates in no file resolution and drops out of the relative base the client reads its quiver off. A reload keeps the quill and still reseeds the document.

**A collection installed under `node_modules/` repacks on an edit.** The watcher read `node_modules` and `.git` segments of the absolute path rather than of the path below the watch root, so a quiver at `node_modules/@scope/quills` — the way canon points studio at an installed collection — had every file under it read as the pack's own write, and studio silently never repacked.

**Studio's source panel keeps a draft through a drag that ends outside it.** A click's target is the nearest common ancestor of press and release, so dragging a text selection past the panel edge released at the dialog and discarded the edited draft with no confirmation. The close checks where the gesture began too.

**The studio server closes what a cancelled request opened.** A read stream piped into a response had no teardown of its own, so a client cancelling mid-body left the fd open for the life of the process; one erroring on a file a repack removed under it took the server down mid-session. `quillkit <not-a-verb>` prints usage for every spelling, `toString` included.

**The README states what a host owes a deploy, and every recipe gates before it packs.** Four rules: `assets/*` immutable, no edge cache on `quiver/latest.json`, a missing path answered as a 404, and https. The last two are the ones a default gets wrong — an SPA fallback turns a missing file into the client's own HTML under a 200, which reaches the loader as a digest mismatch, and a page off a secure context has no `crypto.subtle`, so arriving bytes go unchecked. `site` stats each `Quill.yaml` as a sentinel and parses none, so `quillkit test` stands ahead of it in the recipes rather than inside the verb.

## v0.5.4 - 2026-08-26

**The carried `@quillmark/wasm` is 0.110.0, and the gate refuses only what the render floor refuses.** A quill whose document holds a value the floor adopts — a bare scalar where an `array` is declared, `"3"` for an `integer` — passes where it was fatally `validation::type_mismatch` while rendering correctly, so a fatal validation diagnostic under test means the document does not render. A bare scalar stringified into an `enum` field is domain-checked on that string, so a spelling outside `values:` is caught where it was silent.

## v0.5.3 - 2026-08-24

**The carried `@quillmark/wasm` is 0.109.0, and a quill under test keeps two adjacent containers apart.** Two quotes in a row typeset as two, two ordered lists number from their own firsts rather than the second running on from the first, and the CommonMark idiom for spelling two lists apart keeps the second list's marker. A container inside a list item no longer ends that list either, so an item's quote or fence stays the item's and the items below it keep their numbering.

## v0.5.2 - 2026-08-21

**The carried `@quillmark/wasm` is 0.108.3, and a quill under test renders a paragraph that is one bare Typst marker.** A body holding the `/` that opens the slash menu compiles, where the studio's preview answered `expected colon` on that keystroke; the same escape covers `-`, `+`, `=` and `N.`, a marker at the head of bold text or a table cell, and text after inline code or an image opening with `(` or `.name`.

## v0.5.1 - 2026-08-19

**The carried `@quillmark/wasm` is 0.108.1, and a quill under test can be filled at depth.** A content cell under `variants:` reads at its codec, so the studio's editor mounts a leaf over one where it stood a line pointing at the source view; the same holds for a content property of an `object`. A quill whose classification world is four `plaintext` cells is fillable from the visual surface.

## v0.5.0 - 2026-08-19

**The studio carries the editor's nesting ladder, its pressed-header hold and the preview's bounded fold.** The client compiles `@quillmark/svelte` in, so what that package releases is what an author here works in: depth stated by verticals rather than rules across a block, a pressed section header held in the fold as the one above it collapses, a discrete hop that outranks the follow, and a caret into a table cell that takes the scroller with it. The shell taking the viewport's width rather than its widest mount is the studio's own — it is the surface that spends the whole screen on two mounts, and a host holding its content to a maximum never saw it.

## v0.4.0 - 2026-08-18

**The carried `@quillmark/wasm` is 0.108.0.** A quill under test gains depth and two shapes. Every type nests at every position the schema admits, so a property or an element declares whatever a card-level field declares, itself included; an enum may declare `variants:`, per-member fields that exist only in the world its discriminant selects — which the editor draws, so an author sees the cells appear and retire as they pick — and a plate may claim the ink it composes for a field with `field-region`, which puts a computed block in the region table the preview reads.

**A plate under test loses `plaintext(field)` and the date wrapper.** The helper exports no content-to-string coercion, and a present date is a native `datetime` whose ink is reached by schema address: `display("issued", "[year]")` where `(data.issued.display)("[year]")` stood. Both old spellings are compile errors rather than silent degrades, so a plate carrying one stops rendering in the studio until it moves. Five schema declarations fail load: a nested `richtext(inline)` literal over more than one paragraph, a container-shaped literal on a variant-bearing enum, two variants declaring one name differently, a `default:` or `example:` on a typed dictionary, and `must_fill:` anywhere at all — the last two naming the migration in the diagnostic, since obligation is now a reading of `default:` rather than a key beside it.

**A quill under test carries its defaults per cell.** An absent container descends into its properties, so a cell's `default:` reaches the plate whether or not anything above it is authored — a shape a studio note used to report as unanswered while the render printed the value. The studio's `must_fill` notes are unchanged in code and narrower in fact: they name the cells that declare no `default:`, and a typed dictionary is not one of them.

**A release's notes name what its tarball carries, read off the tarball.** The line was minted from the release branch while the client is built from the merge commit, so a sibling release landing between the two made them disagree: 0.2.1's notes name a `@quillmark/svelte` its client does not carry, corrected here. `dist/client/carried.json` is the one mint, the notes render it, and the promoted changelog section carries no copy.

**`studio` packs drafts; `build` and `site` no longer do.** Quiver's floor leaves quills under `0.1.0` out of a built artifact, and the two verbs that write deployments take it. `studio` is the author's own viewer, so it asks for the whole tree and a quill mid-draft stays on screen.

## v0.3.0 - 2026-08-14

Carries `@quillmark/svelte` 0.5.0, `@quillmark/quiver` 0.23.0, `@quillmark/wasm` 0.105.0.

The carried `@quillmark/wasm` is 0.105.0. A quill under test declaring `""` among an enum's `values:` now fails to load, the blank being the engine's to supply; and the studio's notes gain a `must_fill` warning per obliged cell the document leaves unauthored, which is the studio reporting the completeness signal a consumer's editor will show.

The studio's paint stops following the caret when the focus lands on a leaf that reports none: a click into any form control left it following the leaf the focus left, and each keystroke typed into the control scrolled the paint back there. The bridge wires `onActiveLeafChange={preview.endFollow}` beside the caret hop it already had.

## v0.2.2 - 2026-08-13

Carries `@quillmark/svelte` 0.4.0, `@quillmark/quiver` 0.22.0, `@quillmark/wasm` 0.104.0.

The carried `@quillmark/wasm` is 0.104.0. The studio and `test` name no field address and read no schema domain, so the release's breaks reach neither; a quill under test that authors the retired `enum:` modifier now fails to parse, which is the studio reporting what the engine will.

## v0.2.1 - 2026-08-11

Carries `@quillmark/svelte` 0.3.1, `@quillmark/quiver` 0.21.0, `@quillmark/wasm` 0.103.0.

## v0.2.0 - 2026-08-11

Carries `@quillmark/svelte` 0.3.0, `@quillmark/quiver` 0.21.0, `@quillmark/wasm` 0.103.0.

The carried `@quillmark/wasm` is 0.103.0, where `init()` is the only door to `Quill` and `Document`. The studio and `test` await that gate and reach no class through it, so the resolution rules are unmoved.

**The bundle names what it carries.** The client compiles in `@quillmark/svelte`, `@quillmark/quiver` and `@quillmark/wasm`, and nothing in a consumer's tree records which copies: a browser resolves nothing, so there is no dependency edge to read. `dist/client/carried.json` names all three beside the bundle, the running client holds the same three in `__CARRIED__`, and each release's notes state them in one line. Each is the version its manifest states.

## v0.1.1 - 2026-08-08

The studio client carries the scale it draws with. The `@quillmark/svelte` it bundles declared itself prunable, so `vite build` dropped `core/theme.css` and the codec's three stylesheets out of the client: `studio` and `site` both served an editor whose controls had no border, no background, no padding and no tap floor, under chrome that read as intact. The tool ships its own client, so the fix arrives with this version rather than with a consumer's install.

## v0.1.0 - 2026-08-08

First published version. One bin over the whole author loop: `quillkit test` gates a quiver, `quillkit build` packs it, `quillkit studio` serves the surface over a repack loop, and `quillkit site` lays a deploy out. It replaces the `quillmark-quiver` and `quillmark-studio` bins, and `quiver.config.js` is `quillkit.config.js`.

It ships no runtime dependencies. The loader that packs and the engine that renders are resolved out of the collection's own `node_modules`, so a collection pins the format its quiver is written in and one copy packs however the pack is reached. The studio client is carried rather than resolved, at `dist/client`, so `studio` and `site` need nothing installed to serve it and take no flag naming another. It replaces `@quillmark/studio`, which is not published.
