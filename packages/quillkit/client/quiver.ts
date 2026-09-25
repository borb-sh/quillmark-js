// Where studio's quills come from: the built quiver the Node half packs, served beside
// the client and read back with `Quiver.fromBuiltUrl` (`quiver.json`, one
// content-addressed bundle per quill, fonts dehydrated beside them). The browser consumer
// path in full, which is what an author-facing surface owes the loader it is a surface for.
//
// The base is a runtime fact, taken off the document's own, and nothing here is
// workspace-relative: the same client serves a dev server, a subpath, and a published
// deploy unchanged (STUDIO §"A client, and what serves it").
import { Quiver } from '@quillmark/quiver';

/** The quiver's catalog, flattened for the picker. Sync, because `quillNames` and
 *  `versionsOf` are: the catalog is materialized as the quiver is built, so the picker
 *  needs no loading state of its own (QUIVER §getQuill). */
export interface Catalog {
	/** The quiver's own name, from `Quiver.yaml`. */
	name: string;
	/** What the collection says it is, from `Quiver.yaml`. */
	description: string | undefined;
	/** Every quill it holds, versions newest first. */
	quills: { name: string; versions: string[] }[];
}

/**
 * A fresh `Quiver` over the served tree. Minted rather than cached: a repack yields a
 * new `quiver.json`, and the quill cache lives as long as the quiver does, so the client
 * drops the quiver instead of invalidating it. `quiver.json` is already fetched
 * `no-cache`, so nothing here works around a cache.
 */
export function openQuiver(): Promise<Quiver> {
	return Quiver.fromBuiltUrl(new URL('quiver/', document.baseURI).href);
}

export function catalogOf(quiver: Quiver): Catalog {
	return {
		name: quiver.name,
		description: quiver.description,
		quills: quiver.quillNames().map((name) => ({ name, versions: quiver.versionsOf(name) }))
	};
}
