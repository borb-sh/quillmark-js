// Where studio's quills come from: the built quiver served beside the client, read back
// with `Quiver.fromBuiltUrl` off the document's own base (STUDIO §"A client, and what serves it").
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
 * A fresh `Quiver` over the served tree. Minted rather than cached: the quill cache lives
 * as long as the quiver, so a repack drops the quiver instead of invalidating it.
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

/** The header `quillkit serve` names its stream by, and the event it sends after a repack
 *  lands (`src/serve.ts`, `src/bin/quillkit.ts`). The client shares no module with the
 *  bin, so both are spelled here too. */
const EVENTS_HEADER = 'x-quillkit-events';
const REPACKED = 'repacked';

/**
 * Call `onRepack` after each repack `quillkit serve` lands, and return the unsubscribe.
 *
 * The stream is named by a header on the page itself, so a client a static host serves
 * finds none and asks for nothing. The stream's first open is the boot; a later one is the
 * stream back after the server restarted, and a restart packs on its way up, so it counts
 * as a repack.
 */
export function followRepacks(onRepack: () => void): () => void {
	let source: EventSource | undefined;
	let stopped = false;
	fetch(document.baseURI, { method: 'HEAD', cache: 'no-store' }).then(
		(res) => {
			const at = res.headers.get(EVENTS_HEADER);
			if (stopped || !at) return;
			source = new EventSource(new URL(at, document.baseURI));
			let opened = false;
			source.addEventListener('open', () => {
				if (opened) onRepack();
				opened = true;
			});
			source.addEventListener(REPACKED, onRepack);
		},
		// No answer to a probe is no loop behind the page, which is the deployed case.
		() => {}
	);
	return () => {
		stopped = true;
		source?.close();
	};
}
