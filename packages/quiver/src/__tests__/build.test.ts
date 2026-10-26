import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildQuiver } from '../build.js';
import { unpackFiles } from '../bundle.js';
import { FORMAT } from '../format.js';
import { scratch } from './helpers/scratch.js';

/** An OpenType signature and then `tail`: bytes the build takes as a font. */
const font = (...tail: number[]): Uint8Array =>
	new Uint8Array([...new TextEncoder().encode('OTTO'), ...tail]);

const SAMPLE_FIXTURE = new URL('./fixtures/sample-quiver', import.meta.url).pathname;

const temp = scratch('quiver-build-');
afterEach(() => temp.cleanup());

/** A path nothing is at yet, inside a directory `temp` cleans up. */
const fresh = async (): Promise<string> => join(await temp.dir(), 'q');

/**
 * Build a minimal Source Quiver programmatically. `fonts` are written into the quill
 * directory at their paths.
 */
async function seedSourceQuiver(
	root: string,
	opts: {
		name?: string;
		quills: Array<{
			name: string;
			version: string;
			fonts?: Array<{ path: string; content: Uint8Array }>;
		}>;
	}
): Promise<void> {
	await mkdir(root, { recursive: true });
	await writeFile(join(root, 'Quiver.yaml'), `name: ${opts.name ?? 'test'}\n`);
	for (const q of opts.quills) {
		const dir = join(root, 'quills', q.name, q.version);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'Quill.yaml'), `name: ${q.name}\n`);
		await writeFile(join(dir, 'template.typ'), `// ${q.name} ${q.version}\n`);
		for (const font of q.fonts ?? []) {
			const fontPath = join(dir, font.path);
			await mkdir(join(dir, 'fonts'), { recursive: true }).catch(() => {});
			await writeFile(fontPath, font.content);
		}
	}
}

/** `quiver.json`, parsed. */
async function indexOf(out: string): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(join(out, 'quiver.json'), 'utf-8')) as Record<string, unknown>;
}

describe('buildQuiver — happy path (sample-quiver fixture)', () => {
	it('stamps the format the tree is written in', async () => {
		// The one thing a client of any age reads first, so a tree from a newer builder
		// is refused by name rather than misread field by field.
		const out = await fresh();
		await buildQuiver(SAMPLE_FIXTURE, out);

		expect((await indexOf(out)).format).toBe(FORMAT);
	});

	it('leaves a reader of format 1 the format and nothing more', async () => {
		// What that reader fetches first and reads `format` off before anything else, so it
		// refuses the artifact with the upgrade named.
		const out = await fresh();
		await buildQuiver(SAMPLE_FIXTURE, out);

		const pointer = JSON.parse(await readFile(join(out, 'latest.json'), 'utf-8')) as unknown;
		expect(pointer).toEqual({ format: FORMAT });
		expect(FORMAT).toBeGreaterThan(1);
	});
});

describe('buildQuiver — one .quill bundle per quill, fonts and all', () => {
	it("carries each quill's fonts in its own bundle, and writes no fonts/", async () => {
		const src = await fresh();
		const out = await fresh();
		const shared = font(1, 2, 3, 4, 5, 6, 7, 8);

		await seedSourceQuiver(src, {
			quills: [
				{ name: 'quill_a', version: '1.0.0', fonts: [{ path: 'fonts/font.ttf', content: shared }] },
				{ name: 'quill_b', version: '1.0.0', fonts: [{ path: 'fonts/font.ttf', content: shared }] }
			]
		});
		await buildQuiver(src, out);

		const { quills } = (await indexOf(out)) as { quills: Array<Record<string, unknown>> };
		for (const entry of quills) {
			expect(Object.keys(entry).sort()).toEqual(['bundle', 'name', 'version']);
			const files = unpackFiles(await readFile(join(out, entry['bundle'] as string)));
			expect(Object.keys(files).sort()).toEqual(['Quill.yaml', 'fonts/font.ttf', 'template.typ']);
			expect(files['fonts/font.ttf']).toEqual(shared);
		}
		expect((await readdir(out)).sort()).toEqual(
			['latest.json', 'quiver.json', ...quills.map((q) => q['bundle'] as string)].sort()
		);
	});

	it('packs a font collection the size of a CJK one into its bundle', async () => {
		const src = await fresh();
		const out = await fresh();
		const collection = new Uint8Array(20 * 1024 * 1024);
		collection.set(new TextEncoder().encode('ttcf'));

		await seedSourceQuiver(src, {
			quills: [
				{ name: 'memo', version: '1.0.0', fonts: [{ path: 'fonts/cjk.ttc', content: collection }] }
			]
		});
		await buildQuiver(src, out);

		const { quills } = (await indexOf(out)) as { quills: Array<{ bundle: string }> };
		const files = unpackFiles(await readFile(join(out, quills[0]!.bundle)));
		expect(files['fonts/cjk.ttc']!.length).toBe(collection.length);
	});

	it('packs every font signature Quillmark parses', async () => {
		const src = await fresh();
		const out = await fresh();
		const signatures: [string, string][] = [
			['\0\x01\0\0', 'ttf'],
			['OTTO', 'otf'],
			['true', 'ttf'],
			['ttcf', 'ttc'],
			['ttcf', 'otc'],
			['wOFF', 'woff'],
			['wOF2', 'woff2']
		];
		const fonts = signatures.map(([magic, ext], i) => ({
			path: `fonts/${i}.${ext}`,
			content: new TextEncoder().encode(`${magic}rest`)
		}));
		await seedSourceQuiver(src, { quills: [{ name: 'memo', version: '1.0.0', fonts }] });

		await expect(buildQuiver(src, out)).resolves.toBeUndefined();
	});

	it.each([
		['a page', 'fonts/body.ttf', '<html>'],
		// Quillmark parses sfnt alone; a WOFF under `.ttf` would reach Typst and be substituted.
		['WOFF bytes under .ttf', 'fonts/body.ttf', 'wOF2rest']
	])('refuses a font file holding %s, naming it', async (_, path, content) => {
		const src = await fresh();
		const out = await fresh();
		await seedSourceQuiver(src, {
			quills: [
				{
					name: 'memo',
					version: '1.0.0',
					fonts: [{ path, content: new TextEncoder().encode(content) }]
				}
			]
		});

		await expect(buildQuiver(src, out)).rejects.toThrow(
			expect.objectContaining({
				code: 'quiver_invalid',
				message: expect.stringContaining(`"${path}" does not open as the font its extension names`)
			})
		);
	});

	it("carries Quiver.yaml's description into quiver.json", async () => {
		const out = await fresh();
		await buildQuiver(SAMPLE_FIXTURE, out);

		expect((await indexOf(out)).description).toBe('A sample quiver for testing');
	});

	it('omits the description a Quiver.yaml does not carry', async () => {
		const src = await fresh();
		const out = await fresh();
		await seedSourceQuiver(src, { quills: [{ name: 'quill_a', version: '1.0.0' }] });
		await buildQuiver(src, out);

		expect(await indexOf(out)).not.toHaveProperty('description');
	});
});

describe('buildQuiver — determinism', () => {
	it('packing the same source twice yields an identical quiver.json', async () => {
		const out1 = await fresh();
		const out2 = await fresh();

		await buildQuiver(SAMPLE_FIXTURE, out1);
		await buildQuiver(SAMPLE_FIXTURE, out2);

		expect(await readFile(join(out1, 'quiver.json'), 'utf-8')).toBe(
			await readFile(join(out2, 'quiver.json'), 'utf-8')
		);
	});
});

describe('buildQuiver — I/O error', () => {
	it('throws transport_error when outDir parent path is a file, not a directory', async () => {
		// Using a file-as-path-segment (ENOTDIR) works regardless of uid — a
		// chmod-based read-only fixture is bypassed by root, so it can't be
		// relied on in containerized test environments.
		const parentFile = await fresh();

		await writeFile(parentFile, 'not a directory');

		const out = join(parentFile, 'out');

		await expect(buildQuiver(SAMPLE_FIXTURE, out)).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error' })
		);
	});
});

describe('buildQuiver — the generation lands whole', () => {
	// What a repack loop and a deploy both read under. A build takes seconds, so a
	// window inside one is a window a client lands in.

	/** `quiver.json` as written, which moves whenever the packed content does. */
	async function indexText(out: string): Promise<string> {
		return readFile(join(out, 'quiver.json'), 'utf-8');
	}

	it('replaces the previous generation rather than merging with it', async () => {
		const out = join(await fresh(), 'quiver');
		await buildQuiver(SAMPLE_FIXTURE, out);
		await writeFile(join(out, 'stale.txt'), 'from a previous build');
		await buildQuiver(SAMPLE_FIXTURE, out);

		await expect(access(join(out, 'stale.txt'))).rejects.toThrow();
		// Every name the index reaches has landed: a whole tree moves in, so a client
		// never reads an index whose bundles are not there yet.
		const { quills } = (await indexOf(out)) as { quills: Array<{ bundle: string }> };
		expect(quills.length).toBeGreaterThan(0);
		for (const quill of quills) await access(join(out, quill.bundle));
		// The two siblings hold a generation mid-assembly and the one it replaced. Both
		// are gone by the time a build resolves, so a repack loop does not grow a disk.
		await expect(access(`${out}.stage`)).rejects.toThrow();
		await expect(access(`${out}.prev`)).rejects.toThrow();
	});

	it('a failed build leaves the last good generation serving', async () => {
		// A quiver mid-edit is invalid as often as not, and the loop that repacks on
		// every save is exactly where that lands.
		const src = await fresh();
		const out = await fresh();
		await seedSourceQuiver(src, { quills: [{ name: 'memo', version: '1.0.0' }] });
		await buildQuiver(src, out);
		const good = await indexText(out);

		await writeFile(join(src, 'Quiver.yaml'), 'name: [unclosed');
		await expect(buildQuiver(src, out)).rejects.toThrow();
		expect(await indexText(out)).toBe(good);

		await writeFile(join(src, 'Quiver.yaml'), 'name: recovered\n');
		await buildQuiver(src, out);
		expect(await indexText(out)).not.toBe(good);
	});
});

describe('buildQuiver — outDir guard', () => {
	// The build clears outDir first, so these are the paths where a typo would
	// delete the caller. Each asserts the source survives: the guard has to fire
	// before the rm, not after.

	it('refuses an outDir equal to the source quiver', async () => {
		const src = await fresh();
		await seedSourceQuiver(src, { quills: [{ name: 'memo', version: '1.0.0' }] });

		await expect(buildQuiver(src, src)).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error' })
		);
		await access(join(src, 'Quiver.yaml'));
	});

	it('refuses an outDir that is an ancestor of the source quiver', async () => {
		const parent = await fresh();
		const src = join(parent, 'quiver');
		await seedSourceQuiver(src, { quills: [{ name: 'memo', version: '1.0.0' }] });

		await expect(buildQuiver(src, parent)).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error' })
		);
		await access(join(src, 'Quiver.yaml'));
	});

	it('refuses an outDir that is the working directory', async () => {
		// A source outside the cwd, so only the cwd rule can fire.
		const src = await fresh();
		await seedSourceQuiver(src, { quills: [{ name: 'memo', version: '1.0.0' }] });

		await expect(buildQuiver(src, '.')).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error' })
		);
		await access(join(process.cwd(), 'package.json'));
	});

	it('allows an outDir nested inside the source quiver', async () => {
		const src = await fresh();
		await seedSourceQuiver(src, { quills: [{ name: 'memo', version: '1.0.0' }] });

		await buildQuiver(src, join(src, 'dist'));
		await access(join(src, 'dist', 'quiver.json'));
	});
});

describe('buildQuiver — every name but the index carries the digest of its own bytes', () => {
	// What makes a name safe to cache forever: a changed byte is a changed name.

	it('a bundle is named for its quill and the SHA-256 of its bytes', async () => {
		const src = await fresh();
		const out = await fresh();

		await seedSourceQuiver(src, {
			quills: [
				{
					name: 'memo',
					version: '1.0.0',
					fonts: [{ path: 'fonts/body.ttf', content: font(1, 2, 3, 4) }]
				}
			]
		});
		await buildQuiver(src, out);

		const { quills } = (await indexOf(out)) as { quills: Array<{ bundle: string }> };
		const digestOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

		const [entry] = quills;
		const bytes = await readFile(join(out, entry!.bundle));
		expect(entry!.bundle).toBe(`memo@1.0.0.${digestOf(bytes).slice(0, 32)}.quill`);
	});
});

describe('buildQuiver — what it writes, a loader reads', () => {
	// A quill directory that is not a quill name is refused at the scan, before a bundle
	// takes its name: a bundle filename the loader refuses fails the whole artifact,
	// every healthy quill in it included.

	it('refuses a source quill that is not a quill name, and writes nothing', async () => {
		const src = await fresh();
		const out = await fresh();

		await seedSourceQuiver(src, {
			quills: [
				{ name: 'memo', version: '1.0.0' },
				{ name: 'my quill', version: '1.0.0' }
			]
		});

		await expect(buildQuiver(src, out)).rejects.toThrow(/directory "my quill"/);
		await expect(access(out)).rejects.toThrow();
	});
});

describe('buildQuiver — the draft floor', () => {
	/** `<name>@<version>` for every quill `quiver.json` carries. */
	async function refsOf(out: string): Promise<string[]> {
		const quills = (await indexOf(out))['quills'] as Array<{ name: string; version: string }>;
		return quills.map((q) => `${q.name}@${q.version}`).sort();
	}

	it('leaves versions below 0.1.0 out of quiver.json, and packs them under { drafts: true }', async () => {
		// `0.1.0` itself is the lowest published version, and a quill whose every version
		// is a draft leaves the catalog whole.
		const src = await fresh();
		await seedSourceQuiver(src, {
			quills: [
				{ name: 'draft_only', version: '0.0.1' },
				{ name: 'floor', version: '0.1.0' },
				{ name: 'memo', version: '0.0.9' },
				{ name: 'memo', version: '1.0.0' }
			]
		});

		const out = await fresh();
		await buildQuiver(src, out);
		expect(await refsOf(out)).toEqual(['floor@0.1.0', 'memo@1.0.0']);

		const drafts = await fresh();
		await buildQuiver(src, drafts, { drafts: true });
		expect(await refsOf(drafts)).toEqual([
			'draft_only@0.0.1',
			'floor@0.1.0',
			'memo@0.0.9',
			'memo@1.0.0'
		]);
	});

	it('builds an empty catalog and no bundle when every quill is a draft', async () => {
		// A quiver whose quills are all under the floor is a valid quiver that publishes
		// nothing. An unreferenced bundle beside quiver.json would still be a draft served
		// off the artifact's own origin.
		const src = await fresh();
		const out = await fresh();
		await seedSourceQuiver(src, { quills: [{ name: 'memo', version: '0.0.1' }] });

		await buildQuiver(src, out);

		expect(await refsOf(out)).toEqual([]);
		expect((await readdir(out)).filter((n) => n.endsWith('.quill'))).toEqual([]);
	});
});
