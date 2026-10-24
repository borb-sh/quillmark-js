# Preview

> **Implementation**: `src/lib/preview/`

## TL;DR

The headline live preview surface: turning the current document into a rendered, continuously-updating view of the output. `PreviewController` (vanilla-TS core) composes the paint loop, the click/scroll bridge and the zoom over one `LiveSession`, wrapped by a thin `<Preview>` Svelte component. The subpath imports nothing editor-side: enforced by `check:deps`, at the subpath's edge — it reaches its own directory and the shared modules in `core/`, and the hop past those is what pulls the codec.

## Shape

`PreviewController` (vanilla-TS core, `createPreview`), wrapped by a thin `<Preview>` Svelte component. It wraps **one** `LiveSession` the consumer already opened (`engine.open(quill, doc)`) and supplies exactly the layer `LiveSession` omits: viewport, DOM, DPR, and click mapping. It is a **pure view**: it paints and reads geometry off the session, never mutates it.

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

- **Paint**: one `<canvas>` per visible page (+ margin), painted via `session.paint`; mounted/unmounted on scroll, so memory stays bounded to *visible + margin* per the canon. Each page slot is a `.qm-page-slot` carrying `data-page`, its index: the two hooks a consumer drawing its own overlay targets, the number being otherwise position among the slots, which holds today and is not a contract. A slot is sized by the zoom (§Zoom) and a canvas fills it (`width`/`height: 100%`), so its ink is always on the box the click and scroll geometry measure, whatever the raster was painted at. Mounted pages repaint when the scale moves (on the next frame, or once a gesture rests) and on DPR changes (a re-arming `(resolution: …dppx)` query), so a stretched raster is re-sharpened rather than left soft, and a page already rastered at the scale it would take is skipped; the canvases are `position:absolute`, so a repaint never feeds back into layout. The raster's density is `devicePixelRatio` floored at 2 (`MIN_DENSITY`): glyphs rasterize unhinted, so a 1× or fractional-ratio raster resampled onto its box leaves small text soft, where one at least twice the box is downsampled and reads. When `PaintResult.clamped` caps density on an oversized page, V1 honors it silently.
- **Bridge**: clicks resolve to an address and surface as a hook; commands scroll/focus a field.

**A counted page is the whole of the paint gate.** Every backend paints, so there is no capability to probe: `paint` and `pageSize` refuse only a page the count excludes. A compile with zero pages is the one state the surface stands a message in, and it is recoverable — the commonest state of a fresh seed, escaped by the next `refresh` that brings pages. A paint that throws on a counted page is caught per slot and surfaced as the render-failed message rather than aborting the sweep, so no page count leaves the pane blank and silent.

**The preview draws nothing of its own on the page.** It is the surface a user proofs against (its claim is _this is the output_), so any ink it leaves is ink the reader has to discount, and there is no alpha band both legible at pane scale and non-tinting. The zoom pill is the one thing it floats over the desk, at the pane's corner rather than on a page, and only while the zoom is not the default (§Zoom). Nothing advertises that the text is clickable either: the click target is the text itself, which is what a reader tries first. Nothing marks the field the editor's caret is in, and **correlating the two panes on the page is unbuilt**: the surface holds no shape for a design to inherit.

A **field box** is the rectangle on the rendered page where a schema field's content lands: the field's canonical `DocPath` address (`main.subject`, `cards.<kind>[2].name`, cards by absolute document index) mapped to on-page geometry. `fieldBoxes(field)` unions a field's segment rects into one (striped) box per page. `field` is not unique — a field split across pages or shown in header + footer surfaces several boxes — and the scroll takes the first.

**An address's boxes are `fieldBoxes`'s union, else every `regions()` rect at or under it** (`geometry.ts`, `boxesForField`; what the scroll reads). `fieldBoxes` is span-bearing-content-only: it answers `[]` for a scalar the plate places without tracking its content and for an array itself, whose own ink is composed rather than carried (an element answers a union rect like any other content-bearing address), and the boundary says what such a field's box is — a single `regions()` rect. The second rung takes an address and its descendants together, because a container is placed at both: a plate reading a whole array regions the array on the ink it composes around the rows — the separator between the reference quill's boxed keywords — while each element regions the ink it carries itself, and the field is on the page at all of it. A host holding the declared path therefore reaches every row it prints. A descendant is recognized by the character opening it, `[` for an element and `.` for a nested key, so the prefix stays a path boundary and `main.keywords_note` is not a row of `main.keywords`.

## Zoom

The rules are `zoom.ts`, pure; `viewport.ts` measures the pane, applies them, and owns the gestures and the pill.

**One scale for every page.** Every page is drawn at one zoom, a fraction of actual size (96 CSS px to the inch), so type is one size across a portrait memo and its landscape attachment, and the gaps between pages stay a fixed rung. The pane's width is the host's, never the document's (`contain: inline-size`); the page's width is the zoom's, so a page wider than the pane scrolls sideways inside it.

**The default fits the widest page to the pane's width, capped (`FIT_CAP`).** A portrait document in a split pane lands at the pane's width; a landscape page lands at that same width and shorter, rather than at the pane's height, which at a split's proportions shows it no larger. The cap stops a wide pane growing a page past a size print recognises. The default follows the pane, so a dragged divider re-fits it; a zoom the reader set holds across a resize, against the floor.

**The floor is the whole page in view.** Zooming out stops where every page fits the pane with a fixed share of it filled on the page's limiting axis (`FLOOR_FILL`), and never past the default: a smaller page is empty desk with nothing gained. The ceiling is `MAX_ZOOM`.

**Gestures, and no toolbar.** Ctrl/⌘-wheel (the trackpad pinch Chromium and Firefox send as one), Safari's gesture events, a two-finger touch pinch, and Mod `+`/`−`/`0`. Each holds a point still, as a fraction of the page under it since the gaps do not scale: the pointer, or the pane's centre for a key pressed with the pointer elsewhere and for the reset. The touch pinch holds the point between the fingers and carries it with their midpoint, so a two-finger drag pans; the desk's `touch-action` keeps the browser's own pinch off, and the pinch cancels its moves so the browser's pan does not run beside its own. The spread zooms only past `PINCH_SLOP`, so a drag leaves the default fit standing. A re-fit to a resized pane holds the line at its top edge; the desk's own `overflow-anchor` is off, the browser's correction otherwise landing on top of this one. The keys step through `STEPS`, a subset of browser zoom's levels, landing on the nearer level from between two and skipping any under the floor; Mod-`0` returns to the default. A continuous gesture holds at 100% where it crosses it and leaves once carried `DETENT` past, so actual size is always one gesture away. The keys reach the pane under the pointer as well as a focused one, since a click on a page lands its caret in the editor and takes the focus with it; the first pane to take one claims it, and a key a host's handler already took is left alone.

**The pill says only the percentage and resets on a click**, a behaviour learned by using it rather than one a label announces. It exists only while the zoom is not the default, hides `IDLE_MS` after the zoom last moved unless the pointer is on it, and comes back when the pointer nears its corner or the zoom moves again; Mod-`0` reaches the same reset with it hidden. It stands in a zero-height dock, sticky at the bottom of the desk's flex column, so the corner is the pane's however short or wide the pages are.

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

**Two rungs, and the second is the plate's.** `positionAt` answers over span-tracked content; `fieldAt` answers over every placement the compile tracks, which is a strict superset — measured against the reference quill, a whole-page sweep finds no point where `positionAt` answers and `fieldAt` does not, and none where the two name unrelated fields. Where composed ink meets the element it surrounds, the two placements share an edge and `fieldAt` names the container of what `positionAt` names; the ladder reads `positionAt` first, so a click lands the finer of the two. So the second rung fires exactly where a field is printed without its content being tracked, which on a memo is the front matter: `main.signature_block`, a card's.

**An absent `pos` is the placement rung**, and one hook carries both (`Landing`, `/core`): a pick names its field either way, so the coarse case is a pick with no offset rather than a second hook. A fabricated `0` would be an invented offset wearing a real one's type. `granularity` is the only precision axis, and reads where there is a `pos`: `'cluster'` → caret-exact, `'segment'` → focus the field/segment, no exact caret.

**What either rung can name at depth is the plate's, and a scalar cell is out of reach.** A content value carries its own spans, so a `richtext` or `text` cell regions wherever it is placed — through a loop binding, at any depth: `#for rev in data.revisions [#rev.detail]` regions at `main.revisions[0].detail`. A scalar carries none, so its address is the read path's, and the codegen tracks a literal one only: `data.revisions.at(0).pages` regions at `main.revisions[0].pages` where `data.revisions.at(i).pages` regions at `main.revisions`, the whole array. An array a plate prints by looping — which is every array whose length the document decides — therefore names its rows through their content cells and through nothing else. The reference quill declares one for that reason (`revisions.detail`), so a landing into a nested row is drivable here rather than only in a quill this workspace does not hold.

**There is no third rung hit-testing `regions()` by hand.** Its rects are bounding boxes over ink the field does not fill — `main.body`'s union spans the gap between two disjoint segments — so a click in that gap would land on the body by geometry the compile never claimed.

**Both rungs carry a slack instead.** A glyph's hit box is its line's ink by that glyph's own advance, so the boxes along a line abut and the leading between two lines is inside the paragraph and on no glyph: the reference quill's body sets 9.3pt of ink on a 16.1pt pitch, and a click in the rest of that column answers nothing for a reason the reader cannot see. Each query takes a tolerance in points and answers with the nearest ink inside it, so a point in the leading takes the line it is nearer, in the column it was clicked in — which is where a caret goes. It stays a click on ink some placement drew, unlike a bounding box, and a point far from all of it still lands nothing.

**The slack is the pointer's, so this pane states it and converts it per click.** A fixed size on the screen (`CLICK_SLACK_PX`, `bridge.ts`) over the scale the slot is drawn at, `pxToPt` being that conversion beside the point transform it has to agree with. One fixed in points would shrink under the cursor exactly as the target does, which is the wrong direction: a narrow pane draws the page small, and that is where a line is hardest to hit. So the same two pixels are 3.1pt at the split's own threshold and 1.5pt on a pane twice that wide, and the reference quill's body line is live over 96% of its pitch at the first and 77% at the second, against 58% exact.

**Two pixels, and not the leading's own measure.** The session ranks by distance rather than growing each box, so the slack only ever fills a miss: ink under the pointer keeps the click whatever the slack is, and no click that lands today lands elsewhere. What a slack grown past the pointer would buy is the rest of the leading, and what it would cost is a caret placed in a paragraph from a click on the margin beside it — so the residue stays: whatever a wide pane leaves of the leading, and the whole of a line past its last glyph, which on the memo's short last body line is 248pt of a 443pt measure. Both are a line box's to close, and a line box is the backend's.

## Follow-the-caret scroll

`focusPosition` locates the caret rect and `scrollToField` a field's first box; both place a throwaway absolute marker at the `%` position, measure it, and remove it, so the trip is computed off the page box's own proportions and needs no separate zoom or DPR term.

**The preview scrolls its own scrollport and nothing else.** `container.scrollTop`, never `marker.scrollIntoView()`: that walks *every* scrollable ancestor, so a host whose document scrolls has the whole page dragged to the preview by a keystroke in the editor, taking the surface the user is typing on off screen. Instant, and with no `prefers-reduced-motion` term: no `scroll-behavior` on the container means no motion for one to cancel.

The rule is this pane's, and it is about the keystroke rather than about the call: a continuous signal must not move a surface the user is not acting in. A landing in the editor is the opposite case and answers the opposite way — the user clicked here to edit there, and the editor holds no scrollport of its own to move ([VISUAL_EDITOR.md](VISUAL_EDITOR.md) §"Focus and the preview bridge").

**A miss is an answer, not a failure.** `scrollToField` returns whether this compile placed anything at the address. The plate places plenty it does not track, so a `false` is ordinary; and the preview carries no schema, so it cannot tell that case from a field the host misnamed. The editor's `focusField` is what distinguishes them — it holds the mounted tree and reports `target-unknown` for a name it has no field for ([VISUAL_EDITOR.md](VISUAL_EDITOR.md)). It is not an `onError` report: that channel carries failures a surface recovered from.

**The two commands split on what their inputs are** ([VISUAL_EDITOR.md](VISUAL_EDITOR.md) §"Focus and the preview bridge"). `scrollToField` is a discrete act, so it centres every time. `focusPosition` is the continuous signal (one call per keystroke and per arrow key), so it moves the pane only when the caret is not clear of the fold: the caret rect's own height of clearance at each edge, since a rect flush against one is visible and unusable, and the next line typed lands past it. Across, a caret on a page zoomed wider than the pane is brought into view by the least trip, which leaves the line the reader is on where it is. The clearance derives from the target, not from a margin dial, so it scales with zoom as the caret does. Centring on every call takes the scrollport back from the user on each of them, and a preview click is one of them: the click already put its target on screen, and the `setCaret` it drives comes back through `onCaretMove` as a caret move like any other. The change-guard answers that hop too; a suppression flag for it would be redundant state.

**The clearance is bounded at both ends**, a derived term left unbounded being an answer that cannot be reached. Floored at a caret's height: a rect reporting none scores as clear against the very edge it sits on. Capped against the room the port has to spare: a target too tall for its own height of clearance — a located line at zoom, a short split track — fails wherever it sits, so every keystroke re-centres it, which is the behavior the guard exists to prevent; under the cap it passes once centred, with a band around the centre to hold in. Past the cap, a target taller than the port is clear while it covers the port, no scroll showing more of it.

**The discrete hop outranks the follow**, and ends it. Otherwise the caret is re-asserted at the next recompile and pulls the pane straight back off the field the host just asked for, a debounce later and past a guard the hop itself moved the caret out of. The playground hides that by hopping only where the editor's focus moves too; a host that hops without moving it — a "find this in the preview" control, a diagnostic jumping to a field — has its scroll undone. A hop that placed nothing moved nothing and takes no rank: the follow stands.

**A recompile re-locates the followed caret.** `session.locate` answers against the last compiled layout while a consumer debounces `update`, so a caret typed past that layout's content is off-content for the whole burst: `focusPosition` no-ops and the pane sits still. Nothing re-asks when the compile lands, because the next caret event is the only thing that would, so `refresh` re-runs the last followed place through the same guard. It belongs here rather than at the consumer: the staleness sits between two session queries this module owns both ends of.

**A pane with no box is not a fold to be clear of.** The shell's narrow switch hides the track the reader is not on with `display: none` ([`THEMING.md`](../../THEMING.md) §"The shell"), and a hidden container measures 0×0, as does every marker on it — clearance arithmetic over zeros answers "already clear" for every keystroke, and a centring divides a trip out of them. Both trips therefore hold what they were asked for while the pane has no box, and the last one held runs when it has one again: the container's own `ResizeObserver` is what reports that, since `refresh` re-asks only on a recompile and the reader who has just tapped Preview is not typing. Without it the pane opens where the caret was several edits ago. A held `scrollToField` still answers `true` — the address is placed, which is the whole of what the boolean says, and a pane with no box yet is not a second no.

**A focus change ends the follow** (`endFollow`), as does the discrete hop above; nothing else does. The place is re-asserted on every recompile, so a leaf that reports no caret does not merely fail to be followed: it leaves the pane being pulled back to the leaf the focus left, on each one. Every form control is such a leaf — there is no offset a date field could name, and a numeric input refuses a selection outright — so the rule is the arrival's rather than the caret's, and the editor's `onActiveLeafChange` carries it ([VISUAL_EDITOR.md](VISUAL_EDITOR.md) §"Focus and the preview bridge"). A prose leaf restarts the follow with its own next caret. An expiry on a timer or on a recompile answers a different question: a caret that has not moved is still followed correctly, which is what the re-locate above exists for.

## Minimal surface

`createPreview(session, opts)` hands back a `PreviewController` (`preview/controller.ts`), and the sections above are its verbs: `refresh` after an edit, `scrollToField` and `focusPosition` for the two hops, `endFollow` for the arrival that stops one, `setZoom` for a host restoring a zoom the reader set. Its options are the container and the hooks it reports through, and every one of them is once-bound, so a swap is the consumer's `{#key session}` ([VISUAL_EDITOR.md](VISUAL_EDITOR.md) §"The document swap").

## Not owned

- Compile / incremental recompile: the session's.
- The document and `apply`: the consumer's.
- Caret anchoring across edits: the VisualEditor's `StepMap`.
- Canvas text-selection / find / a11y: gone by design; keep an SVG export path alongside if needed.
