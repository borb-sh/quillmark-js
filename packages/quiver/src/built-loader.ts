/**
 * Built-quiver loader: reads a packed artifact through a transport, validates
 * its pointer and manifest, and hands back a Quiver whose loader fetches
 * bundles and fonts on demand, each checked against the digest in its name.
 *
 * Package-internal, and browser-safe: no static `node:` imports at any level.
 */

import { QuiverError } from './errors.js';
import { MAX_BUNDLE_BYTES, unpackFiles } from './bundle.js';
import { isQuillName } from './ref.js';
import { isCanonicalSemver, compareSemver } from './semver.js';
import { NAME_DIGEST_LENGTH, sha256Hex } from './digest.js';
import { MANIFEST_VERSION, POINTER_FORMAT } from './format.js';
import type { Quiver, QuiverLoader } from './quiver.js';
import { createQuiver } from './quiver.js';

// ─── Internal types ───────────────────────────────────────────────────────────

interface BuiltQuillEntry {
	name: string;
	version: string;
	bundle: string;
	fonts: Record<string, string>;
}

interface BuiltManifest {
	name: string;
	description: string | undefined;
	quills: BuiltQuillEntry[];
}

// ─── The transport seam ───────────────────────────────────────────────────────

/**
 * Transport abstraction: fetch raw bytes by relative path within the packed
 * artifact. Implemented by HttpTransport (browser + Node) and FsBuiltTransport
 * (Node).
 */
export interface BuiltTransport {
	fetchBytes(relativePath: string, opts: FetchOptions): Promise<Uint8Array>;
}

/**
 * `revalidate` marks the one request that must not be answered from a cache:
 * `latest.json`, the only name in the artifact that is not content-addressed.
 * Everything else is safe to cache forever by construction, and a transport over a
 * cache says so itself rather than leaving the fact to a host's headers.
 *
 * `maxBytes` is what the response may weigh, required because only the caller knows what
 * it asked for: a pointer, a bundle and a font carry their own ceilings. A transport
 * holding a stream refuses past it before the bytes are resident; one over a file or a
 * held map ignores it.
 */
export interface FetchOptions {
	maxBytes: number;
	revalidate?: boolean;
}

/**
 * The ceiling per path. A bundle's is the unpack budget itself (`bundle.ts`). The other
 * two are their own: a font is a store entry rather than a bundle entry, and the pointer
 * and the manifest are the small documents a catalog is read out of — the pointer being
 * the one response in the artifact with no digest behind it.
 */
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_FONT_BYTES = 32 * 1024 * 1024;

/**
 * Fetch under `maxBytes`, then check the bytes against the digest their name
 * carries. That check is what makes "content-addressed, safe to cache forever"
 * a property rather than a hope: it catches a corrupted CDN object, a partial
 * sync, and a name reused across releases. A mismatch is a transport failure
 * (the bytes that arrived are not the bytes asked for), so the caches that
 * evict on error let a retry succeed.
 *
 * The ceiling is the transport's to hold, because a digest is a verdict on
 * bytes that have all arrived.
 *
 * Where no digest primitive exists (a page served over plain http, which is
 * not a secure context) the fetch passes through unchecked.
 */
async function fetchVerified(
	transport: BuiltTransport,
	path: string,
	expected: string,
	maxBytes: number
): Promise<Uint8Array> {
	const bytes = await transport.fetchBytes(path, { maxBytes });
	const actual = await sha256Hex(bytes);
	if (actual !== undefined && !actual.startsWith(expected)) {
		throw new QuiverError(
			'transport_error',
			`Digest mismatch for "${path}": the bytes hash to ${actual.slice(0, expected.length)}, not ${expected}`
		);
	}
	return bytes;
}

// ─── Path validation ──────────────────────────────────────────────────────────

// Each name carries the digest of what it names; the capture group is the
// digest the fetch is checked against, so path validation and verification
// read the same character span. `build` writes exactly NAME_DIGEST_LENGTH
// chars for bundles and manifests and the full 64 for store entries.
const DIGEST = `[0-9a-f]{${NAME_DIGEST_LENGTH},}`;
const MANIFEST_FILENAME_RE = new RegExp(`^manifest\\.(${DIGEST})\\.json$`);
// The name span is the ref charset, not a filename charset: `build` spells a bundle
// off the catalog row, and a row is a name a ref can spell.
const BUNDLE_FILENAME_RE = new RegExp(
	`^[A-Za-z0-9_-]+@[0-9]+\\.[0-9]+\\.[0-9]+\\.(${DIGEST})\\.zip$`
);
const FONT_HASH_RE = /^[0-9a-f]{64}$/;

/** The digest a content-addressed filename carries. Throws `quiver_invalid`. */
function digestOfName(re: RegExp, name: string, what: string): string {
	const match = re.exec(name);
	if (match === null) {
		throw new QuiverError('quiver_invalid', `${what} is invalid: "${name}"`);
	}
	return match[1]!;
}

function validateFontHash(hash: string, context: string): void {
	if (!FONT_HASH_RE.test(hash)) {
		throw new QuiverError('quiver_invalid', `${context}: font hash is invalid: "${hash}"`);
	}
}

// ─── BuiltLoader implementation ─────────────────────────────────────────────

class BuiltLoader implements QuiverLoader {
	/** Font byte cache: hash → in-flight or resolved Promise. */
	private readonly fontCache: Map<string, Promise<Uint8Array>> = new Map();

	constructor(
		private readonly transport: BuiltTransport,
		/** Index map from "name@version" to its manifest entry. */
		private readonly index: Map<string, BuiltQuillEntry>
	) {}

	async loadTree(name: string, version: string): Promise<Map<string, Uint8Array>> {
		// The catalog the outer Quiver resolves against derives from this index,
		// so every ref reaching here has an entry.
		const entry = this.index.get(`${name}@${version}`)!;

		const zipBytes = await fetchVerified(
			this.transport,
			entry.bundle,
			digestOfName(BUNDLE_FILENAME_RE, entry.bundle, 'bundle filename'),
			MAX_BUNDLE_BYTES
		);
		const files = unpackFiles(zipBytes);

		const fontEntries = Object.entries(entry.fonts);
		await Promise.all(
			fontEntries.map(async ([path, hash]) => {
				files[path] = await this.fetchFont(hash);
			})
		);

		return new Map(Object.entries(files));
	}

	/**
	 * Fetch a font by hash from store/<hash>, coalescing concurrent requests for
	 * the same hash into a single fetch. On error, removes the cache entry so
	 * callers can retry.
	 */
	private fetchFont(hash: string): Promise<Uint8Array> {
		let promise = this.fontCache.get(hash);
		if (!promise) {
			promise = fetchVerified(this.transport, `store/${hash}`, hash, MAX_FONT_BYTES).catch(
				(err: unknown) => {
					this.fontCache.delete(hash);
					throw err;
				}
			);
			this.fontCache.set(hash, promise);
		}
		return promise;
	}
}

// ─── Pointer + manifest validation helpers ────────────────────────────────────

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

function parsePointer(raw: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new QuiverError('quiver_invalid', 'latest.json contains invalid JSON');
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new QuiverError('quiver_invalid', 'latest.json must be a JSON object');
	}

	const obj = parsed as Record<string, unknown>;

	// The format, read before anything is believed about the rest. An unknown key is not
	// a failure here: this is the document a newer format announces itself on, and a
	// reader rejecting what it does not recognise refuses the announcement too. Absent
	// means a build from before the marker (`format.ts`).
	const format = obj['format'] ?? POINTER_FORMAT;
	if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
		throw new QuiverError(
			'quiver_invalid',
			`latest.json: "format" must be a positive integer, got ${JSON.stringify(obj['format'])}`
		);
	}
	if (format > POINTER_FORMAT) {
		throw new QuiverError(
			'quiver_invalid',
			`This quiver is built in format ${format} and this loader reads ${POINTER_FORMAT}. ` +
				`Upgrade @quillmark/quiver, or for a served client the client itself, which carries the copy that reads this.`
		);
	}

	const manifest = obj['manifest'];
	if (typeof manifest !== 'string' || manifest.length === 0) {
		throw new QuiverError(
			'quiver_invalid',
			'latest.json must have a non-empty string "manifest" field'
		);
	}

	return manifest;
}

function parseManifest(raw: string): BuiltManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new QuiverError('quiver_invalid', 'Manifest file contains invalid JSON');
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new QuiverError('quiver_invalid', 'Manifest must be a JSON object');
	}

	const obj = parsed as Record<string, unknown>;
	assertNoUnknownKeys(obj, ['version', 'name', 'description', 'quills'], 'manifest');

	const version = obj['version'];
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
		throw new QuiverError(
			'quiver_invalid',
			`Manifest version must be a positive integer, got ${JSON.stringify(version)}`
		);
	}
	if (version > MANIFEST_VERSION) {
		throw new QuiverError(
			'quiver_invalid',
			`This quiver's manifest is version ${version} and this loader reads ${MANIFEST_VERSION}. ` +
				`Upgrade @quillmark/quiver, or for a served client the client itself, which carries the copy that reads this.`
		);
	}

	const name = obj['name'];
	if (typeof name !== 'string' || name.length === 0) {
		throw new QuiverError('quiver_invalid', 'Manifest must have a non-empty string "name" field');
	}

	const description = obj['description'];
	if (description !== undefined && typeof description !== 'string') {
		throw new QuiverError(
			'quiver_invalid',
			`Manifest "description" must be a string if present, got ${typeof description}`
		);
	}

	const entries = obj['quills'];
	if (!Array.isArray(entries)) {
		throw new QuiverError('quiver_invalid', 'Manifest must have a "quills" array');
	}

	const quills: BuiltQuillEntry[] = [];

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];

		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			throw new QuiverError('quiver_invalid', `manifest.quills[${i}] must be an object`);
		}

		const e = entry as Record<string, unknown>;
		assertNoUnknownKeys(e, ['name', 'version', 'bundle', 'fonts'], `manifest.quills[${i}]`);

		const quillName = e['name'];
		if (typeof quillName !== 'string' || quillName.length === 0) {
			throw new QuiverError(
				'quiver_invalid',
				`manifest.quills[${i}].name must be a non-empty string`
			);
		}

		if (!isQuillName(quillName)) {
			throw new QuiverError(
				'quiver_invalid',
				`manifest.quills[${i}].name "${quillName}" is not a name a ref can spell — only [A-Za-z0-9_-] are allowed`
			);
		}

		const version = e['version'];
		if (typeof version !== 'string' || !isCanonicalSemver(version)) {
			throw new QuiverError(
				'quiver_invalid',
				`manifest.quills[${i}].version must be canonical semver (x.y.z), got "${String(version)}"`
			);
		}

		const bundle = e['bundle'];
		if (typeof bundle !== 'string' || bundle.length === 0) {
			throw new QuiverError(
				'quiver_invalid',
				`manifest.quills[${i}].bundle must be a non-empty string`
			);
		}

		digestOfName(BUNDLE_FILENAME_RE, bundle, `manifest.quills[${i}].bundle filename`);

		const declared = e['fonts'];
		if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
			throw new QuiverError('quiver_invalid', `manifest.quills[${i}].fonts must be an object`);
		}

		const fonts: Record<string, string> = {};
		for (const [k, v] of Object.entries(declared)) {
			if (typeof v !== 'string') {
				throw new QuiverError(
					'quiver_invalid',
					`manifest.quills[${i}].fonts["${k}"] must be a string`
				);
			}
			validateFontHash(v, `manifest.quills[${i}].fonts["${k}"]`);
			fonts[k] = v;
		}

		quills.push({ name: quillName, version, bundle, fonts });
	}

	return { name, description, quills };
}

// ─── Catalog assembly ─────────────────────────────────────────────────────────

/**
 * Name → versions (descending), derived from the index. One structure backs
 * both the loader's lookups and the Quiver's catalog, so the two cannot
 * disagree about what the manifest holds.
 */
function catalogOf(index: Map<string, BuiltQuillEntry>): Map<string, string[]> {
	const catalog = new Map<string, string[]>();
	for (const entry of index.values()) {
		const versions = catalog.get(entry.name) ?? [];
		versions.push(entry.version);
		catalog.set(entry.name, versions);
	}
	for (const versions of catalog.values()) {
		versions.sort((a, b) => compareSemver(b, a));
	}
	return catalog;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/** Load a build-output quiver via the given transport. */
export async function loadBuiltQuiver(transport: BuiltTransport): Promise<Quiver> {
	// The pointer is the one name that is not content-addressed, so it is also the
	// one fetch that must revalidate.
	let pointerBytes: Uint8Array;
	try {
		pointerBytes = await transport.fetchBytes('latest.json', {
			revalidate: true,
			maxBytes: MAX_DOCUMENT_BYTES
		});
	} catch (err) {
		if (err instanceof QuiverError) throw err;
		throw new QuiverError(
			'transport_error',
			`Failed to fetch latest.json: ${(err as Error).message}`,
			{ cause: err }
		);
	}

	const manifestFileName = parsePointer(new TextDecoder().decode(pointerBytes));
	const manifestDigest = digestOfName(
		MANIFEST_FILENAME_RE,
		manifestFileName,
		'Pointer manifest filename'
	);

	let manifestBytes: Uint8Array;
	try {
		manifestBytes = await fetchVerified(
			transport,
			manifestFileName,
			manifestDigest,
			MAX_DOCUMENT_BYTES
		);
	} catch (err) {
		if (err instanceof QuiverError) throw err;
		throw new QuiverError(
			'transport_error',
			`Failed to fetch manifest "${manifestFileName}": ${(err as Error).message}`,
			{ cause: err }
		);
	}

	const manifest = parseManifest(new TextDecoder().decode(manifestBytes));

	const index = new Map<string, BuiltQuillEntry>();
	for (const entry of manifest.quills) {
		const key = `${entry.name}@${entry.version}`;
		if (index.has(key)) {
			throw new QuiverError('quiver_invalid', `Duplicate quill entry in manifest: "${key}"`);
		}
		index.set(key, entry);
	}

	return createQuiver(
		manifest.name,
		manifest.description,
		catalogOf(index),
		new BuiltLoader(transport, index)
	);
}
