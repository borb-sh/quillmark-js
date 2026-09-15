import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HttpTransport } from '../../transports/http-transport.js';
import { QuiverError } from '../../errors.js';

// ─── Mock fetch helpers ───────────────────────────────────────────────────────

type FetchMock = (url: string) => Promise<Response>;

function makeFetchMock(fn: FetchMock): typeof globalThis.fetch {
	return fn as typeof globalThis.fetch;
}

function mockOkResponse(bytes: Uint8Array): Response {
	return new Response(bytes.buffer as ArrayBuffer, { status: 200 });
}

function mockErrorResponse(status: number): Response {
	return new Response(null, { status });
}

/** A ceiling wide enough for every fixture that is not about the ceiling. */
const CAP = { maxBytes: 1024 };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HttpTransport.fetchBytes', () => {
	let originalFetch: typeof globalThis.fetch | undefined;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		if (originalFetch !== undefined) {
			globalThis.fetch = originalFetch;
		} else {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			delete (globalThis as any).fetch;
		}
	});

	it('happy path: returns bytes from a 200 response', async () => {
		const expected = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
		const capturedUrls: string[] = [];

		globalThis.fetch = makeFetchMock(async (url: string) => {
			capturedUrls.push(url);
			return mockOkResponse(expected);
		});

		const transport = new HttpTransport('https://cdn.example.com/quivers/my/');
		const bytes = await transport.fetchBytes('latest.json', CAP);

		expect(bytes).toEqual(expected);
		expect(capturedUrls).toEqual(['https://cdn.example.com/quivers/my/latest.json']);
	});

	it('HTTP 404 throws transport_error', async () => {
		globalThis.fetch = makeFetchMock(async () => mockErrorResponse(404));

		const transport = new HttpTransport('https://cdn.example.com/quivers/');
		await expect(transport.fetchBytes('missing.json', CAP)).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error' })
		);
	});

	it('network error (fetch rejects) throws transport_error with cause', async () => {
		globalThis.fetch = makeFetchMock(async () => {
			throw new TypeError('Network failure');
		});

		const transport = new HttpTransport('https://cdn.example.com/quivers/');
		let thrown: unknown;
		try {
			await transport.fetchBytes('latest.json', CAP);
		} catch (e) {
			thrown = e;
		}

		expect(thrown).toBeInstanceOf(QuiverError);
		expect((thrown as QuiverError).code).toBe('transport_error');
		expect((thrown as QuiverError).cause).toBeInstanceOf(TypeError);
	});

	describe('URL joining', () => {
		it('base URL with trailing slash + normal relative path', async () => {
			const capturedUrls: string[] = [];
			globalThis.fetch = makeFetchMock(async (url: string) => {
				capturedUrls.push(url);
				return mockOkResponse(new Uint8Array([1]));
			});

			const transport = new HttpTransport('https://cdn.example.com/base/');
			await transport.fetchBytes('store/abc', CAP);
			expect(capturedUrls[0]).toBe('https://cdn.example.com/base/store/abc');
		});

		it('base URL without trailing slash — adds one', async () => {
			const capturedUrls: string[] = [];
			globalThis.fetch = makeFetchMock(async (url: string) => {
				capturedUrls.push(url);
				return mockOkResponse(new Uint8Array([1]));
			});

			const transport = new HttpTransport('https://cdn.example.com/base');
			await transport.fetchBytes('store/abc', CAP);
			expect(capturedUrls[0]).toBe('https://cdn.example.com/base/store/abc');
		});

		it('relative path with leading slash — strips the leading slash', async () => {
			const capturedUrls: string[] = [];
			globalThis.fetch = makeFetchMock(async (url: string) => {
				capturedUrls.push(url);
				return mockOkResponse(new Uint8Array([1]));
			});

			const transport = new HttpTransport('https://cdn.example.com/base/');
			await transport.fetchBytes('/store/abc', CAP);
			expect(capturedUrls[0]).toBe('https://cdn.example.com/base/store/abc');
		});
	});
});

describe('HttpTransport — revalidation', () => {
	// `latest.json` is the one name in the artifact that is not
	// content-addressed, so it is the one request a browser cache may not answer
	// on its own. Everything else is immutable by construction, and says so here:
	// a deploy that never sets a cache header still reuses what it already holds.
	let originalFetch: typeof globalThis.fetch | undefined;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		if (originalFetch !== undefined) globalThis.fetch = originalFetch;
	});

	async function initFor(opts?: { revalidate?: boolean }): Promise<RequestInit | undefined> {
		let captured: RequestInit | undefined;
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			captured = init;
			return new Response(new Uint8Array([1]).buffer as ArrayBuffer, { status: 200 });
		}) as typeof globalThis.fetch;

		const transport = new HttpTransport('https://cdn.example.com/q/');
		await transport.fetchBytes('latest.json', { ...CAP, ...opts });
		return captured;
	}

	it('asks the cache to revalidate when told to', async () => {
		expect(await initFor({ revalidate: true })).toEqual({ cache: 'no-cache' });
	});

	it('takes a cached response whatever its age otherwise', async () => {
		expect(await initFor()).toEqual({ cache: 'force-cache' });
		expect(await initFor({ revalidate: false })).toEqual({ cache: 'force-cache' });
	});
});

describe('HttpTransport — the ceiling', () => {
	// The one layer with a stream to stop: a digest mismatch and an over-budget bundle
	// are both verdicts reached by holding the whole response.
	let originalFetch: typeof globalThis.fetch | undefined;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		if (originalFetch !== undefined) globalThis.fetch = originalFetch;
	});

	/** A body of `chunks` 64-byte chunks, reporting what was pulled off it. */
	function streaming(chunks: number, headers: Record<string, string> = {}) {
		const source = { pulls: 0, cancelled: false };
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (source.pulls++ >= chunks) {
					controller.close();
					return;
				}
				controller.enqueue(new Uint8Array(64).fill(7));
			},
			cancel() {
				source.cancelled = true;
			}
		});
		globalThis.fetch = makeFetchMock(async () => new Response(stream, { status: 200, headers }));
		return source;
	}

	const transport = new HttpTransport('https://cdn.example.com/q/');

	it('reads a body under the ceiling whole', async () => {
		streaming(4);
		const bytes = await transport.fetchBytes('store/abc', { maxBytes: 256 });
		expect(bytes.byteLength).toBe(256);
		expect([...new Set(bytes)]).toEqual([7]);
	});

	it('refuses a body past the ceiling and drops the connection', async () => {
		const source = streaming(Number.POSITIVE_INFINITY);

		await expect(transport.fetchBytes('store/abc', { maxBytes: 256 })).rejects.toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
		// The body never ends, so the throw and the cancel are the proof: the read
		// stopped at the ceiling, not at the end of the response.
		expect(source.cancelled).toBe(true);
	});

	it('refuses a stated length over the ceiling without reading the body', async () => {
		// A body that fails on its first read: `quiver_invalid` rather than a network
		// fault is the proof the header refused before anything touched it.
		globalThis.fetch = makeFetchMock(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							controller.error(new TypeError('the body was read'));
						}
					}),
					{ status: 200, headers: { 'content-length': String(4 * 1024 * 1024) } }
				)
		);

		await expect(transport.fetchBytes('store/abc', { maxBytes: 256 })).rejects.toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	it('holds the ceiling against a length that under-reports', async () => {
		// `Content-Length` is the encoded length, so a compressed response states
		// less than it delivers. The running total is what refuses.
		streaming(Number.POSITIVE_INFINITY, { 'content-length': '8' });

		await expect(transport.fetchBytes('store/abc', { maxBytes: 256 })).rejects.toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	it('spends the ceiling after the fact where a host hands back no stream', async () => {
		const bodiless = (size: number): Response =>
			({
				ok: true,
				status: 200,
				headers: new Headers(),
				body: null,
				arrayBuffer: async () => new ArrayBuffer(size)
			}) as unknown as Response;

		globalThis.fetch = makeFetchMock(async () => bodiless(4096));
		await expect(transport.fetchBytes('store/abc', { maxBytes: 256 })).rejects.toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);

		globalThis.fetch = makeFetchMock(async () => bodiless(128));
		expect((await transport.fetchBytes('store/abc', { maxBytes: 256 })).byteLength).toBe(128);
	});

	it('a body that fails mid-stream is a transport_error', async () => {
		globalThis.fetch = makeFetchMock(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							controller.error(new TypeError('Connection reset'));
						}
					}),
					{ status: 200 }
				)
		);

		let thrown: unknown;
		try {
			await transport.fetchBytes('store/abc', { maxBytes: 256 });
		} catch (e) {
			thrown = e;
		}

		expect(thrown).toBeInstanceOf(QuiverError);
		expect((thrown as QuiverError).code).toBe('transport_error');
		expect((thrown as QuiverError).cause).toBeInstanceOf(TypeError);
	});
});
