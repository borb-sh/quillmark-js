// Node, no environment shim. `src/__tests__` is the bin's half, run against quivers
// `helpers/collection.ts` copies out of the workspace's reference quiver; `app/__tests__` is
// the app client's readings that need no browser. What a browser has to show is
// `deploy.browser.test.ts`'s, over a deploy the built bin lays.
//
// `cli.integration.test.ts` spawns the built bin, so the suite needs `dist/`, and the
// gate builds before it tests. There is no `prepare` to build it at install time: `tsc`
// here reads `@quillmark/quiver`'s emitted types, and npm sequences no workspace's
// install-time script after another's, so the root `build` is where that order is
// stated.

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/__tests__/**/*.test.ts', 'app/__tests__/**/*.test.ts']
	}
});
