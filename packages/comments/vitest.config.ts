// Node, real WASM: every Document a test holds is the installed `@quillmark/wasm`, so the
// receipts and the re-attachment rule under test are the core's own.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		setupFiles: ['./tests/setup.ts'],
		testTimeout: 120000
	}
});
