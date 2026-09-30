# Hosting the surfaces

> **Implementation**: none here — this is the seam a consumer owns. The worked example is [`packages/playground`](../../../playground/prose/canon/PLAYGROUND.md).

## TL;DR

What an app is left holding once it mounts `<VisualEditor>` and `<Preview>`: the handles, the text edge, the order an open lands in, the recompile schedule, and the teardown. The surfaces mount over live `@quillmark/wasm` handles and mutate them in place, so none of it is the package's and none of it is visible from a prop.

## The text edge

**A host that stores markdown owns the round trip.** `Document.fromMarkdown(md)` in, `doc.toMarkdown()` out, and the surfaces in between never see either: `<VisualEditor>` takes a `Document` and edits it, so text is a thing the host converts at both ends. The verbs are pinned in [DOCUMENT_MODEL.md](DOCUMENT_MODEL.md) §"The host's text edge".

**The markdown may be a document its reader did not write**, so the round trip is also the seam an untrusted one enters by. What the surfaces hold over one whatever it carries, and what that leaves the host, is stated for the consumer in the [README](../../README.md#what-a-document-is-trusted-to-be).

**Project on the change, not on a timer.** `onChange` fires after the edit has landed, so `doc.toMarkdown()` inside the handler is the canonical text for the state on screen. The projection and the recompile debounce separately, and only one of them should: a keystroke lost to a projection debounce is a keystroke lost to a crash, while a recompile held for the same interval costs a frame of preview.

**Text arriving from outside means reopening.** An import, a source-mode keystroke, a document switch: a mounted surface cannot be handed markdown, so the host parses a new `Document` and remounts the surfaces over it. The editor re-keys on `doc` itself, so a swap of the pair is enough and a `quill` swapped alone is what it reports ([VISUAL_EDITOR.md](VISUAL_EDITOR.md)); the preview binds every prop once and the remount is the host's `{#key session}` ([PREVIEW.md](PREVIEW.md)). Both raise `rebind-ignored` for the case they cannot cover, and in a dev build throw it after reporting, since a host swapping `onError` alongside the handle would otherwise be told through the handler it just replaced.

**Guard the reopen with `doc.equals`, or the round trip eats the caret.** A host whose autosave writes `toMarkdown()` and whose store echoes the saved text back has a loop: the echo is a new markdown string, parsing it makes a new `Document`, and remounting on it drops the caret mid-keystroke. `equals` is structural, and its own doc at the boundary names this use. A host with no echo still wants it: two writes that settle to the same document should not remount.

## Opening

**The editor lands before the session.** `<VisualEditor>` binds `doc` and `quill` alone; the preview needs a `LiveSession`, and the first `engine.open` loads the render build, tens of megabytes fetched, compiled and instantiated on the main thread. So the host mounts the editor once the quill resolves and opens the session behind it, and the preview waits on its own. `engine.open` reads the document before it loads, so a session opened from the start compiles the document as it stood then, and an edit made during the load is missing from it. `await engine.load(quill)` first, then `open` over the document as it stands: one compile, and it is current. An edit that arrives while that attempt is in flight starts no second one, since the attempt reads the document only once the load lands. A session that fails to open is tried again by the next edit, a refusal being a state of the document rather than the end of the open.

**A reopen is async and can race.** Resolving the quill, loading the backend and opening a session each await, so two reopens in flight can land out of order, and the loser must free what it opened rather than install it. A token bumped whenever the handles are released and re-read after each await is the whole of it, and the session attempt reads it as the reopen does: the editor's handles are installed before that attempt starts, so a session landing after its document was replaced frees itself rather than installing over the next one.

## Handles

**The host frees what it made, and nothing else.** A `Document` it parsed and a `LiveSession` it opened are its own. A `Quill` from `@quillmark/quiver`'s `getQuill` is **borrowed**: shared with every caller for that ref and alive as long as the quiver, so freeing it hands the next caller a freed handle. A host wanting one of its own mints it from `.toTree()`.

**Teardown is an order, not a list**: unregister, cancel, then free. A pending recompile that fires after its session is freed is holding what nobody owns, so the timer is cleared before the handles go. `core/teardown.ts` carries the same order for the package's own surfaces.

## Recompile

**The lane split is the default, not a tuning exercise**: `EditorChange.source` names the lane, structure recompiles at once, prose and field wait for the burst to settle ([VISUAL_EDITOR.md](VISUAL_EDITOR.md) §"Edits are ops to the live Document").

**`session.update` is transactional.** A document mid-edit that cannot compile leaves the last-good compile painted and throws; the next good keystroke recovers it. A host needs no last-good bookkeeping of its own, and a compile failure is a thing to show beside the preview rather than instead of it.

## What is addressable, and why a field is not

The bridge between the panes runs on addresses, and a field only has one where the compile placed something it can name. Two mechanisms answer, and the difference is the schema's, not the plate's.

**Content tracking, span-bearing.** A field declared `richtext` or `plaintext` flows through the content pipeline, and its spans survive whatever the plate does with the value: passing it through a package function, a local one-liner, or a wrapper that re-brackets it as content all keep the span. These are the fields with a caret: `positionAt` answers on them, `fieldBoxes` unions them, and a preview click lands an exact offset.

**Scalar reference tracking, span-less.** A field declared `string`, `number`, `date` or an array of them is not content, and gets a region only where the plate marks it: a `field:`-bound widget, or a bare `#data.<field>` evaluated at a place that prints. This rung is syntactic — the same scalar through a plate-side function call surfaces nothing — and it yields a region with a rect and no span. `fieldAt` answers over it, so a preview click lands the field with no offset ([PREVIEW.md](PREVIEW.md) §"Click bridge"), and `fieldBoxes` answers `[]` while `regions()` carries the rect.

**So a front-matter field a user types prose into wants `richtext` in the quill's schema, and gets the caret for free.** The reference quill has all three cases. `subject` is `richtext` and is caret-addressable straight through `frontmatter.with`. `signature_block` is `array<string>` and reaches the field rung, because the plate places a `signature-field` widget bound to it. `memo_for` is `array<string>` passed through `frontmatter.with` with no widget, and is addressable by nothing: a preview click there does not land, and `scrollToField` returns `false`. Which of the three a field lands in is the quill's to decide, so a bridge that reaches too little is answered in the collection.

## Not owned here

- The surfaces' own contracts, and which prop is once-bound: [VISUAL_EDITOR.md](VISUAL_EDITOR.md), [PREVIEW.md](PREVIEW.md).
- The verbs themselves, and their semantics: quillmark canon, via [DOCUMENT_MODEL.md](DOCUMENT_MODEL.md).
- Loading a quiver and resolving a ref: [`packages/quiver`](../../../quiver/prose/canon/QUIVER.md).
