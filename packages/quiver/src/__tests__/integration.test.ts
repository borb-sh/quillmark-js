/**
 * Integration tests — `build` → `fromBuiltUrl` / `fromBuiltDir` / `fromBuiltFiles` →
 * `getQuill`, against one artifact written to a temporary directory.
 *
 * `fromBuiltUrl` takes http(s):// URLs only, so `globalThis.fetch` is stubbed to
 * serve the packed tree off disk. `Quill.fromTree` is stubbed too: what is under
 * test is the tree that reaches it, not the quill it builds.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { cp, rm, readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { Quiver, build, fromBuiltDir } from '../node.js';
import { mockQuillFromTree } from './helpers/mock-engine.js';
import { scratch } from './helpers/scratch.js';

const SAMPLE_FIXTURE = new URL('./fixtures/sample-quiver', import.meta.url).pathname;

const temp = scratch('quiver-integration-');
let out: string;

beforeAll(async () => {
	out = join(await temp.dir(), 'out');
	await build(SAMPLE_FIXTURE, out);
});

afterAll(() => temp.cleanup());

let stub: ReturnType<typeof mockQuillFromTree> | undefined;
afterEach(() => {
	stub?.restore();
	stub = undefined;
	vi.unstubAllGlobals();
});

/** The catalog and the first tree a built quiver hands `Quill.fromTree`. */
async function readBack(built: Quiver): Promise<void> {
	expect(built.name).toBe('sample');
	expect(built.quillNames()).toEqual(['memo', 'resume']);
	expect(built.versionsOf('memo')).toEqual(['1.1.0', '1.0.0']);
	expect(built.versionsOf('resume')).toEqual(['2.0.0']);

	stub = mockQuillFromTree();
	await built.getQuill('memo@1.0.0');
	expect(stub.calls).toHaveLength(1);
	expect(stub.calls[0]!.has('Quill.yaml')).toBe(true);
}

describe('Integration: build → fromBuiltUrl → getQuill', () => {
	it('reads the catalog and a quill over HTTP', async () => {
		const base = 'https://mock.cdn.example.com/my-quiver/';
		vi.stubGlobal('fetch', async (url: string) => {
			try {
				return new Response(new Uint8Array(await readFile(join(out, url.slice(base.length)))));
			} catch {
				return new Response(null, { status: 404 });
			}
		});

		await readBack(await Quiver.fromBuiltUrl(base));
	});
});

describe('Integration: build → fromBuiltDir → getQuill', () => {
	it('reads the catalog and a quill off disk, without network', async () => {
		vi.stubGlobal('fetch', () => {
			throw new Error('fetch must not be called by fromBuiltDir');
		});

		await readBack(await fromBuiltDir(out));
	});

	it('fromBuiltDir on a missing bundle throws transport_error naming its path', async () => {
		const gutted = join(await temp.dir(), 'gutted');
		await cp(out, gutted, { recursive: true });
		const { quills } = JSON.parse(await readFile(join(gutted, 'quiver.json'), 'utf-8')) as {
			quills: Array<{ name: string; version: string; bundle: string }>;
		};
		const memo = quills.find((q) => q.name === 'memo' && q.version === '1.0.0')!;
		await rm(join(gutted, memo.bundle));

		const built = await fromBuiltDir(gutted);
		await expect(built.getQuill('memo@1.0.0')).rejects.toThrow(
			expect.objectContaining({
				code: 'transport_error',
				message: expect.stringContaining(join(gutted, memo.bundle))
			})
		);
	});

	it('fromBuiltDir on missing directory throws transport_error', async () => {
		await expect(fromBuiltDir(join(out, 'does-not-exist'))).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error' })
		);
	});
});

describe('Integration: build → fromBuiltFiles → getQuill', () => {
	it('loads from the bytes `build` wrote, and names a path the map lacks', async () => {
		const files = new Map<string, Uint8Array>();
		for (const path of await readdir(out, { recursive: true })) {
			const bytes = await readFile(join(out, path)).catch(() => undefined);
			if (bytes !== undefined) files.set(path.split(sep).join('/'), bytes);
		}

		await readBack(await Quiver.fromBuiltFiles(files));

		const partial = new Map([['quiver.json', files.get('quiver.json')!]]);
		await expect((await Quiver.fromBuiltFiles(partial)).getQuill('memo@1.0.0')).rejects.toThrow(
			/No bytes held for "memo@1\.0\.0\./
		);
	});
});
