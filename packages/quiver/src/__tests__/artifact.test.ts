/**
 * The reader, over artifacts minted by hand: what `build` writes is `build.test.ts`'s,
 * and a hand-minted file is how the reader meets what `build` never writes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { zipSync } from 'fflate';
import { Quiver } from '../index.js';
import { FORMAT } from '../format.js';
import { mockQuillFromTree } from './helpers/mock-engine.js';
import { declaring } from './helpers/zip.js';

const enc = new TextEncoder();
const MIB = 1024 * 1024;

const FONT = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
const FONT_SHA = 'a'.repeat(64);

type Manifest = Record<string, unknown>;

const MANIFEST: Manifest = {
	format: FORMAT,
	name: 'sample',
	description: 'A sample quiver',
	quills: [
		{ name: 'memo', version: '1.0.0', fonts: { 'fonts/body.ttf': FONT_SHA } },
		{ name: 'memo', version: '1.1.0', fonts: {} },
		{ name: 'resume', version: '2.0.0', fonts: {} }
	]
};

const FILES: Record<string, Uint8Array> = {
	'quills/memo/1.0.0/Quill.yaml': enc.encode('name: memo\n'),
	'quills/memo/1.0.0/assets/logo.png': new Uint8Array([1, 2, 3]),
	'quills/memo/1.1.0/Quill.yaml': enc.encode('name: memo\nversion: 1.1\n'),
	'quills/resume/2.0.0/Quill.yaml': enc.encode('name: resume\n'),
	[`fonts/${FONT_SHA}`]: FONT
};

/** An artifact: `manifest` as `quiver.json` beside `files`. */
function artifact(manifest: Manifest = MANIFEST, files = FILES): Uint8Array {
	return zipSync({ 'quiver.json': enc.encode(JSON.stringify(manifest)), ...files });
}

const refused = (pattern: RegExp) =>
	expect.objectContaining({ code: 'quiver_invalid', message: expect.stringMatching(pattern) });

let stub: ReturnType<typeof mockQuillFromTree> | undefined;
afterEach(() => {
	stub?.restore();
	stub = undefined;
});

/** The tree `getQuill` hands `Quill.fromTree` for `ref`. */
async function treeOf(quiver: Quiver, ref: string): Promise<Map<string, Uint8Array>> {
	stub ??= mockQuillFromTree();
	await quiver.getQuill(ref);
	return stub.calls.at(-1)!;
}

describe('Quiver.fromBytes — the catalog', () => {
	it('reads the name, the description and every quill', async () => {
		const quiver = await Quiver.fromBytes(artifact());
		expect(quiver.name).toBe('sample');
		expect(quiver.description).toBe('A sample quiver');
		expect(quiver.quillNames()).toEqual(['memo', 'resume']);
		expect(quiver.versionsOf('memo')).toEqual(['1.1.0', '1.0.0']);
	});

	it('a document without a description carries undefined', async () => {
		const { description: _, ...bare } = MANIFEST;
		expect((await Quiver.fromBytes(artifact(bare))).description).toBeUndefined();
	});
});

describe('Quiver.fromBytes — a quill comes back whole', () => {
	it("hands Quill.fromTree the quill's files at their own paths", async () => {
		const tree = await treeOf(await Quiver.fromBytes(artifact()), 'memo@1.0.0');
		expect(tree.get('Quill.yaml')).toEqual(FILES['quills/memo/1.0.0/Quill.yaml']);
		expect(tree.get('assets/logo.png')).toEqual(new Uint8Array([1, 2, 3]));
	});

	it('puts each font back at the path the quill names it by', async () => {
		const tree = await treeOf(await Quiver.fromBytes(artifact()), 'memo@1.0.0');
		expect(tree.get('fonts/body.ttf')).toEqual(FONT);
	});

	it("carries no other quill's files", async () => {
		const tree = await treeOf(await Quiver.fromBytes(artifact()), 'memo@1.1.0');
		expect([...tree.keys()]).toEqual(['Quill.yaml']);
	});

	it("keeps its own copy, so the caller's buffer stays the caller's", async () => {
		const bytes = artifact();
		const quiver = await Quiver.fromBytes(bytes);
		bytes.fill(0);
		expect((await treeOf(quiver, 'resume')).has('Quill.yaml')).toBe(true);
	});
});

describe('Quiver.fromBytes — what is not an artifact', () => {
	it('names an HTML page as the fallback a host served in its place', async () => {
		const page = enc.encode('<!doctype html><html><body>studio</body></html>');
		await expect(Quiver.fromBytes(page)).rejects.toThrow(refused(/HTML page.*SPA fallback/));
	});

	it('refuses bytes that are not a zip', async () => {
		await expect(Quiver.fromBytes(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(
			refused(/not a zip/)
		);
	});

	it('refuses a zip with no quiver.json', async () => {
		await expect(Quiver.fromBytes(zipSync(FILES))).rejects.toThrow(refused(/no quiver\.json/));
	});

	it('refuses a quiver.json that is not JSON', async () => {
		const bytes = zipSync({ 'quiver.json': enc.encode('not json') });
		await expect(Quiver.fromBytes(bytes)).rejects.toThrow(refused(/not JSON/));
	});
});

describe('Quiver.fromBytes — one version, read first', () => {
	it('refuses a format above its own, naming the upgrade', async () => {
		await expect(Quiver.fromBytes(artifact({ ...MANIFEST, format: FORMAT + 1 }))).rejects.toThrow(
			refused(/format 2.*Upgrade @quillmark\/quiver/)
		);
	});

	it('names the upgrade before any field it does not know', async () => {
		// A newer format is the ordinary reason for an unknown field, so the version
		// answers first rather than the field.
		const newer = { ...MANIFEST, format: FORMAT + 1, signature: 'x' };
		await expect(Quiver.fromBytes(artifact(newer))).rejects.toThrow(refused(/Upgrade/));
	});

	it.each([[0], [1.5], ['1'], [undefined]])('refuses a format of %j', async (format) => {
		await expect(Quiver.fromBytes(artifact({ ...MANIFEST, format }))).rejects.toThrow(
			refused(/"format" must be a positive integer/)
		);
	});
});

describe('Quiver.fromBytes — the document is closed', () => {
	it('refuses an unknown top-level field', async () => {
		await expect(Quiver.fromBytes(artifact({ ...MANIFEST, extra: 1 }))).rejects.toThrow(
			refused(/unknown field "extra"/)
		);
	});

	it('refuses an unknown field on a quill', async () => {
		const quills = [{ name: 'resume', version: '2.0.0', fonts: {}, bundle: 'x.zip' }];
		await expect(Quiver.fromBytes(artifact({ ...MANIFEST, quills }))).rejects.toThrow(
			refused(/unknown field "bundle"/)
		);
	});

	it('refuses a description that is not a string', async () => {
		await expect(Quiver.fromBytes(artifact({ ...MANIFEST, description: 3 }))).rejects.toThrow(
			refused(/"description" must be a string/)
		);
	});

	it('refuses a quill named outside the ref charset', async () => {
		const quills = [{ name: 'my quill', version: '1.0.0', fonts: {} }];
		await expect(Quiver.fromBytes(artifact({ ...MANIFEST, quills }, {}))).rejects.toThrow(
			refused(/not a name a ref can spell/)
		);
	});

	it('refuses a version that is not canonical semver', async () => {
		const quills = [{ name: 'memo', version: '1.0', fonts: {} }];
		await expect(Quiver.fromBytes(artifact({ ...MANIFEST, quills }, {}))).rejects.toThrow(
			refused(/canonical semver/)
		);
	});

	it('refuses a font hash that is not a full SHA-256', async () => {
		const quills = [{ name: 'memo', version: '1.0.0', fonts: { 'a.ttf': 'abc' } }];
		await expect(Quiver.fromBytes(artifact({ ...MANIFEST, quills }, {}))).rejects.toThrow(
			refused(/not a SHA-256/)
		);
	});

	it('refuses a quill listed twice', async () => {
		const quills = [
			{ name: 'memo', version: '1.0.0', fonts: {} },
			{ name: 'memo', version: '1.0.0', fonts: {} }
		];
		await expect(Quiver.fromBytes(artifact({ ...MANIFEST, quills }, {}))).rejects.toThrow(
			refused(/"memo@1\.0\.0" twice/)
		);
	});
});

describe('Quiver.fromBytes — the layout is checked whole', () => {
	it('refuses a file the document does not account for', async () => {
		const files = { ...FILES, 'quills/ghost/1.0.0/Quill.yaml': enc.encode('name: ghost\n') };
		await expect(Quiver.fromBytes(artifact(MANIFEST, files))).rejects.toThrow(
			refused(/"quills\/ghost\/1\.0\.0\/Quill\.yaml"/)
		);
	});

	it('refuses a font the document names and the artifact does not hold', async () => {
		const { [`fonts/${FONT_SHA}`]: _, ...files } = FILES;
		await expect(Quiver.fromBytes(artifact(MANIFEST, files))).rejects.toThrow(
			refused(/"fonts\/body\.ttf".*does not hold/)
		);
	});

	it('spends the budget off the central directory, before inflating anything', async () => {
		// Ten entries declaring 30 MiB apiece, the document included: were anything inflated
		// first, the document would fail to parse before the budget was asked.
		const files = { ...FILES };
		for (let i = 0; i < 4; i++) files[`quills/resume/2.0.0/f${i}`] = enc.encode('x');
		await expect(Quiver.fromBytes(declaring(artifact(MANIFEST, files), 30 * MIB))).rejects.toThrow(
			refused(/unpacks to over/)
		);
	});
});
