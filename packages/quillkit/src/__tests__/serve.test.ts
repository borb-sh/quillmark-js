/**
 * The static server, at the two points a general-purpose one gets wrong for this: the
 * content type `.wasm` must carry, and the paths that must not resolve. Both are why
 * this server is written rather than borrowed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createStaticServer, fileFor, listen, type Mount } from '../serve.js';
import { scratch } from './helpers/collection.js';

const temp = scratch('quillkit-serve-');
const servers: Server[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) {
		server.closeAllConnections();
		await new Promise((ok) => server.close(ok));
	}
	await temp.cleanup();
});

/** A client root and a quiver root, mounted the way `quillkit studio` mounts them. */
async function serveFixture(): Promise<string> {
	const client = await temp.dir();
	const quiver = await temp.dir();
	await writeFile(join(client, 'index.html'), '<!doctype html>');
	await mkdir(join(client, 'assets'), { recursive: true });
	await writeFile(join(client, 'assets', 'wasm_bg.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]));
	await writeFile(join(client, 'assets', 'index.js'), '// client');
	await writeFile(join(quiver, 'quiver.json'), '{"format":1,"name":"q","quills":[]}');

	const mounts: Mount[] = [
		{ prefix: '/quiver', root: quiver },
		{ prefix: '', root: client }
	];
	const server = createStaticServer(mounts);
	servers.push(server);
	return `http://127.0.0.1:${await listen(server, 0, '127.0.0.1')}`;
}

describe('serving', () => {
	it('serves .wasm as application/wasm', async () => {
		// wasm-bindgen's web target instantiates by streaming, and
		// `WebAssembly.instantiateStreaming` refuses a response of any other type.
		const base = await serveFixture();
		const res = await fetch(`${base}/assets/wasm_bg.wasm`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/wasm');
	});

	it('serves the quiver mount ahead of the client', async () => {
		// The longest prefix wins, so `/quiver/…` reaches the pack rather than resolving
		// to a missing file under the client.
		const base = await serveFixture();
		const res = await fetch(`${base}/quiver/quiver.json`);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ format: 1 });
		// An author repacks under this server; an answer from a cache would be an answer
		// about the previous generation.
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	it('404s a missing asset rather than falling back to the page', async () => {
		// One screen, no router: a missing asset that answered with `index.html` would
		// surface as a parse error somewhere else entirely.
		const base = await serveFixture();
		expect((await fetch(`${base}/assets/nope.js`)).status).toBe(404);
	});

	it('refuses a method it does not serve', async () => {
		const base = await serveFixture();
		expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
	});
});

describe('the escape refusal', () => {
	// Checked on the resolved path, so every spelling of the same escape collapses into
	// one answer rather than each needing to be anticipated.
	it('refuses paths that leave their mount', async () => {
		const client = await temp.dir();
		const quiver = await temp.dir();
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
		const client = await temp.dir();
		const mounts: Mount[] = [{ prefix: '', root: client }];
		expect(fileFor(mounts, '/%ZZ')).toBeNull();
		expect(fileFor(mounts, '/x%00.js')).toBeNull();
	});

	it('a directory is not a file', async () => {
		const client = await temp.dir();
		await mkdir(join(client, 'assets'), { recursive: true });
		expect(fileFor([{ prefix: '', root: client }], '/assets')).toBeNull();
	});
});
