// Main browser-safe entrypoint.
//
// Exposes only browser-safe surface. The Node-only factories (`fromDir`, `build`) live
// at `@quillmark/quiver/node`.
export { QuiverError } from './errors.js';
export type { QuiverErrorCode } from './errors.js';
export { Quiver } from './quiver.js';

// The canonical API (`Quill`, `Document`, `Engine`, `RenderResult`, …) is not
// re-exported: import it straight from the `@quillmark/wasm` peer dependency,
// which is the single source of truth. `quiver.getQuill(ref)` returns a core
// `Quill` that an `Engine` renders directly — the engine clones it into the
// backend, so no boundary-crossing helper is needed.
