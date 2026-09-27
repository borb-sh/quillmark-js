/**
 * Regression tests for the Node entry design.
 *
 * The filesystem factories are free functions in `@quillmark/quiver/node`; the
 * `Quiver` class is the browser-safe one from the main entry, unmodified.
 * Importing `/node` must therefore leave the shared constructor exactly as the
 * main entry left it, so the import-order hazard a runtime patch carries (a
 * `Quiver` binding whose statics depend on what else got imported first) cannot
 * arise.
 */

import { describe, it, expect } from 'vitest';
import { Quiver as MainQuiver } from '../index.js';
import { Quiver as NodeQuiver, fromDir } from '../node.js';

describe('node entry — the class is untouched', () => {
	it('re-exports the same constructor as the main entry', () => {
		expect(NodeQuiver).toBe(MainQuiver);
	});

	it('installs no statics on it', () => {
		for (const verb of ['fromDir', 'fromBuiltDir', 'build']) {
			expect(MainQuiver).not.toHaveProperty(verb);
		}
	});

	it('leaves the browser-safe static in place', () => {
		expect(typeof MainQuiver.fromBuiltUrl).toBe('function');
	});
});

describe('node entry — the factories', () => {
	it('returns an instance of the constructor the main entry exports', async () => {
		const fixture = new URL('./fixtures/sample-quiver', import.meta.url).pathname;
		expect(await fromDir(fixture)).toBeInstanceOf(MainQuiver);
	});

	it("carries Quiver.yaml's description off a source tree", async () => {
		const fixture = new URL('./fixtures/sample-quiver', import.meta.url).pathname;
		expect((await fromDir(fixture)).description).toBe('A sample quiver for testing');
	});
});

/**
 * The `file://` guard sends the reader to the disk factory by name. The name has
 * to be one that resolves: a consumer who follows `Quiver.fromBuiltDir` gets
 * `is not a function`, and the guard's whole job is to be followable.
 */
describe('the file:// refusal names a real export', () => {
	const refuse = () => MainQuiver.fromBuiltUrl('file:///tmp/quiver/');

	it('points at the free function, not a static that does not exist', async () => {
		await expect(refuse()).rejects.toThrow(/\bfromBuiltDir\b/);
		await expect(refuse()).rejects.not.toThrow(/Quiver\.fromBuiltDir/);
	});

	it('names the module the free function is reachable from', async () => {
		await expect(refuse()).rejects.toThrow(
			expect.objectContaining({
				code: 'transport_error',
				message: expect.stringContaining('@quillmark/quiver/node')
			})
		);
	});
});
