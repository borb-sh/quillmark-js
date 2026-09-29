// The shared pixel<->PDF-pt transform (src/lib/preview/geometry.ts), tested both
// as pure math (synthetic rects, exact round-trip) and against a real compiled
// session (every fieldBoxes rect -> % -> a simulated click inside it ->
// positionAt), proving the forward transform and its inverse never drift
// apart. No canvas needed; geometry and positionAt are session
// queries, so this runs in Node against the real Typst backend.
//
// geometry.ts is reached directly (not through the `$lib/preview` barrel, which
// only re-exports the public `createPreview`/`Preview` surface per PREVIEW.md;
// the transform is an internal correctness seam, not part of that surface).
import { describe, it, expect, beforeAll, afterAll, onTestFinished } from 'vitest';
import {
	Engine,
	type ContentHit,
	type Document,
	type FieldRegion,
	type LiveSession,
	type PageSize
} from '@quillmark/wasm';
import { boxesForField, rectToPercent, clickToPdfPt, pxToPt } from '$lib/preview/geometry.js';
import { quill, example, type FixtureName } from '../helpers/fixtures.js';

const engine = new Engine();

/** A session over a fixture's example, `edit`ed first, freed when the test ends. */
async function open(edit?: (doc: Document) => void, name?: FixtureName): Promise<LiveSession> {
	const doc = example(name);
	edit?.(doc);
	const session = await engine.open(quill(name), doc);
	onTestFinished(() => {
		session.free();
		doc.free();
	});
	return session;
}

// The unedited showcase example, which the tests that only read it share.
let showcaseDoc: Document;
let showcase: LiveSession;
beforeAll(async () => {
	showcaseDoc = example();
	showcase = await engine.open(quill(), showcaseDoc);
});
afterAll(() => {
	showcase.free();
	showcaseDoc.free();
});

describe('geometry: synthetic round-trip', () => {
	const pageSize: PageSize = { widthPt: 612, heightPt: 792 }; // US Letter

	it('rectToPercent places a known rect at the expected %', () => {
		// A 100x50pt box with its bottom-left corner at (50,700): near the
		// top-left of the page (y is bottom-left origin, so a high y sits near the top).
		const rect: [number, number, number, number] = [50, 700, 150, 750];
		const pct = rectToPercent(rect, pageSize);
		expect(pct.left).toBeCloseTo((50 / 612) * 100, 10);
		expect(pct.top).toBeCloseTo((1 - 750 / 792) * 100, 10);
		expect(pct.width).toBeCloseTo((100 / 612) * 100, 10);
		expect(pct.height).toBeCloseTo((50 / 792) * 100, 10);
	});

	it('clickToPdfPt is the exact inverse of rectToPercent, across the page and at any CSS size', () => {
		// Model a point as a zero-size rect so both directions compose through the
		// same forward transform the scroll uses; not a hand-derived inverse.
		const points: Array<[number, number]> = [
			[0, 0], // bottom-left corner
			[pageSize.widthPt, pageSize.heightPt], // top-right corner
			[pageSize.widthPt / 2, pageSize.heightPt / 2], // center
			[123.4, 567.8] // an arbitrary interior point
		];
		for (const cssW of [300, 612, 3000]) {
			const cssH = (cssW / pageSize.widthPt) * pageSize.heightPt;
			for (const [x, y] of points) {
				const pct = rectToPercent([x, y, x, y], pageSize);
				const px = (pct.left / 100) * cssW;
				const py = (pct.top / 100) * cssH;
				const pt = clickToPdfPt(px, py, cssW, cssH, pageSize);
				expect(pt.x).toBeCloseTo(x, 6);
				expect(pt.y).toBeCloseTo(y, 6);
			}
		}
	});

	it('pxToPt measures a length in the space clickToPdfPt lands a point', () => {
		// A length is the distance between two points, so the length transform and the
		// point transform have to agree on it wherever the page is drawn. This is what
		// makes the click slack a distance in the space the queries rank distances in.
		for (const cssW of [300, 612, 1500]) {
			const cssH = (cssW / pageSize.widthPt) * pageSize.heightPt;
			const span = 17;
			const near = clickToPdfPt(100, 0, cssW, cssH, pageSize);
			const far = clickToPdfPt(100 + span, 0, cssW, cssH, pageSize);
			expect(pxToPt(span, cssW, pageSize)).toBeCloseTo(far.x - near.x, 6);
		}
	});
});

describe('geometry: against a real compiled session (showcase)', () => {
	it('every fieldBoxes rect round-trips through positionAt back to its own field, somewhere in the box', () => {
		// Not the box's geometric center: fieldBoxes unions same-page segments into
		// one rect (PREVIEW.md), so a field whose content is two non-adjacent lines
		// (e.g. main.body: two disjoint line segments with a real vertical gap between
		// them) has a bounding box whose center falls in that gap, off any ink.
		const fieldNames = new Set(showcase.regions().map((r) => r.field));
		expect(fieldNames.size).toBeGreaterThan(0);
		const fractions = [0.1, 0.3, 0.5, 0.7, 0.9];
		let checked = 0;
		for (const field of fieldNames) {
			for (const box of showcase.fieldBoxes(field)) {
				const pageSize = showcase.pageSize(box.page);
				const pct = rectToPercent(box.rect, pageSize);
				const cssW = 612;
				const cssH = (cssW / pageSize.widthPt) * pageSize.heightPt;
				let hitOwnField = false;
				for (const fy of fractions) {
					for (const fx of fractions) {
						const px = ((pct.left + fx * pct.width) / 100) * cssW;
						const py = ((pct.top + fy * pct.height) / 100) * cssH;
						const pt = clickToPdfPt(px, py, cssW, cssH, pageSize);
						const hit = showcase.positionAt(box.page, pt.x, pt.y);
						if (hit?.field === field) hitOwnField = true;
					}
				}
				expect(hitOwnField, `field ${field} page ${box.page}: no grid sample hit its own ink`).toBe(
					true
				);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(0);
	});

	// What the click slack stands on, and the one thing about it no diff shows: the
	// session ranks placements by distance rather than growing each box, so a slack only
	// ever fills a miss. If a pin traded that ranking for grown boxes, every click this
	// pane places today could move, and nothing else here would notice.
	//
	// Held at the wide end of the range a slack converts into, with the fill asserted
	// beside it: a tolerance that changed nothing would satisfy the first assertion by
	// doing nothing.
	it('a slack only ever fills a miss: every exact hit answers the same under one', () => {
		const pageSize = showcase.pageSize(0);
		const step = 12;
		const tolPt = 8;
		const hits: Array<[number, number, ContentHit]> = [];
		const misses: Array<[number, number]> = [];
		for (let y = step / 2; y < pageSize.heightPt; y += step) {
			for (let x = step / 2; x < pageSize.widthPt; x += step) {
				const exact = showcase.positionAt(0, x, y);
				if (exact) hits.push([x, y, exact]);
				else misses.push([x, y]);
			}
		}
		expect(hits.length).toBeGreaterThan(0);

		for (const [x, y, exact] of hits) {
			expect(showcase.positionAt(0, x, y, tolPt), `(${x}, ${y})`).toEqual(exact);
		}
		const sampled = misses.filter((_, i) => i % 8 === 0);
		expect(sampled.filter(([x, y]) => showcase.positionAt(0, x, y, tolPt)).length).toBeGreaterThan(
			0
		);
	});

	it('answers fieldAt wherever positionAt answers, at that field or the one holding it', () => {
		// The ladder's premise: `positionAt` over span-tracked content, `fieldAt` over
		// every placement, the second a superset of the first. If it ever stopped being
		// one, a click on content would fall through to a rung that named nothing. Ink a
		// plate composes around an element meets that element at a shared edge, where the
		// placement is the container and the span is the element, so the coarser answer
		// is a prefix of the finer on a path boundary. The ladder reads `positionAt`
		// first, so the finer one is what a click lands on.
		let placementOnly = 0;
		for (const region of showcase.regions()) {
			const [x0, y0, x1, y1] = region.rect;
			for (let i = 0; i <= 4; i++) {
				for (let j = 0; j <= 4; j++) {
					const x = x0 + ((x1 - x0) * i) / 4;
					const y = y0 + ((y1 - y0) * j) / 4;
					const hit = showcase.positionAt(region.page, x, y);
					const field = showcase.fieldAt(region.page, x, y);
					if (hit) {
						const holds = hit.field.startsWith(`${field}.`) || hit.field.startsWith(`${field}[`);
						expect(field === hit.field || holds, `${field} for a hit on ${hit.field}`).toBe(true);
					} else if (field) placementOnly++;
				}
			}
		}
		// …and the second rung is not dead weight: the span-less addresses answer it
		// and nothing else, so without it a click on them resolves to no field.
		expect(placementOnly).toBeGreaterThan(0);
	});
});

describe('boxesForField', () => {
	const region = (field: string, x: number): FieldRegion =>
		({ field, page: 0, rect: [x, 10, x + 100, 30] }) as FieldRegion;

	it("takes an address's own rects together with the ones under it", () => {
		// A container is placed at both: the array's own region is the ink the plate
		// composed around its elements, and an element's is what it carries itself.
		const regions = [region('main.authors', 0), region('main.authors[0]', 200)];
		expect(boxesForField('main.authors', [], () => regions)).toEqual(regions);
		expect(boxesForField('main.authors[0]', [], () => regions)).toEqual([regions[1]]);
	});

	it('reads both boundary characters, and neither as a bare prefix', () => {
		// An element is bracketed (`keywords`, a declared array) and a nested key dotted
		// (`contact`, a declared object), so the descendant rung needs both openers.
		// A name that merely starts with one is not under it.
		const regions = [
			region('main.keywords[0]', 0),
			region('main.keywords_note', 100),
			region('main.contact.city', 200),
			region('main.contact_note', 300)
		];
		expect(boxesForField('main.keywords', [], () => regions)).toEqual([regions[0]]);
		expect(boxesForField('main.contact', [], () => regions)).toEqual([regions[2]]);
	});

	it('prefers the union the compile did make', () => {
		const boxes = [region('main.body', 0)];
		expect(boxesForField('main.body', boxes, () => [region('main.body[9]', 200)])).toBe(boxes);
	});
});

describe('geometry: the addresses a compile serves (showcase)', () => {
	it('gives every regions() address a box, and a declared array one off its elements', () => {
		const regions = showcase.regions();
		const fields = [...new Set(regions.map((r) => r.field))];
		// The fixture has to reach both fallback shapes for this to mean anything: a
		// span-less scalar reference, and a `richtext[]` element.
		expect(fields).toContain('main.signature_block');
		expect(fields).toContain('main.keywords[0]');

		for (const field of fields) {
			const boxes = boxesForField(field, showcase.fieldBoxes(field), () => regions);
			expect(boxes.length, `no box for ${field}`).toBeGreaterThan(0);
		}
		// The array is named by the ink the plate composes around its elements — the
		// separator between the boxed keywords — and each element by the ink it carries
		// itself. A host holding the declared path reaches every row it prints either
		// way, so the second rung answers with both, whatever the fixture seeds.
		expect(showcase.fieldBoxes('main.keywords')).toEqual([]);
		const under = regions.filter(
			(r) => r.field === 'main.keywords' || r.field.startsWith('main.keywords[')
		);
		expect(under.filter((r) => r.field === 'main.keywords').length).toBeGreaterThan(0);
		expect(
			boxesForField('main.keywords', showcase.fieldBoxes('main.keywords'), () => regions).length
		).toBe(under.length);
	});

	it('gives every address the shipped quill serves a box of its own', async () => {
		// The invariant above, over a plate nobody here wrote: a region a real quill's
		// plate mints is a region this tier has to be able to box.
		const session = await open(undefined, 'usaf_memo');
		const regions = session.regions();
		expect(regions.length).toBeGreaterThan(0);
		for (const field of new Set(regions.map((r) => r.field))) {
			expect(
				boxesForField(field, session.fieldBoxes(field), () => regions).length,
				`no box for ${field}`
			).toBeGreaterThan(0);
		}
	});

	it('gives a live variant cell its own region, and a box under the field that draws it', async () => {
		// The cells of a world nobody picked print nothing, so the address exists only
		// once the document is in that world with the cell written.
		const session = await open((doc) =>
			doc.storeField('handling', {
				value: 'CONTROLLED',
				controlled_by: 'SPEC/AA',
				caveat: 'no copies'
			})
		);
		const fields = [...new Set(session.regions().map((r) => r.field))];
		expect(fields).toContain('main.handling.controlled_by');
		expect(fields).toContain('main.handling.caveat');
		for (const cell of ['main.handling.controlled_by', 'main.handling.caveat']) {
			expect(
				boxesForField(cell, session.fieldBoxes(cell), () => session.regions()).length,
				`no box for ${cell}`
			).toBeGreaterThan(0);
		}
		// The discriminant is read into a local for the branching, and a binding carries
		// no address: what the compile serves is the cells, and the field above them is
		// reached by truncating one of theirs (`nearestAddrForFieldPath`).
		expect(fields).not.toContain('main.handling');
	});

	it('gives a nested row its own region through its content cell, and nothing through its scalars', async () => {
		// The nested-row address a landing has to resolve through, and the reason the
		// fixture declares a content cell in a row at all: a content value carries its own
		// spans, so it regions wherever a plate places it, while a scalar's address is the
		// read path's and the codegen tracks a literal one only (PREVIEW.md §"Click bridge").
		// The plate loops, so `note` and `pages` reach the preview through the array and
		// `detail` reaches it as its own row.
		const session = await open((doc) =>
			doc.storeField('revisions', [
				{ note: 'Fig. 2 relabelled', pages: 1, detail: 'The caption named the wrong figure.' },
				{ note: 'Year corrected', pages: 2, detail: 'Page 4 gave 2025.' }
			])
		);
		const fields = [...new Set(session.regions().map((r) => r.field))];
		expect(fields).toContain('main.revisions[0].detail');
		expect(fields).toContain('main.revisions[1].detail');
		expect(fields).not.toContain('main.revisions[0].note');

		for (const cell of ['main.revisions[0].detail', 'main.revisions[1].detail']) {
			const boxes = boxesForField(cell, session.fieldBoxes(cell), () => session.regions());
			expect(boxes.length, `no box for ${cell}`).toBeGreaterThan(0);
			// The row a click lands on is the row that was drawn, not its neighbour.
			const [x0, y0, x1, y1] = boxes[0].rect;
			const hit = session.positionAt(boxes[0].page, (x0 + x1) / 2, (y0 + y1) / 2);
			expect(hit?.field, `${cell} does not answer its own box`).toBe(cell);
		}
	});
});
