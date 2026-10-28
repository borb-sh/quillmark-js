// `@quillmark/svelte` root: the substrate, free of any UI framework. The headline surfaces mount
// from their own subpaths (`/preview`, `/visual`); the root re-exports `/core` for a consumer that
// wants one import for the substrate.
export * from './core/index.js';
