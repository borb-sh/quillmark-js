// Node, real WASM: every Document a test holds is the installed `@quillmark/wasm`, and the
// shared state between them is real Yjs, delivered by hand in whatever order a test picks.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		setupFiles: ['./tests/setup.ts'],
		testTimeout: 120000
	}
});
