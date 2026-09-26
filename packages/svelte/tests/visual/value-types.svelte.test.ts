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
import { mount, unmount, flushSync } from 'svelte';
import { DocumentReader, type Quill, type Document } from '@quillmark/wasm';
import VisualEditor from '$lib/visual/VisualEditor.svelte';
import { quill } from '../helpers/fixtures.js';

// jsdom implements neither, and mounting the editor reaches both: the card
// scroll hop and the flip the survivors run through.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.getAnimations ??= () => [];
// The rects the subform's prose cell measures; jsdom implements neither.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

function mountEditor(q: Quill, doc: Document) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(VisualEditor, { target, props: { doc, quill: q } });
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
	};
	return target;
}

/** The field whose label reads `label`: the one locator that does not spend an id
 *  minted per editor instance (`fieldDomIds` keys off `$props.id()`). */
function field(target: HTMLElement, label: string): HTMLElement {
	const match = [...target.querySelectorAll<HTMLElement>('.qm-field')].find(
		(f) => f.querySelector('.qm-field-label span')?.textContent === label
	);
	if (!match) throw new Error(`no field labelled ${label}`);
	return match;
}

/** An array field carries no `.qm-field-label`; its label sits in the header row
 *  {@link ArrayField} builds beside the add affordance. */
function arrayField(target: HTMLElement, label: string): HTMLElement {
	const match = [...target.querySelectorAll<HTMLElement>('.qm-field')].find((f) =>
		[...f.querySelectorAll('span')].some((s) => s.textContent === label)
	);
	if (!match) throw new Error(`no array field labelled ${label}`);
	return match;
}

/** Type into a text/number input the way a pointer entry settles: `input` carries
 *  the keystroke, `change` the settle, and the two controls commit on different
 *  ones. */
function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}

const read = (q: Quill, doc: Document, name: string) => new DocumentReader(q, doc).get(name);

describe('a boolean field', () => {
	it('commits the switch toggle, and toggles back off', () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

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
});

describe('an object field', () => {
	it('commits the whole object on each property, keeping the properties beside it', () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		const obj = field(target, 'Point of contact');
		const props = [...obj.querySelectorAll<HTMLElement>('.qm-object-prop')];
		// Declaration order, which is what the subform renders by. The marker is per
		// property, not per container: the three that declare no `default:` carry one, and
		// `listed`'s default retires its own while the container above holds none either way.
		expect(
			props.map((p) => p.querySelector('.qm-field-label')?.textContent?.replace(/\s+/g, ' ').trim())
		).toEqual(['Name *', 'Email *', 'Reply by *', 'Listed', 'Note']);

		type(props[0].querySelector('input')!, 'Ada Lovelace');
		expect(read(q, doc, 'contact')).toEqual({ name: 'Ada Lovelace' });

		// The second property commits the object by value, so the first has to ride
		// along: a commit that carried only the edited key would drop it.
		type(props[1].querySelector('input')!, 'ada@example.org');
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

	it('drops a cleared property rather than committing a hole', () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		const props = [
			...field(target, 'Point of contact').querySelectorAll<HTMLElement>('.qm-object-prop')
		];
		type(props[0].querySelector('input')!, 'Ada Lovelace');
		type(props[1].querySelector('input')!, 'ada@example.org');
		expect(read(q, doc, 'contact')).toEqual({
			name: 'Ada Lovelace',
			email: 'ada@example.org'
		});

		// Cleared to empty: the key goes absent (resolving to its own `default:`)
		// rather than being committed as `undefined`.
		type(props[0].querySelector('input')!, '');
		expect(read(q, doc, 'contact')).toEqual({ email: 'ada@example.org' });
	});

	// The content property, which is a leaf and not a line pointing elsewhere: it reads
	// one key in through `reader.getContentAt` at the codec its own type declares, and
	// the container commits it whole like every other property.
	it('mounts its content property as a prose leaf reading at the property codec', () => {
		const q = quill();
		const doc = q.seedDocument();
		q.writer(doc).set('contact', { name: 'Ada Lovelace', note: 'ask for *Ada*, not Augusta' });
		const target = mountEditor(q, doc);

		const props = [
			...field(target, 'Point of contact').querySelectorAll<HTMLElement>('.qm-object-prop')
		];
		const leaf = props[4].querySelector<HTMLElement>('.ProseMirror')!;
		expect(leaf).not.toBeNull();
		// `plaintext`, so the asterisks are characters: nothing was lowered from them.
		expect(leaf.textContent).toBe('ask for *Ada*, not Augusta');
		expect(leaf.querySelector('em, strong')).toBeNull();
		// `for` cannot reach a `contenteditable`, so the label names it the other way.
		expect(leaf.getAttribute('aria-labelledby')).toBe(
			props[4].querySelector('.qm-field-label')?.id
		);

		// The property rests as its literal string, the scalar `plaintext` field's rest
		// form one key in, and the scalar beside it rides the commit as ever.
		expect(doc.getStored('contact')).toEqual({
			name: 'Ada Lovelace',
			note: 'ask for *Ada*, not Augusta'
		});
	});
});

describe('an array of objects', () => {
	/** A row's summary button, which is the element in collapsed form. */
	const summaries = (arr: HTMLElement) => [
		...arr.querySelectorAll<HTMLButtonElement>('.qm-element-summary')
	];

	/** A seeded document with `revisions` emptied. The fixture seeds one row so its plate
	 *  has a nested row to region (PREVIEW.md §"Click bridge"); these three are about the
	 *  array a hand fills from empty, so they clear it and drive the adds themselves. */
	function emptied(q: Quill): Document {
		const doc = q.seedDocument();
		doc.storeField('revisions', []);
		return doc;
	}

	it('adds an element open, and commits its cells through the subform', () => {
		const q = quill();
		const doc = emptied(q);
		const target = mountEditor(q, doc);

		const arr = arrayField(target, 'Revisions');
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
		).toEqual(['Note *', 'Pages *', 'Detail']);

		type(props[0].querySelector('input')!, 'First cut');
		expect(read(q, doc, 'revisions')).toEqual([{ note: 'First cut' }]);

		// The element commits whole, so the second cell has to carry the first with it.
		type(props[1].querySelector('input')!, '3');
		expect(read(q, doc, 'revisions')).toEqual([{ note: 'First cut', pages: 3 }]);
	});

	it('titles a collapsed row by its first string cell, and opens one at a time', () => {
		const q = quill();
		const doc = emptied(q);
		const target = mountEditor(q, doc);

		const arr = arrayField(target, 'Revisions');
		const add = arr.querySelector<HTMLButtonElement>('.qm-add-el')!;
		add.click();
		flushSync();
		type(
			arr.querySelector<HTMLElement>('.qm-object-prop')!.querySelector('input')!,
			'Fig. 2 relabelled'
		);

		// The second add closes the first: one figure on screen per array, however many
		// records it holds.
		add.click();
		flushSync();
		const rows = summaries(arr);
		expect(rows.map((s) => s.getAttribute('aria-expanded'))).toEqual(['false', 'true']);

		// A titled row reads as its own value; an untitled one falls back to the name its
		// accessible label already spends.
		expect(rows[0].textContent?.trim()).toBe('Fig. 2 relabelled');
		expect(rows[1].textContent?.trim()).toBe('Revisions 2');

		// Pressing an open row closes it, so an array can rest with nothing unfolded.
		rows[1].click();
		flushSync();
		expect(summaries(arr).map((s) => s.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
	});

	it('drops the open row with its element, leaving no row opened in its place', () => {
		const q = quill();
		const doc = emptied(q);
		const target = mountEditor(q, doc);

		const arr = arrayField(target, 'Revisions');
		const add = arr.querySelector<HTMLButtonElement>('.qm-add-el')!;
		add.click();
		flushSync();
		type(arr.querySelector<HTMLElement>('.qm-object-prop')!.querySelector('input')!, 'Kept');
		add.click();
		flushSync();
		expect(read(q, doc, 'revisions')).toEqual([{ note: 'Kept' }, {}]);

		// Removing the open row must not leave `openId` naming a row that has gone: the
		// row sliding into its place would otherwise be un-openable by its own press.
		arr.querySelectorAll<HTMLButtonElement>('.qm-remove')[1].click();
		flushSync();
		expect(read(q, doc, 'revisions')).toEqual([{ note: 'Kept' }]);
		const rows = summaries(arr);
		expect(rows).toHaveLength(1);
		expect(rows[0].getAttribute('aria-expanded')).toBe('false');
		rows[0].click();
		flushSync();
		expect(summaries(arr)[0].getAttribute('aria-expanded')).toBe('true');
	});
});
