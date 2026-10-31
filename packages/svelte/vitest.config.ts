import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const lib = fileURLToPath(new URL('./src/lib', import.meta.url));

// Standalone, without the `sveltekit()` plugin, which needs routing context Vitest lacks.
// `@quillmark/wasm` ships wasm-bindgen's web target; `tests/setup.ts` awaits the `init()` that
// instantiates it. The node environment runs the Typst backend, so core tests render for real.
// `svelte()` compiles `.svelte` sources so a test can mount a surface; mounting tests declare
// `@vitest-environment jsdom` per file.
export default defineConfig({
	plugins: [svelte({ compilerOptions: { hmr: false } })],
	// `browser` picks svelte's client build, without which `mount()` resolves to the server
	// entry and throws. `@quillmark/wasm` declares no `browser` condition, so it is unaffected.
	resolve: { alias: { $lib: lib }, conditions: ['browser'] },
	test: {
		environment: 'node',
		include: ['tests/**/*.{test,spec}.ts'],
		setupFiles: ['./tests/setup.ts'],
		// Files share a worker's module graph, so the Typst backend compiles once per worker.
		isolate: false,
		// The Typst backend compiles lazily on the first `Engine.open`.
		testTimeout: 30000,
		hookTimeout: 30000
	}
});
