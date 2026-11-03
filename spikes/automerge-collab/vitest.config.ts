// Node, real WASM: every Document a test holds is the linked local build of `@quillmark/wasm`
// (link.mjs), and sync messages travel between peers only when and in the order a test says.
// preserveSymlinks keeps the linked package under node_modules, so Node loads it as it loads an
// installed one rather than Vite transforming it.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: { preserveSymlinks: true },
	test: {
		include: ['tests/**/*.test.ts'],
		setupFiles: ['./tests/setup.ts'],
		testTimeout: 300000
	}
});
