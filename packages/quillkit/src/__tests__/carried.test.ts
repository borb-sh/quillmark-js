/**
 * The stamp a bundle carries, measured against a real workspace rather than asserted from
 * the shape of the string: what the stamp is for is a consumer holding a tarball nobody
 * can `npm ls`, so a coordinate that reads right and names the wrong copy is the failure
 * this suite exists to catch.
 *
 * The scratch workspace is the siblings' package manifests, which is the whole of what
 * `carried()` reads for one. `@quillmark/wasm` it resolves, so the workspace's `node_modules` is
 * linked in beside them.
 */

import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { carried } from '../../../../scripts/carried.mjs';
import { scratch } from './helpers/collection.js';

const WORKSPACE = fileURLToPath(new URL('../../../..', import.meta.url));
const WORKSPACE_MODULES = join(WORKSPACE, 'node_modules');

const files = scratch('quillkit-carried-');
afterAll(() => files.cleanup());

/** A workspace holding the siblings at the given versions. */
async function workspace(svelte: string, quiver: string, fonts = '0.0.0'): Promise<string> {
	const at = await files.dir();
	await writeFile(join(at, 'package.json'), JSON.stringify({ name: 'w', private: true }));
	await mkdir(join(at, 'node_modules'), { recursive: true });
	await symlink(join(WORKSPACE_MODULES, '@quillmark'), join(at, 'node_modules', '@quillmark'));

	for (const [dir, version] of [
		['svelte', svelte],
		['quiver', quiver],
		['fonts', fonts]
	]) {
		await mkdir(join(at, 'packages', dir), { recursive: true });
		await writeFile(
			join(at, 'packages', dir, 'package.json'),
			JSON.stringify({ name: `@quillmark/${dir}`, version })
		);
	}
	return at;
}

describe('carried', () => {
	it('names each sibling at the version its manifest states', async () => {
		const at = await workspace('0.1.0', '0.19.0', '1.2.0');

		expect(carried(at)).toMatchObject({
			'@quillmark/svelte': '0.1.0',
			'@quillmark/quiver': '0.19.0',
			'@quillmark/fonts': '1.2.0'
		});
	});

	it('names the resolved engine', async () => {
		const at = await workspace('0.1.0', '0.19.0');
		const wasm = JSON.parse(
			await readFile(join(WORKSPACE_MODULES, '@quillmark', 'wasm', 'package.json'), 'utf8')
		);

		expect(carried(at)['@quillmark/wasm']).toBe(wasm.version);
	});
});

describe('the built client', () => {
	it('carries the stamp beside the bundle', async () => {
		const at = join(WORKSPACE, 'packages', 'quillkit', 'dist', 'client', 'carried.json');

		expect(JSON.parse(await readFile(at, 'utf8'))).toEqual(carried());
	});
});
