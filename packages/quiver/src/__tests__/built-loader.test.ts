/**
 * Tests for built-loader.ts — all scenarios read an in-memory artifact, so no filesystem
 * or network is needed.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { filesReader, httpReader, loadBuiltQuiver } from '../built-loader.js';
import type { ArtifactReader } from '../built-loader.js';
import { packFiles } from '../bundle.js';
import { QuiverError } from '../errors.js';
import { FORMAT } from '../format.js';
import { mockQuillFromTree } from './helpers/mock-engine.js';

// The Quiver tree path is private (`getQuill` → the loader). To observe the
// tree the loader produced, stub `Quill.fromTree` and read the tree it was
// handed; `getQuill` resolves the ref and drives the same loader.
let treeStub: ReturnType<typeof mockQuillFromTree> | undefined;
afterEach(() => {
	treeStub?.restore();
	treeStub = undefined;
});

/** Drives the loader via `getQuill` and returns the tree fed to Quill.fromTree. */
async function loadTreeViaGetQuill(
	quiver: { getQuill: (ref: string) => Promise<unknown> },
	name: string,
	version: string
): Promise<Map<string, Uint8Array>> {
	treeStub ??= mockQuillFromTree();
	const before = treeStub.calls.length;
	await quiver.getQuill(`${name}@${version}`);
	return treeStub.calls[before]!;
}

/** A mutable artifact, logging every read. */
class MemArtifact {
	readonly files: Map<string, Uint8Array>;
	readonly log: string[] = [];
	readonly revalidated: string[] = [];

	constructor(entries: Record<string, Uint8Array>) {
		this.files = new Map(Object.entries(entries));
	}

	readonly read: ArtifactReader = async (path, mode) => {
		this.log.push(path);
		if (mode === 'no-cache') this.revalidated.push(path);
		const bytes = this.files.get(path);
		if (bytes === undefined) {
			throw new QuiverError('transport_error', `MemArtifact: not found: "${path}"`);
		}
		return bytes;
	};
}

const enc = new TextEncoder();

function makeBundle(files: Record<string, string>): Uint8Array {
	const input: Record<string, Uint8Array> = {};
	for (const [k, v] of Object.entries(files)) {
		input[k] = enc.encode(v);
	}
	return packFiles(input);
}

/** An OpenType signature and then `tail`: bytes the loader takes as a font. */
const font = (...tail: number[]): Uint8Array =>
	new Uint8Array([...new TextEncoder().encode('OTTO'), ...tail]);

/** Distinct 64-hex keys; the loader reads a font's name and never hashes its bytes. */
const fontKey = (n: number): string => n.toString(16).padStart(64, '0');
const bundleName = (name: string, version: string, tag = 'a'): string =>
	`${name}@${version}.${tag.repeat(32)}.zip`;

interface QuillSpec {
	name: string;
	version: string;
	/** Content files, zipped into the bundle. */
	files?: Record<string, string>;
	/** Dehydrated fonts: tree path → [key, bytes]. */
	fonts?: Record<string, [string, Uint8Array]>;
}

function indexOf(name: string, quills: QuillSpec[]): Record<string, unknown> {
	return {
		format: FORMAT,
		name,
		quills: quills.map((q) => ({
			name: q.name,
			version: q.version,
			bundle: bundleName(q.name, q.version),
			fonts: Object.fromEntries(Object.entries(q.fonts ?? {}).map(([p, [key]]) => [p, key]))
		}))
	};
}

/** A packed artifact of the shape `build` writes. */
function makeArtifact(quiverName: string, quills: QuillSpec[]): MemArtifact {
	const entries: Record<string, Uint8Array> = {
		'quiver.json': enc.encode(JSON.stringify(indexOf(quiverName, quills)))
	};
	for (const q of quills) {
		entries[bundleName(q.name, q.version)] = makeBundle(
			q.files ?? { 'Quill.yaml': `name: ${q.name}\n` }
		);
		for (const [key, bytes] of Object.values(q.fonts ?? {})) entries[`fonts/${key}`] = bytes;
	}
	return new MemArtifact(entries);
}

/** An artifact whose `quiver.json` is the given document and nothing else. */
function indexed(doc: Record<string, unknown>): MemArtifact {
	return new MemArtifact({ 'quiver.json': enc.encode(JSON.stringify(doc)) });
}

/** The minimal three-quill fixture most tests below run against. */
function buildMinimalArtifact(): MemArtifact {
	return makeArtifact('sample', [
		{
			name: 'memo',
			version: '1.0.0',
			files: { 'Quill.yaml': 'name: memo\n', 'template.typ': '// memo 1.0.0\n' }
		},
		{ name: 'memo', version: '1.1.0' },
		{ name: 'resume', version: '2.0.0' }
	]);
}

function loadMinimal() {
	return loadBuiltQuiver(buildMinimalArtifact().read);
}

describe('loadBuiltQuiver — happy path', () => {
	it('quillNames() returns sorted quill names', async () => {
		expect((await loadMinimal()).quillNames()).toEqual(['memo', 'resume']);
	});

	it('versionsOf() returns versions sorted descending', async () => {
		const q = await loadMinimal();
		expect(q.versionsOf('memo')).toEqual(['1.1.0', '1.0.0']);
		expect(q.versionsOf('resume')).toEqual(['2.0.0']);
	});

	it('carries the description', async () => {
		const q = await loadBuiltQuiver(
			indexed({ format: FORMAT, name: 'sample', description: 'A sample quiver', quills: [] }).read
		);
		expect(q.description).toBe('A sample quiver');
	});

	it('an index without a description carries undefined', async () => {
		expect((await loadMinimal()).description).toBeUndefined();
	});
});

describe('loadBuiltQuiver — tree rehydration', () => {
	it('loaded tree has correct bytes for content files', async () => {
		const q = await loadMinimal();
		const tree = await loadTreeViaGetQuill(q, 'memo', '1.0.0');

		expect(new TextDecoder().decode(tree.get('Quill.yaml'))).toBe('name: memo\n');
	});

	it('rehydrates fonts at correct paths', async () => {
		const fontBytes = font(0xde, 0xad, 0xbe, 0xef);
		const artifact = makeArtifact('sample', [
			{ name: 'memo', version: '1.0.0', fonts: { 'fonts/body.ttf': [fontKey(1), fontBytes] } }
		]);

		const q = await loadBuiltQuiver(artifact.read);
		const tree = await loadTreeViaGetQuill(q, 'memo', '1.0.0');

		expect(tree.get('fonts/body.ttf')).toEqual(fontBytes);
	});

	it('reads one bundle and its own fonts, and nothing of another quill', async () => {
		const artifact = makeArtifact('sample', [
			{ name: 'memo', version: '1.0.0', fonts: { 'a.ttf': [fontKey(1), font(1)] } },
			{ name: 'resume', version: '2.0.0', fonts: { 'b.ttf': [fontKey(2), font(2)] } }
		]);
		const q = await loadBuiltQuiver(artifact.read);
		await loadTreeViaGetQuill(q, 'memo', '1.0.0');

		expect(artifact.log.sort()).toEqual(
			['quiver.json', bundleName('memo', '1.0.0'), `fonts/${fontKey(1)}`].sort()
		);
	});
});

describe('loadBuiltQuiver — the index revalidates', () => {
	it('asks the reader to revalidate quiver.json and nothing else', async () => {
		const artifact = buildMinimalArtifact();
		const q = await loadBuiltQuiver(artifact.read);
		await loadTreeViaGetQuill(q, 'memo', '1.0.0');

		expect(artifact.revalidated).toEqual(['quiver.json']);
		expect(artifact.log.length).toBeGreaterThan(1);
	});
});

describe('loadBuiltQuiver — a newer generation', () => {
	// A tab holds the index it booted with; a deploy since has replaced the files it names.
	const MEMO = bundleName('memo', '1.0.0');

	/** Replace `memo@1.0.0` with a generation of its own, deleting what it replaced. */
	function redeploy(artifact: MemArtifact, spec: QuillSpec, tag: string): void {
		const next = indexOf('sample', [spec]);
		const entry = (next['quills'] as { bundle: string }[])[0]!;
		const before = new Set(artifact.files.keys());
		entry.bundle = bundleName('memo', '1.0.0', tag);
		for (const path of before) artifact.files.delete(path);
		artifact.files.set('quiver.json', enc.encode(JSON.stringify(next)));
		artifact.files.set(
			entry.bundle,
			makeBundle(spec.files ?? { 'Quill.yaml': `name: ${spec.name}\n` })
		);
		for (const [key, bytes] of Object.values(spec.fonts ?? {})) {
			artifact.files.set(`fonts/${key}`, bytes);
		}
	}

	it("a bundle the next generation deleted is read under that generation's name", async () => {
		const artifact = makeArtifact('sample', [{ name: 'memo', version: '1.0.0' }]);
		const q = await loadBuiltQuiver(artifact.read);
		redeploy(
			artifact,
			{ name: 'memo', version: '1.0.0', files: { 'Quill.yaml': 'name: memo\n# next\n' } },
			'b'
		);

		const tree = await loadTreeViaGetQuill(q, 'memo', '1.0.0');
		expect(new TextDecoder().decode(tree.get('Quill.yaml'))).toBe('name: memo\n# next\n');
	});

	it('a font the next generation replaced is read under its new name', async () => {
		// The bundle's name is a digest of what is not a font, so a release changing only a
		// font keeps it.
		const artifact = makeArtifact('sample', [
			{ name: 'memo', version: '1.0.0', fonts: { 'a.ttf': [fontKey(1), font(1)] } }
		]);
		const q = await loadBuiltQuiver(artifact.read);
		redeploy(
			artifact,
			{ name: 'memo', version: '1.0.0', fonts: { 'a.ttf': [fontKey(2), font(2)] } },
			'a'
		);

		const tree = await loadTreeViaGetQuill(q, 'memo', '1.0.0');
		expect(tree.get('a.ttf')).toEqual(font(2));
	});

	it('one reread serves every quill the tab opens after it', async () => {
		const artifact = makeArtifact('sample', [
			{ name: 'memo', version: '1.0.0' },
			{ name: 'resume', version: '2.0.0' }
		]);
		const q = await loadBuiltQuiver(artifact.read);
		const next = indexOf('sample', [
			{ name: 'memo', version: '1.0.0' },
			{ name: 'resume', version: '2.0.0' }
		]);
		for (const entry of next['quills'] as { name: string; version: string; bundle: string }[]) {
			artifact.files.delete(entry.bundle);
			entry.bundle = bundleName(entry.name, entry.version, 'b');
			artifact.files.set(entry.bundle, makeBundle({ 'Quill.yaml': `name: ${entry.name}\n` }));
		}
		artifact.files.set('quiver.json', enc.encode(JSON.stringify(next)));

		await loadTreeViaGetQuill(q, 'memo', '1.0.0');
		await loadTreeViaGetQuill(q, 'resume', '2.0.0');
		expect(artifact.log.filter((p) => p === 'quiver.json')).toHaveLength(2);
	});

	it('a failure the index does not explain is the original error', async () => {
		const artifact = makeArtifact('sample', [{ name: 'memo', version: '1.0.0' }]);
		artifact.files.delete(MEMO);

		const q = await loadBuiltQuiver(artifact.read);
		await expect(q.getQuill('memo@1.0.0')).rejects.toThrow(`not found: "${MEMO}"`);
		expect(artifact.log.filter((p) => p === 'quiver.json')).toHaveLength(2);
	});

	it('a quill the next generation dropped is the original error', async () => {
		const artifact = makeArtifact('sample', [{ name: 'memo', version: '1.0.0' }]);
		const q = await loadBuiltQuiver(artifact.read);
		artifact.files.clear();
		artifact.files.set(
			'quiver.json',
			enc.encode(JSON.stringify({ format: FORMAT, name: 'sample', quills: [] }))
		);

		await expect(q.getQuill('memo@1.0.0')).rejects.toThrow(`not found: "${MEMO}"`);
	});

	it('a reread that cannot reach quiver.json is the original error', async () => {
		const artifact = makeArtifact('sample', [{ name: 'memo', version: '1.0.0' }]);
		const q = await loadBuiltQuiver(artifact.read);
		artifact.files.clear();

		await expect(q.getQuill('memo@1.0.0')).rejects.toThrow(`not found: "${MEMO}"`);
	});

	it('a reread refusing a newer format is the error thrown', async () => {
		const artifact = makeArtifact('sample', [{ name: 'memo', version: '1.0.0' }]);
		const q = await loadBuiltQuiver(artifact.read);
		artifact.files.clear();
		artifact.files.set(
			'quiver.json',
			enc.encode(JSON.stringify({ format: FORMAT + 1, name: 'sample', quills: [] }))
		);

		await expect(q.getQuill('memo@1.0.0')).rejects.toThrow(/Upgrade @quillmark\/quiver/);
	});
});

describe('loadBuiltQuiver — a host answering with something else', () => {
	// An SPA fallback answers a missing name 200 with the client's page.
	const page = enc.encode('<!doctype html><title>studio</title>');

	it('a page where a bundle was → transport_error naming it', async () => {
		const artifact = makeArtifact('sample', [{ name: 'memo', version: '1.0.0' }]);
		artifact.files.set(bundleName('memo', '1.0.0'), page);

		const q = await loadBuiltQuiver(artifact.read);
		await expect(q.getQuill('memo@1.0.0')).rejects.toThrow(
			expect.objectContaining({
				code: 'transport_error',
				message: expect.stringContaining('other than a zip')
			})
		);
	});

	it('a page where a font was → transport_error naming it', async () => {
		const artifact = makeArtifact('sample', [
			{ name: 'memo', version: '1.0.0', fonts: { 'a.ttf': [fontKey(1), font(1)] } }
		]);
		artifact.files.set(`fonts/${fontKey(1)}`, page);

		const q = await loadBuiltQuiver(artifact.read);
		await expect(q.getQuill('memo@1.0.0')).rejects.toThrow(
			expect.objectContaining({
				code: 'transport_error',
				message: expect.stringContaining(
					`"fonts/${fontKey(1)}" arrived as something other than a font`
				)
			})
		);
	});

	it('takes every font signature build writes', async () => {
		const signatures: [string, string][] = [
			['\0\x01\0\0', 'ttf'],
			['OTTO', 'otf'],
			['true', 'ttf'],
			['ttcf', 'ttf'],
			['wOFF', 'woff'],
			['wOF2', 'woff2']
		];
		const fonts = Object.fromEntries(
			signatures.map(([magic, ext], i): [string, [string, Uint8Array]] => [
				`${i}.${ext}`,
				[fontKey(i + 1), enc.encode(`${magic}rest`)]
			])
		);
		const artifact = makeArtifact('sample', [{ name: 'memo', version: '1.0.0', fonts }]);

		const tree = await loadTreeViaGetQuill(await loadBuiltQuiver(artifact.read), 'memo', '1.0.0');
		expect([...tree.keys()].filter((p) => /^\d\./.test(p))).toHaveLength(signatures.length);
	});

	// The engine parses sfnt alone; a WOFF under `.ttf` would reach Typst and be substituted.
	it('a .ttf holding WOFF bytes → transport_error naming it', async () => {
		const artifact = makeArtifact('sample', [
			{ name: 'memo', version: '1.0.0', fonts: { 'a.ttf': [fontKey(1), enc.encode('wOF2rest')] } }
		]);

		const q = await loadBuiltQuiver(artifact.read);
		await expect(q.getQuill('memo@1.0.0')).rejects.toThrow('other than a font');
	});

	// `force-cache` would answer the page again on every retry and every reload of the tab.
	it('a page the cache holds where a bundle is → read once past the cache', async () => {
		const artifact = makeArtifact('sample', [{ name: 'memo', version: '1.0.0' }]);
		const bundle = bundleName('memo', '1.0.0');
		const modes: string[] = [];
		const read: ArtifactReader = async (path, mode) => {
			if (path === bundle) modes.push(mode);
			return path === bundle && mode === 'force-cache' ? page : artifact.read(path, mode);
		};

		const tree = await loadTreeViaGetQuill(await loadBuiltQuiver(read), 'memo', '1.0.0');
		expect(tree.size).toBeGreaterThan(0);
		expect(modes).toEqual(['force-cache', 'reload']);
	});
});

describe('loadBuiltQuiver — font coalescing', () => {
	it('two concurrent loads sharing a font read it exactly once', async () => {
		const shared: [string, Uint8Array] = [fontKey(1), font(1, 2, 3)];
		const artifact = makeArtifact('coalesce-test', [
			{ name: 'quillA', version: '1.0.0', fonts: { 'fonts/shared.ttf': shared } },
			{ name: 'quillB', version: '1.0.0', fonts: { 'fonts/shared.ttf': shared } }
		]);

		const q = await loadBuiltQuiver(artifact.read);
		treeStub = mockQuillFromTree();
		await Promise.all([q.getQuill('quillA@1.0.0'), q.getQuill('quillB@1.0.0')]);

		expect(artifact.log.filter((p) => p.startsWith('fonts/'))).toHaveLength(1);
	});

	it('a failed font read is not cached', async () => {
		const body: [string, Uint8Array] = [fontKey(1), font(1, 2, 3, 4)];
		const artifact = makeArtifact('sample', [
			{ name: 'memo', version: '1.0.0', fonts: { 'fonts/body.ttf': body } }
		]);
		artifact.files.delete(`fonts/${body[0]}`);

		const q = await loadBuiltQuiver(artifact.read);
		await expect(q.getQuill('memo@1.0.0')).rejects.toThrow(QuiverError);

		artifact.files.set(`fonts/${body[0]}`, body[1]);
		const tree = await loadTreeViaGetQuill(q, 'memo', '1.0.0');
		expect(tree.get('fonts/body.ttf')).toEqual(body[1]);
	});
});

describe('loadBuiltQuiver — the format', () => {
	it('a format above this loader → quiver_invalid naming the upgrade', async () => {
		await expect(
			loadBuiltQuiver(indexed({ format: FORMAT + 1, name: 'test', quills: [] }).read)
		).rejects.toThrow(
			expect.objectContaining({
				code: 'quiver_invalid',
				message: expect.stringContaining('Upgrade @quillmark/quiver')
			})
		);
	});

	// The format is read before the key check, so a newer document is refused as newer.
	it('a format above this loader wins over a field this loader does not know', async () => {
		await expect(
			loadBuiltQuiver(indexed({ format: FORMAT + 1, name: 't', quills: [], later: 1 }).read)
		).rejects.toThrow(/Upgrade @quillmark\/quiver/);
	});

	it('an absent format → quiver_invalid', async () => {
		await expect(loadBuiltQuiver(indexed({ name: 'test', quills: [] }).read)).rejects.toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	it('a non-integer format → quiver_invalid', async () => {
		await expect(
			loadBuiltQuiver(indexed({ format: '1', name: 'test', quills: [] }).read)
		).rejects.toThrow(expect.objectContaining({ code: 'quiver_invalid' }));
	});
});

describe('loadBuiltQuiver — invalid index', () => {
	// Truncated bytes are what a partial sync leaves behind, and the raw SyntaxError would
	// escape every QuiverError handler downstream.
	it('quiver.json that is not JSON → quiver_invalid', async () => {
		const artifact = new MemArtifact({ 'quiver.json': enc.encode('{"format": 1, "na') });
		await expect(loadBuiltQuiver(artifact.read)).rejects.toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	it('a missing quiver.json → transport_error', async () => {
		await expect(loadBuiltQuiver(new MemArtifact({}).read)).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error' })
		);
	});

	it('a non-string description → quiver_invalid', async () => {
		await expect(
			loadBuiltQuiver(indexed({ format: FORMAT, name: 'test', description: 7, quills: [] }).read)
		).rejects.toThrow(expect.objectContaining({ code: 'quiver_invalid' }));
	});

	it('unknown top-level field → quiver_invalid', async () => {
		await expect(
			loadBuiltQuiver(indexed({ format: FORMAT, name: 'test', quills: [], extra: true }).read)
		).rejects.toThrow(expect.objectContaining({ code: 'quiver_invalid' }));
	});

	const withQuill = (quill: Record<string, unknown>) =>
		loadBuiltQuiver(
			indexed({
				format: FORMAT,
				name: 'test',
				quills: [
					{ name: 'foo', version: '1.0.0', bundle: bundleName('foo', '1.0.0'), fonts: {}, ...quill }
				]
			}).read
		);

	it('a quill entry named outside the ref charset → quiver_invalid', async () => {
		await expect(
			withQuill({ name: 'my.quill', bundle: bundleName('my.quill', '1.0.0') })
		).rejects.toThrow(/is not a name a ref can spell/);
	});

	it('non-canonical semver in quill entry → quiver_invalid', async () => {
		await expect(withQuill({ version: '1.0', bundle: 'foo@1.0.zip' })).rejects.toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	// A name read off `quiver.json` becomes a path on every reader, `fromBuiltDir`'s a
	// filesystem one, so no validated name carries a separator.
	it.each([
		['a bundle with path traversal', { bundle: '../../etc/passwd' }],
		['an absolute bundle', { bundle: '/etc/passwd' }],
		['a bundle in a subdirectory', { bundle: `x/${bundleName('foo', '1.0.0')}` }],
		['a font hash with path traversal', { fonts: { 'a.ttf': '../../etc/passwd' } }],
		// 32 hex chars: a full-width MD5, not a SHA-256.
		['a font hash that is not a full SHA-256', { fonts: { 'a.ttf': 'ab'.repeat(16) } }]
	])('%s → quiver_invalid', async (_, quill) => {
		await expect(withQuill(quill)).rejects.toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	it('duplicate name@version → quiver_invalid', async () => {
		const entry = { name: 'foo', version: '1.0.0', fonts: {} };
		await expect(
			loadBuiltQuiver(
				indexed({
					format: FORMAT,
					name: 'test',
					quills: [
						{ ...entry, bundle: bundleName('foo', '1.0.0', 'a') },
						{ ...entry, bundle: bundleName('foo', '1.0.0', 'b') }
					]
				}).read
			)
		).rejects.toThrow(/Duplicate quill entry/);
	});

	it('same name but different versions is not a duplicate', async () => {
		const artifact = makeArtifact('test', [
			{ name: 'foo', version: '1.0.0' },
			{ name: 'foo', version: '2.0.0' }
		]);
		const q = await loadBuiltQuiver(artifact.read);
		expect(q.versionsOf('foo')).toEqual(['2.0.0', '1.0.0']);
	});
});

describe('filesReader', () => {
	it('drops a leading ./ or / from a key', async () => {
		const read = filesReader(
			new Map([
				['./quiver.json', new Uint8Array([1])],
				['/fonts/x', new Uint8Array([2])]
			])
		);
		expect(await read('quiver.json', 'no-cache')).toEqual(new Uint8Array([1]));
		expect(await read('fonts/x', 'force-cache')).toEqual(new Uint8Array([2]));
	});

	it('a path the map lacks → transport_error naming it', async () => {
		await expect(filesReader(new Map())('quiver.json', 'no-cache')).rejects.toThrow(
			expect.objectContaining({
				code: 'transport_error',
				message: expect.stringContaining('quiver.json')
			})
		);
	});
});

describe('httpReader', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubFetch(answer: () => Promise<Response>): { url: string; init?: RequestInit }[] {
		const calls: { url: string; init?: RequestInit }[] = [];
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			calls.push({ url, init });
			return answer();
		});
		return calls;
	}

	it('reads the path under the base, with or without its trailing slash', async () => {
		const calls = stubFetch(async () => new Response(new Uint8Array([7])));
		expect(await httpReader('https://cdn.example.com/q')('quiver.json', 'no-cache')).toEqual(
			new Uint8Array([7])
		);
		await httpReader('/q/')('fonts/x', 'force-cache');
		expect(calls.map((c) => c.url)).toEqual([
			'https://cdn.example.com/q/quiver.json',
			'/q/fonts/x'
		]);
	});

	it('fetches under the cache mode it is given', async () => {
		const calls = stubFetch(async () => new Response(new Uint8Array()));
		const read = httpReader('/q/');
		await read('quiver.json', 'no-cache');
		await read(bundleName('memo', '1.0.0'), 'force-cache');
		await read(bundleName('memo', '1.0.0'), 'reload');
		expect(calls.map((c) => c.init?.cache)).toEqual(['no-cache', 'force-cache', 'reload']);
	});

	it('an HTTP error → transport_error naming the status', async () => {
		stubFetch(async () => new Response(null, { status: 404 }));
		await expect(httpReader('/q/')('quiver.json', 'no-cache')).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error', message: expect.stringContaining('404') })
		);
	});

	it('a network failure → transport_error carrying it as cause', async () => {
		const cause = new TypeError('Network failure');
		stubFetch(async () => {
			throw cause;
		});
		await expect(httpReader('/q/')('quiver.json', 'no-cache')).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error', cause })
		);
	});
});
