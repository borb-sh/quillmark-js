import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// @quillmark/wasm ships wasm-bindgen's web target: no `.wasm` import and no
// top-level await, so a static import is safe on any route's graph and Vite
// resolves it unaided. Dev-server pre-bundling is the one exception: it relocates
// the package away from the binary `init()` resolves against, which surfaces as
// `runtime::init_failed`, so the package stays unbundled.
//
// The reference quill is not a bundler input at all: it is packed into
// `static/quiver/` before dev and build, and fetched at runtime. So nothing here
// reaches outside the app root.
export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// A static SPA: `+layout.ts` sets ssr=false/prerender=false, so the fallback
			// is the whole app, with no per-route prerender and no server.
			adapter: adapter({ fallback: 'index.html' }),
			// Root-relative unless BASE_PATH is set. The Pages workflow sets it to the
			// project subpath (`/quillmark-js`) at build time, so assets and links resolve
			// under it; dev and `preview` leave it unset.
			paths: {
				base: (process.env.BASE_PATH ?? '') as '' | `/${string}`
			}
		})
	],
	optimizeDeps: { exclude: ['@quillmark/wasm'] }
});
