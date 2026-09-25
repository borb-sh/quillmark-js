import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// @quillmark/wasm ships wasm-bindgen's web target: no `.wasm` import and no
// top-level await, so a static import is safe on any route's graph and Vite
// resolves it unaided. Dev-server pre-bundling is the one exception: it relocates
// the package away from the binary `init()` resolves against, which surfaces as
// `runtime::init_failed`, so the package stays unbundled.
//
// The reference quill is not a bundler input at all: it is packed into
// `static/quiver.qv` before dev and build, and fetched at runtime. So nothing here
// reaches outside the app root.
export default defineConfig({
	plugins: [sveltekit()],
	optimizeDeps: { exclude: ['@quillmark/wasm'] }
});
