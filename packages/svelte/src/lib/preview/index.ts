// `@quillmark/svelte/preview`: the live-preview surface.
//
// `createPreview(session)` (vanilla-TS core) + a thin `<Preview>` Svelte wrapper
// land here. Reserved-package invariant: this subpath imports no editor-side code
// (the codec, the VisualEditor) so a `@quillmark/preview` promotion stays a
// re-export, not a refactor: it may reach `/core` (the shared WASM boundary) and
// nothing else. Enforced by `check:deps`, at the subpath's edge: a relative hop past a
// module directly in `core/` is what pulls the codec, and all of ProseMirror with it.

// The theme derivation, which the page slots read through `var()`.
// Imported at the barrel because a subpath is what a consumer gets: this surface
// reaches modules inside `core/` and never its entry, which carries no sheet.
// `check:deps` holds the reach.
import '../core/theme.css';

export { createPreview } from './controller.js';
export type { PreviewOptions, PreviewController } from './controller.js';
export { default as Preview } from './Preview.svelte';

// What the preview says when there is nothing to paint. Keyed and partial; the
// English is exported so a consumer composes against it rather than restating it.
// The merge is the surface's own: a consumer hands `strings` to a prop, never
// merges one.
export { DEFAULT_PREVIEW_STRINGS } from './strings.js';
export type { PreviewStrings, PreviewStringsInput } from './strings.js';
