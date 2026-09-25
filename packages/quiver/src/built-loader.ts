/**
 * Built-quiver loader: reads `quiver.json` through a reader, validates it, and hands back
 * a Quiver whose loader reads bundles and fonts on demand.
 *
 * Package-internal, and browser-safe: no static `node:` imports at any level.
 */

import { QuiverError } from './errors.js';
import { unpackFiles } from './bundle.js';
import { isQuillName } from './ref.js';
import { isCanonicalSemver, compareSemver } from './semver.js';
import { FORMAT, INDEX } from './format.js';
import { isFont, isZip } from './signature.js';
import type { Quiver, QuiverLoader } from './quiver.js';
import { createQuiver } from './quiver.js';

interface BuiltQuillEntry {
	name: string;
	version: string;
	bundle: string;
	fonts: Record<string, string>;
}

interface BuiltIndex {
	name: string;
	description: string | undefined;
	entries: Map<string, BuiltQuillEntry>;
}

/**
 * Bytes at an artifact-relative path. `revalidate` marks `quiver.json`, the one name read
 * that carries no digest; every other name read is safe to answer from a cache.
 */
export type ArtifactReader = (path: string, revalidate: boolean) => Promise<Uint8Array>;

export function httpReader(base: string): ArtifactReader {
	const root = base.endsWith('/') ? base : `${base}/`;
	return async (path, revalidate) => {
		const url = `${root}${path}`;
		let response: Response;
		try {
			// `no-cache` revalidates with the origin, a 304 still serving from disk.
			// `force-cache` takes a cached response whatever its age, which a name carrying
			// its own digest is entitled to.
			response = await globalThis.fetch(url, { cache: revalidate ? 'no-cache' : 'force-cache' });
		} catch (err) {
			throw new QuiverError(
				'transport_error',
				`Network error fetching "${url}": ${(err as Error).message}`,
				{ cause: err }
			);
		}
		if (!response.ok) {
			throw new QuiverError('transport_error', `HTTP ${response.status} fetching "${url}"`);
		}
		try {
			return new Uint8Array(await response.arrayBuffer());
		} catch (err) {
			throw new QuiverError(
				'transport_error',
				`Network error reading "${url}": ${(err as Error).message}`,
				{ cause: err }
			);
		}
	};
}

/** Over bytes the caller holds; a leading `./` or `/` on a key is dropped. */
export function filesReader(files: ReadonlyMap<string, Uint8Array>): ArtifactReader {
	const held = new Map([...files].map(([key, bytes]) => [key.replace(/^\.?\//, ''), bytes]));
	return async (path) => {
		const bytes = held.get(path);
		if (bytes === undefined) {
			throw new QuiverError(
				'transport_error',
				`No bytes held for "${path}": Quiver.fromBuiltFiles needs the whole artifact`
			);
		}
		return bytes;
	};
}

// The shapes `build` writes. Neither admits a separator, so a validated name read off
// `quiver.json` stays inside the artifact on every reader.
const BUNDLE_RE = /^[A-Za-z0-9_-]+@[0-9]+\.[0-9]+\.[0-9]+\.[0-9a-f]+\.zip$/;
const FONT_HASH_RE = /^[0-9a-f]{64}$/;

/** Bytes a host answered with that are not the file named: a `transport_error`, so an
 *  evicting cache and the reread below both get their turn. */
function refused(path: string, what: string): QuiverError {
	return new QuiverError('transport_error', `"${path}" arrived as something other than ${what}`);
}

class BuiltLoader implements QuiverLoader {
	readonly #fonts = new Map<string, Promise<Uint8Array>>();
	#rereading: Promise<BuiltIndex> | undefined;

	constructor(
		private readonly read: ArtifactReader,
		private readonly entries: Map<string, BuiltQuillEntry>
	) {}

	/**
	 * A tab holding the previous generation's index asks for names the next one deleted,
	 * so a failed read rereads `quiver.json` once and retries under that entry where it
	 * names other files. A reread refusing the index is the error that explains the
	 * failure, and is the one thrown.
	 */
	async loadTree(name: string, version: string): Promise<Map<string, Uint8Array>> {
		const key = `${name}@${version}`;
		const entry = this.entries.get(key)!;
		try {
			return await this.#treeOf(entry);
		} catch (err) {
			let index: BuiltIndex;
			try {
				index = await this.#reread();
			} catch (reread) {
				throw reread instanceof QuiverError && reread.code === 'quiver_invalid' ? reread : err;
			}
			const fresh = index.entries.get(key);
			if (fresh === undefined || sameFiles(fresh, entry)) throw err;
			return this.#treeOf(fresh);
		}
	}

	/** One reread in flight, taking every entry both generations carry. */
	#reread(): Promise<BuiltIndex> {
		return (this.#rereading ??= readIndex(this.read)
			.then((index) => {
				for (const [key, entry] of index.entries) {
					if (this.entries.has(key)) this.entries.set(key, entry);
				}
				return index;
			})
			.finally(() => {
				this.#rereading = undefined;
			}));
	}

	async #treeOf(entry: BuiltQuillEntry): Promise<Map<string, Uint8Array>> {
		const zip = await this.read(entry.bundle, false);
		if (!isZip(zip)) throw refused(entry.bundle, 'a zip');
		const files = unpackFiles(zip);
		await Promise.all(
			Object.entries(entry.fonts).map(async ([path, hash]) => {
				files[path] = await this.#font(hash);
			})
		);
		return new Map(Object.entries(files));
	}

	/** One read per hash, coalesced; a failure is evicted so a retry reads again. */
	#font(hash: string): Promise<Uint8Array> {
		let bytes = this.#fonts.get(hash);
		if (bytes === undefined) {
			const path = `fonts/${hash}`;
			bytes = this.read(path, false)
				.then((font) => {
					if (!isFont(font)) throw refused(path, 'a font');
					return font;
				})
				.catch((err: unknown) => {
					this.#fonts.delete(hash);
					throw err;
				});
			this.#fonts.set(hash, bytes);
		}
		return bytes;
	}
}

function sameFiles(a: BuiltQuillEntry, b: BuiltQuillEntry): boolean {
	return a.bundle === b.bundle && JSON.stringify(a.fonts) === JSON.stringify(b.fonts);
}

function assertNoUnknownKeys(
	obj: Record<string, unknown>,
	allowed: string[],
	context: string
): void {
	for (const key of Object.keys(obj)) {
		if (!allowed.includes(key)) {
			throw new QuiverError('quiver_invalid', `${context}: unknown field "${key}"`);
		}
	}
}

async function readIndex(read: ArtifactReader): Promise<BuiltIndex> {
	let bytes: Uint8Array;
	try {
		bytes = await read(INDEX, true);
	} catch (err) {
		if (err instanceof QuiverError) throw err;
		throw new QuiverError('transport_error', `Failed to read ${INDEX}: ${(err as Error).message}`, {
			cause: err
		});
	}
	return parseIndex(new TextDecoder().decode(bytes));
}

function parseIndex(raw: string): BuiltIndex {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new QuiverError('quiver_invalid', `${INDEX} contains invalid JSON`);
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new QuiverError('quiver_invalid', `${INDEX} must be a JSON object`);
	}

	const obj = parsed as Record<string, unknown>;

	// Read before the key check, so a newer document is refused as newer rather than as
	// carrying a field this reader does not know.
	const format = obj['format'];
	if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
		throw new QuiverError(
			'quiver_invalid',
			`${INDEX}: "format" must be a positive integer, got ${JSON.stringify(format)}`
		);
	}
	if (format > FORMAT) {
		throw new QuiverError(
			'quiver_invalid',
			`This quiver is built in format ${format} and this loader reads ${FORMAT}. ` +
				`Upgrade @quillmark/quiver, or for a served client the client itself, which carries the copy that reads this.`
		);
	}

	assertNoUnknownKeys(obj, ['format', 'name', 'description', 'quills'], INDEX);

	const name = obj['name'];
	if (typeof name !== 'string' || name.length === 0) {
		throw new QuiverError('quiver_invalid', `${INDEX} must have a non-empty string "name" field`);
	}

	const description = obj['description'];
	if (description !== undefined && typeof description !== 'string') {
		throw new QuiverError(
			'quiver_invalid',
			`${INDEX} "description" must be a string if present, got ${typeof description}`
		);
	}

	const quills = obj['quills'];
	if (!Array.isArray(quills)) {
		throw new QuiverError('quiver_invalid', `${INDEX} must have a "quills" array`);
	}

	const entries = new Map<string, BuiltQuillEntry>();

	for (let i = 0; i < quills.length; i++) {
		const at = `${INDEX} quills[${i}]`;
		const entry = quills[i];

		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			throw new QuiverError('quiver_invalid', `${at} must be an object`);
		}

		const e = entry as Record<string, unknown>;
		assertNoUnknownKeys(e, ['name', 'version', 'bundle', 'fonts'], at);

		const quillName = e['name'];
		if (typeof quillName !== 'string' || quillName.length === 0) {
			throw new QuiverError('quiver_invalid', `${at}.name must be a non-empty string`);
		}

		if (!isQuillName(quillName)) {
			throw new QuiverError(
				'quiver_invalid',
				`${at}.name "${quillName}" is not a name a ref can spell — only [A-Za-z0-9_-] are allowed`
			);
		}

		const version = e['version'];
		if (typeof version !== 'string' || !isCanonicalSemver(version)) {
			throw new QuiverError(
				'quiver_invalid',
				`${at}.version must be canonical semver (x.y.z), got "${String(version)}"`
			);
		}

		const bundle = e['bundle'];
		if (typeof bundle !== 'string' || !BUNDLE_RE.test(bundle)) {
			throw new QuiverError('quiver_invalid', `${at}.bundle is invalid: "${String(bundle)}"`);
		}

		const declared = e['fonts'];
		if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
			throw new QuiverError('quiver_invalid', `${at}.fonts must be an object`);
		}

		const fonts: Record<string, string> = {};
		for (const [path, hash] of Object.entries(declared)) {
			if (typeof hash !== 'string' || !FONT_HASH_RE.test(hash)) {
				throw new QuiverError(
					'quiver_invalid',
					`${at}.fonts["${path}"] is not a font hash: ${JSON.stringify(hash)}`
				);
			}
			fonts[path] = hash;
		}

		const key = `${quillName}@${version}`;
		if (entries.has(key)) {
			throw new QuiverError('quiver_invalid', `Duplicate quill entry in ${INDEX}: "${key}"`);
		}
		entries.set(key, { name: quillName, version, bundle, fonts });
	}

	return { name, description, entries };
}

/**
 * Name → versions (descending), derived from the entries. One structure backs both the
 * loader's lookups and the Quiver's catalog, so the two cannot disagree about what
 * `quiver.json` holds.
 */
function catalogOf(entries: Map<string, BuiltQuillEntry>): Map<string, string[]> {
	const catalog = new Map<string, string[]>();
	for (const entry of entries.values()) {
		const versions = catalog.get(entry.name) ?? [];
		versions.push(entry.version);
		catalog.set(entry.name, versions);
	}
	for (const versions of catalog.values()) {
		versions.sort((a, b) => compareSemver(b, a));
	}
	return catalog;
}

export async function loadBuiltQuiver(read: ArtifactReader): Promise<Quiver> {
	const { name, description, entries } = await readIndex(read);
	return createQuiver(name, description, catalogOf(entries), new BuiltLoader(read, entries));
}
