/**
 * Integration tests — `build` → `fromBuiltUrl` / `fromBuiltDir` → `getQuill`,
 * against artifacts written to a temporary directory.
 *
 * `fromBuiltUrl` takes http(s):// URLs only, so `globalThis.fetch` is stubbed to
 * serve the packed tree off disk. `Quill.fromTree` is stubbed too: what is under
 * test is the tree that reaches it, not the quill it builds.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Quiver, build, fromBuiltDir } from '../node.js';
import { mockQuillFromTree } from './helpers/mock-engine.js';

// ─── Fixture ──────────────────────────────────────────────────────────────────

const SAMPLE_FIXTURE = new URL('./fixtures/sample-quiver', import.meta.url).pathname;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tempDir(): string {
	return join(tmpdir(), `quiver-integration-test-${randomUUID()}`);
}

/**
 * Mock globalThis.fetch to serve files from a build-output directory on disk.
 * URL pattern: baseUrl + relativePath (with one slash between them).
 */
function makeMockFetch(dir: string, baseUrl: string): { restore: () => void } {
	const original = globalThis.fetch;
	const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

	globalThis.fetch = (async (url: string) => {
		if (!url.startsWith(base)) {
			return new Response(null, { status: 404 });
		}
		const relativePath = url.slice(base.length);
		const filePath = join(dir, relativePath);
		try {
			const bytes = await readFile(filePath);
			return new Response(bytes.buffer, { status: 200 });
		} catch {
			return new Response(null, { status: 404 });
		}
	}) as typeof globalThis.fetch;

	return {
		restore: () => {
			if (original !== undefined) {
				globalThis.fetch = original;
			} else {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				delete (globalThis as any).fetch;
			}
		}
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Integration: build → fromBuiltUrl → resolve → getQuill', () => {
	const tmpDirs: string[] = [];
	let mockFetch: { restore: () => void } | undefined;

	afterEach(async () => {
		if (mockFetch !== undefined) {
			mockFetch.restore();
			mockFetch = undefined;
		}
		for (const d of tmpDirs.splice(0)) {
			await rm(d, { recursive: true, force: true });
		}
	});

	it('fromBuiltUrl catalog matches source quiver', async () => {
		const outDir = tempDir();
		tmpDirs.push(outDir);

		await build(SAMPLE_FIXTURE, outDir);

		const baseUrl = 'https://mock.cdn.example.com/my-quiver/';
		mockFetch = makeMockFetch(outDir, baseUrl);

		const built = await Quiver.fromBuiltUrl(baseUrl);

		expect(built.name).toBe('sample');
		expect(built.quillNames().sort()).toEqual(['memo', 'resume']);
		expect(built.versionsOf('memo').sort()).toEqual(['1.0.0', '1.1.0']);
		expect(built.versionsOf('resume')).toEqual(['2.0.0']);
	});

	it('quiver.getQuill builds a quill from the correct tree', async () => {
		const outDir = tempDir();
		tmpDirs.push(outDir);

		await build(SAMPLE_FIXTURE, outDir);

		const baseUrl = 'https://mock.cdn.example.com/my-quiver/';
		mockFetch = makeMockFetch(outDir, baseUrl);

		const built = await Quiver.fromBuiltUrl(baseUrl);
		const { calls, restore } = mockQuillFromTree();
		try {
			const quill = await built.getQuill('memo@1.0.0');

			expect(quill).toBeDefined();
			expect(calls).toHaveLength(1);
			expect(calls[0]!.has('Quill.yaml')).toBe(true);
		} finally {
			restore();
		}
	});
});

describe('Integration: fromBuiltUrl error cases', () => {
	let mockFetch: { restore: () => void } | undefined;
	const tmpDirs: string[] = [];

	afterEach(async () => {
		if (mockFetch !== undefined) {
			mockFetch.restore();
			mockFetch = undefined;
		}
		for (const d of tmpDirs.splice(0)) {
			await rm(d, { recursive: true, force: true });
		}
	});

	it('fromBuiltUrl with empty directory served over HTTP throws transport_error', async () => {
		const outDir = tempDir();
		tmpDirs.push(outDir);
		await mkdir(outDir, { recursive: true });

		const baseUrl = 'https://mock.cdn.example.com/empty/';
		mockFetch = makeMockFetch(outDir, baseUrl);

		await expect(Quiver.fromBuiltUrl(baseUrl)).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error' })
		);
	});

	it('fromBuiltUrl with malformed quiver.json throws quiver_invalid', async () => {
		const outDir = tempDir();
		tmpDirs.push(outDir);
		await mkdir(outDir, { recursive: true });

		const { writeFile } = await import('node:fs/promises');
		await writeFile(join(outDir, 'quiver.json'), 'not-json');

		const baseUrl = 'https://mock.cdn.example.com/malformed/';
		mockFetch = makeMockFetch(outDir, baseUrl);

		await expect(Quiver.fromBuiltUrl(baseUrl)).rejects.toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	it('fromBuiltUrl rejects file:// URLs with transport_error', async () => {
		await expect(Quiver.fromBuiltUrl('file:///tmp/quiver/')).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error' })
		);
	});
});

describe('Integration: build → fromBuiltDir → resolve → getQuill', () => {
	const tmpDirs: string[] = [];

	afterEach(async () => {
		for (const d of tmpDirs.splice(0)) {
			await rm(d, { recursive: true, force: true });
		}
	});

	it('fromBuiltDir catalog matches source quiver', async () => {
		const outDir = tempDir();
		tmpDirs.push(outDir);

		await build(SAMPLE_FIXTURE, outDir);

		const built = await fromBuiltDir(outDir);

		expect(built.name).toBe('sample');
		expect(built.quillNames().sort()).toEqual(['memo', 'resume']);
		expect(built.versionsOf('memo').sort()).toEqual(['1.0.0', '1.1.0']);
		expect(built.versionsOf('resume')).toEqual(['2.0.0']);
	});

	it('fromBuiltDir + getQuill loads tree from disk without network', async () => {
		const outDir = tempDir();
		tmpDirs.push(outDir);

		await build(SAMPLE_FIXTURE, outDir);

		// Sabotage fetch — fromBuiltDir must not touch it.
		const original = globalThis.fetch;
		globalThis.fetch = (() => {
			throw new Error('fetch must not be called by fromBuiltDir');
		}) as typeof globalThis.fetch;

		const { calls, restore } = mockQuillFromTree();
		try {
			const built = await fromBuiltDir(outDir);

			const quill = await built.getQuill('memo@1.0.0');

			expect(quill).toBeDefined();
			expect(calls).toHaveLength(1);
			expect(calls[0]!.has('Quill.yaml')).toBe(true);
		} finally {
			restore();
			if (original !== undefined) globalThis.fetch = original;
		}
	});

	it('fromBuiltDir on missing directory throws transport_error', async () => {
		await expect(fromBuiltDir(join(tmpdir(), `does-not-exist-${randomUUID()}`))).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error' })
		);
	});
});

describe('Integration: build → fromBuiltFiles → getQuill', () => {
	const tmpDirs: string[] = [];

	afterEach(async () => {
		for (const d of tmpDirs.splice(0)) {
			await rm(d, { recursive: true, force: true });
		}
	});

	it('loads from the bytes `build` wrote, and names a path the map lacks', async () => {
		const outDir = tempDir();
		tmpDirs.push(outDir);
		await build(SAMPLE_FIXTURE, outDir);

		const files = new Map<string, Uint8Array>();
		for (const path of await readdir(outDir, { recursive: true })) {
			const bytes = await readFile(join(outDir, path)).catch(() => undefined);
			if (bytes !== undefined) files.set(path, bytes);
		}

		const { calls, restore } = mockQuillFromTree();
		try {
			const built = await Quiver.fromBuiltFiles(files);
			expect(built.quillNames()).toEqual(['memo', 'resume']);
			await built.getQuill('memo@1.0.0');
			expect(calls[0]!.has('Quill.yaml')).toBe(true);

			const partial = new Map([['quiver.json', files.get('quiver.json')!]]);
			await expect((await Quiver.fromBuiltFiles(partial)).getQuill('memo@1.0.0')).rejects.toThrow(
				/No bytes held for "memo@1\.0\.0\./
			);
		} finally {
			restore();
		}
	});
});
