/**
 * Real-engine integration test. Everywhere else in the suite `Quill.fromTree` is
 * stubbed; this file is the only one that materializes a real core `Quill` from a
 * quiver and renders it through a real `Engine`, loading the Typst backend,
 * crossing the WASM-memory seam, and producing artifact bytes.
 *
 * It pins quiver's side of three canonical contracts:
 *   1. a core `Quill` from `getQuill` passes straight to `engine.render` — no
 *      boundary-crossing helper is needed (the Engine hides the seam);
 *   2. the Engine clones the quill, it never consumes it — the same `Quill`
 *      renders a second time;
 *   3. a stored document names its quill: `doc.quillRef` is a ref `getQuill`
 *      accepts, and the per-canonical-ref cache answers it with the one
 *      instance — one materialization per document, however many consumers
 *      resolve.
 *
 * The last block closes the loop the package exists for, against the
 * workspace's reference quill rather than a toy: source layout → `build` → one file →
 * font rehydration → `Quill.fromTree` → `engine.render`. The apps walk the same loop, but only under a human.
 *
 * The Typst backend load makes this the slowest test in the suite (seconds).
 * It is kept in its own file so it stays cheap to skip locally.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, Engine } from '@quillmark/wasm';
import { Quiver, build, fromDir } from '../node.js';

const core = await init();

// Two quills, `memo@1.0.0` and `plain@1.0.0`, both `backend: typst` (see their
// `Quill.yaml`) and both render-complete — a comment-only `template.typ`
// compiles to a valid PDF.
const RENDER_FIXTURE = fileURLToPath(new URL('./fixtures/render-quiver', import.meta.url));

// The workspace's reference quiver: `showcase@1.0.0`, a published-shape quill with a
// Typst package tree, an image asset, and five fonts the build stores once under
// `fonts/`; beside it `usaf_memo@0.0.0`, which a build leaves out as a draft.
const REFERENCE_QUIVER = fileURLToPath(new URL('../../../../fixtures', import.meta.url));

describe('Engine.render against a quiver quill', () => {
	it('renders a fixture quill end-to-end with a real Engine', async () => {
		const quiver = await fromDir(RENDER_FIXTURE);
		const engine = new Engine();

		const quill = await quiver.getQuill('memo@1.0.0');
		// The fixture declares `backend: typst`; the Engine routes on this.
		expect(quill.backendId).toBe('typst');

		const doc = quill.seedDocument();
		try {
			const result = await engine.render(quill, doc);

			expect(result.artifacts.length).toBeGreaterThan(0);
			const [artifact] = result.artifacts;
			expect(artifact.bytes).toBeInstanceOf(Uint8Array);
			expect(artifact.bytes.length).toBeGreaterThan(0);
		} finally {
			doc.free();
		}
	}, 60000);

	it('clones the quill on render — the same handle renders twice', async () => {
		const quiver = await fromDir(RENDER_FIXTURE);
		const engine = new Engine();

		const quill = await quiver.getQuill('memo@1.0.0');
		expect(quill.backendId).toBe('typst');

		// First render.
		const first = quill.seedDocument();
		try {
			const result = await engine.render(quill, first);
			expect(result.artifacts.length).toBeGreaterThan(0);
		} finally {
			first.free();
		}

		// The Engine clones into backend memory and frees the clone — the source
		// `Quill` is untouched, so a second render with the same handle succeeds.
		expect(quill.backendId).toBe('typst');
		const second = quill.seedDocument();
		try {
			const result = await engine.render(quill, second);
			expect(result.artifacts.length).toBeGreaterThan(0);
			expect(result.artifacts[0].bytes.length).toBeGreaterThan(0);
		} finally {
			second.free();
		}
	}, 60000);

	it('resolves the quill from a stored document and renders', async () => {
		const quiver = await fromDir(RENDER_FIXTURE);
		const engine = new Engine();

		// Authoring side: seed against a selector-resolved quill, store the markdown.
		const authored = await quiver.getQuill('memo');
		const seeded = authored.seedDocument();
		const stored = seeded.toMarkdown();
		seeded.free();

		// Loading side: the stored bytes are the only input. The document names its
		// quill, the quiver answers it — the consumer dispatches to no loader of its
		// own.
		const doc = core.Document.fromMarkdown(stored);
		try {
			expect(doc.quillRef).toBe(`${authored.metadata.name}@${authored.metadata.version}`);
			const quill = await quiver.getQuill(doc.quillRef);
			// The per-canonical-ref cache answers with the authoring-side instance:
			// one materialization per document, however many consumers resolve.
			expect(quill).toBe(authored);

			const result = await engine.render(quill, doc);
			expect(result.artifacts.length).toBeGreaterThan(0);
			expect(result.artifacts[0].bytes.length).toBeGreaterThan(0);
		} finally {
			doc.free();
		}
	}, 60000);
});

describe('the reference quill, source → build → read → render', () => {
	// `fromUrl` is a fetch in front of `fromBytes`, so the bytes off disk cover the
	// pipeline without a server.
	let outDir: string;
	const packed = (): Promise<Quiver> => readFile(join(outDir, 'quiver.qv')).then(Quiver.fromBytes);

	beforeAll(async () => {
		outDir = await mkdtemp(join(tmpdir(), 'quiver-reference-'));
		await build(REFERENCE_QUIVER, join(outDir, 'quiver.qv'));
	}, 60000);

	afterAll(async () => {
		await rm(outDir, { recursive: true, force: true });
	});

	it('packs the reference quiver and renders it back out of the artifact', async () => {
		const built = await packed();
		// The source quiver carries two quills and the artifact carries one: `usaf_memo`
		// sits at `0.0.0`, under the draft floor, so a build leaves it out. It is a copy
		// of a shipped quill rather than that release, and the version is what says so —
		// the rule the synthetic fixtures assert (build.test.ts), holding over a real one.
		expect((await fromDir(REFERENCE_QUIVER)).quillNames()).toEqual(['showcase', 'usaf_memo']);
		expect(built.quillNames()).toEqual(['showcase']);
		expect(built.resolve('showcase')).toBe('showcase@1.0.0');

		const quill = await built.getQuill('showcase');
		expect(quill.backendId).toBe('typst');

		// The fonts left the quill's files at build time and came back from `fonts/` on
		// read. Typst substitutes for a missing face rather than failing, so the
		// rehydration is asserted here rather than left to the render.
		const tree = quill.toTree();
		const fonts = [...tree.keys()].filter((p) => /\.(ttf|otf)$/i.test(p));
		expect(fonts.length).toBeGreaterThan(0);
		for (const path of fonts) expect(tree.get(path)!.length).toBeGreaterThan(0);

		const doc = quill.seedDocument();
		try {
			const result = await new Engine().render(quill, doc, { format: 'pdf' });
			expect(result.artifacts.length).toBeGreaterThan(0);
			expect(result.artifacts[0]!.bytes.length).toBeGreaterThan(0);
		} finally {
			doc.free();
		}
	}, 120000);

	it('round-trips the tree byte for byte', async () => {
		// Zip, store the fonts by hash, read, rehydrate: the quill that comes back out is the
		// quill that went in. A build that drops, truncates, or reorders a file
		// shows up here rather than as a typesetting error downstream.
		const source = await (await fromDir(REFERENCE_QUIVER)).getQuill('showcase@1.0.0');
		const built = await (await packed()).getQuill('showcase@1.0.0');

		const before = source.toTree();
		const after = built.toTree();
		expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
		for (const [path, bytes] of before) expect(after.get(path)).toEqual(bytes);
	}, 120000);
});
