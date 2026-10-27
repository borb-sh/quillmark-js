import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, Engine } from '@quillmark/wasm';
import { FAMILIES, loadSuite } from '../node.js';
import { loadSuite as fetchSuite } from '../index.js';

const core = await init();

interface Manifest {
	families: {
		name: string;
		faces: { weight: number; style: string; file: string; sha256: string }[];
	}[];
}
const manifest: Manifest = JSON.parse(
	await readFile(new URL('../../manifest.json', import.meta.url), 'utf8')
);
const faces = manifest.families.flatMap((f) =>
	f.faces.map((face) => ({ family: f.name, ...face }))
);

const SHOWCASE = fileURLToPath(
	new URL('../../../../fixtures/quills/showcase/1.0.0', import.meta.url)
);

async function treeOf(root: string): Promise<Map<string, Uint8Array>> {
	const tree = new Map<string, Uint8Array>();
	async function walk(dir: string): Promise<void> {
		for (const name of await readdir(dir)) {
			const at = join(dir, name);
			if ((await stat(at)).isDirectory()) await walk(at);
			else tree.set(relative(root, at), new Uint8Array(await readFile(at)));
		}
	}
	await walk(root);
	return tree;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('loadSuite (node)', () => {
	it("answers every face's file in the manifest's order", async () => {
		const files = await loadSuite();
		expect(files.map(sha256)).toEqual(faces.map((f) => f.sha256));
	});

	it('names the families the manifest lists', () => {
		expect([...FAMILIES]).toEqual(manifest.families.map((f) => f.name));
	});
});

describe('loadSuite (browser)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('fetches each file beside the module, as the node entry reads it', async () => {
		vi.stubGlobal('fetch', async (url: URL) => new Response(await readFile(url)));
		expect((await fetchSuite()).map(sha256)).toEqual((await loadSuite()).map(sha256));
	});

	it('rejects naming the file that would not load', async () => {
		vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }));
		await expect(fetchSuite()).rejects.toThrow(/\.ttf answered 404/);
	});
});

const quill = core.Quill.fromTree(await treeOf(SHOWCASE));

describe('the engine reads the suite as the manifest states it', () => {
	it('lists each face under its family, weight and style', async () => {
		const engine = new Engine({ fonts: await loadSuite() });
		const listed = await engine.fontFaces(quill);
		expect(listed.map(({ family, weight, style }) => ({ family, weight, style }))).toEqual(
			faces.map(({ family, weight, style }) => ({ family, weight, style }))
		);
	});

	it('sets a run in every family, where an engine without the suite falls back', async () => {
		const runs = FAMILIES.map((f) => `<qm-span family="${f}">${f}</qm-span>`).join(' ');
		const doc = quill.parse(`~~~\n$quill: showcase\n$kind: main\ntitle: Fonts\n~~~\n\n${runs}\n`);
		const unknown = async (engine: Engine): Promise<number> =>
			(await engine.render(quill, doc, { format: 'pdf' })).warnings.filter(
				(w) => w.code === 'typst::unknown_font_family'
			).length;
		try {
			expect(await unknown(new Engine({ fonts: await loadSuite() }))).toBe(0);
			expect(await unknown(new Engine())).toBe(FAMILIES.length);
		} finally {
			doc.free();
		}
	});
});
