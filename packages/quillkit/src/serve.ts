/**
 * The static server `serve` runs the loop over and `preview` serves a deploy with. It
 * composes its roots rather than copying one into another: the client out of this package,
 * the packed quiver out of the tree the packer swaps, an app's staged files beside them. A
 * repack replaces a directory the server reads per request, so serving a file needs no word
 * of it; what a loop's server adds is a stream that tells an open page one landed.
 *
 * Two things a general-purpose static server gets wrong for this, which is why this one
 * is written rather than borrowed: `.wasm` must be served as `application/wasm`, and a
 * path escaping its root must be refused.
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { within } from './paths.js';

/**
 * What the roots hold: the clients `vite build` emits, a packed quiver's `quiver.json` and
 * bundles, and an app's `app.json` and the author's files `app.css` names. A packed font
 * carries no type because it carries no extension either, being dehydrated into
 * `fonts/<sha256>`; anything unlisted falls back to `application/octet-stream`, which is
 * right for opaque bytes.
 *
 * `.wasm` is the one that is not a nicety: `@quillmark/wasm` ships wasm-bindgen's web
 * target, which instantiates by streaming, and `WebAssembly.instantiateStreaming`
 * refuses a response of any other type.
 */
const TYPES: Record<string, string> = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.gif': 'image/gif',
	'.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.otf': 'font/otf',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ttf': 'font/ttf',
	'.wasm': 'application/wasm',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.zip': 'application/zip'
};

export interface Mount {
	/** URL prefix, leading slash and no trailing one. `''` is the root mount. Two mounts may
	 *  share one, and the first listed that holds the file answers. */
	prefix: string;
	root: string;
}

/**
 * What a response says about caching. `none` is the loop: an author repacks under it, and a
 * cache would answer about the last generation. `host` is the four rules a deploy's host
 * owes it (QUILLKIT §"The deploy layout"), so a built deploy served locally caches as the host will.
 */
export type Caching = 'none' | 'host';

export interface ServeOptions {
	caching?: Caching;
	/** Answer any origin, so a client of its own on another port reads a dev quiver. */
	cors?: boolean;
	/** The loop's push channel, served at `EVENTS_PATH`. Absent, as under `preview`, the
	 *  server is the static host a deploy lands on and streams nothing. */
	events?: EventStream;
}

/** Where a server with `events` streams them. Under neither the quiver mount nor any name
 *  a client build emits, so it shadows no file. */
export const EVENTS_PATH = '/.quillkit/events';
/**
 * The header naming `EVENTS_PATH`, relative, on every response a server with `events`
 * answers. A page reads it off a request it makes anyway and subscribes only where it is
 * present, so a deployed client asks a static host for no stream it would 404.
 */
export const EVENTS_HEADER = 'x-quillkit-events';

/**
 * Server-sent events to every page holding the stream open. An event carries its name and
 * nothing else: what changed is what the page reads back off the files.
 */
export class EventStream {
	readonly #open = new Set<ServerResponse>();

	/** Hold `res` open as a stream until its client goes. */
	attach(res: ServerResponse, headers: Record<string, string>): void {
		res.writeHead(200, {
			...headers,
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-store'
		});
		// A comment, so the head and a first byte leave now rather than with the first event,
		// and `EventSource` opens on connect.
		res.write(': open\n\n');
		this.#open.add(res);
		res.on('close', () => this.#open.delete(res));
	}

	/** `EventSource` dispatches no event with an empty data buffer, so the name rides in
	 *  both fields. */
	send(event: string): void {
		for (const res of this.#open) res.write(`event: ${event}\ndata: ${event}\n\n`);
	}
}

/** A file a request may have, its length off the stat that found it, and the path it was
 *  asked for by. */
export interface Served {
	at: string;
	size: number;
	path: string;
}

/** What `host` caching answers for a path: the client's hash-named bundle forever, and
 *  everything else revalidated, `quiver/quiver.json` above all. */
function cacheFor(caching: Caching, path: string): string {
	if (caching === 'none') return 'no-store';
	return path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

/**
 * What each request resolves against. The mounts are fixed before the server listens,
 * so the longest-prefix order and each root are settled once rather than per request.
 */
export function fileResolver(mounts: Mount[]): (url: string) => Served | null {
	// Longest prefix first, so `/quiver/…` reaches the pack rather than the client. The sort
	// is stable, so mounts sharing a prefix keep the order they were listed in.
	const ordered = [...mounts]
		.sort((a, b) => b.prefix.length - a.prefix.length)
		.map((m) => ({ prefix: m.prefix, root: resolve(m.root) }));

	return (url) => {
		let path: string;
		try {
			path = decodeURIComponent(new URL(url, 'http://localhost').pathname);
		} catch {
			// A malformed escape names no file; refusing beats guessing at the intent.
			return null;
		}
		if (path.includes('\0')) return null;

		for (const mount of ordered) {
			if (mount.prefix !== '' && path !== mount.prefix && !path.startsWith(`${mount.prefix}/`))
				continue;
			const rest = path.slice(mount.prefix.length).replace(/^\/+/, '');
			// One screen, no router: the root is the client's `index.html` and nothing else
			// falls back to it, so a missing asset is a 404 rather than a page.
			const at = resolve(mount.root, rest === '' ? 'index.html' : rest);

			// The escape refusal, checked on the resolved path: `%2e%2e`, a doubled separator
			// and a plain `..` all collapse into one answer here, where a check against the
			// request text would have to anticipate each spelling.
			if (!within(mount.root, at)) return null;

			// One stat answers all three questions the response has: is it there, is it a
			// file, how long is it. A second would read a tree a repack swaps under the
			// server, and the length it read would not be the body's.
			let stats;
			try {
				stats = statSync(at);
			} catch {
				continue;
			}
			if (stats.isFile()) return { at, size: stats.size, path };
		}
		return null;
	};
}

/** The file a request names, or null when it names none it may have. */
export function fileFor(mounts: Mount[], url: string): string | null {
	return fileResolver(mounts)(url)?.at ?? null;
}

/** A server over `mounts`, caching as `caching` says. */
export function createStaticServer(
	mounts: Mount[],
	{ caching = 'none', cors = false, events }: ServeOptions = {}
): Server {
	const resolveFile = fileResolver(mounts);
	const shared: Record<string, string> = {
		...(cors
			? { 'access-control-allow-origin': '*', 'access-control-expose-headers': EVENTS_HEADER }
			: {}),
		...(events ? { [EVENTS_HEADER]: EVENTS_PATH.slice(1) } : {})
	};

	return createServer((req: IncomingMessage, res: ServerResponse) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405, { allow: 'GET, HEAD' }).end();
			return;
		}

		if (
			events &&
			req.method === 'GET' &&
			new URL(req.url ?? '/', 'http://localhost').pathname === EVENTS_PATH
		) {
			events.attach(res, shared);
			return;
		}

		const found = resolveFile(req.url ?? '/');
		if (found === null) {
			res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found\n');
			return;
		}

		res.writeHead(200, {
			'content-type': TYPES[extname(found.at).toLowerCase()] ?? 'application/octet-stream',
			'content-length': found.size,
			'cache-control': cacheFor(caching, found.path),
			...shared
		});
		if (req.method === 'HEAD') {
			res.end();
			return;
		}

		const stream = createReadStream(found.at);
		// A repack removes the file between the stat and the open, and a `ReadStream`
		// that errors with nothing listening throws out of the event loop and takes the
		// loop down mid-session. The head is already written, so the answer is a
		// destroyed response rather than a status: a body short of the length it
		// declared has to be a read a client can tell from a whole one.
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
