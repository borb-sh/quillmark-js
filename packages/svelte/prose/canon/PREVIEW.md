# Preview

> **Implementation**: `src/lib/preview/`

## TL;DR

The live preview: a continuously updating render of the output. `PreviewController` (vanilla TS, `createPreview`) composes the paint loop, the click and scroll bridge and the zoom over one `LiveSession`, wrapped by a thin `<Preview>` component. The subpath imports nothing editor-side (`check:deps`).

## Shape and ownership

The controller wraps one `LiveSession` the consumer already opened and supplies what the session leaves out: viewport, DOM, DPR and click mapping. It is a pure view. It paints and reads geometry off the session and never mutates it, so one session can take edits from any source while the preview stays a view.

```ts
const session = engine.open(quill, doc);   // consumer owns
const preview = createPreview(session, { container });
preview.refresh(session.update(nextDoc));  // repaint dirty ∩ visible
```

`refresh(changeSet)` is the only lifecycle hop. Every option is bound once; a swap is the consumer's `{#key session}`.

## Two responsibilities

- **Paint**: one `<canvas>` per visible page plus a margin, mounted and unmounted on scroll, so memory stays bounded. A page that fails to paint shows a message in its slot rather than blanking the pane.
- **Bridge**: clicks resolve to an address and surface as `onPick`; commands scroll to a field or follow the caret.

**The preview leaves no ink of its own on the page.** It is the surface a user proofs against, so nothing advertises clickability and nothing marks the editor's active field. The zoom pill floats over the desk, not the page, and only while the zoom is not the default; the arrival wash decays to nothing.

A **field box** is where a field's content lands on a page, keyed by its `DocPath`. A field can have several (split across pages, repeated in a header), and an address's boxes fall back to the `regions()` rects at or under it where the field has no content spans (`boxesForField`).

## Zoom

One scale for every page, as a fraction of actual size, so type is one size across a portrait memo and its landscape attachment. The default fits the widest page to the pane, capped; the floor is the whole page in view. Zoom is by gesture and key, with no toolbar, and each gesture holds the point under the pointer still. The default fit and 100% are detents a gesture holds at. The rules are `zoom.ts`; `viewport.ts` measures, applies and owns the gestures and the pill.

## Click bridge

The preview owns the pixel-to-point math and the session queries. The consumer completes the caret move, because only the editor's codec maps a content offset to a ProseMirror position.

```
click → pt → session.positionAt → ContentHit ─┐
           └► session.fieldAt    → { field } ─┴► onPick(at) → editor.setCaret
```

**Two rungs.** `positionAt` answers over span-tracked content with an offset; `fieldAt` answers over every placement the compile tracks, with no offset. The bridge asks `positionAt` first, so a click lands the finer of the two. One hook carries both (`Landing`), and an absent `pos` is the coarse rung; a fabricated `0` would be an invented offset.

**There is no third rung over `regions()`.** Its rects are bounding boxes over ink the field does not fill, so hit-testing them would land clicks the compile never claimed.

**Both rungs take a slack.** The leading between lines is on no glyph, so each query takes a tolerance and answers with the nearest ink inside it. The slack is the pointer's imprecision, so it is fixed in screen pixels and converted per click (`CLICK_SLACK_PX`).

## Follow-the-caret scroll

`focusPosition` follows the editor's caret; `scrollToField` jumps to a field's first box.

**The preview scrolls its own scrollport and nothing else.** `scrollIntoView` would walk every scrollable ancestor and drag the host page away from the surface the user is typing in.

**The two commands split on what their inputs are.** `scrollToField` is a discrete act and centres every time. `focusPosition` is continuous (one call per keystroke), so it moves the pane only when the caret is not clear of the fold. The discrete hop outranks the follow and ends it; a focus change ends it too (`endFollow`), since a leaf with no caret would otherwise keep pulling the pane back.

A recompile re-locates the followed caret, since `locate` answers against the last compiled layout. A pane hidden with `display: none` holds the last request and runs it when it has a box again.

**A miss is an answer, not a failure.** `scrollToField` returns whether this compile placed anything at the address. The plate places plenty it does not track, so `false` is ordinary and is not an `onError` report.

## Wash

`washField(field)` plays the editor's arrival wash over every box the address has, so a host can mark a change it wrote in both panes. It moves nothing: a pane that jumped to it would take the reader off what they were reading. A `refresh` cuts any wash still playing, since the recompile may have moved the ink.

## Not owned

- Compile and recompile: the session's.
- The document and its edits: the consumer's.
- Caret anchoring across edits: the editor's.
- Canvas text selection, find and accessibility: out by design; keep an SVG export path alongside if needed.
