// `@quillmark/svelte` root: the substrate, free of any UI framework.
//
// The headline surfaces mount from their own subpaths (`@quillmark/svelte/preview`,
// `/visual`) so a bundler pulls only what an entry reaches; the root
// re-exports `/core` (the address vocabulary, the error channel, `init`) for a
// consumer that wants one import for the substrate. It carries no framework code.
// The `@quillmark/wasm` API is imported from the peer dependency directly, never
// from here.
export * from './core/index.js';
