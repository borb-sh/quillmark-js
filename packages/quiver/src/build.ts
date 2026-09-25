/**
 * Build logic — internal, Node-only.
 *
 * All Node.js built-in imports are done dynamically inside `buildQuiver`, so
 * a module reaching this one for types alone does not pull `node:fs` or
 * `node:crypto` into a browser bundle.
 */

import { QuiverError } from './errors.js';
import { FONTS_DIR, FORMAT, MANIFEST_PATH, QUILLS_DIR } from './format.js';
import { isDraft } from './semver.js';
import { packFiles } from './zip.js';

/** Options for {@link buildQuiver}. */
export interface BuildOptions {
	/**
	 * Pack versions below `MIN_PUBLISHED_VERSION` too. Off by default: the
	 * artifact is a deployment, and the draft space is not part of one. A
	 * viewer of the collection as it stands turns it on.
	 */
	drafts?: boolean;
}

/** Font file extensions recognised by the builder (case-insensitive). */
const FONT_EXT = /\.(ttf|otf|woff|woff2)$/i;

/**
 * Reads a Source Quiver, validates it, and writes the artifact to `outFile`: one zip
 * holding `quiver.json` (the format, the collection's name and description, and each
 * quill's font map), each quill's files under `quills/<name>/<version>/`, and every font
 * once under `fonts/<sha256>`.
 *
 * The artifact is written beside `outFile` and renamed onto it, so a reader sees the
 * previous file or the next one and never a torn one, and a build that throws leaves the
 * previous one in place.
 *
 * Versions below `MIN_PUBLISHED_VERSION` are drafts and are left out unless
 * `options.drafts` asks for them; a quill with nothing above the floor is
 * absent from the artifact entirely.
 *
 * Throws:
 *   - `quiver_invalid` on source validation failures (propagated from scanner) and on a
 *     collection over the budget a reader holds (`zip.ts`)
 *   - `transport_error` on I/O failures
 */
export async function buildQuiver(
	sourceDir: string,
	outFile: string,
	options: BuildOptions = {}
): Promise<void> {
	// Dynamic imports keep this module safe to type-import from browser contexts.
	const { dirname, join, resolve } = await import('node:path');
	const { mkdir, rename, rm, writeFile } = await import('node:fs/promises');
	const { createHash, randomUUID } = await import('node:crypto');
	const { scanSourceQuiver, readQuillTree } = await import('./source-loader.js');

	const { meta, catalog } = await scanSourceQuiver(sourceDir);

	const files: Record<string, Uint8Array> = {};
	const quills: Array<{ name: string; version: string; fonts: Record<string, string> }> = [];

	for (const name of [...catalog.keys()].sort()) {
		for (const version of catalog.get(name)!) {
			if (!options.drafts && isDraft(version)) continue;

			const tree = await readQuillTree(join(sourceDir, 'quills', name, version));
			const fonts: Record<string, string> = {};
			for (const [rel, bytes] of tree) {
				if (FONT_EXT.test(rel)) {
					// Full width: the store is keyed by hash, so two distinct fonts sharing a
					// prefix would merge into one entry.
					const hash = createHash('sha256').update(bytes).digest('hex');
					fonts[rel] = hash;
					files[`${FONTS_DIR}${hash}`] = bytes;
				} else {
					files[`${QUILLS_DIR}${name}/${version}/${rel}`] = bytes;
				}
			}
			quills.push({ name, version, fonts });
		}
	}

	const manifest = {
		format: FORMAT,
		name: meta.name,
		...(meta.description === undefined ? {} : { description: meta.description }),
		quills
	};
	files[MANIFEST_PATH] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

	// The budget a reader holds is spent here too, so a collection no reader would take is
	// refused by the build that packs it, where the author it names can act on it.
	let zip: Uint8Array;
	try {
		zip = packFiles(files);
	} catch (err) {
		throw new QuiverError('quiver_invalid', `Quiver "${meta.name}": ${(err as Error).message}`, {
			quiverName: meta.name,
			cause: err
		});
	}

	const out = resolve(outFile);
	// Unique per build, so two builds aimed at one file never write into each other's.
	const temp = `${out}.${randomUUID()}.tmp`;
	try {
		await mkdir(dirname(out), { recursive: true });
		await writeFile(temp, zip);
		await rename(temp, out);
	} catch (err) {
		await rm(temp, { force: true }).catch(() => {});
		throw new QuiverError(
			'transport_error',
			`Failed to write the artifact to "${outFile}": ${(err as Error).message}`,
			{ cause: err }
		);
	}
}
