// Node, real WASM, no environment shim: every test in this package runs against
// the installed `@quillmark/wasm`, and the ones that render load the real Typst
// backend. Small fixtures under `tests/fixtures/` exercise the loaders'
// mechanics; the pipeline the package exists for is proven end to end against
// the workspace's reference quill (`fixtures/quills/showcase/1.0.0`) in
// `engine-render.integration.test.ts`, which packs it into a temp dir and loads
// it back through the built-artifact path.

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		setupFiles: ['./tests/setup.ts']
	}
});
