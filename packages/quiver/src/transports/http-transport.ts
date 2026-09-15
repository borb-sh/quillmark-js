/**
 * HttpTransport — browser-safe built-quiver transport that fetches via HTTP.
 * Internal; not exported from index.ts.
 *
 * Uses globalThis.fetch — no node: imports at any level.
 */

import { QuiverError } from '../errors.js';
import type { BuiltTransport, FetchOptions } from '../built-loader.js';

/** Over the ceiling is `quiver_invalid`, not `transport_error`: a retry fetches the same
 *  response, so there is nothing for an evicting cache to fix. */
function oversized(url: string, max: number, says: string): QuiverError {
	return new QuiverError('quiver_invalid', `"${url}" ${says} the ${max} bytes a fetch may read`);
}

/** The body chunk by chunk, refused past the ceiling. Cancelling the reader terminates
 *  the fetch, so nothing more of a refused response is pulled off the socket. */
async function readCapped(
	body: ReadableStream<Uint8Array>,
	url: string,
	max: number
): Promise<Uint8Array> {
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > max) {
			await reader.cancel();
			throw oversized(url, max, 'is over');
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return bytes;
}

export class HttpTransport implements BuiltTransport {
	private readonly baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	}

	async fetchBytes(relativePath: string, opts: FetchOptions): Promise<Uint8Array> {
		const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

		const url = `${this.baseUrl}${cleanPath}`;

		let response: Response;
		try {
			// `no-cache` revalidates with the origin rather than skipping the cache: a 304
			// still serves from disk. `force-cache` takes a cached response whatever its
			// age, which a digest-carrying name is entitled to; a stale one fails
			// verification upstream as `transport_error`, which an evicting cache clears.
			response = await globalThis.fetch(url, {
				cache: opts.revalidate ? 'no-cache' : 'force-cache'
			});
		} catch (err) {
			throw new QuiverError(
				'transport_error',
				`Network error fetching "${url}": ${(err as Error).message}`,
				{ cause: err }
			);
		}

		if (!response.ok) {
			throw new QuiverError('transport_error', `HTTP ${response.status} fetching "${url}"`);
		}

		// A fast reject; the running total below is what holds the ceiling. `Content-Length`
		// is the encoded length, so under `Content-Encoding` it under-reports; a missing one is
		// 0 and an unparseable one NaN, neither over the ceiling, so both accept early.
		const declared = Number(response.headers.get('content-length'));
		if (declared > opts.maxBytes) {
			throw oversized(url, opts.maxBytes, `states ${declared} bytes, over`);
		}

		try {
			// A host that hands back no stream is measured after the fact rather than
			// refused: the degraded check still bounds what reaches the unpack budget,
			// and refusing outright would cost hosts that work today.
			if (response.body === null) {
				const buffer = await response.arrayBuffer();
				if (buffer.byteLength > opts.maxBytes) throw oversized(url, opts.maxBytes, 'is over');
				return new Uint8Array(buffer);
			}
			return await readCapped(response.body, url, opts.maxBytes);
		} catch (err) {
			if (err instanceof QuiverError) throw err;
			throw new QuiverError(
				'transport_error',
				`Network error reading "${url}": ${(err as Error).message}`,
				{ cause: err }
			);
		}
	}
}
