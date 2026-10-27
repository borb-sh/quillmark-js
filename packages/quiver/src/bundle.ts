/**
 * The `.quill` bundle, written and read through fflate — browser-safe. The format is
 * Quillmark's (quill-bundle.md in the quillmark repository): one quill's tree as one zip,
 * `Quill.yaml` at the root.
 */

import { zipSync, unzipSync } from 'fflate';
import { QuiverError } from './errors.js';

/** The extension a `.quill` bundle's name ends in. */
export const BUNDLE_EXTENSION = 'quill';

/**
 * Fixed epoch mtime for deterministic zip output.
 *
 * fflate reads mtime via local-time getters (getFullYear/getMonth/...) and rejects
 * years before 1980. Date.UTC(1980, 0, 1) becomes 1979-12-31 in any TZ west of UTC,
 * which both crashes the encoder and (where it doesn't crash) produces TZ-dependent
 * bytes. Using the local-time constructor anchors the components to 1980-01-01
 * 00:00:00 in *every* timezone, so the DOS timestamp written into the zip header
 * is always identical.
 */
const ZIP_EPOCH = new Date(1980, 0, 1, 0, 0, 0, 0);

/**
 * What a bundle may hold: the `.quill` format's budget, which every Quillmark runtime
 * spends on the same three bounds. Deflate tops out near 1032:1, so a megabyte of zip is
 * a gigabyte resident and the bundle is what a reader inflates to find that out.
 *
 * A constant rather than something a consumer raises, because the format fixes it. Both
 * ends spend it, so an artifact no loader would read is refused where it is written.
 */
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_BUNDLE_ENTRIES = 2048;

/**
 * The `.quill` format's entry names: relative, `/`-separated, and no segment empty, `.`
 * or `..`, nor holding `\`, `:` or NUL. Throws `quiver_invalid`.
 */
function checkPath(name: string): void {
	const why = name.startsWith('/')
		? 'is absolute'
		: /[\\:\0]/.test(name)
			? 'holds a \\, : or NUL'
			: name.split('/').some((s) => s === '' || s === '.' || s === '..')
				? 'has an empty, "." or ".." segment'
				: undefined;
	if (why !== undefined) {
		throw new QuiverError('quiver_invalid', `Bundled file "${name}" ${why}`);
	}
}

/**
 * The budget, spent one entry at a time. Throws `quiver_invalid`.
 *
 * Unpacking spends the sizes the central directory declares, and those are the sizes
 * fflate allocates: each entry inflates into a buffer of exactly its declared size,
 * which never grows. So a header cannot buy more than it declares — it can only
 * understate itself and truncate its own entry, which is a corrupt bundle rather than an
 * allocation.
 */
function bundleBudget(): (name: string, size: number) => void {
	let total = 0;
	let count = 0;
	return (name, size) => {
		if (++count > MAX_BUNDLE_ENTRIES) {
			throw new QuiverError(
				'quiver_invalid',
				`Bundle holds over ${MAX_BUNDLE_ENTRIES} files, the most one may hold`
			);
		}
		if (size > MAX_ENTRY_BYTES) {
			throw new QuiverError(
				'quiver_invalid',
				`Bundled file "${name}" is ${size} bytes, over the ${MAX_ENTRY_BYTES} one file may be`
			);
		}
		total += size;
		if (total > MAX_BUNDLE_BYTES) {
			throw new QuiverError(
				'quiver_invalid',
				`Bundle unpacks to over ${MAX_BUNDLE_BYTES} bytes, the most one may hold`
			);
		}
	};
}

/**
 * Pack a flat file map into a deterministic zip.
 * Keys are sorted before zipping so insertion order doesn't affect output.
 * Throws `quiver_invalid` where the budget is spent or a name is one the format refuses.
 */
export function packFiles(files: Record<string, Uint8Array>): Uint8Array {
	const spend = bundleBudget();
	const sorted = Object.keys(files).sort();
	const input: Record<string, [Uint8Array, { mtime: Date }]> = {};
	for (const key of sorted) {
		const bytes = files[key]!;
		checkPath(key);
		spend(key, bytes.length);
		input[key] = [bytes, { mtime: ZIP_EPOCH }];
	}
	return zipSync(input, { level: 6 });
}

/**
 * Unpack a zip into a flat file map.
 * Returns { path: Uint8Array } for every file entry in the archive; a directory entry
 * carries nothing and is dropped.
 * Throws `quiver_invalid` where the budget is spent or an entry name is one the format
 * refuses. fflate filters and inflates one entry per pass, so the entries the budget
 * already took are resident when it throws — bounded, being what fit inside it.
 */
export function unpackFiles(data: Uint8Array): Record<string, Uint8Array> {
	const spend = bundleBudget();
	return unzipSync(data, {
		filter: ({ name, originalSize }) => {
			spend(name, originalSize);
			const directory = name.endsWith('/');
			checkPath(directory ? name.slice(0, -1) : name);
			return !directory;
		}
	});
}
