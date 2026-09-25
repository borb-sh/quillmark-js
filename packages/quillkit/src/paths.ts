/** The paths this package knows: the client it ships, and the containment three
 *  refusals turn on (a watcher's own output, a server's mount, and an out that owns its
 *  input). */

import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The client `studio` serves and `site` lays out: `vite build`'s output, beside the
 * compiled bin in the one `dist` the tarball carries.
 *
 * Bytes rather than a module. Nothing here imports it, so the wasm it bundles stays in a
 * browser tab and out of this process (QUILLKIT §"One wasm per process, and mostly
 * none").
 *
 * Anchored at the package root rather than beside this module, which is what makes one
 * spelling right from both trees: `src/paths.ts` and `dist/paths.js` each sit one level
 * under it.
 */
export const CLIENT = fileURLToPath(new URL('../dist/client/', import.meta.url));

/** The artifact's name beside the client, which `client/quiver.ts` resolves off the
 *  document's base. */
export const ARTIFACT = 'quiver.qv';

/** True when `at` is `abs` or an ancestor of it. */
export function within(at: string, abs: string): boolean {
	const rel = relative(at, abs);
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
