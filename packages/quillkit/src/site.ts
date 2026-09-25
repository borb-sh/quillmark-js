/**
 * Lay a servable site out: the client at the root, a built quiver beside it under
 * `quiver/`. A deploy is that arrangement and nothing else, written here once, so a
 * consumer's `scripts`, this repository's CI and a Pages job all reach it by running
 * `quillkit site`.
 *
 * The client resolves its quiver from `document.baseURI` (`client/quiver.ts`), so
 * the tree it is laid into decides what it loads. Both halves of that are asserted rather
 * than assumed: a `quiver/` inside the client would occupy the URL the built one is
 * served from, and the winner would be whichever copy landed last.
 */

import { existsSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadQuiverNode } from './collection.js';
import { CLIENT, within } from './paths.js';

export interface SiteOptions {
	/** The source quiver: `Quiver.yaml` at its root. */
	collection: string;
	/** The site root, owned outright: cleared before it is written. */
	out: string;
	/** Defaults to the client this package ships, which is the only one a verb serves:
	 *  the tool and its client version together, so there is nothing to point elsewhere.
	 *  What this is for is the suite, which asserts the layout over a stub rather than
	 *  waiting on a Vite build to prove a copy. */
	client?: string;
	/** Pack the draft space too (QUIVER §"The draft floor"): a deploy that previews a
	 *  collection's prototypes rather than publishing its releases. */
	drafts?: boolean;
}

/**
 * `site` clears its output before writing it, so an out that is or contains the
 * collection or the working directory deletes the thing being laid out. `--out .` and a
 * slipped `--out ..` are one keystroke away and the deletion is unrecoverable.
 *
 * Quiver refuses the same shape for the tree its own `build` owns, and that refusal does
 * not travel with the packer: this clears a directory quiver never sees, one level above
 * the one it is handed.
 *
 * An out nested inside the collection stays allowed: `site/` under the quiver root is
 * the ordinary layout, and nothing of the source is read after the clear.
 */
export function assertSafeOut(collection: string, out: string): void {
	const at = resolve(out);
	const what = within(at, resolve(collection))
		? 'the collection'
		: within(at, process.cwd())
			? 'the working directory'
			: undefined;

	if (what !== undefined) {
		throw new Error(
			`Refusing to lay a site out in "${out}": the layout clears its output, and this one holds ${what} ("${at}"). Point --out at a directory the site owns.`
		);
	}
}

/**
 * The client half of the layout, checked before anything is deleted.
 *
 * A client carrying a `quiver/` of its own is the one failure this cannot recover from
 * silently: it would shadow the author's at the same URL, and which one the reader gets
 * would depend on copy order.
 */
export function assertClient(dist: string): void {
	if (!existsSync(join(dist, 'index.html')))
		throw new Error(`No client at ${dist}: quillkit carries one at dist/client`);
	if (existsSync(join(dist, 'quiver')))
		throw new Error(
			`${dist}/quiver exists: a client carries no quiver, and it would shadow the site's`
		);
}

/** Returns the site root, resolved. */
export async function laySite({
	collection,
	out,
	client,
	drafts = false
}: SiteOptions): Promise<string> {
	const dist = client ?? CLIENT;
	assertClient(dist);
	assertSafeOut(collection, out);

	const at = resolve(out);
	const { build } = await loadQuiverNode(collection);

	await rm(at, { recursive: true, force: true });
	await cp(dist, at, { recursive: true });
	await build(collection, join(at, 'quiver'), { drafts });

	assertPacked(join(at, 'quiver'), collection);

	return at;
}

/**
 * What the client fetches first. The packer is the collection's copy of quiver and the
 * reader is the client's, so a pack without it is one the client cannot read, and in the
 * browser that reads as a quiver that is not present rather than a pin that is behind.
 */
export function assertPacked(out: string, collection: string): void {
	if (!existsSync(join(out, 'quiver.json')))
		throw new Error(
			`${out} holds no quiver.json: "${collection}" packs through a @quillmark/quiver this client does not read. Upgrade it in the collection.`
		);
}
