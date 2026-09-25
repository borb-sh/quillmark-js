/**
 * A collection of quills, addressed by ref. One class over a composed
 * `QuiverLoader`, source-backed or built, so what a quiver reads is the loader's
 * business and never the class's.
 *
 * Browser-safe: only `fromBuiltUrl`, `fromBuiltFiles` and the instance API live
 * here. The filesystem factories are free functions in `./node.js`; the class is
 * the same either way.
 */

import { QuiverError } from './errors.js';
import { init } from '@quillmark/wasm';
import type { Quill } from '@quillmark/wasm';
import { parseQuillRef } from './ref.js';
import { matchesSemverSelector } from './semver.js';

/** Loader strategy: source or build output. Package-internal. */
export interface QuiverLoader {
	loadTree(name: string, version: string): Promise<Map<string, Uint8Array>>;
}

/**
 * The private constructor's only door, closed over by the static block below.
 * Exported as `createQuiver` for this package's loaders and reachable from no
 * entry in `exports`, so a consumer holds the factories and nothing else.
 */
let create!: (
	name: string,
	description: string | undefined,
	catalog: Map<string, string[]>,
	loader: QuiverLoader
) => Quiver;

export class Quiver {
	readonly name: string;

	/** What `Quiver.yaml` says the collection is; `undefined` where the field is absent. */
	readonly description: string | undefined;

	readonly #catalog: ReadonlyMap<string, readonly string[]>;
	readonly #loader: QuiverLoader;

	/**
	 * Cache of materialized quills, keyed by canonical ref. A `Quill` is
	 * engine-free, portable data (`Quill.fromTree`), so one instance per ref is
	 * shared across every engine. Promise values so concurrent getQuill calls
	 * coalesce into a single materialization.
	 */
	readonly #quillCache: Map<string, Promise<Quill>> = new Map();

	/**
	 * Private constructor. A Quiver comes from a factory (`Quiver.fromBuiltUrl`,
	 * `Quiver.fromBuiltFiles`, or `fromDir` / `fromBuiltDir` from
	 * `@quillmark/quiver/node`), which is what names the thing being read.
	 */
	private constructor(
		name: string,
		description: string | undefined,
		catalog: Map<string, string[]>,
		loader: QuiverLoader
	) {
		this.name = name;
		this.description = description;
		this.#catalog = new Map(catalog);
		this.#loader = loader;
	}

	static {
		create = (name, description, catalog, loader) => new Quiver(name, description, catalog, loader);
	}

	/**
	 * Browser-safe factory. Loads build output from an HTTP/HTTPS URL.
	 *
	 * Origin-relative URLs (e.g. `/quivers/foo/`) are accepted in browser
	 * environments. `file://` URLs are rejected — to load build output from
	 * disk in Node, use `fromBuiltDir(path)` from `@quillmark/quiver/node`.
	 *
	 * Throws `transport_error` on network/HTTP failure, `quiver_invalid`
	 * on format errors.
	 */
	static async fromBuiltUrl(url: string): Promise<Quiver> {
		if (url.startsWith('file://')) {
			throw new QuiverError(
				'transport_error',
				`Quiver.fromBuiltUrl requires an http(s):// or origin-relative URL; got "${url}". For local build output, use import { fromBuiltDir } from '@quillmark/quiver/node'.`
			);
		}
		const { httpReader, loadBuiltQuiver } = await import('./built-loader.js');
		return loadBuiltQuiver(httpReader(url));
	}

	/**
	 * Browser-safe factory. Loads build output from the bytes themselves, keyed
	 * by artifact-relative path (`quiver.json`, `<name>@<x.y.z>.<digest>.zip`,
	 * `fonts/<hash>`) — the shape `build` writes and `fromBuiltDir` reads back.
	 *
	 * Nothing is fetched, so a runtime whose artifact is not on a path it can
	 * read (a serverless function, a bundler that inlines it, a test) reaches
	 * one without fetching its own static output back over its own load
	 * balancer.
	 *
	 * Throws `quiver_invalid` on format errors, `transport_error` on a path the
	 * map does not carry.
	 */
	static async fromBuiltFiles(files: ReadonlyMap<string, Uint8Array>): Promise<Quiver> {
		const { filesReader, loadBuiltQuiver } = await import('./built-loader.js');
		return loadBuiltQuiver(filesReader(files));
	}

	/** Returns all known quill names, sorted lexicographically. */
	quillNames(): string[] {
		return [...this.#catalog.keys()].sort();
	}

	/**
	 * Returns all canonical versions for a given quill name, sorted descending.
	 * Returns an empty array if the quill name is not in the catalog.
	 */
	versionsOf(name: string): string[] {
		return [...(this.#catalog.get(name) ?? [])];
	}

	/**
	 * Resolves a selector ref → canonical ref (e.g. "memo" → "memo@1.1.0").
	 *
	 * Selector forms: `name`, `name@x`, `name@x.y`, `name@x.y.z`. Picks the
	 * highest matching version in this quiver.
	 *
	 * Sync, and in-memory by construction rather than by implementation: every
	 * loader materializes the catalog as the quiver is built, and `QuiverLoader`
	 * carries one verb, `loadTree`, which resolution never reaches.
	 *
	 * Throws:
	 *   - `invalid_ref` if ref fails parseQuillRef
	 *   - `quill_not_found` if no version matches
	 */
	resolve(ref: string): string {
		const { name, selector } = parseQuillRef(ref);
		const versions = this.#catalog.get(name);

		if (versions !== undefined) {
			// Every loader materializes a catalog sorted descending, so the first match is
			// the highest.
			const winner =
				selector === undefined
					? versions[0]
					: versions.find((v) => matchesSemverSelector(v, selector));

			if (winner !== undefined) return `${name}@${winner}`;
		}

		throw new QuiverError(
			'quill_not_found',
			`No quill found for ref "${ref}" in quiver "${this.name}".`,
			{ ref, quiverName: this.name }
		);
	}

	/**
	 * Returns a `Quill` for a ref (selector or canonical).
	 *
	 * The returned quill is materialized from the `@quillmark/wasm` root export
	 * — it is engine-free, portable data suitable for schema inspection,
	 * validation, blueprint access, and document seeding.
	 *
	 * A core `Quill` renders directly: pass it to `engine.render(quill, doc)`.
	 *
	 * Selector refs (e.g. `"memo"`, `"memo@1"`) are resolved to canonical form
	 * first. Materializes once and caches per canonical ref — concurrent calls
	 * coalesce into a single load.
	 *
	 * Borrowed, not handed over: the quill is the quiver's, shared with every
	 * other caller for the same ref, and lives as long as the quiver. Do not
	 * `free()` it: the next `getQuill` for that ref would hand out a freed
	 * handle. A caller wanting one of its own mints it from `.toTree()`.
	 *
	 * Throws:
	 *   - `invalid_ref` if ref is malformed
	 *   - `quill_not_found` if ref does not match any version in this quiver
	 *   - propagates I/O errors from the loader unchanged
	 *   - propagates validation errors from Quill.fromTree() unchanged
	 */
	async getQuill(ref: string): Promise<Quill> {
		const canonicalRef = this.resolve(ref);

		let entry = this.#quillCache.get(canonicalRef);
		if (entry === undefined) {
			entry = this.#materializeQuill(canonicalRef).catch((err) => {
				this.#quillCache.delete(canonicalRef);
				throw err;
			});
			this.#quillCache.set(canonicalRef, entry);
		}
		return entry;
	}

	/**
	 * Internal: load the tree + construct via Quill.fromTree. Errors propagate.
	 *
	 * The tree is held only for the length of this call: the quill cache holds the
	 * materialized result, and it is the one cache. A second tree cache beside it
	 * would buy a retry after a `Quill.fromTree` throw its refetch, which is a
	 * saved round-trip on the path where the quill is broken.
	 *
	 * Every caller arrives through `resolve` or the catalog itself, so the ref is
	 * catalog-backed by construction and the loader needs no gate.
	 *
	 * `init()` is the only door to `Quill`, awaited here rather than left a
	 * precondition of `getQuill`. The gate is memoized, so this is one instantiation
	 * across every caller, overlapped with the load that pays for it.
	 */
	async #materializeQuill(canonicalRef: string): Promise<Quill> {
		const at = canonicalRef.indexOf('@');
		const [{ Quill }, tree] = await Promise.all([
			init(),
			this.#loader.loadTree(canonicalRef.slice(0, at), canonicalRef.slice(at + 1))
		]);
		return Quill.fromTree(tree);
	}
}

export { create as createQuiver };
