import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, rm, writeFile, readFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { buildQuiver } from '../build.js';
import { unpackFiles } from '../zip.js';
import { FORMAT } from '../format.js';

const SAMPLE_FIXTURE = new URL('./fixtures/sample-quiver', import.meta.url).pathname;

// ─── Helpers ────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

afterEach(async () => {
	for (const d of tmpDirs.splice(0)) await rm(d, { recursive: true, force: true });
});

/** A fresh directory path, removed after the test. */
function tempDir(): string {
	const dir = join(tmpdir(), `quiver-pack-test-${randomUUID()}`);
	tmpDirs.push(dir);
	return dir;
}

/** Where a test writes its artifact. */
const artifactIn = (dir: string): string => join(dir, 'quiver.qv');

/**
 * Build a minimal Source Quiver programmatically.
 * If `fonts` is provided for a quill entry, those files are written as font
 * bytes (same content for dedup testing).
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
		await mkdir(join(dir, 'fonts'), { recursive: true });
		await writeFile(join(dir, 'Quill.yaml'), `name: ${q.name}\n`);
		await writeFile(join(dir, 'template.typ'), `// ${q.name} ${q.version}\n`);
		for (const font of q.fonts ?? []) await writeFile(join(dir, font.path), font.content);
	}
}

/** Every entry the artifact holds, inflated. */
async function contentsOf(file: string): Promise<Record<string, Uint8Array>> {
	return unpackFiles(await readFile(file)).files;
}

async function manifestOf(file: string): Promise<Record<string, unknown>> {
	const bytes = (await contentsOf(file))['quiver.json']!;
	return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

/** `<name>@<version>` for every quill the manifest carries. */
async function refsOf(file: string): Promise<string[]> {
	const quills = (await manifestOf(file))['quills'] as Array<{ name: string; version: string }>;
	return quills.map((q) => `${q.name}@${q.version}`).sort();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildQuiver — one file', () => {
	it('stamps the format it is packed in', async () => {
		// The one thing a reader of any age reads first, so a file from a newer packer is
		// refused by name rather than misread field by field.
		const out = artifactIn(tempDir());
		await buildQuiver(SAMPLE_FIXTURE, out);

		expect((await manifestOf(out))['format']).toBe(FORMAT);
	});

	it('writes the one file and nothing beside it', async () => {
		const dir = tempDir();
		await buildQuiver(SAMPLE_FIXTURE, artifactIn(dir));

		expect(await readdir(dir)).toEqual(['quiver.qv']);
	});

	it("lays each quill's files under quills/<name>/<version>/", async () => {
		const out = artifactIn(tempDir());
		await buildQuiver(SAMPLE_FIXTURE, out);

		const names = Object.keys(await contentsOf(out));
		expect(names).toContain('quills/memo/1.0.0/Quill.yaml');
		expect(names).toContain('quills/memo/1.1.0/Quill.yaml');
		expect(names).toContain('quills/resume/2.0.0/Quill.yaml');
	});

	it("carries Quiver.yaml's description", async () => {
		const out = artifactIn(tempDir());
		await buildQuiver(SAMPLE_FIXTURE, out);

		expect((await manifestOf(out))['description']).toBe('A sample quiver for testing');
	});

	it('omits the description a Quiver.yaml does not carry', async () => {
		const src = tempDir();
		const out = artifactIn(tempDir());
		await seedSourceQuiver(src, { quills: [{ name: 'quillA', version: '1.0.0' }] });
		await buildQuiver(src, out);

		expect(await manifestOf(out)).not.toHaveProperty('description');
	});
});

describe('buildQuiver — fonts are stored once, by hash', () => {
	const shared = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
	const sha = createHash('sha256').update(shared).digest('hex');

	it('stores a font two quills share exactly once', async () => {
		const src = tempDir();
		const out = artifactIn(tempDir());
		await seedSourceQuiver(src, {
			quills: [
				{ name: 'quillA', version: '1.0.0', fonts: [{ path: 'fonts/a.ttf', content: shared }] },
				{ name: 'quillB', version: '1.0.0', fonts: [{ path: 'fonts/b.otf', content: shared }] }
			]
		});

		await buildQuiver(src, out);

		const names = Object.keys(await contentsOf(out));
		expect(names.filter((n) => n.startsWith('fonts/'))).toEqual([`fonts/${sha}`]);
		expect(names.filter((n) => /\.(ttf|otf)$/.test(n))).toEqual([]);
	});

	it("maps each quill's font paths to the full hash", async () => {
		const src = tempDir();
		const out = artifactIn(tempDir());
		await seedSourceQuiver(src, {
			quills: [
				{ name: 'quillA', version: '1.0.0', fonts: [{ path: 'fonts/a.ttf', content: shared }] }
			]
		});

		await buildQuiver(src, out);

		const [quill] = (await manifestOf(out))['quills'] as Array<{ fonts: Record<string, string> }>;
		expect(quill!.fonts).toEqual({ 'fonts/a.ttf': sha });
	});
});

describe('buildQuiver — determinism', () => {
	it('packing the same source twice yields identical bytes', async () => {
		const a = artifactIn(tempDir());
		const b = artifactIn(tempDir());
		await buildQuiver(SAMPLE_FIXTURE, a);
		await buildQuiver(SAMPLE_FIXTURE, b);

		expect(await readFile(a)).toEqual(await readFile(b));
	});
});

describe('buildQuiver — the file is replaced whole', () => {
	it('replaces the previous artifact', async () => {
		const src = tempDir();
		const out = artifactIn(tempDir());
		await seedSourceQuiver(src, { quills: [{ name: 'memo', version: '1.0.0' }] });
		await buildQuiver(src, out);
		await seedSourceQuiver(src, { quills: [{ name: 'letter', version: '1.0.0' }] });
		await buildQuiver(src, out);

		expect(await refsOf(out)).toEqual(['letter@1.0.0', 'memo@1.0.0']);
	});

	it('a failed build leaves the previous artifact in place, and no temp file', async () => {
		const src = tempDir();
		const dir = tempDir();
		const out = artifactIn(dir);
		await seedSourceQuiver(src, { quills: [{ name: 'memo', version: '1.0.0' }] });
		await buildQuiver(src, out);
		const before = await readFile(out);

		await writeFile(join(src, 'Quiver.yaml'), 'not: [valid');
		await expect(buildQuiver(src, out)).rejects.toThrow();

		expect(await readFile(out)).toEqual(before);
		expect(await readdir(dir)).toEqual(['quiver.qv']);
	});

	it('throws transport_error where the file cannot land, and leaves no temp file', async () => {
		// A directory at the path: the rename refuses it whatever the uid.
		const dir = tempDir();
		const out = artifactIn(dir);
		await mkdir(join(out, 'occupied'), { recursive: true });

		await expect(buildQuiver(SAMPLE_FIXTURE, out)).rejects.toThrow(
			expect.objectContaining({ code: 'transport_error' })
		);
		expect(await readdir(dir)).toEqual(['quiver.qv']);
	});
});

describe('buildQuiver — what it writes, a reader reads', () => {
	it('refuses a source quill a ref cannot spell, and writes nothing', async () => {
		const src = tempDir();
		const out = artifactIn(tempDir());
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
	it('leaves versions below 0.1.0 out', async () => {
		const src = tempDir();
		const out = artifactIn(tempDir());
		await seedSourceQuiver(src, {
			quills: [
				{ name: 'memo', version: '0.0.9' },
				{ name: 'memo', version: '1.0.0' }
			]
		});

		await buildQuiver(src, out);

		expect(await refsOf(out)).toEqual(['memo@1.0.0']);
		// The document is the catalog, but files left beside it would still be a draft
		// served off the artifact's own origin.
		expect(Object.keys(await contentsOf(out)).some((n) => n.includes('0.0.9'))).toBe(false);
	});

	it('drops a quill whose every version is a draft', async () => {
		const src = tempDir();
		const out = artifactIn(tempDir());
		await seedSourceQuiver(src, {
			quills: [
				{ name: 'draft-only', version: '0.0.1' },
				{ name: 'memo', version: '1.0.0' }
			]
		});

		await buildQuiver(src, out);

		expect(await refsOf(out)).toEqual(['memo@1.0.0']);
	});

	it('keeps 0.1.0 itself — the floor is the lowest published version', async () => {
		const src = tempDir();
		const out = artifactIn(tempDir());
		await seedSourceQuiver(src, { quills: [{ name: 'memo', version: '0.1.0' }] });

		await buildQuiver(src, out);

		expect(await refsOf(out)).toEqual(['memo@0.1.0']);
	});

	it('packs drafts under { drafts: true }', async () => {
		const src = tempDir();
		const out = artifactIn(tempDir());
		await seedSourceQuiver(src, {
			quills: [
				{ name: 'memo', version: '0.0.9' },
				{ name: 'memo', version: '1.0.0' }
			]
		});

		await buildQuiver(src, out, { drafts: true });

		expect(await refsOf(out)).toEqual(['memo@0.0.9', 'memo@1.0.0']);
	});

	it('writes an empty catalog rather than throwing when every quill is a draft', async () => {
		// A quiver whose quills are all under the floor is a valid quiver that publishes
		// nothing.
		const src = tempDir();
		const out = artifactIn(tempDir());
		await seedSourceQuiver(src, { quills: [{ name: 'memo', version: '0.0.1' }] });

		await buildQuiver(src, out);

		expect(await refsOf(out)).toEqual([]);
	});
});
