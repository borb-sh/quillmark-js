// @vitest-environment jsdom
// The shipped quill, drawn. `usaf_memo` is a copy of a real one (fixtures/Quiver.yaml)
// and declares nothing for this tier's benefit, so what it asks the surface for is
// what a quill author asks for: the conformance lane beside `showcase`'s curated one.
//
// Two kinds of claim here, and the difference is what survives a re-copy. The first
// three read the schema the quill happens to declare — every field draws, every group
// sections, in the order the schema gives — and hold whatever it declares next. The
// last two name shapes, and are meant to fail when the shape or the surface moves:
// they are what the tier does with `plaintext` and with a variant whose cells are
// prose, which is most of this quill.
//
// jsdom implements no contenteditable, so a cell's keystroke is out of reach here: the
// read half is asserted on the mounted leaf and the write half through the typed
// writer, as an array's prose row asserts them (`plaintext-array`).
import { describe, it, expect, afterEach } from 'vitest';
import { fieldModels, groupLabel, groupOrder } from '$lib/visual/structure';
import { quill } from '../helpers/fixtures.js';
import { field, mountEditor, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const memo = () => quill('usaf_memo');

const texts = (target: HTMLElement, selector: string): string[] =>
	[...target.querySelectorAll<HTMLElement>(selector)].map(
		(el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? ''
	);

describe('the shipped quill on the surface', () => {
	it('draws a labelled control for every field of every card it seeds', () => {
		const q = memo();
		const doc = q.seedDocument();
		const { target } = mountEditor(q, doc);

		const schema = q.schema;
		// The seed lays the main card and one `indorsement`; both are declared kinds, so
		// neither falls to the recovery shell.
		expect(target.querySelectorAll('.qm-card').length).toBe(2);
		expect(target.querySelector('.qm-card-recovery')).toBeNull();

		const declared =
			Object.keys(schema.main.fields).length +
			Object.keys(schema.card_kinds!.indorsement.fields).length;
		expect(target.querySelectorAll('.qm-field').length).toBe(declared);
		// A control nothing names is a control nobody can reach: every field carries its
		// label, closed sections included (a closed panel is inert, not unmounted).
		expect(target.querySelectorAll('.qm-field-label').length).toBe(declared);
	});

	it('sections the main card into the groups the schema registers, in that order', () => {
		const q = memo();
		const doc = q.seedDocument();
		const { target } = mountEditor(q, doc);

		// The quill spells `ui.groups` as a list and the boundary serves the registry a
		// map, so the JS tier reads one shape however an author wrote it — and the order
		// on the surface is the order the registry gives.
		const main = q.schema.main;
		expect(groupOrder(main).length).toBeGreaterThan(1);
		expect(texts(target.querySelector<HTMLElement>('.qm-card')!, '.qm-group-header')).toEqual(
			groupOrder(main).map((g) => groupLabel(main, g))
		);
	});

	it('names a card kind’s fields as the projection labels them, in declaration order', () => {
		const q = memo();
		const doc = q.seedDocument();
		const { target } = mountEditor(q, doc);

		const card = [...target.querySelectorAll<HTMLElement>('.qm-card')][1];
		// The marker rides inside the label, so the text carries it: three of this kind's
		// fields declare no `default:` and say so.
		expect(texts(card, '.qm-field-label')).toEqual(
			fieldModels(q.schema.card_kinds!.indorsement).map((m) =>
				m.required ? `${m.label} *` : m.label
			)
		);
	});

	it('takes a `plaintext` field as the inline leaf it declares', () => {
		// Most of this quill is `plaintext` + `inline: true`, and the boundary serves
		// `inline` at every type — so the leaf is a one-line one and `packable` takes
		// the `ui.compact` beside it.
		const byName = Object.fromEntries(fieldModels(memo().schema.main).map((m) => [m.name, m]));
		expect(byName.authority_line.control).toBe('prose');
		expect(byName.authority_line.plaintext).toBe(true);
		expect(byName.authority_line.inline).toBe(true);
		expect(byName.tag_line.inline).toBe(true); // a richtext scalar, declared alike
		expect(byName.dissemination.compact).toBe(true);

		// And on the surface, where a packed field is a `cell` and a declined one — or one
		// stranded with nothing to pack against — spans the row.
		const q = memo();
		const { target } = mountEditor(q, q.seedDocument());
		const span = (label: string) =>
			field(target, label).classList.contains('cell') ? 'cell' : 'full';
		// `Dissemination` asks to pack and stands alone between block leaves, so its run
		// is one and it takes the row; `Tag line` sits in a run of inline neighbours and
		// packs. What separates them is the run each lands in, not what either declares.
		expect(span('Dissemination')).toBe('full');
		expect(span('Tag line')).toBe('cell');
	});

	// What the cells rest as, both ways. The read is the one a variant's key answers
	// only at the boundary that walks it; the write is the container's own, whole.
	it('draws the CUI world as prose cells, read at their codec and rested as strings', () => {
		const q = memo();
		const doc = q.seedDocument();
		q.writer(doc).set('classification', {
			value: 'CUI',
			controlled_by: 'SAF/AA',
			poc: 'Capt J. Smith, DSN 555-1234',
			category: 'PRVCY',
			limited_dissemination: 'FEDONLY'
		});
		const { target } = mountEditor(q, doc);

		const classification = field(target, 'Classification');
		// Named and obliged as the schema declares them, and each a `plaintext` leaf, so a
		// CUI document can be finished from this surface.
		expect(texts(classification, '.qm-object-prop .qm-field-label')).toEqual([
			'Controlled by *',
			'Poc *',
			'Category',
			'Limited dissemination'
		]);
		expect(texts(classification, '.qm-object-prop .ProseMirror')).toEqual([
			'SAF/AA',
			'Capt J. Smith, DSN 555-1234',
			'PRVCY',
			'FEDONLY'
		]);
		// Every cell rests as its literal string, which is what a `plaintext` cell's
		// codec commits: the banner reads them as text and the storage says so.
		expect(doc.getStored('classification')).toEqual({
			value: 'CUI',
			controlled_by: 'SAF/AA',
			poc: 'Capt J. Smith, DSN 555-1234',
			category: 'PRVCY',
			limited_dissemination: 'FEDONLY'
		});
	});
});
