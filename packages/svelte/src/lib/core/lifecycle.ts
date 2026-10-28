// `@quillmark/wasm` ships wasm-bindgen's web target: the core build is instantiated by an explicit
// `await init()`, which resolves to the classes and free functions, none of which the artifact
// exports statically. Instantiation installs the panic hook on its start section.
import { init as initWasm, type CoreSurface } from '@quillmark/wasm';

let started: Promise<CoreSurface> | undefined;

/** The resolved surface, for the sync verbs below that cannot await one. */
let latched: CoreSurface | undefined;

/**
 * Instantiate the core WASM build and resolve to its surface. Await once before any other boundary
 * verb; the promise is memoized, so concurrent callers share one instantiation, and a failed init
 * clears the memo so a retry is possible. The surface is the artifact's own, handed back unchanged.
 */
export function init(): Promise<CoreSurface> {
	if (started) return started;
	started = initWasm().then(
		(surface) => {
			latched = surface;
			return surface;
		},
		(err: unknown) => {
			started = undefined;
			throw err;
		}
	);
	return started;
}

/**
 * The surface synchronously, for this package's pure verbs (the `DocPath` formatter and the codec
 * inside a ProseMirror transaction), which cannot await. Package-internal, and read at the call
 * rather than destructured at module scope. Reaching it before {@link init} resolves throws, naming
 * the fix.
 */
export function core(): CoreSurface {
	if (!latched) {
		throw new Error(
			'@quillmark/svelte: the WASM core is not initialized. Await `init()` from `@quillmark/svelte/core` before mounting a surface or calling a boundary verb.'
		);
	}
	return latched;
}
