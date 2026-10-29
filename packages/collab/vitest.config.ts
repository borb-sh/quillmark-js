// Node, real WASM: every Document a test holds is the installed `@quillmark/wasm`, the shared
// state between them is real Yjs, and updates travel when and in the order a test says.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		setupFiles: ['./tests/setup.ts'],
		testTimeout: 120000
	}
});
