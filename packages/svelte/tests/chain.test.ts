// Drive the whole substrate chain end-to-end against the reference quill:
// fixture tree → Quill.fromTree → seedDocument → Engine.open → LiveSession, and
// prove handles free without leaking across repeated cycles. Runs in Node against
// the real Typst backend (no browser, no canvas). Imports the surface through
// `$lib/core` exactly as a consumer does.
import { describe, it, expect } from 'vitest';
import { Engine } from '@quillmark/wasm';
import { init } from '$lib/core';
import { loadFixtureTree } from './helpers/fixtures.js';

const core = await init();

describe('substrate chain', () => {
	it('loads the fixture, seeds a document, opens a session', async () => {
		const tree = loadFixtureTree();
		expect(tree.size).toBeGreaterThan(0);
		expect(tree.has('Quill.yaml')).toBe(true);

		const quill = core.Quill.fromTree(tree);
		expect(quill.metadata.name).toBe('showcase');
		expect(quill.backendId).toBe('typst');
		expect(Object.keys(quill.schema.main.fields).length).toBeGreaterThan(0);
		expect(quill.schema.card_kinds).toHaveProperty('section');

		const doc = quill.seedDocument();
		// Composed from the quill's own metadata; the contract is `name@version`,
		// not the version the fixture happens to sit at.
		expect(doc.quillRef).toBe(`${quill.metadata.name}@${quill.metadata.version}`);

		const engine = new Engine();
		const session = await engine.open(quill, doc);
		// The two quantities a session reports, and the paint the count promises.
		expect(session.pageCount).toBeGreaterThan(0);
		expect(Array.isArray(session.warnings)).toBe(true);
		expect(session.pageSize(0).widthPt).toBeGreaterThan(0);

		session.free();
		doc.free();
		quill.free();
	});

	it('preserves binary fixture bytes (the mark and the fonts arrive as raw bytes)', () => {
		const tree = loadFixtureTree();
		const mark = tree.get('assets/mark.png');
		expect(mark).toBeInstanceOf(Uint8Array);
		// PNG magic number; proves the byte path did not decode/re-encode as text.
		expect(Array.from(mark!.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
	});

	it('opens and frees repeatedly without a handle leak', async () => {
		const tree = loadFixtureTree();
		const quill = core.Quill.fromTree(tree);
		const engine = new Engine();
		// Repeated open/close on one cached quill clone; a leak or use-after-free
		// would surface as a throw or a corrupt compile by the last iteration.
		for (let i = 0; i < 5; i++) {
			const doc = quill.seedDocument();
			const session = await engine.open(quill, doc);
			expect(session.pageCount).toBeGreaterThan(0);
			session.free();
			doc.free();
		}
		quill.free();
	});

	it('runs the same chain over the shipped quill, fonts, seals and all', async () => {
		// The other fixture is a copy of a real quill (fixtures/Quiver.yaml), so this is
		// the chain over a tree nobody here curated: four font families, two seal images
		// and a Typst package of its own.
		const quill = core.Quill.fromTree(loadFixtureTree('usaf_memo'));
		expect(quill.metadata.name).toBe('usaf_memo');
		expect(quill.metadata.version).toBe('0.0.0');

		const doc = quill.seedDocument();
		expect(doc.quillRef).toBe('usaf_memo@0.0.0');

		const session = await new Engine().open(quill, doc);
		expect(session.pageCount).toBeGreaterThan(0);
		expect(session.warnings).toEqual([]);

		session.free();
		doc.free();
		quill.free();
	});
});
