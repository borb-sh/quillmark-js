/**
 * Node-only entrypoint: the factories that read a filesystem, as free
 * functions. Each returns a `Quiver`; the class itself is the browser-safe one
 * from the main entry, unmodified. Importing this module installs nothing, so
 * the import path is the whole contract and a bundler drops what is not called.
 *
 * The modules behind these factories statically import `node:*` builtins, so a
 * browser bundle must never reach this entry. The main entry (`./index.js`)
 * makes no static or dynamic reference to it.
 */

import { Quiver, createQuiver } from './quiver.js';
import { scanSourceQuiver, SourceLoader } from './source-loader.js';
import { buildQuiver } from './build.js';
import type { BuildOptions } from './build.js';
import { loadBuiltQuiver } from './built-loader.js';
import { QuiverError } from './errors.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reads a Source Quiver from a local directory containing `Quiver.yaml` and
 * `quills/<name>/<version>/Quill.yaml` entries.
 *
 * Also accepts an `import.meta.url`-style `file://` URL; the URL's parent
 * directory is used as the source root.
 *
 * A quiver installed from npm is a directory like any other:
 * `dirname(createRequire(import.meta.url).resolve('<pkg>/Quiver.yaml'))` is its
 * root, resolved from the caller, whose dependencies are reachable from the
 * caller alone under an isolated `node_modules` layout.
 *
 * Throws `quiver_invalid` on schema violations, `transport_error` on I/O
 * failure.
 */
export async function fromDir(pathOrFileUrl: string): Promise<Quiver> {
	const dir = pathOrFileUrl.startsWith('file://')
		? fileURLToPath(new URL('.', pathOrFileUrl))
		: pathOrFileUrl;
	const { meta, catalog } = await scanSourceQuiver(dir);
	return createQuiver(meta.name, meta.description, catalog, new SourceLoader(dir));
}

/**
 * Loads a packed (build-output) quiver from a local directory containing
 * `quiver.json` and the bundles and fonts written by `build`.
 * Symmetric to `Quiver.fromBuiltUrl(url)` but reads from disk instead of HTTP:
 * no network required.
 *
 * Use this for server-side runtime when a packed artifact ships in the
 * deployment image; consumers can keep source quivers as devDependencies and
 * avoid self-fetching over their own load balancer.
 *
 * Throws `quiver_invalid` on format errors, `transport_error` on I/O failure.
 */
export async function fromBuiltDir(dirPath: string): Promise<Quiver> {
	return loadBuiltQuiver(async (path) => {
		const file = join(dirPath, path);
		try {
			const buf = await readFile(file);
			return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
		} catch (err) {
			throw new QuiverError(
				'transport_error',
				`Failed to read "${file}": ${(err as Error).message}`,
				{ cause: err }
			);
		}
	});
}

/**
 * Reads the Source Quiver at sourceDir, validates it, and writes the runtime
 * build artifact to outDir, which the build clears first and therefore owns.
 *
 * Quills below `0.1.0` are drafts: they stay in the source layout, which
 * `fromDir` reads whole, and reach the artifact only under `{ drafts: true }`.
 *
 * Throws `quiver_invalid` on source validation failures, `transport_error` on
 * I/O failures and on an outDir holding the source quiver or the cwd.
 */
export async function build(
	sourceDir: string,
	outDir: string,
	options?: BuildOptions
): Promise<void> {
	return buildQuiver(sourceDir, outDir, options);
}

// The rest of the public surface, so a Node consumer needs one import.

export { Quiver } from './quiver.js';
export { QuiverError } from './errors.js';
export type { QuiverErrorCode } from './errors.js';
export type { BuildOptions } from './build.js';

// Engine types (`Quillmark`, `Quill`, `Document`, `RenderResult`, …) are not
// re-exported: import them straight from the `@quillmark/wasm` peer dependency,
// which is the single source of truth for the engine contract.
