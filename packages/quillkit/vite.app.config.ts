import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { carried } from '../../scripts/carried.mjs';

// The app client, built: `app/` is its browser tree, landing at `dist/app` beside studio's
// `dist/client`. The two clients share the modules they have in common by relative import
// and nothing else, so each bundle carries only what its own graph reaches. There is no dev
// server here: `quillkit serve app` serves this build over a packed quiver.

const ROOT = fileURLToPath(new URL('app', import.meta.url));
const DIST = fileURLToPath(new URL('dist/app', import.meta.url));

export default defineConfig({
	root: ROOT,
	// Relative asset URLs, and the client resolves `app.json` and the quiver off
	// `document.baseURI`, so a built app serves from wherever it is put.
	base: './',
	plugins: [
		svelte({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			}
		})
	],
	build: { outDir: DIST, emptyOutDir: true, copyPublicDir: false },
	define: { __CARRIED__: JSON.stringify(carried()) },
	optimizeDeps: { exclude: ['@quillmark/wasm'] }
});
