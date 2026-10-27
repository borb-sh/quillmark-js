/**
 * Internal filesystem scanner for the Source Quiver layout. Statically imports
 * `node:fs`, so it is reachable from the Node entry alone.
 */

import { readdir, readFile, lstat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { QuiverError } from './errors.js';
import { parseQuiverYaml } from './quiver-yaml.js';
import { isQuillName } from './ref.js';
import { isCanonicalSemver, compareSemver } from './semver.js';
import type { QuiverMeta } from './quiver-yaml.js';
import type { QuiverLoader } from './quiver.js';

/**
 * Refuse a symlink. Every rung that opens a tree or reads a file `lstat`s and asks,
 * because a source quiver is content and a link is a reference out of it: followed,
 * `readFile` reads whatever it points at into the quill, where the backend can typeset
 * it and `build` packs it into the published artifact. A linked directory smuggles a
 * tree where a linked file smuggles one, so the answer is the same at each.
 */
function refuseSymlink(st: Stats, path: string): void {
	if (st.isSymbolicLink()) {
		throw new QuiverError(
			'quiver_invalid',
			`"${path}" is a symlink; a quiver holds its own content, and nothing under it may point outside`
		);
	}
}

/**
 * Asked of a directory holding a quill rather than of every directory, so a stray
 * one holding none stays ignored: what has to be addressable is a catalog row.
 */
function refuseUnnamedQuill(quillName: string, quiverName: string): void {
	if (!isQuillName(quillName)) {
		throw new QuiverError(
			'quiver_invalid',
			`Quill directory "${quillName}" is not a quill name — a name is [a-z][a-z0-9_]*, at most 64 characters`,
			{ quiverName }
		);
	}
}

/**
 * Refuse a `Quill.yaml` whose `quill.name` or `quill.version` disagrees with the
 * path it sits at: the catalog serves the path, and a document saved from the quill
 * names what `Quill.yaml` says. A canonical version has one spelling, so the declared
 * one is compared as written. A field absent or not a string is Quillmark's to report
 * when the quill loads.
 */
function refuseMisplacedQuill(
	raw: Uint8Array,
	name: string,
	version: string,
	quiverName: string
): void {
	let parsed: unknown;
	try {
		parsed = parseYaml(new TextDecoder().decode(raw), { schema: 'failsafe' });
	} catch {
		return;
	}
	const quill = (parsed as { quill?: unknown } | null)?.quill;
	if (typeof quill !== 'object' || quill === null) return;
	const declared = quill as { name?: unknown; version?: unknown };

	if (typeof declared.name === 'string' && declared.name !== name) {
		throw new QuiverError(
			'quiver_invalid',
			`Quill "${name}@${version}" declares quill.name "${declared.name}": a quill sits at quills/<quill.name>/<quill.version>/`,
			{ quiverName, version }
		);
	}

	if (typeof declared.version === 'string' && declared.version !== version) {
		const rule = isCanonicalSemver(declared.version)
			? 'a quill sits at quills/<quill.name>/<quill.version>/'
			: 'a quill version is x.y.z';
		throw new QuiverError(
			'quiver_invalid',
			`Quill "${name}@${version}" declares quill.version "${declared.version}": ${rule}`,
			{ quiverName, version }
		);
	}
}

/**
 * Scans a Source Quiver root directory.
 *
 * Reads `<rootDir>/Quiver.yaml`, then walks `<rootDir>/quills/<name>/<version>/`
 * to build a catalog of quill names → sorted versions (descending).
 *
 * Throws:
 *   - `quiver_invalid` if Quiver.yaml is invalid, any rung it opens or reads is a
 *     symlink, a quill dir holding versions is not a quill name, a version dir
 *     name is non-canonical, or a version dir is missing its Quill.yaml or holds
 *     one naming another quill or version.
 *   - `transport_error` for I/O failures (permissions, etc.).
 *
 * Missing `quills/` directory is not an error — the quiver is valid but empty.
 */
export async function scanSourceQuiver(rootDir: string): Promise<{
	meta: QuiverMeta;
	catalog: Map<string, string[]>;
}> {
	const quiverYamlPath = join(rootDir, 'Quiver.yaml');
	let raw: Uint8Array;
	try {
		refuseSymlink(await lstat(quiverYamlPath), quiverYamlPath);
		raw = await readFile(quiverYamlPath);
	} catch (err) {
		if (err instanceof QuiverError) throw err;
		// ENOENT → transport_error: a missing Quiver.yaml means the path itself
		// does not point to a quiver — this is a missing-path condition, not a
		// structural violation of a quiver that exists.
		// (Contrast: missing Quill.yaml inside a version dir is quiver_invalid —
		// the version dir exists but lacks its required sentinel file.)
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') {
			throw new QuiverError(
				'transport_error',
				`Source Quiver at "${rootDir}" is missing required "Quiver.yaml"`,
				{ cause: err }
			);
		}
		throw new QuiverError(
			'transport_error',
			`Failed to read "Quiver.yaml" at "${quiverYamlPath}": ${(err as Error).message}`,
			{ cause: err }
		);
	}

	const meta = parseQuiverYaml(raw);

	const quillsDir = join(rootDir, 'quills');

	let quillNames: string[];
	try {
		quillNames = await readdir(quillsDir);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') {
			return { meta, catalog: new Map() };
		}
		throw new QuiverError(
			'transport_error',
			`Failed to read "quills/" directory at "${quillsDir}": ${(err as Error).message}`,
			{ cause: err }
		);
	}

	const catalog = new Map<string, string[]>();

	for (const quillName of quillNames) {
		const quillNameDir = join(quillsDir, quillName);

		let st;
		try {
			st = await lstat(quillNameDir);
		} catch (err) {
			throw new QuiverError(
				'transport_error',
				`Failed to stat "${quillNameDir}": ${(err as Error).message}`,
				{ cause: err }
			);
		}
		refuseSymlink(st, quillNameDir);
		if (!st.isDirectory()) continue;

		let versionDirs: string[];
		try {
			versionDirs = await readdir(quillNameDir);
		} catch (err) {
			throw new QuiverError(
				'transport_error',
				`Failed to read versions for quill "${quillName}": ${(err as Error).message}`,
				{ cause: err }
			);
		}

		const versions: string[] = [];

		for (const versionDir of versionDirs) {
			const versionPath = join(quillNameDir, versionDir);

			let vst;
			try {
				vst = await lstat(versionPath);
			} catch (err) {
				throw new QuiverError(
					'transport_error',
					`Failed to stat "${versionPath}": ${(err as Error).message}`,
					{ cause: err }
				);
			}
			refuseSymlink(vst, versionPath);
			if (!vst.isDirectory()) continue;

			if (!isCanonicalSemver(versionDir)) {
				throw new QuiverError(
					'quiver_invalid',
					`Quill "${quillName}" has non-canonical version directory "${versionDir}" — only x.y.z format is allowed`,
					{ quiverName: meta.name, version: versionDir }
				);
			}

			const quillYamlPath = join(versionPath, 'Quill.yaml');
			let quillYaml: Uint8Array;
			try {
				refuseSymlink(await lstat(quillYamlPath), quillYamlPath);
				quillYaml = await readFile(quillYamlPath);
			} catch (err) {
				if (err instanceof QuiverError) throw err;
				const code = (err as NodeJS.ErrnoException).code;
				if (code === 'ENOENT') {
					throw new QuiverError(
						'quiver_invalid',
						`Quill "${quillName}@${versionDir}" is missing required "Quill.yaml"`,
						{ quiverName: meta.name, version: versionDir }
					);
				}
				throw new QuiverError(
					'transport_error',
					`Failed to read "Quill.yaml" at "${quillYamlPath}": ${(err as Error).message}`,
					{ cause: err }
				);
			}
			refuseUnnamedQuill(quillName, meta.name);
			refuseMisplacedQuill(quillYaml, quillName, versionDir, meta.name);

			versions.push(versionDir);
		}

		if (versions.length > 0) {
			versions.sort((a, b) => compareSemver(b, a));
			catalog.set(quillName, versions);
		}
	}

	return { meta, catalog };
}

/**
 * Recursively reads all files under a quill version directory into a Map.
 *
 * Keys are relative POSIX paths (forward slashes, no leading slash).
 * Throws `quiver_invalid` on a symlink, `transport_error` on I/O failure.
 */
export async function readQuillTree(quillDir: string): Promise<Map<string, Uint8Array>> {
	const tree: Map<string, Uint8Array> = new Map();
	await walkDir(quillDir, quillDir, tree);
	return tree;
}

async function walkDir(
	baseDir: string,
	currentDir: string,
	tree: Map<string, Uint8Array>
): Promise<void> {
	let entries: string[];
	try {
		entries = await readdir(currentDir);
	} catch (err) {
		throw new QuiverError(
			'transport_error',
			`Failed to read directory "${currentDir}": ${(err as Error).message}`,
			{ cause: err }
		);
	}

	for (const entry of entries) {
		const fullPath = join(currentDir, entry);
		let st;
		try {
			st = await lstat(fullPath);
		} catch (err) {
			throw new QuiverError(
				'transport_error',
				`Failed to stat "${fullPath}": ${(err as Error).message}`,
				{ cause: err }
			);
		}
		refuseSymlink(st, fullPath);

		if (st.isDirectory()) {
			await walkDir(baseDir, fullPath, tree);
		} else {
			const rel = relative(baseDir, fullPath);
			const posixRel = sep === '/' ? rel : rel.split(sep).join('/');

			let bytes: Uint8Array;
			try {
				bytes = await readFile(fullPath);
			} catch (err) {
				throw new QuiverError(
					'transport_error',
					`Failed to read file "${fullPath}": ${(err as Error).message}`,
					{ cause: err }
				);
			}
			tree.set(posixRel, bytes);
		}
	}
}

/**
 * Source-backed QuiverLoader: loads file trees from a Source Quiver on disk.
 * `Quiver` resolves every ref against its catalog before reaching a loader, so
 * the name and version arrive catalog-backed and go straight to the disk.
 */
export class SourceLoader implements QuiverLoader {
	constructor(private readonly rootDir: string) {}

	async load(name: string, version: string): Promise<Map<string, Uint8Array>> {
		const quillDir = join(this.rootDir, 'quills', name, version);
		return readQuillTree(quillDir);
	}
}
