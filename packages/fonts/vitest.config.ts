// Node, real WASM: the suite is proven against the engine it is for. The tests read the
// manifest rather than restating it, and render the workspace's reference quill
// (`fixtures/quills/showcase/1.0.0`), which loads the Typst backend.

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/__tests__/**/*.test.ts'],
		setupFiles: ['./tests/setup.ts']
	}
});
