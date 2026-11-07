import { vi, type MockInstance } from 'vitest';
import { unzipSync } from 'fflate';
import { init, type Quill } from '@quillmark/wasm';

const core = await init();

/**
 * Stubs `Quill.fromTree` and `Quill.fromBundle` so tests can exercise
 * `Quiver.getQuill` without the real WASM validator. Each call records the tree it
 * was given, a bundle unzipped to one, and returns a fresh fake `Quill`, whose
 * identity is what the caching and coalescing tests read.
 *
 * `calls` holds the trees in order; `spy` is the `fromTree` stub; `restore()` undoes
 * both stubs.
 */
export function mockQuillLoad(): {
	calls: Array<Map<string, Uint8Array>>;
	spy: MockInstance;
	restore: () => void;
} {
	const calls: Array<Map<string, Uint8Array>> = [];
	const fake = (tree: Map<string, Uint8Array>): Quill => {
		calls.push(tree);
		return { seedDocument: () => ({}) } as unknown as Quill;
	};
	const spy = vi.spyOn(core.Quill, 'fromTree').mockImplementation(fake);
	const bundleSpy = vi
		.spyOn(core.Quill, 'fromBundle')
		.mockImplementation((bytes: Uint8Array) => fake(new Map(Object.entries(unzipSync(bytes)))));
	return {
		calls,
		spy,
		restore: () => {
			spy.mockRestore();
			bundleSpy.mockRestore();
		}
	};
}
