// `@quillmark/svelte/core`: what this package owns at the substrate seam.
//
// The `@quillmark/wasm` API is not re-exported: import it from the peer dependency. What earns a
// line here is what more than one surface speaks and no other package declares: the address
// vocabulary, the error channel, and the WASM init gate.
//
// No stylesheet: a host reaches this entry where there is no document (a worker, a server), and a
// dev server serves a side-effect sheet as a module that writes a `<style>` into one. The surface
// barrels carry the theme; `check:deps` holds it.

export { init } from './lifecycle.js';

// ── The address vocabulary ──────────────────────────────────────────────────
// `Place` is the caret payload the editor emits and the preview scrolls to, `Landing` the one the
// preview surfaces and the editor lands, whose caret is optional. Declared here because `/preview`
// and `/visual` both name a place in their hooks.
export type { DocPath, Landing, Place } from './address.js';
// The hop between that vocabulary and the `Addr` the document verbs take.
export { fieldPathForAddr, addrForFieldPath } from './address.js';

// ── The error channel ───────────────────────────────────────────────────────
// What every surface reports a recovered failure through, via its `onError` prop.
export type { EditorError, EditorErrorCode, EditorErrorHandler } from './errors.js';
