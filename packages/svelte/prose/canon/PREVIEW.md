# Preview

> **Implementation**: `src/lib/preview/`

## TL;DR

The live preview surface: a continuously-updating render of the output. `PreviewController` (vanilla-TS core, `createPreview`) composes the paint loop, the click/scroll bridge and the zoom over one `LiveSession`, wrapped by a thin `<Preview>` Svelte component. The subpath imports nothing editor-side: `check:deps` enforces it at the subpath's edge, which reaches its own directory and the shared modules in `core/`; the hop past those is what pulls the codec.

## Shape

The controller wraps **one** `LiveSession` the consumer already opened (`engine.open(quill, doc)`) and supplies exactly the layer `LiveSession` omits: viewport, DOM, DPR, and click mapping. It is a **pure view**: it paints and reads geometry off the session, never mutates it.

Grounds on quillmark's `LiveSession` (canon: quillmark `prose/canon/PREVIEW.md`), which is per-page, document-space geometry with no notion of a viewport.

## Ownership

The **consumer** owns the session and drives edits, from any source (source editor, VisualEditor, one-shot pipeline). The preview never calls `apply`:

```ts
const session = engine.open(quill, doc);            // consumer owns
const preview = createPreview(session, { container });
// …
const changeSet = session.update(nextDoc);           // edit from any source
preview.refresh(changeSet);                         // repaint dirty ∩ visible
```

One session, many edit sources, preview stays a view. `refresh(changeSet)` is the only lifecycle hop: it repaints `dirtyPages ∩ visible` and re-reads geometry.

## Two responsibilities

- **Paint**: one `<canvas>` per visible page (+ margin), painted via `session.paint`; mounted/unmounted on scroll, so memory stays bounded to *visible + margin* per the canon. Each page slot is a `.qm-page-slot` carrying `data-page`, its index: the hooks a consumer drawing its own overlay targets. A slot is sized by the zoom (§Zoom) and a canvas fills it (`width`/`height: 100%`), so its ink is always on the box the click and scroll geometry measure, whatever the raster was painted at. Mounted pages repaint when the scale moves (on the next frame, or once a gesture rests) and on DPR changes, skipping a page already rastered at the scale it would take. The raster's density is `devicePixelRatio` floored at 2 (`MIN_DENSITY`): glyphs rasterize unhinted, so a 1× or fractional-ratio raster resampled onto its box leaves small text soft, where one at least twice the box is downsampled and reads. When `PaintResult.clamped` caps density on an oversized page, V1 honors it silently.
- **Bridge**: clicks resolve to an address and surface as a hook; commands scroll/focus a field.

**A counted page is the whole of the paint gate.** `paint` and `pageSize` refuse only a page the count excludes. A compile with zero pages is the one state the surface stands a message in, recoverable by the next `refresh` that brings pages. A paint that throws on a counted page is caught per slot and surfaced as the render-failed message rather than aborting the sweep, so no page count leaves the pane blank and silent.

**The preview draws nothing of its own on the page.** It is the surface a user proofs against, so any ink it leaves is ink the reader has to discount. The zoom pill is the one thing it floats over the desk, at the pane's corner rather than on a page, and only while the zoom is not the default (§Zoom). Nothing advertises that the text is clickable either: the click target is the text itself, which is what a reader tries first. Nothing marks the field the editor's caret is in, and **correlating the two panes on the page is unbuilt**: the surface holds no shape for a design to inherit.

A **field box** is the rectangle on the rendered page where a schema field's content lands: the field's canonical `DocPath` address (`main.subject`, `cards.<kind>[2].name`, cards by absolute document index) mapped to on-page geometry. `fieldBoxes(field)` unions a field's segment rects into one (striped) box per page. `field` is not unique — a field split across pages or shown in header + footer surfaces several boxes — and the scroll takes the first.

**An address's boxes are `fieldBoxes`'s union, else every `regions()` rect at or under it** (`geometry.ts`, `boxesForField`; what the scroll reads). `fieldBoxes` answers `[]` for a scalar the plate places without tracking its content and for an array itself, whose own ink is composed rather than carried; the boundary says such a field's box is a single `regions()` rect. The second rung takes an address and its descendants together, because a plate reading a whole array regions the ink it composes around the rows while each element regions its own, and the field is on the page at all of it. A descendant is recognized by the character opening it, `[` for an element and `.` for a nested key, so `main.keywords_note` is not a row of `main.keywords`.

## Zoom

The rules are `zoom.ts`, pure; `viewport.ts` measures the pane, applies them, and owns the gestures and the pill.

**One scale for every page.** Every page is drawn at one zoom, a fraction of actual size (96 CSS px to the inch), so type is one size across a portrait memo and its landscape attachment, and the gaps between pages stay a fixed rung. The pane's width is the host's, never the document's (`contain: inline-size`); the page's width is the zoom's, so a page wider than the pane scrolls sideways inside it.

**The default fits the widest page to the pane's width, capped (`FIT_CAP`).** A portrait document in a split pane lands at the pane's width; a landscape page lands at that same width and shorter, rather than at the pane's height, which at a split's proportions shows it no larger. The cap stops a wide pane growing a page past a size print recognises. The default follows the pane; a zoom the reader set holds across a resize, against the floor.

**The floor is the whole page in view.** Zooming out stops where every page fits the pane with a fixed share of it filled on the page's limiting axis (`FLOOR_FILL`), and never past the default: a smaller page is empty desk with nothing gained. The ceiling is `MAX_ZOOM`.

**Gestures, and no toolbar.** Ctrl/⌘-wheel (the trackpad pinch Chromium and Firefox send as one), Safari's gesture events, a two-finger touch pinch, and Mod `+`/`−`/`0`. Each holds a point still, as a fraction of the page under it since the gaps do not scale: the pointer, or the pane's centre for a key pressed with the pointer elsewhere and for the reset. The touch pinch holds the point between the fingers and carries it with their midpoint, so a two-finger drag pans; the desk's `touch-action` keeps the browser's own pinch off. The spread zooms only past `PINCH_SLOP`, so a drag leaves the default fit standing. A re-fit to a resized pane holds the line at its top edge and re-rasters once the resize rests, a dragged divider being a gesture. The keys step through `STEPS`, a subset of browser zoom's levels, with the default fit among them in place of any level within `DETENT` of it, landing on the nearer level from between two and skipping any under the floor; Mod-`0` returns to the default. A continuous gesture holds at the fit and at 100% where it crosses either, at the first it meets, and leaves once carried `DETENT` past, moving on from the hold by the gesture's own ratio rather than jumping to where its events would have put it, so the fit and actual size are each one gesture away; a 100% within `DETENT` of the fit gives way to it, two holds that close pinning a slow gesture between them. **A zoom that lands on the fit is the default again**, so it follows the pane from there and the pill goes, which is the whole of what marks the fit: the pill carries no word for it. The keys are the focused pane's alone, as a viewer's are: with the focus elsewhere, a click on a page having landed its caret in the editor, they stay the browser's own zoom even with the pointer over the pane; a key a host's handler already took is left alone.

**A diagonal pan is the pane's own.** Over pages that overflow both ways, a pixel wheel carrying both axes scrolls the pane in the viewport rather than the browser, since macOS rails a trackpad scroll that leans on one axis to it and the pages are panned, not read down. A delta on one axis, a mouse wheel's notch, and a scroll at the edge stay the browser's, so a notch keeps its smoothing and an edge chains on.

**The pill says only the percentage and resets on a click**, a behaviour learned by using it rather than one a label announces. It exists only while the zoom is not the default, hides `IDLE_MS` after the zoom last moved unless the pointer is on it, and comes back when the pointer nears its corner or the zoom moves again. On a screen with no hover it never hides, there being no pointer to bring it back; Mod-`0` reaches the same reset with it hidden. It stands in a zero-height dock, sticky at the bottom of the desk's flex column, so the corner is the pane's however short or wide the pages are.

**A gesture re-rasters once it rests.** Every event resizes the slots; the stretched canvases stand in until `SETTLE_MS` passes without another, since a paint per event is a full raster of every mounted page per event.

**Where the divider sits is the host's.** The preview fits whatever pane it is given and never asks for a wider one; a host that remembers a split per orientation reads the page sizes off the session itself.

## Click bridge

The preview owns the pixel→pt math (inverse of the rect→`%` transform) and the session queries; the consumer completes the caret move, because only the editor's codec maps a content offset to a ProseMirror position.

```
click → PDF-pt → session.positionAt(p, x, y, tol) → ContentHit ─┐
             └─► session.fieldAt(p, x, y, tol)    → { field }  ─┴► onPick(at)
                                                                 ↳ consumer:
                                                                   codec.usvToPM → setCaret
```

**Two rungs, and the second is the plate's.** `positionAt` answers over span-tracked content; `fieldAt` answers over every placement the compile tracks, which is a strict superset (a whole-page sweep of the reference quill finds no point where `positionAt` answers and `fieldAt` does not). Where composed ink meets the element it surrounds, `fieldAt` names the container of what `positionAt` names; the ladder reads `positionAt` first, so a click lands the finer of the two. So the second rung fires exactly where a field is printed without its content being tracked, which on a memo is the front matter: `main.signature_block`, a card's.

**An absent `pos` is the placement rung**, and one hook carries both (`Landing`, `/core`): a pick names its field either way, so the coarse case is a pick with no offset rather than a second hook. A fabricated `0` would be an invented offset. `granularity` is the only precision axis, and reads where there is a `pos`: `'cluster'` → caret-exact, `'segment'` → focus the field/segment, no exact caret.

**What either rung can name at depth is the plate's, and a scalar cell is out of reach.** A content value carries its own spans, so a `richtext` or `text` cell regions wherever it is placed — through a loop binding, at any depth: `#for rev in data.revisions [#rev.detail]` regions at `main.revisions[0].detail`. A scalar carries none, so its address is the read path's, and the codegen tracks a literal one only: `data.revisions.at(0).pages` regions at `main.revisions[0].pages` where `data.revisions.at(i).pages` regions at `main.revisions`, the whole array. An array a plate prints by looping — which is every array whose length the document decides — therefore names its rows through their content cells and through nothing else.

**There is no third rung hit-testing `regions()` by hand.** Its rects are bounding boxes over ink the field does not fill — `main.body`'s union spans the gap between two disjoint segments — so a click in that gap would land on the body by geometry the compile never claimed.

**Both rungs carry a slack instead.** A glyph's hit box is its line's ink by that glyph's own advance, so the boxes along a line abut and the leading between two lines is inside the paragraph and on no glyph: the reference quill's body sets 9.3pt of ink on a 16.1pt pitch, and a click in the rest of that column answers nothing for a reason the reader cannot see. Each query takes a tolerance in points and answers with the nearest ink inside it, so a point in the leading takes the line it is nearer, in the column it was clicked in — which is where a caret goes. It stays a click on ink some placement drew, unlike a bounding box, and a point far from all of it still lands nothing.

**The slack is the pointer's, so it is a fixed size on the screen** (`CLICK_SLACK_PX`, `bridge.ts`) converted per click at the scale the slot is drawn at (`pxToPt`). One fixed in points would shrink exactly as the target does, and a narrow pane draws the page small, where a line is hardest to hit.

**The slack is the pointer's imprecision, not the leading's measure.** The session ranks by distance, so the slack only fills a miss: ink under the pointer keeps the click. A slack grown to the leading would place a caret in a paragraph from a click on the margin beside it, so the residue stays: whatever a wide pane leaves of the leading, and a line past its last glyph. Both are a line box's to close, and a line box is the backend's.

## Follow-the-caret scroll

`focusPosition` locates the caret rect and `scrollToField` a field's first box; both place a throwaway absolute marker at the `%` position, measure it, and remove it, so the trip is computed off the page box's own proportions and needs no separate zoom or DPR term.

**The preview scrolls its own scrollport and nothing else.** `container.scrollTop`, never `marker.scrollIntoView()`: that walks *every* scrollable ancestor, so a host whose document scrolls has the whole page dragged to the preview by a keystroke in the editor, taking the surface the user is typing on off screen. Instant, and with no `prefers-reduced-motion` term: no `scroll-behavior` on the container means no motion for one to cancel.

The rule is this pane's, and it is about the keystroke rather than about the call: a continuous signal must not move a surface the user is not acting in. A landing in the editor is the opposite case and answers the opposite way — the user clicked here to edit there, and the editor holds no scrollport of its own to move ([VISUAL_EDITOR.md](VISUAL_EDITOR.md) §"Focus and the preview bridge").

**A miss is an answer, not a failure.** `scrollToField` returns whether this compile placed anything at the address. The plate places plenty it does not track, so a `false` is ordinary; and the preview carries no schema, so it cannot tell that case from a field the host misnamed. The editor's `focusField` is what distinguishes them — it holds the mounted tree and reports `target-unknown` for a name it has no field for ([VISUAL_EDITOR.md](VISUAL_EDITOR.md)). It is not an `onError` report: that channel carries failures a surface recovered from.

**The two commands split on what their inputs are** ([VISUAL_EDITOR.md](VISUAL_EDITOR.md) §"Focus and the preview bridge"). `scrollToField` is a discrete act, so it centres every time. `focusPosition` is the continuous signal (one call per keystroke and per arrow key), so it moves the pane only when the caret is not clear of the fold: the caret rect's own height of clearance at each edge, since a rect flush against one is visible and unusable, and the next line typed lands past it. Across, a caret on a page zoomed wider than the pane is brought into view by the least trip, which leaves the line the reader is on where it is. The clearance derives from the target, so it scales with zoom as the caret does. A preview click is such a call too: the click already put its target on screen, and the `setCaret` it drives comes back through `onCaretMove` as a caret move the fold guard answers.

**The clearance is bounded at both ends** (`clearOfTheFold`). Floored, so a rect reporting no height is not clear against the very edge it sits on. Capped against the room the port has to spare, so a target too tall for its own clearance passes once centred instead of being re-centred by every keystroke. A target taller than the port is clear while it covers the port.

**The discrete hop outranks the follow**, and ends it. Otherwise the caret is re-asserted at the next recompile and pulls the pane back off the field the host just asked for, as with a "find this in the preview" control or a diagnostic jumping to a field. A hop that placed nothing moved nothing and takes no rank: the follow stands.

**A recompile re-locates the followed caret.** `session.locate` answers against the last compiled layout while a consumer debounces `update`, so a caret typed past that layout's content is off-content for the whole burst: `focusPosition` no-ops and the pane sits still. `refresh` re-runs the last followed place through the same guard; the staleness sits between two session queries this module owns both ends of.

**A pane with no box is not a fold to be clear of.** The shell's narrow switch hides the track the reader is not on with `display: none` ([`THEMING.md`](../../THEMING.md) §"The shell"), and a hidden container measures 0×0, as does every marker on it — clearance arithmetic over zeros answers "already clear" for every keystroke. Both trips therefore hold what they were asked for while the pane has no box, and the last one held runs when the container's `ResizeObserver` reports one again. A held `scrollToField` still answers `true`: the address is placed.

**A focus change ends the follow** (`endFollow`), as does the discrete hop above; nothing else does. The place is re-asserted on every recompile, so a leaf that reports no caret (every form control) would leave the pane being pulled back to the leaf the focus left; the rule is the arrival's, and the editor's `onActiveLeafChange` carries it ([VISUAL_EDITOR.md](VISUAL_EDITOR.md) §"Focus and the preview bridge"). A prose leaf restarts the follow with its own next caret.

## Minimal surface

`createPreview(session, opts)` hands back a `PreviewController` (`preview/controller.ts`) with `refresh`, `scrollToField`, `focusPosition`, `endFollow` and `setZoom`. Every option is once-bound, so a swap is the consumer's `{#key session}` ([VISUAL_EDITOR.md](VISUAL_EDITOR.md) §"The document swap").

## Not owned

- Compile / incremental recompile: the session's.
- The document and `apply`: the consumer's.
- Caret anchoring across edits: the VisualEditor's `StepMap`.
- Canvas text-selection / find / a11y: gone by design; keep an SVG export path alongside if needed.
