/**
 * Integration tests — `build` → `fromUrl` / `fromBytes` → `getQuill`, against an
 * artifact written to a temporary directory.
 *
 * `fromUrl` is served by a real HTTP server over that directory. `Quill.fromTree` is
 * stubbed: what is under test is the tree that reaches it, not the quill it builds.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Quiver, build } from '../node.js';
import { mockQuillFromTree } from './helpers/mock-engine.js';

const SAMPLE_FIXTURE = new URL('./fixtures/sample-quiver', import.meta.url).pathname;

let dir: string;
let artifact: string;
let server: Server;
let base: string;
/** The headers of every request the server answered, in order. */
const requests: IncomingHttpHeaders[] = [];

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'quiver-integration-'));
	artifact = join(dir, 'quiver.qv');
	await build(SAMPLE_FIXTURE, artifact);

	server = createServer((req, res) => {
		requests.push(req.headers);
		if (req.url === '/quiver.qv') {
			void readFile(artifact).then((bytes) => res.writeHead(200).end(bytes));
		} else if (req.url === '/fallback/quiver.qv') {
			res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>app</title>');
		} else {
			res.writeHead(404).end();
		}
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	const address = server.address();
	base = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
});

afterAll(async () => {
	await new Promise((ok) => server.close(ok));
	await rm(dir, { recursive: true, force: true });
});

let stub: ReturnType<typeof mockQuillFromTree> | undefined;
afterEach(() => {
	stub?.restore();
	stub = undefined;
	requests.length = 0;
});

describe('build → fromUrl → getQuill', () => {
	it('reads the catalog the source holds', async () => {
		const quiver = await Quiver.fromUrl(`${base}/quiver.qv`);
		expect(quiver.name).toBe('sample');
		expect(quiver.quillNames()).toEqual(['memo', 'resume']);
		expect(quiver.versionsOf('memo')).toEqual(['1.1.0', '1.0.0']);
		expect(quiver.versionsOf('resume')).toEqual(['2.0.0']);
	});

	it('fetches the file once, whole, and never again for a quill', async () => {
		const quiver = await Quiver.fromUrl(`${base}/quiver.qv`);
		stub = mockQuillFromTree();
		await quiver.getQuill('memo@1.0.0');
		await quiver.getQuill('resume');

		expect(requests).toHaveLength(1);
		expect(stub.calls[0]!.has('Quill.yaml')).toBe(true);
	});

	it('revalidates with the origin, so a release reaches the next load', async () => {
		const fetch = vi.spyOn(globalThis, 'fetch');
		try {
			await Quiver.fromUrl(`${base}/quiver.qv`);
			expect(fetch).toHaveBeenCalledWith(`${base}/quiver.qv`, { cache: 'no-cache' });
		} finally {
			fetch.mockRestore();
		}
	});

	it('names an SPA fallback where the artifact should be', async () => {
		await expect(Quiver.fromUrl(`${base}/fallback/quiver.qv`)).rejects.toThrow(
			expect.objectContaining({
				code: 'quiver_invalid',
				message: expect.stringMatching(/SPA fallback/)
			})
		);
	});

	it('a 404 is a transport_error naming the status', async () => {
		await expect(Quiver.fromUrl(`${base}/missing.qv`)).rejects.toThrow(
			expect.objectContaining({
				code: 'transport_error',
				message: expect.stringMatching(/HTTP 404/)
			})
		);
	});

	it('a refused connection is a transport_error', async () => {
		await expect(Quiver.fromUrl('http://127.0.0.1:1/quiver.qv')).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error' })
		);
	});

	it('refuses a file: URL, naming fromBytes', async () => {
		await expect(Quiver.fromUrl('file:///tmp/quiver.qv')).rejects.toThrow(
			expect.objectContaining({
				code: 'transport_error',
				message: expect.stringMatching(/Quiver\.fromBytes/)
			})
		);
	});
});

describe('build → fromBytes → getQuill', () => {
	it('reads the file off disk with no network', async () => {
		const quiver = await Quiver.fromBytes(await readFile(artifact));
		stub = mockQuillFromTree();
		await quiver.getQuill('memo@1.1.0');

		expect(quiver.quillNames()).toEqual(['memo', 'resume']);
		expect(stub.calls[0]!.has('Quill.yaml')).toBe(true);
		expect(requests).toHaveLength(0);
	});
});
