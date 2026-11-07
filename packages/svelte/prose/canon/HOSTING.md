# Hosting the surfaces

> **Implementation**: none here; this is the seam a consumer owns. The worked example is [`packages/playground`](../../../playground/prose/canon/PLAYGROUND.md).

## TL;DR

What an app is left holding once it mounts `<VisualEditor>` and `<Preview>`: the handles, the text edge, the order an open lands in, the recompile schedule and teardown. The surfaces mount over live `@quillmark/wasm` handles and mutate them in place, so none of this is visible from a prop.

## The text edge

**A host that stores markdown owns the round trip.** `Document.parse(md)` in, `doc.toMarkdown()` out; the surfaces never see text. Markdown may come from someone else, so this is also where an untrusted document enters; what the surfaces hold over one is stated in the [README](../../README.md#what-a-document-is-trusted-to-be).

**Project on the change, not on a timer.** `onChange` fires after the edit has landed, so `toMarkdown()` there is the text for the state on screen. Debounce the recompile, not the projection: a keystroke lost to a projection debounce is lost to a crash.

**Text arriving from outside means reopening.** A mounted surface cannot be handed markdown, so the host parses a new `Document` and remounts. The editor re-keys on `doc`; the preview binds every prop once and the remount is the host's `{#key session}`. Both report `rebind-ignored` for a swap they cannot follow.

**Guard the reopen with `doc.equals`.** An autosave whose store echoes the saved text back would otherwise reparse and remount on its own output, dropping the caret mid-keystroke.

## Opening

**The editor lands before the session.** The editor needs only `doc` and `quill`; the preview needs a `LiveSession`, and the first open loads the render build, which is large. So the host mounts the editor once the quill resolves and opens the session behind it. `await engine.load(quill)` and then `open` over the document as it stands, so the first compile is current; an edit that lands after the open read the document schedules one recompile. A failed open is retried by the next edit.

**The font library arrives behind the editor too.** The engine takes it at construction, and the editor takes `engine.fontFaces(quill)` when it lands.

**A reopen is async and can race.** Two reopens in flight can land out of order, and the loser must free what it opened rather than install it. A token bumped on every release and re-read after each await is the whole of it.

## Handles

**The host frees what it made, and nothing else.** A `Document` it parsed and a `LiveSession` it opened are its own. A `Quill` from `@quillmark/quiver`'s `getQuill` is borrowed, shared with every caller for that ref, so freeing it breaks the next caller.

**Teardown is an order**: unregister, cancel, then free. A pending recompile that fires after its session is freed holds what nobody owns. `core/teardown.ts` carries the same order for the package's own surfaces.

## Recompile

Structure edits recompile at once; prose and field edits wait for the burst to settle. `EditorChange.source` names the lane ([VISUAL_EDITOR.md](VISUAL_EDITOR.md) §"Edits are ops to the live Document").

`session.update` is transactional: a document that cannot compile leaves the last good compile painted and throws, and the next good edit recovers. A host shows the failure beside the preview, not instead of it.

## What is addressable, and why a field is not

The bridge between the panes runs on addresses, and a field only has one where the compile placed something it can name. That is the quill's decision, not the editor's.

- **Content fields** (`richtext`, `text`) carry their spans through whatever the plate does with them. They get a caret: a preview click lands an exact offset.
- **Scalar fields** get a region only where the plate marks them (a `field:`-bound widget, or a bare `#data.<field>` that prints). A click lands the field with no offset.

A scalar the plate prints through a function call surfaces nothing, and a click there does not land, until the plate prints it through `qm.ink` or claims it with `qm.region`. A bridge that reaches too little is answered in the quill.
