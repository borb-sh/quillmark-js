// @vitest-environment jsdom
// A top-level field declaring `inline`, or a `plaintext` one, over a stored value its
// schema cannot hold is held: the decode would join the lines and drop the list and the
// image, and the first commit would store that. The hold is judged of the value each
// mount and re-hydrate reads, and every set of diagnostics routed to the field
// re-hydrates it, so a re-validation after an external write releases it or takes it.
// The probe is its own quill: one field of each shape, a card kind holding one, and a
// string whose commit re-validates.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { isQuillmarkError, type Document } from '@quillmark/wasm';
import { core, quillFromYaml } from '../helpers/fixtures.js';
import {
	field,
	heldNote,
	mountEditor,
	paste,
	type,
	unmountAll,
	type Mounted
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const YAML = `quill:
  name: inline_held
  version: 1.0.0
  backend: typst
  description: Narrowed and plain fields, at the top level and on a card.
typst:
  plate_file: plate.typ
main:
  fields:
    title:
      type: richtext
      inline: true
    line:
      type: plaintext
      inline: true
      default: ""
    address:
      type: plaintext
      default: ""
    author:
      type: string
card_kinds:
  note:
    fields:
      heading:
        type: richtext
        inline: true
`;
const probe = () => quillFromYaml(YAML);
const STRUCTURED = '- one\n- two\n\npara ![i](a.png)';
const load = (title: string, ...cards: string[]): Document =>
	core.Document.fromMarkdown(
		[
			'~~~',
			'$quill: inline_held@1.0.0',
			`title: ${JSON.stringify(title)}`,
			'~~~',
			'',
			...cards.flatMap((heading) => [
				'~~~',
				'$kind: note',
				`heading: ${JSON.stringify(heading)}`,
				'~~~',
				''
			])
		].join('\n')
	);

const leafOf = (target: HTMLElement, label: string): HTMLElement =>
	field(target, label).querySelector<HTMLElement>('.ProseMirror')!;

/** Commit the string beside the fields: a revision, and so a re-validation. */
function revalidate(m: Mounted): void {
	type(field(m.target, 'Author').querySelector<HTMLInputElement>('input')!, 'Ann');
}

function expectHeld(leaf: HTMLElement): void {
	expect(leaf.getAttribute('contenteditable')).toBe('false');
	expect(leaf.getAttribute('role')).toBe('textbox');
	expect(leaf.getAttribute('aria-readonly')).toBe('true');
	expect(leaf.tabIndex).toBe(0);
	// Under the text it is about.
	expect(heldNote(leaf)?.previousElementSibling).toBe(leaf);
}

function expectStructure(leaf: HTMLElement): void {
	expect([...leaf.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two']);
	expect(leaf.querySelector('[data-qm-island="image"]')).not.toBeNull();
}

describe('a top-level inline richtext field over stored block content', () => {
	it('draws the list and the image read-only, where a paste lands nothing', () => {
		const doc = load(STRUCTURED);
		const mounted = mountEditor(probe(), doc);
		const leaf = leafOf(mounted.target, 'Title');

		expectHeld(leaf);
		expectStructure(leaf);
		paste(leaf, 'Z');
		expect(doc.getStored('title')).toBe(STRUCTURED);
		expect(mounted.changes).toEqual([]);
	});

	it('releases once a re-validation follows an external write that leaves it inline', () => {
		const q = probe();
		const doc = load(STRUCTURED);
		const mounted = mountEditor(q, doc);
		expectHeld(leafOf(mounted.target, 'Title'));

		q.writer(doc).set('title', 'plain');
		revalidate(mounted);
		const leaf = leafOf(mounted.target, 'Title');
		expect(leaf.getAttribute('contenteditable')).toBe('true');
		expect(leaf.hasAttribute('aria-describedby')).toBe(false);
		expect(field(mounted.target, 'Title').querySelector('.qm-prose-held-note')).toBeNull();
		expect(leaf.textContent).toBe('plain');

		paste(leaf, 'Z');
		expect(mounted.changes.at(-1)?.path).toBe('main.title');
		expect(q.reader(doc).getContent({ field: 'title' })?.text).toContain('Z');
	});

	it('holds once a re-validation follows an external store write that gains structure', () => {
		const q = probe();
		const doc = load('plain');
		const mounted = mountEditor(q, doc);
		expect(leafOf(mounted.target, 'Title').getAttribute('contenteditable')).toBe('true');

		// The typed writer refuses the value outright; the store takes it verbatim, as the
		// source view and an import do.
		let refused: string | undefined;
		try {
			q.writer(doc).set('title', STRUCTURED);
		} catch (e) {
			refused = isQuillmarkError(e) ? e.diagnostics[0]?.code : undefined;
		}
		expect(refused).toBe('edit::field_not_inline');
		doc.storeField('title', STRUCTURED);
		revalidate(mounted);

		const leaf = leafOf(mounted.target, 'Title');
		expectHeld(leaf);
		expectStructure(leaf);
	});

	it('holds when the diagnostics that re-hydrate it predate the value', () => {
		const q = probe();
		const doc = load('plain');
		const { target, props } = mountEditor(q, doc, { diagnostics: [] });

		doc.storeField('title', STRUCTURED);
		// A host's own feed changing, with no revision to re-validate the document: the
		// set routed to the title names nothing about its shape.
		props.diagnostics = [{ severity: 'error', message: 'Checked elsewhere.', path: 'main.title' }];
		flushSync();

		const leaf = leafOf(target, 'Title');
		expectHeld(leaf);
		expectStructure(leaf);
	});

	it('holds the same field on a card', () => {
		const doc = load('plain', STRUCTURED);
		const mounted = mountEditor(probe(), doc);
		const leaf = leafOf(mounted.target, 'Heading');
		expectHeld(leaf);
		expectStructure(leaf);
	});
});

describe('a top-level plaintext field over content upstream does not call plain', () => {
	it('holds one declaring inline, whose refusal upstream names not_plain', () => {
		const doc = load('plain');
		doc.overwrite({ field: 'line' }, core.importMarkdown(STRUCTURED).content);
		const mounted = mountEditor(probe(), doc);
		const leaf = leafOf(mounted.target, 'Line');
		expectHeld(leaf);
		expectStructure(leaf);
	});

	it('releases one without inline once a re-validation follows an external write', () => {
		const q = probe();
		const doc = load('plain');
		doc.overwrite({ field: 'address' }, core.importMarkdown(STRUCTURED).content);
		const mounted = mountEditor(q, doc);
		expectHeld(leafOf(mounted.target, 'Address'));

		q.writer(doc).set('address', '12 Main St\nSpringfield');
		revalidate(mounted);
		const leaf = leafOf(mounted.target, 'Address');
		expect(leaf.getAttribute('contenteditable')).toBe('true');
		expect([...leaf.querySelectorAll('p')].map((p) => p.innerHTML)).toEqual([
			'12 Main St<br>Springfield'
		]);
	});
});
