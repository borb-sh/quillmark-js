/** The paths this package knows: the two clients and the starter it ships, and the
 *  containment four refusals turn on (a watcher's own output, a server's mount, an out
 *  that owns its input, and an author file reaching out of its quiver). */

import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The clients a target lays: each `vite build`'s output, beside the compiled bin in the one
 * `dist` the tarball carries. Bytes rather than modules: nothing here imports them.
 *
 * Anchored at the package root rather than beside this module, which is what makes one
 * spelling right from both trees: `src/paths.ts` and `dist/paths.js` each sit one level
 * under it.
 */
export const STUDIO = fileURLToPath(new URL('../dist/client/', import.meta.url));
export const APP = fileURLToPath(new URL('../dist/app/', import.meta.url));

/** The quiver `init` copies. Anchored as the clients are. */
export const STARTER = fileURLToPath(new URL('../starter/', import.meta.url));

/** True when `at` is `abs` or an ancestor of it. */
export function within(at: string, abs: string): boolean {
	const rel = relative(at, abs);
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
