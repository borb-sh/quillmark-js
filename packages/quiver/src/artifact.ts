/**
 * The artifact reader: one zip holding `quiver.json`, each quill's files under
 * `quills/<name>/<version>/`, and the fonts they share under `fonts/<sha256>`. The
 * document and the layout are checked whole when the bytes are opened; a quill's files
 * are inflated when it is asked for.
 *
 * Package-internal, and browser-safe: no static `node:` imports at any level.
 */

import { QuiverError } from './errors.js';
import { FONTS_DIR, FORMAT, MANIFEST_PATH, QUILLS_DIR } from './format.js';
import { isQuillName } from './ref.js';
import { compareSemver, isCanonicalSemver } from './semver.js';
import { unpackFiles } from './zip.js';
import { createQuiver } from './quiver.js';
import type { Quiver, QuiverLoader } from './quiver.js';

interface Entry {
	name: string;
	version: string;
	/** Path in the quill's tree → the font's full SHA-256. */
	fonts: Record<string, string>;
}

const FONT_HASH_RE = /^[0-9a-f]{64}$/;

const invalid = (message: string): QuiverError => new QuiverError('quiver_invalid', message);

/**
 * Bytes that are not a zip, named for what they most often are: a host answering a
 * missing path with a page. A zip opens on a local file header (`PK\x03\x04`), or on the
 * end record alone when it holds nothing.
 */
function assertZip(bytes: Uint8Array): void {
	const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
	if (zip) return;
	const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart().toLowerCase();
	throw invalid(
		head.startsWith('<')
			? 'Not a quiver artifact: the bytes are an HTML page. A host answering a missing path with its index (an SPA fallback) serves one where the artifact should be.'
			: `Not a quiver artifact: ${bytes.length} bytes that are not a zip`
	);
}

function assertKeys(obj: Record<string, unknown>, allowed: string[], context: string): void {
	for (const key of Object.keys(obj)) {
		if (!allowed.includes(key)) throw invalid(`${context}: unknown field "${key}"`);
	}
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `quiver.json`, parsed. The format is read before anything else is believed, so a file
 * from a newer packer is refused by name rather than as the first field this reader
 * does not know.
 */
function parseManifest(raw: Uint8Array | undefined): {
	name: string;
	description: string | undefined;
	entries: Entry[];
} {
	if (raw === undefined) throw invalid(`Artifact holds no ${MANIFEST_PATH}`);

	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(raw));
	} catch {
		throw invalid(`${MANIFEST_PATH} is not JSON`);
	}
	if (!isRecord(parsed)) throw invalid(`${MANIFEST_PATH} must be a JSON object`);

	const format = parsed['format'];
	if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
		throw invalid(
			`${MANIFEST_PATH}: "format" must be a positive integer, got ${JSON.stringify(format)}`
		);
	}
	if (format > FORMAT) {
		throw invalid(
			`This quiver is packed in format ${format} and this reader reads ${FORMAT}. ` +
				`Upgrade @quillmark/quiver, or for a served client the client itself, which carries the copy that reads this.`
		);
	}

	assertKeys(parsed, ['format', 'name', 'description', 'quills'], MANIFEST_PATH);

	const name = parsed['name'];
	if (typeof name !== 'string' || name.length === 0) {
		throw invalid(`${MANIFEST_PATH}: "name" must be a non-empty string`);
	}

	const description = parsed['description'];
	if (description !== undefined && typeof description !== 'string') {
		throw invalid(`${MANIFEST_PATH}: "description" must be a string if present`);
	}

	const quills = parsed['quills'];
	if (!Array.isArray(quills)) throw invalid(`${MANIFEST_PATH}: "quills" must be an array`);

	const entries = quills.map((q: unknown, i): Entry => {
		const at = `${MANIFEST_PATH}: quills[${i}]`;
		if (!isRecord(q)) throw invalid(`${at} must be an object`);
		assertKeys(q, ['name', 'version', 'fonts'], at);

		const quill = q['name'];
		if (typeof quill !== 'string' || !isQuillName(quill)) {
			throw invalid(
				`${at}.name ${JSON.stringify(quill)} is not a name a ref can spell — only [A-Za-z0-9_-] are allowed`
			);
		}

		const version = q['version'];
		if (typeof version !== 'string' || !isCanonicalSemver(version)) {
			throw invalid(
				`${at}.version must be canonical semver (x.y.z), got ${JSON.stringify(version)}`
			);
		}

		const declared = q['fonts'];
		if (!isRecord(declared)) throw invalid(`${at}.fonts must be an object`);
		const fonts: Record<string, string> = {};
		for (const [path, hash] of Object.entries(declared)) {
			if (typeof hash !== 'string' || !FONT_HASH_RE.test(hash)) {
				throw invalid(`${at}.fonts["${path}"] is not a SHA-256: ${JSON.stringify(hash)}`);
			}
			fonts[path] = hash;
		}

		return { name: quill, version, fonts };
	});

	return { name, description, entries };
}

/**
 * Every entry is one the document accounts for, and every font it names is present. A
 * torn or hand-assembled artifact fails here, whole, rather than at whichever quill a
 * reader happens to open first.
 */
function assertLayout(names: string[], index: Map<string, Entry>): void {
	const present = new Set(names);
	for (const path of names) {
		if (path === MANIFEST_PATH) continue;
		if (path.startsWith(FONTS_DIR) && FONT_HASH_RE.test(path.slice(FONTS_DIR.length))) continue;
		if (path.startsWith(QUILLS_DIR)) {
			const [name, version] = path.slice(QUILLS_DIR.length).split('/', 2);
			if (index.has(`${name}@${version}`)) continue;
		}
		throw invalid(`Artifact holds "${path}", which ${MANIFEST_PATH} does not account for`);
	}
	for (const entry of index.values()) {
		for (const [path, hash] of Object.entries(entry.fonts)) {
			if (!present.has(`${FONTS_DIR}${hash}`)) {
				throw invalid(
					`${entry.name}@${entry.version} names font "${path}" as ${hash}, which the artifact does not hold`
				);
			}
		}
	}
}

/** Name → versions (descending), derived from the index, so the catalog and the loader
 *  cannot disagree about what the artifact holds. */
function catalogOf(index: Map<string, Entry>): Map<string, string[]> {
	const catalog = new Map<string, string[]>();
	for (const { name, version } of index.values()) {
		catalog.set(name, [...(catalog.get(name) ?? []), version]);
	}
	for (const versions of catalog.values()) versions.sort((a, b) => compareSemver(b, a));
	return catalog;
}

class ArtifactLoader implements QuiverLoader {
	constructor(
		private readonly bytes: Uint8Array,
		private readonly index: Map<string, Entry>
	) {}

	async loadTree(name: string, version: string): Promise<Map<string, Uint8Array>> {
		// Every ref reaching here resolved against the catalog this index derives.
		const entry = this.index.get(`${name}@${version}`)!;
		const prefix = `${QUILLS_DIR}${name}/${version}/`;
		const fonts = new Set(Object.values(entry.fonts).map((hash) => `${FONTS_DIR}${hash}`));

		const { files } = unpackFiles(this.bytes, (path) => path.startsWith(prefix) || fonts.has(path));

		const tree = new Map<string, Uint8Array>();
		for (const [path, bytes] of Object.entries(files)) {
			if (path.startsWith(prefix)) tree.set(path.slice(prefix.length), bytes);
		}
		for (const [path, hash] of Object.entries(entry.fonts)) {
			tree.set(path, files[`${FONTS_DIR}${hash}`]!);
		}
		return tree;
	}
}

/**
 * Open an artifact's bytes. Throws `quiver_invalid` on anything but a whole artifact in a
 * format this reader takes.
 */
export function readArtifact(bytes: Uint8Array): Quiver {
	assertZip(bytes);
	const { names, files } = unpackFiles(bytes, (path) => path === MANIFEST_PATH);
	const { name, description, entries } = parseManifest(files[MANIFEST_PATH]);

	const index = new Map<string, Entry>();
	for (const entry of entries) {
		const ref = `${entry.name}@${entry.version}`;
		if (index.has(ref)) throw invalid(`${MANIFEST_PATH} lists "${ref}" twice`);
		index.set(ref, entry);
	}
	assertLayout(names, index);

	return createQuiver(name, description, catalogOf(index), new ArtifactLoader(bytes, index));
}
