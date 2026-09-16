/**
 * Zip utilities — browser-safe (uses fflate only).
 */

import { zipSync, unzipSync } from 'fflate';
import { QuiverError } from './errors.js';

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
 * What a bundle may hold. Deflate tops out near 1032:1, so a megabyte of zip is a
 * gigabyte resident and the bundle is what a reader inflates to find that out.
 *
 * The ceiling is a constant rather than something a consumer raises, because a quiver
 * is a dependency pinned like any other (README, "What a quiver is trusted to be") and
 * what a budget bounds there is a build that packed something enormous. Both ends spend
 * it, so an artifact no loader would read is refused where it is written.
 *
 * Fonts are not in here: `build` writes them to the store and the manifest names them,
 * leaving a bundle its markdown, its Typst, and what those inline.
 *
 * `built-loader.ts` spends it on the wire too. A deflate of what fits inside it is within
 * zip framing of that, so one number bounds both ends and the fetch needs no second.
 */
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_BUNDLE_ENTRIES = 2048;

/**
 * The budget, spent one entry at a time. Throws `quiver_invalid`.
 *
 * Unpacking spends the sizes the central directory declares, and those are the sizes
 * fflate allocates: each entry inflates into a buffer of exactly its declared size,
 * which never grows. So a header cannot buy more than it declares — it can only
 * understate itself and truncate its own entry, which is the corrupt bundle the digest
 * already answers.
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
 * Throws `quiver_invalid` where the budget is spent.
 */
export function packFiles(files: Record<string, Uint8Array>): Uint8Array {
	const spend = bundleBudget();
	const sorted = Object.keys(files).sort();
	const input: Record<string, [Uint8Array, { mtime: Date }]> = {};
	for (const key of sorted) {
		const bytes = files[key]!;
		spend(key, bytes.length);
		input[key] = [bytes, { mtime: ZIP_EPOCH }];
	}
	return zipSync(input, { level: 6 });
}

/**
 * Unpack a zip into a flat file map.
 * Returns { path: Uint8Array } for every file entry in the archive.
 * Throws `quiver_invalid` where the budget is spent. fflate filters and inflates one
 * entry per pass, so the entries the budget already took are resident when it throws —
 * bounded, being what fit inside it.
 */
export function unpackFiles(data: Uint8Array): Record<string, Uint8Array> {
	const spend = bundleBudget();
	return unzipSync(data, {
		filter: ({ name, originalSize }) => {
			spend(name, originalSize);
			return true;
		}
	});
}
