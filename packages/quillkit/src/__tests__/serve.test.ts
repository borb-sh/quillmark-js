/**
 * The static server, at the two points a general-purpose one gets wrong for this: the
 * content type `.wasm` must carry, and the paths that must not resolve. Both are why
 * this server is written rather than borrowed. Beside them, the two things its callers
 * add: roots composed under one prefix, and a deploy's cache rules for `preview`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createStaticServer, fileFor, listen, type Mount, type ServeOptions } from '../serve.js';
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

/** A client root and a quiver root, mounted the way `quillkit serve` mounts them. */
async function serveFixture(options?: ServeOptions): Promise<string> {
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
	const server = createStaticServer(mounts, options);
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

describe('roots under one prefix', () => {
	it('answers from the first root holding the file', async () => {
		// `dev app` serves the client and the app's staged files both at the root.
		const client = await temp.dir();
		const staged = await temp.dir();
		await writeFile(join(client, 'index.html'), 'client');
		await writeFile(join(staged, 'index.html'), 'staged');
		await writeFile(join(staged, 'app.json'), '{}');
		const mounts: Mount[] = [
			{ prefix: '', root: client },
			{ prefix: '', root: staged }
		];

		expect(fileFor(mounts, '/')).toBe(join(client, 'index.html'));
		expect(fileFor(mounts, '/app.json')).toBe(join(staged, 'app.json'));
		expect(fileFor(mounts, '/nope.json')).toBeNull();
	});
});

describe("a host's cache rules", () => {
	it('serves the bundle immutable and revalidates everything else', async () => {
		// The four rules a deploy's host owes it, two of which are headers: what `preview`
		// answers is what the host will.
		const base = await serveFixture({ caching: 'host' });
		const asset = await fetch(`${base}/assets/index.js`);
		expect(asset.headers.get('cache-control')).toContain('immutable');
		for (const path of ['/', '/quiver/quiver.json'])
			expect((await fetch(`${base}${path}`)).headers.get('cache-control')).toBe('no-cache');
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
