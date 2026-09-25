/**
 * The static server `studio` serves the loop over. It composes the client's root and the
 * one artifact file rather than copying either into the other: the client out of this
 * package, the artifact wherever the packer writes it. A repack replaces a file the
 * server reads per request, so nothing here is told a pack happened.
 *
 * Two things a general-purpose static server gets wrong for this, which is why this one
 * is written rather than borrowed: `.wasm` must be served as `application/wasm`, and a
 * path escaping its root must be refused.
 */

import { closeSync, createReadStream, fstatSync, openSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { within } from './paths.js';

/**
 * What the client `vite build` emits. Anything unlisted, the artifact included, falls
 * back to `application/octet-stream`, which is right for opaque bytes.
 *
 * `.wasm` is the one that is not a nicety: `@quillmark/wasm` ships wasm-bindgen's web
 * target, which instantiates by streaming, and `WebAssembly.instantiateStreaming`
 * refuses a response of any other type.
 */
const TYPES: Record<string, string> = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.wasm': 'application/wasm'
};

/** A directory served under a prefix, or one file served at one path. */
export type Mount =
	| {
			/** URL prefix, leading slash and no trailing one. `''` is the root mount. */
			prefix: string;
			root: string;
	  }
	| {
			/** The one URL path this answers, leading slash included. */
			path: string;
			file: string;
	  };

/**
 * What each request resolves against. The mounts are fixed before the server listens,
 * so the longest-prefix order and each root are settled once rather than per request.
 */
export function fileResolver(mounts: Mount[]): (url: string) => string | null {
	const files = new Map<string, string>();
	const roots: { prefix: string; root: string }[] = [];
	for (const m of mounts) {
		if ('file' in m) files.set(m.path, resolve(m.file));
		else roots.push({ prefix: m.prefix, root: resolve(m.root) });
	}
	// Longest prefix first, so a nested mount is reached ahead of the client's.
	const ordered = roots.sort((a, b) => b.prefix.length - a.prefix.length);

	return (url) => {
		let path: string;
		try {
			path = decodeURIComponent(new URL(url, 'http://localhost').pathname);
		} catch {
			// A malformed escape names no file; refusing beats guessing at the intent.
			return null;
		}
		if (path.includes('\0')) return null;

		const pinned = files.get(path);
		if (pinned !== undefined) return isFile(pinned) ? pinned : null;

		const mount = ordered.find(
			(m) => m.prefix === '' || path === m.prefix || path.startsWith(`${m.prefix}/`)
		);
		if (mount === undefined) return null;

		const rest = path.slice(mount.prefix.length).replace(/^\/+/, '');
		// One screen, no router: the root is the client's `index.html` and nothing else
		// falls back to it, so a missing asset is a 404 rather than a page.
		const at = resolve(mount.root, rest === '' ? 'index.html' : rest);

		// The escape refusal, checked on the resolved path: `%2e%2e`, a doubled separator
		// and a plain `..` all collapse into one answer here, where a check against the
		// request text would have to anticipate each spelling.
		if (!within(mount.root, at)) return null;

		return isFile(at) ? at : null;
	};
}

function isFile(at: string): boolean {
	try {
		return statSync(at).isFile();
	} catch {
		return false;
	}
}

/** The file a request names, or null when it names none it may have. */
export function fileFor(mounts: Mount[], url: string): string | null {
	return fileResolver(mounts)(url);
}

/**
 * A server over `mounts`. Nothing is cached: this is a loop an author repacks under,
 * and a dev server that answered from a cache would be answering about the last
 * generation.
 */
export function createStaticServer(mounts: Mount[]): Server {
	const resolveFile = fileResolver(mounts);

	return createServer((req: IncomingMessage, res: ServerResponse) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405, { allow: 'GET, HEAD' }).end();
			return;
		}

		// The length and the body come off one descriptor: a repack renames a new file over
		// the path at any moment, and a length read off the path would be one file's while
		// the body streamed another's.
		const at = resolveFile(req.url ?? '/');
		let fd: number | undefined;
		try {
			if (at !== null) fd = openSync(at, 'r');
		} catch {
			// Gone between the resolve and the open: as absent as never there.
		}
		if (at === null || fd === undefined) {
			res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found\n');
			return;
		}

		res.writeHead(200, {
			'content-type': TYPES[extname(at).toLowerCase()] ?? 'application/octet-stream',
			'content-length': fstatSync(fd).size,
			'cache-control': 'no-store'
		});
		if (req.method === 'HEAD') {
			closeSync(fd);
			res.end();
			return;
		}

		const stream = createReadStream('', { fd });
		// A `ReadStream` that errors with nothing listening throws out of the event loop and
		// takes the studio down mid-session. The head is already written, so the answer is a
		// destroyed response rather than a status: a body short of the length it declared
		// has to be a read a client can tell from a whole one.
		stream.on('error', () => res.destroy());
		// `pipe` unpipes on a closed destination and leaves the source paused, so a client
		// that cancels mid-body would leave the fd open for the life of the server.
		res.on('close', () => stream.destroy());
		stream.pipe(res);
	});
}

/** Listen, and resolve with the port actually bound (`0` asks the OS for a free one). */
export function listen(server: Server, port: number, host: string): Promise<number> {
	return new Promise((ok, no) => {
		server.once('error', no);
		server.listen(port, host, () => {
			const address = server.address();
			ok(typeof address === 'object' && address !== null ? address.port : port);
		});
	});
}
