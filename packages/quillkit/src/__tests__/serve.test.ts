/**
 * The static server, at the two points a general-purpose one gets wrong for this: the
 * content type `.wasm` must carry, and the paths that must not resolve. Both are why
 * this server is written rather than borrowed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { createStaticServer, fileFor, listen, type Mount } from '../serve.js';

const temps: string[] = [];
const servers: Server[] = [];

async function temp(): Promise<string> {
	const at = await mkdtemp(join(tmpdir(), 'quillkit-serve-'));
	temps.push(at);
	return at;
}

afterEach(async () => {
	for (const server of servers.splice(0)) await new Promise((ok) => server.close(ok));
	for (const at of temps.splice(0)) await rm(at, { recursive: true, force: true });
});

/** A client root and a quiver root, mounted the way `quillkit studio` mounts them. */
async function serveFixture(): Promise<{ base: string; client: string; quiver: string }> {
	const client = await temp();
	const quiver = await temp();
	await writeFile(join(client, 'index.html'), '<!doctype html>');
	await mkdir(join(client, 'assets'), { recursive: true });
	await writeFile(join(client, 'assets', 'wasm_bg.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]));
	await writeFile(join(client, 'assets', 'index.js'), '// client');
	await writeFile(join(quiver, 'quiver.json'), '{"format":1,"name":"q","quills":[]}');
	await writeFile(join(quiver, 'secret-outside'), 'not reachable from the client mount');

	const mounts: Mount[] = [
		{ prefix: '/quiver', root: quiver },
		{ prefix: '', root: client }
	];
	const server = createStaticServer(mounts);
	servers.push(server);
	const port = await listen(server, 0, '127.0.0.1');
	return { base: `http://127.0.0.1:${port}`, client, quiver };
}

describe('serving', () => {
	it('serves .wasm as application/wasm', async () => {
		// wasm-bindgen's web target instantiates by streaming, and
		// `WebAssembly.instantiateStreaming` refuses a response of any other type.
		const { base } = await serveFixture();
		const res = await fetch(`${base}/assets/wasm_bg.wasm`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/wasm');
	});

	it('serves the root as the client index', async () => {
		const { base } = await serveFixture();
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/html');
	});

	it('serves the quiver mount ahead of the client', async () => {
		// The longest prefix wins, so `/quiver/…` reaches the pack rather than resolving
		// to a missing file under the client.
		const { base } = await serveFixture();
		const res = await fetch(`${base}/quiver/quiver.json`);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ format: 1 });
	});

	it('answers nothing from a cache', async () => {
		// An author repacks under this server; an answer from a cache would be an answer
		// about the previous generation.
		const { base } = await serveFixture();
		const res = await fetch(`${base}/quiver/quiver.json`);
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	it('404s a missing asset rather than falling back to the page', async () => {
		// One screen, no router: a missing asset that answered with `index.html` would
		// surface as a parse error somewhere else entirely.
		const { base } = await serveFixture();
		expect((await fetch(`${base}/assets/nope.js`)).status).toBe(404);
	});

	it('refuses a method it does not serve', async () => {
		const { base } = await serveFixture();
		expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
	});
});

describe('the escape refusal', () => {
	// Checked on the resolved path, so every spelling of the same escape collapses into
	// one answer rather than each needing to be anticipated.
	it('refuses paths that leave their mount', async () => {
		const client = await temp();
		const quiver = await temp();
		await writeFile(join(client, 'index.html'), '<!doctype html>');
		const mounts: Mount[] = [
			{ prefix: '/quiver', root: quiver },
			{ prefix: '', root: client }
		];

		for (const url of [
			'/../../../../etc/passwd',
			'/quiver/../../etc/passwd',
			'/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
			'/quiver/%2e%2e/%2e%2e/etc/passwd',
			'/....//....//etc/passwd'
		])
			expect(fileFor(mounts, url), url).toBeNull();
	});

	it('refuses a malformed escape and a NUL', async () => {
		const client = await temp();
		const mounts: Mount[] = [{ prefix: '', root: client }];
		expect(fileFor(mounts, '/%ZZ')).toBeNull();
		expect(fileFor(mounts, '/x%00.js')).toBeNull();
	});

	it('a directory is not a file', async () => {
		const client = await temp();
		await mkdir(join(client, 'assets'), { recursive: true });
		expect(fileFor([{ prefix: '', root: client }], '/assets')).toBeNull();
	});
});
