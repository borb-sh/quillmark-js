// @vitest-environment jsdom
// A top-level field declaring `inline` over stored content upstream reports as
// `validation::not_inline` is held: the inline decode would join the lines and drop the
// list and the image, and the first commit would store that. The hold follows the
// diagnostics the editor routes to the field, so a re-validation releases it or takes
// it. The probe is its own quill: the field, and a string beside it whose commit
// re-validates.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { init, isQuillmarkError, type Document, type Quill } from '@quillmark/wasm';
import { field, mountEditor, stubLayout, type, type Mounted } from '../helpers/surface.js';

const core = await init();
stubLayout();

const YAML = `quill:
  name: inline_held
  version: 1.0.0
  backend: typst
  description: A top-level inline richtext field.
typst:
  plate_file: plate.typ
main:
  fields:
    title:
      type: richtext
      inline: true
    author:
      type: string
`;
// Re-wrapped in this realm's `Uint8Array`: under jsdom the encoder's output comes from
// another realm and the boundary refuses it by identity.
const bytes = (s: string): Uint8Array => new Uint8Array(new TextEncoder().encode(s));
const probe = (): Quill =>
	core.Quill.fromTree(
		new Map([
			['Quill.yaml', bytes(YAML)],
			['plate.typ', bytes('#set page(width: 200pt)\n')]
		])
	);
const STRUCTURED = '- one\n- two\n\npara ![i](a.png)';
const load = (title: string): Document =>
	core.Document.fromMarkdown(
		['~~~', '$quill: inline_held@1.0.0', `title: ${JSON.stringify(title)}`, '~~~', ''].join('\n')
	);

let mounted: Mounted | undefined;
afterEach(() => {
	mounted?.unmount();
	mounted = undefined;
});

/** A paste as the DOM delivers one: jsdom implements no `DataTransfer`, and `getData`
 *  is all ProseMirror's paste handler reads. */
function paste(el: HTMLElement, text: string): void {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? text : '') }
	});
	el.dispatchEvent(event);
	flushSync();
}

/** The note a held leaf draws, inside its own box and naming nothing but itself. */
function heldNote(leaf: HTMLElement): HTMLElement | null {
	const note = document.getElementById(leaf.getAttribute('aria-describedby') ?? '');
	return note && leaf.closest('.qm-control-box')?.contains(note) ? note : null;
}

const titleLeaf = (m: Mounted): HTMLElement =>
	field(m.target, 'Title').querySelector<HTMLElement>('.ProseMirror')!;

/** Commit the string beside the title: a revision, and so a re-validation. */
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

describe('a top-level inline richtext field over stored block content', () => {
	it('draws the list and the image read-only, and a paste commits nothing', () => {
		const doc = load(STRUCTURED);
		mounted = mountEditor(probe(), doc);
		const leaf = titleLeaf(mounted);

		expectHeld(leaf);
		expect([...leaf.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two']);
		expect(leaf.querySelector('[data-qm-island="image"]')).not.toBeNull();

		paste(leaf, 'Z');
		expect(doc.getStored('title')).toBe(STRUCTURED);
		expect(mounted.changes).toEqual([]);
		doc.free();
	});

	it('releases once a re-validation finds the value an external write left inline', () => {
		const q = probe();
		const doc = load(STRUCTURED);
		mounted = mountEditor(q, doc);
		expectHeld(titleLeaf(mounted));

		q.writer(doc).set('title', 'plain');
		revalidate(mounted);
		const leaf = titleLeaf(mounted);
		expect(leaf.getAttribute('contenteditable')).toBe('true');
		expect(leaf.hasAttribute('aria-describedby')).toBe(false);
		expect(mounted.target.querySelector('.qm-prose-held-note')).toBeNull();
		expect(leaf.textContent).toBe('plain');

		paste(leaf, 'Z');
		expect(mounted.changes.at(-1)?.path).toBe('main.title');
		expect(q.reader(doc).getContent({ field: 'title' })?.text).toContain('Z');
		doc.free();
	});

	it('holds once a re-validation finds structure an external store write left', () => {
		const q = probe();
		const doc = load('plain');
		mounted = mountEditor(q, doc);
		expect(titleLeaf(mounted).getAttribute('contenteditable')).toBe('true');

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

		const leaf = titleLeaf(mounted);
		expectHeld(leaf);
		expect([...leaf.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two']);
		paste(leaf, 'Z');
		expect(doc.getStored('title')).toBe(STRUCTURED);
		expect(mounted.changes.map((c) => c.path)).toEqual(['main.author']);
		doc.free();
	});
});
