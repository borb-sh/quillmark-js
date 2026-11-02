// The WASM core's free functions, for the sync verbs that cannot await the gate: the binding
// projects every remote change through the store's `repair`.
import { init as initWasm, type CoreSurface } from '@quillmark/wasm';

let latched: CoreSurface | undefined;

/** Instantiate the core WASM build, as `@quillmark/wasm`'s `init` does, and hold its surface for
 *  the sync verbs. `joinSession`, `readLog` and `writeLog` await it themselves. */
export async function init(): Promise<CoreSurface> {
	latched = await initWasm();
	return latched;
}

export function core(): CoreSurface {
	if (!latched)
		throw new Error(
			'@quillmark/collab: the WASM core is not initialized. Await `init()` from `@quillmark/collab` before binding a Document.'
		);
	return latched;
}
