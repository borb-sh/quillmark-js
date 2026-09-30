# Quillmark Svelte Canon Index

Canonical documentation for the `@quillmark/svelte` package, the Svelte binding: the settled systems, describing what _is_ and pointing into the code. It is a synthesis at systems scale; what a value is, and which rung an element reads, is the code's to state.

A thin overview, the two headline surfaces, and the supporting docs for the shared substrate:

- [ARCHITECTURE.md](ARCHITECTURE.md): the package at a glance; surfaces, substrate, data flow, the subpath public API, the styling system, the playground shell.
- [VISUAL_EDITOR.md](VISUAL_EDITOR.md): the federated WYSIWYG (shape/composition).
- [PREVIEW.md](PREVIEW.md): the live preview (paint, click bridge).
- [CODEC.md](CODEC.md): content (`Content`) ↔ ProseMirror.
- [DOCUMENT_MODEL.md](DOCUMENT_MODEL.md): boundary ledger: the exact `@quillmark/wasm` surface V1 consumes, its canon homes, and stability. Not a model doc; the `Document` is quillmark's.
- [HOSTING.md](HOSTING.md): the seam a consumer owns: the markdown↔handle round trip, the editor landing ahead of the session, handle ownership and teardown, the recompile schedule, and what makes a field addressable.

Work that is not settled lives in GitHub issues.
The `--qm-*` theming baseline is catalogued in the package's [`THEMING.md`](../../THEMING.md).
The app that mounts these surfaces is [`packages/playground`](../../../playground/prose/canon/PLAYGROUND.md).
