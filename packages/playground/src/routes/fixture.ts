// Where the playground's quills come from: a built quiver served under `/quiver/`,
// packed from the workspace fixture tree by `scripts/build-quiver.mjs`. `quiver.json` →
// content-addressed bundle and fonts, the browser consumer path in full
// (PLAYGROUND §"Quiver, not bundler").
//
// One `Quiver` for the page. Its quill cache is per canonical ref and lives as long
// as the quiver does, so routes share one materialization across client-side
// navigation instead of paying for their own.
import { Quiver } from '@quillmark/quiver';
import { base } from '$app/paths';

/** The quill a route opens unless it is asked for another. */
export const DEFAULT_FIXTURE = 'showcase';

let quiverP: Promise<Quiver> | undefined;

// A rejected promise is not nullish and would memoize the failure for the page's life, so
// the memo clears before the rejection reaches the caller: the next call fetches again.
function quiver(): Promise<Quiver> {
	return (quiverP ??= Quiver.fromBuiltUrl(`${base}/quiver/`).catch((err: unknown) => {
		quiverP = undefined;
		throw err;
	}));
}

/**
 * Every quill the served quiver holds, which is the pack's call rather than this
 * module's (PLAYGROUND §"Which quill, and what is seeded into it").
 *
 * Sync on the quiver, which materializes its catalog as it loads, so a picker over
 * this needs no loading state past the one its route already has.
 */
export async function fixtureNames(): Promise<string[]> {
	return (await quiver()).quillNames();
}

/**
 * A fixture quill's file tree, from the quiver: the `Map` `Quill.fromTree` accepts,
 * keyed `"/"`-joined relative to the quill root. A bare name takes the newest version.
 *
 * A tree rather than the `Quill` `getQuill` hands back, because a route frees the
 * handles it opens and the quiver's cached quill is not a route's to free: it is
 * held unfreed for the page. The cost is one materialization the caller discards.
 */
export async function loadFixtureTree(
	name: string = DEFAULT_FIXTURE
): Promise<Map<string, Uint8Array>> {
	return (await (await quiver()).getQuill(name)).toTree();
}
