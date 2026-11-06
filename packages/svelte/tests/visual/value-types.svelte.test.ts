// @vitest-environment jsdom
// The three controls no field-level prose leaf covers: the boolean switch, the object
// subform, and the array's `object` element. The reference quill declares a field for
// each, so they are driven off the fixture on disk rather than off a schema patched in
// memory or hand-built behind the WASM boundary.
//
// Each control is driven as a pointer drives it and the value read back through
// `DocumentReader`, so the commit is judged by the writer's own conformance rather
// than by a captured callback argument.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { DEFAULT_VISUAL_STRINGS as S } from '$lib/visual/strings';
import { DocumentReader, type Content, type Quill, type Document } from '@quillmark/wasm';
import { core, quill, literal } from '../helpers/fixtures.js';
import {
	field,
	mountEditor,
	summaries,
	type,
	typeLeaf,
	unmountAll
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const read = (q: Quill, doc: Document, name: string) => new DocumentReader(q, doc).get(name);

describe('a boolean field', () => {
	it('commits the switch toggle, and toggles back off', () => {
		const q = quill();
		const doc = q.seedDocument();
		const { target } = mountEditor(q, doc);

		const sw = field(target, 'Draft watermark').querySelector<HTMLElement>('[role="switch"]')!;
		expect(sw.getAttribute('aria-checked')).toBe('false');

		sw.click();
		flushSync();
		expect(sw.getAttribute('aria-checked')).toBe('true');
		expect(read(q, doc, 'draft_watermark')).toBe(true);

		// The switch is a control, not a latch: the second click writes `false`
		// rather than clearing the field back to its `default:`.
		sw.click();
		flushSync();
		expect(read(q, doc, 'draft_watermark')).toBe(false);
	});

	// The render reads a stored boolean cell more widely than YAML does, so the switch is
	// held to Quillmark's own reading, `reader.resolve()`, at a field and at a subform
	// cell. A value the render refuses draws as an absent one, here the `false` default.
	it.each(['true', '"False"', '"TRUE"', '0', '-1', 'yes', '" true"'])(
		'draws %s as the render reads it',
		(spelled) => {
			const q = quill();
			const doc = q.parse(
				[
					'~~~',
					'$quill: showcase@1.0.0',
					'contact:',
					'  name: A',
					`  listed: ${spelled}`,
					`draft_watermark: ${spelled}`,
					'~~~',
					''
				].join('\n')
			);
			const rows = new DocumentReader(q, doc).resolve().main.fields;
			const rendered = (name: string) => rows.find((r) => r.name === name)?.value;
			const contact = rendered('contact') as Record<string, unknown>;
			const { target } = mountEditor(q, doc);

			const face = (sw: Element | null) => sw?.getAttribute('aria-checked');
			const top = field(target, 'Draft watermark').querySelector('[role="switch"]');
			const cell = target.querySelector('[data-qm-prop="listed"] [role="switch"]');
			expect(face(top)).toBe(String(rendered('draft_watermark') === true));
			expect(face(cell)).toBe(String(contact.listed === true));
		}
	);
});

describe('an object field', () => {
	it('commits the whole object on each property, keeping the properties beside it', () => {
		const q = quill();
		const doc = q.seedDocument();
		const { target } = mountEditor(q, doc);

		const obj = field(target, 'Point of contact');
		const props = [...obj.querySelectorAll<HTMLElement>('.qm-object-prop')];
		// Declaration order, which is what the subform renders by. The marker is per
		// property, not per container: the three that declare no `default:` carry one, and
		// `listed`'s default retires its own while the container above holds none either way.
		expect(
			props.map((p) => p.querySelector('.qm-field-label')?.textContent?.replace(/\s+/g, ' ').trim())
		).toEqual(['Name', 'Email', 'Reply by', 'Listed', 'Note']);

		typeLeaf(props[0], 'Ada Lovelace');
		expect(read(q, doc, 'contact')).toEqual({ name: 'Ada Lovelace' });

		// The second property commits the object by value, so the first has to ride
		// along: a commit that carried only the edited key would drop it.
		typeLeaf(props[1], 'ada@example.org');
		expect(read(q, doc, 'contact')).toEqual({
			name: 'Ada Lovelace',
			email: 'ada@example.org'
		});

		props[3].querySelector<HTMLElement>('[role="switch"]')!.click();
		flushSync();
		expect(read(q, doc, 'contact')).toEqual({
			name: 'Ada Lovelace',
			email: 'ada@example.org',
			listed: true
		});
	});

	it('commits a cleared text property as the empty answer, never a hole', () => {
		const q = quill();
		const doc = q.seedDocument();
		const { target } = mountEditor(q, doc);

		const props = [
			...field(target, 'Point of contact').querySelectorAll<HTMLElement>('.qm-object-prop')
		];
		typeLeaf(props[0], 'Ada Lovelace');
		typeLeaf(props[1], 'ada@example.org');
		expect(read(q, doc, 'contact')).toEqual({
			name: 'Ada Lovelace',
			email: 'ada@example.org'
		});

		// Cleared to empty: a prose leaf's empty answer, committed as `''` and never as
		// an `undefined` hole carried through `writer.set`.
		typeLeaf(props[0], '');
		expect(read(q, doc, 'contact')).toEqual({ name: '', email: 'ada@example.org' });
	});

	// The content property, which is a leaf and not a line pointing elsewhere: it reads
	// one key in through `reader.getContentAt` at the codec its own type declares, and
	// the container commits it whole like every other property.
	it('mounts its content property as a prose leaf reading at the property codec', () => {
		const q = quill();
		const doc = q.seedDocument();
		q.writer(doc).set('contact', { name: 'Ada Lovelace', note: 'ask for *Ada*, not Augusta' });
		const { target } = mountEditor(q, doc);

		const props = [
			...field(target, 'Point of contact').querySelectorAll<HTMLElement>('.qm-object-prop')
		];
		const leaf = props[4].querySelector<HTMLElement>('.ProseMirror')!;
		expect(leaf).not.toBeNull();
		// `text`, so the asterisks are characters: nothing was lowered from them.
		expect(leaf.textContent).toBe('ask for *Ada*, not Augusta');
		expect(leaf.querySelector('em, strong')).toBeNull();
		// `for` cannot reach a `contenteditable`, so the label names it the other way.
		expect(leaf.getAttribute('aria-labelledby')).toBe(
			props[4].querySelector('.qm-field-label')?.id
		);

		// The property rests as its literal string, the scalar `text` field's rest form
		// one key in, and the cell beside it rides the commit as ever.
		expect(literal(doc.getStored('contact'))).toEqual({
			name: 'Ada Lovelace',
			note: 'ask for *Ada*, not Augusta'
		});
	});
});

describe('an array of objects', () => {
	/** A seeded document with `revisions` emptied. The fixture seeds one row so its plate
	 *  has a nested row to region (PREVIEW.md §"Click bridge"); these three are about the
	 *  array a hand fills from empty, so they clear it and drive the adds themselves. */
	function emptied(q: Quill): Document {
		const doc = q.seedDocument();
		doc.unchecked.storeField('revisions', []);
		return doc;
	}

	it('adds an element open, and commits its cells through the subform', () => {
		const q = quill();
		const doc = emptied(q);
		const { target } = mountEditor(q, doc);

		const arr = field(target, 'Revisions');
		arr.querySelector<HTMLButtonElement>('.qm-add-el')!.click();
		flushSync();

		// A row added is a row to fill in, so it arrives open rather than as a summary
		// the user has to press before typing.
		expect(summaries(arr)[0].getAttribute('aria-expanded')).toBe('true');

		// The element is a subform over `items.properties`, not a JSON pane: one control
		// per declared cell, at the cell's own type.
		const props = [...arr.querySelectorAll<HTMLElement>('.qm-object-prop')];
		expect(
			props.map((p) => p.querySelector('.qm-field-label')?.textContent?.replace(/\s+/g, ' ').trim())
		).toEqual(['Note', 'Pages', 'Detail', 'Rationale', 'Passage']);

		typeLeaf(props[0], 'First cut');
		expect(read(q, doc, 'revisions')).toEqual([{ note: 'First cut' }]);

		// The element commits whole, so the second cell has to carry the first with it.
		type(props[1].querySelector('input')!, '3');
		expect(read(q, doc, 'revisions')).toEqual([{ note: 'First cut', pages: 3 }]);
	});

	it('names a row by its number, and opens each row on its own', () => {
		const q = quill();
		const doc = emptied(q);
		const { target } = mountEditor(q, doc);

		const arr = field(target, 'Revisions');
		const add = arr.querySelector<HTMLButtonElement>('.qm-add-el')!;
		add.click();
		flushSync();
		typeLeaf(arr.querySelector<HTMLElement>('.qm-object-prop')!, 'Fig. 2 relabelled');

		// The second add opens its own row and leaves the first where it stands.
		add.click();
		flushSync();
		const rows = summaries(arr);
		expect(rows.map((s) => s.getAttribute('aria-expanded'))).toEqual(['true', 'true']);
		rows[0].click();
		flushSync();
		expect(summaries(arr).map((s) => s.getAttribute('aria-expanded'))).toEqual(['false', 'true']);

		// A row reads as its number whatever it holds, the same words open or collapsed,
		// and the words it draws are inside the name it is spoken by.
		const titles = rows.map((r) => r.textContent?.trim());
		expect(titles).toEqual([S.elementItem(1), S.elementItem(2)]);
		rows.forEach((r, k) => {
			expect(r.getAttribute('aria-label')).toBe(S.elementUntitled('Revisions', k + 1));
			expect(r.getAttribute('aria-label')!.toLowerCase()).toContain(titles[k]!.toLowerCase());
		});

		// Pressing an open row closes it, so an array can rest with nothing unfolded.
		rows[1].click();
		flushSync();
		expect(summaries(arr).map((s) => s.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
	});

	it('draws a list of one record open on mount', () => {
		const q = quill();
		const doc = emptied(q);
		doc.unchecked.storeField('revisions', [{ note: 'Only' }]);
		const { target } = mountEditor(q, doc);

		const arr = field(target, 'Revisions');
		expect(summaries(arr).map((s) => s.getAttribute('aria-expanded'))).toEqual(['true']);
		expect(
			arr.querySelector('.qm-element.open [data-qm-prop="note"] .ProseMirror')?.textContent
		).toBe('Only');
	});

	it('drops the open row with its element, and opens the one row a remove leaves', () => {
		const q = quill();
		const doc = emptied(q);
		const { target } = mountEditor(q, doc);

		const arr = field(target, 'Revisions');
		const add = arr.querySelector<HTMLButtonElement>('.qm-add-el')!;
		add.click();
		flushSync();
		typeLeaf(arr.querySelector<HTMLElement>('.qm-object-prop')!, 'Kept');
		add.click();
		flushSync();
		add.click();
		flushSync();
		expect(read(q, doc, 'revisions')).toEqual([{ note: 'Kept' }, {}, {}]);

		// Removing an open row takes its open state with it: the closed row sliding into
		// its place stays closed.
		summaries(arr)[0].click();
		summaries(arr)[2].click();
		flushSync();
		arr.querySelectorAll<HTMLButtonElement>('.qm-remove')[1].click();
		flushSync();
		const expanded = () => summaries(arr).map((s) => s.getAttribute('aria-expanded'));
		expect(expanded()).toEqual(['false', 'false']);

		// A remove that leaves one record draws it open, and a press still closes it.
		arr.querySelectorAll<HTMLButtonElement>('.qm-remove')[1].click();
		flushSync();
		expect(read(q, doc, 'revisions')).toEqual([{ note: 'Kept' }]);
		expect(expanded()).toEqual(['true']);
		summaries(arr)[0].click();
		flushSync();
		expect(expanded()).toEqual(['false']);
	});
});

// The render reads a bare value under an `array` as the one-element list it spells
// (canon `SCHEMAS.md` §"Type coercion"), and the transport door rests it as authored,
// so the rows are the render's reading and a gesture writes that list whole.
describe('an array holding a bare value', () => {
	const loaded = (...fields: string[]): Document =>
		core.Document.parse(['~~~', '$quill: showcase@1.0.0', ...fields, '~~~', ''].join('\n'));
	const rendered = (q: Quill, doc: Document, name: string) =>
		new DocumentReader(q, doc).resolve().main.fields.find((r) => r.name === name)?.value;

	it('draws a bare string as one row, and an edit writes the list', () => {
		const q = quill();
		const doc = loaded('authors: Ada Lovelace');
		expect(literal(doc.getStored('authors'))).toBe('Ada Lovelace');
		const { target } = mountEditor(q, doc);
		const leaves = () => [
			...field(target, 'Authors').querySelectorAll<HTMLElement>(
				'.ProseMirror[aria-label^="Authors "]'
			)
		];

		expect(leaves().map((l) => l.textContent)).toEqual(
			(rendered(q, doc, 'authors') as Content[]).map((c) => c.text)
		);
		typeLeaf(leaves()[0], 'Grace Hopper');
		expect(literal(doc.getStored('authors'))).toEqual(['Grace Hopper']);
	});

	it('draws a bare string as one prose row at its codec, and an add writes the list', () => {
		const q = quill();
		const doc = loaded('errata: Page 9 omits the *colophon*.', 'keywords: A *bare* keyword');
		const { target } = mountEditor(q, doc);
		const rows = (label: string) =>
			[...target.querySelectorAll<HTMLElement>(`.ProseMirror[aria-label^="${label} "]`)].map(
				(r) => r.textContent
			);

		expect(rows('Errata')).toEqual(['Page 9 omits the *colophon*.']);
		expect(rows('Keywords')).toEqual(['A bare keyword']);

		field(target, 'Errata').querySelector<HTMLButtonElement>('.qm-add-el')!.click();
		flushSync();
		expect(literal(doc.getStored('errata'))).toEqual(['Page 9 omits the *colophon*.', '']);
		expect(rows('Errata')).toEqual(['Page 9 omits the *colophon*.', '']);
	});
});
