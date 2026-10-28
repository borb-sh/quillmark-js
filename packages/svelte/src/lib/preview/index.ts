// `@quillmark/svelte/preview`: the live-preview surface. Imports no editor-side code; it may reach
// `/core` and nothing else (`check:deps`).

// The theme derivation the page slots read through `var()`; a subpath import reaches `core/`
// modules, never its entry, which carries no sheet.
import '../core/theme.css';

export { createPreview } from './controller.js';
export type { PreviewOptions, PreviewController } from './controller.js';
export { default as Preview } from './Preview.svelte';

export { DEFAULT_PREVIEW_STRINGS } from './strings.js';
export type { PreviewStrings, PreviewStringsInput } from './strings.js';
