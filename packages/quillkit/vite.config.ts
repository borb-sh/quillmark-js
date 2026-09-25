import { fileURLToPath } from 'node:url';
import { build } from '@quillmark/quiver/node';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import { carried } from '../../scripts/carried.mjs';

// The client half of this package, built. `client/` is the browser's tree and `src/` is
// the bin's; the two share a manifest and a `dist`, and meet nowhere else: the tool
// serves these bytes to a tab and imports none of them.
//
// The pack, as this repository serves the client over it. `quillkit studio` is the
// loop an author runs and this is not a second copy of it: the pack is `build`, which
// replaces its file whole, and what is left here is the two things a dev server adds
// and a bin has no use for: the first pack before the server exists, and a repack
// signalled over the socket the page already holds. What this buys over the bin is
// HMR on the client's own chrome, which is what the dev server is for.

/** The browser tree: `index.html` and the module graph under it. Vite's root, so the
 *  Node half beside it is never in the client's program. */
const ROOT = fileURLToPath(new URL('client', import.meta.url));
/** Where the client lands, beside the compiled bin under the one `dist` the tarball
 *  carries. Outside Vite's root, so emptying it is stated rather than assumed. */
const DIST = fileURLToPath(new URL('dist/client', import.meta.url));
/** The workspace's source quiver. A browser cannot read the source layout, so this
 *  pack is the step every browser consumer of a quiver performs. */
const SOURCE = fileURLToPath(new URL('../../fixtures', import.meta.url));
/** Vite's verbatim-copy tree, which is the dev server's alone: the built client
 *  carries no quiver, and `quillkit site` lays one beside it. Generated, and
 *  gitignored. */
const OUT = fileURLToPath(new URL('client/public/quiver.qv', import.meta.url));
/** One repack per settled burst: an editor's save arrives as several watcher events. */
const SETTLE_MS = 80;
/** The dev-only signal that a repack landed. The client answers it by minting a
 *  fresh `Quiver`; nothing on this side knows what a quill is. */
const REPACKED = 'studio:quiver-repacked';

/** What this build compiles in: the two siblings and the engine, read off the copies the
 *  bundle takes rather than off declared ranges (`scripts/carried.mjs`). */
const CARRIED = carried();

/** Call `fn` once a burst of calls stops arriving. */
function settle(ms: number, fn: () => void): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return () => {
		clearTimeout(timer);
		timer = setTimeout(fn, ms);
	};
}

function quiverSource(): Plugin {
	// Serialized rather than concurrent: two overlapping packs of one source would land
	// in whichever order they finish, not the order they started. Both arms chain, so a pack queues onto
	// a settled promise whichever way the last one went; a rejected link would answer
	// every later pack with the first failure instead of running it.
	const run = (): Promise<void> => build(SOURCE, OUT);
	let queue: Promise<void> = Promise.resolve();
	const pack = (): Promise<void> => (queue = queue.then(run, run));

	return {
		name: 'studio:quiver-source',
		// `configResolved` rather than `buildStart`, and the reason is the serving
		// layer: Vite mounts its static middleware only for a public directory that
		// exists when the server is created, which is before any build hook runs. So
		// the first pack lands here, the one hook every mode awaits before that.
		// `serve` alone: a quiver inside the client would occupy the URL the deploy
		// writes the author's to.
		async configResolved(config) {
			if (config.command !== 'serve') return;
			await pack();
		},
		configureServer(server) {
			// The source tree sits outside the Vite root, so the watcher is told about it
			// by hand. The packed output stays watched: Vite serves a public file only if
			// it is in the set the watcher maintains, and a file no module graph reaches
			// triggers no reload, so the page survives a repack.
			server.watcher.add(SOURCE);
			const repack = settle(SETTLE_MS, () => {
				void pack().then(
					() => server.hot.send({ type: 'custom', event: REPACKED }),
					// A quiver mid-edit is invalid as often as not (a half-written
					// `Quill.yaml`). A failed pack never reaches the rename, so the last
					// good artifact stays served and the failure is a log line.
					(err: unknown) =>
						server.config.logger.error(
							`[studio] quiver pack failed: ${err instanceof Error ? err.message : String(err)}`
						)
				);
			});
			for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const)
				server.watcher.on(event, (path: string) => {
					if (path.startsWith(SOURCE)) repack();
				});
		}
	};
}

/** The stamp as a file beside the bundle, for a consumer reading the tarball without
 *  running it. `generateBundle` runs on build alone, so a dev server writes nothing. */
function carriedFile(): Plugin {
	return {
		name: 'studio:carried',
		generateBundle() {
			this.emitFile({
				type: 'asset',
				fileName: 'carried.json',
				source: `${JSON.stringify(CARRIED, null, '\t')}\n`
			});
		}
	};
}

export default defineConfig({
	root: ROOT,
	// Relative asset URLs, and the client resolves the quiver off `document.baseURI`
	// for the same reason: the base is a runtime fact, so a built studio serves from
	// wherever it is put (STUDIO §"A client, and what serves it").
	base: './',
	plugins: [svelte(), quiverSource(), carriedFile()],
	// The client is the whole of what lands in `dist/client` and it carries no quiver,
	// so a public directory left behind by a dev run cannot ride into it. `emptyOutDir`
	// is explicit because the target sits outside the root, and it clears the client's
	// own directory rather than the `dist` it shares with the bin.
	build: { outDir: DIST, emptyOutDir: true, copyPublicDir: false },
	define: { __CARRIED__: JSON.stringify(CARRIED) },
	// @quillmark/wasm ships wasm-bindgen's web target: no `.wasm` import and no
	// top-level await, so a static import is safe and Vite resolves it unaided.
	// Dev-server pre-bundling is the one exception: it relocates the package away
	// from the binary `init()` resolves against, which surfaces as
	// `runtime::init_failed`, so the package stays unbundled.
	optimizeDeps: { exclude: ['@quillmark/wasm'] }
});
