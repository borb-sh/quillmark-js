// @vitest-environment jsdom
// The formatting popover over a by-value prose leaf: an array's element, a cell of an
// open record row, a field-level subform's cell and a table's cell register no
// controller, and each announces its views on focus under the field it stands in, so
// the active-leaf seam hands back the focused one and a mark toggled at its view
// commits by value, as a keystroke does. The anchor verbs are a field's controller's,
// so the surface over an embedded leaf carries no anchor button. A `plaintext` element
// declares no marks and a held leaf announces nothing, so neither raises it. A field's
// own leaf answers through its controller, the anchor button with it. The probe is its
// own quill.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { toggleMark } from 'prosemirror-commands';
import type { Content, Document, PathStep } from '@quillmark/wasm';
import { hasMarks } from '$lib/core/codec';
import { DEFAULT_VISUAL_STRINGS } from '$lib/visual';
import { core, quillFromYaml } from '../helpers/fixtures.js';
import {
	field,
	mountInner,
	press,
	settle,
	type,
	unmountAll,
	type InnerRef,
	type Mounted
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const YAML = `quill:
  name: value_popover
  version: 1.0.0
  backend: typst
  description: By-value prose leaves at every site, a field's own leaf, and a string.
typst:
  plate_file: plate.typ
main:
  fields:
    notes:
      type: array
      items:
        type: richtext
      default: []
    errata:
      type: array
      items:
        type: plaintext
      default: []
    jobs:
      type: array
      items:
        type: object
        properties:
          title:
            type: string
          summary:
            type: richtext
            inline: true
      default: []
    crew:
      type: array
      items:
        type: object
        properties:
          who:
            type: string
          note:
            type: richtext
            inline: true
      ui:
        layout: table
      default: []
    contact:
      type: object
      properties:
        phone:
          type: string
        note:
          type: richtext
    intro:
      type: richtext
    author:
      type: string
`;
const probe = () => quillFromYaml(YAML);
const load = (notes: string[] = ['First note', 'Second note']): Document => {
	const doc = core.Document.fromMarkdown(
		[
			'~~~',
			'$quill: value_popover@1.0.0',
			'errata:',
			'  - Plain line',
			'jobs:',
			'  - title: Archives',
			'    summary: Old summary',
			'crew:',
			'  - who: Ada',
			'    note: Crew note',
			'contact:',
			'  phone: "555"',
			'  note: Contact note',
			'intro: Intro words',
			'~~~',
			''
		].join('\n')
	);
	doc.storeField('notes', notes);
	return doc;
};
const LIST = '- one\n- two';
const STRONG = [{ type: 'strong', start: 0, end: 3 }];

/** Land the caret in the leaf at `path`, as a preview click does, and hand back the
 *  element that took it. */
async function land(editor: InnerRef, path: string): Promise<HTMLElement> {
	await editor.setCaret({ field: path, pos: 0 });
	await settle();
	const leaf = document.activeElement as HTMLElement;
	expect(leaf.classList.contains('ProseMirror')).toBe(true);
	return leaf;
}

/** Select `[from, to)` of the leaf's first line as a pointer does: the DOM range, and
 *  the `selectionchange` both the view and the popover read it through. */
function select(leaf: HTMLElement, from: number, to: number): void {
	const text = leaf.querySelector('p')!.firstChild!;
	const range = document.createRange();
	range.setStart(text, from);
	range.setEnd(text, to);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
	document.dispatchEvent(new Event('selectionchange'));
	flushSync();
}

/** The popover once its coalesced check has run, or `null` where it withheld itself. */
async function surface(): Promise<HTMLElement | null> {
	await new Promise<void>((r) => requestAnimationFrame(() => r()));
	flushSync();
	await settle();
	return document.querySelector<HTMLElement>('.qm-format-popover');
}
const labels = (popover: HTMLElement): (string | null)[] =>
	[...popover.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));

/** Commit the string beside the leaves: a revision, and so a re-derive. */
function rederive(m: Mounted<InnerRef>): void {
	type(field(m.target, 'Author').querySelector<HTMLInputElement>('input')!, 'Ann');
}

describe('the formatting popover over a by-value prose leaf', () => {
	const SITES = [
		['an array element', 'main.notes[0]', 'notes', [0], 'First note'],
		['an open row cell', 'main.jobs[0].summary', 'jobs', [0, 'summary'], 'Old summary'],
		['a subform cell', 'main.contact.note', 'contact', ['note'], 'Contact note'],
		['a table cell', 'main.crew[0].note', 'crew', [0, 'note'], 'Crew note']
	] as const;

	for (const [site, path, name, at, text] of SITES) {
		it(`hands back ${site}'s view, and bold toggled at it lands in the store`, async () => {
			const q = probe();
			const doc = load();
			const mounted = mountInner(q, doc);
			const read = (path: PathStep[]): Content | undefined =>
				q.reader(doc).getContentAt({ field: name }, path);
			const leaf = await land(mounted.editor, path);
			expect(leaf.textContent).toBe(text);
			select(leaf, 0, 3);

			const active = mounted.editor.getActiveLeaf();
			const view = active!.views.focusedView();
			expect(view.dom).toBe(leaf);
			expect(view.hasFocus()).toBe(true);
			expect(active!.controller).toBeUndefined();
			expect(hasMarks(view.state.schema)).toBe(true);

			// The popover's own `toggle`: the command straight at the view.
			toggleMark(view.state.schema.marks.strong)(view.state, view.dispatch);
			flushSync();
			expect(read([...at])?.marks).toEqual(STRONG);
			expect(read([...at])?.text).toBe(text);
			expect(mounted.changes.at(-1)?.path).toBe(`main.${name}`);
		});
	}

	it('rises over an element’s selection without the anchor button, and its bold commits', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		select(await land(editor, 'main.notes[0]'), 0, 3);

		const popover = await surface();
		expect(popover).not.toBeNull();
		expect(labels(popover!)).not.toContain(DEFAULT_VISUAL_STRINGS.formatAnchor);
		popover!
			.querySelector<HTMLButtonElement>(`[aria-label="${DEFAULT_VISUAL_STRINGS.formatBold}"]`)!
			.click();
		flushSync();
		expect(q.reader(doc).getContentAt({ field: 'notes' }, [0])?.marks).toEqual(STRONG);
	});

	it('writes its link prompt to the element it rose over, the prompt holding the focus', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		const leaf = await land(editor, 'main.notes[0]');
		select(leaf, 0, 3);
		(await surface())!
			.querySelector<HTMLButtonElement>(`[aria-label="${DEFAULT_VISUAL_STRINGS.formatLink}"]`)!
			.click();
		flushSync();

		const input = document.querySelector<HTMLInputElement>('.qm-link-input')!;
		expect(document.activeElement).toBe(input);
		input.value = 'example.com';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.form!.requestSubmit();
		flushSync();
		const marks = q.reader(doc).getContentAt({ field: 'notes' }, [0])?.marks;
		expect(marks?.map((m) => [m.type, m.start, m.end])).toEqual([['link', 0, 3]]);
	});

	it('takes Mod-b through the element’s own keymap, which asks no seam', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		const leaf = await land(editor, 'main.notes[0]');
		select(leaf, 0, 3);
		press(leaf, 'b', { ctrlKey: true });
		expect(q.reader(doc).getContentAt({ field: 'notes' }, [0])?.marks).toEqual(STRONG);
	});

	it('answers the element focused last, of several sharing the field', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		await land(editor, 'main.notes[0]');
		const second = await land(editor, 'main.notes[1]');

		expect(editor.getActiveLeaf()?.views.view.dom).toBe(second);
	});

	it('answers none once the element it answered is gone', async () => {
		const q = probe();
		const doc = load();
		const mounted = mountInner(q, doc);
		await land(mounted.editor, 'main.notes[1]');

		q.writer(doc).set('notes', ['First note']);
		rederive(mounted);
		expect(field(mounted.target, 'Notes').querySelectorAll('.ProseMirror')).toHaveLength(1);
		expect(mounted.editor.getActiveLeaf()).toBeUndefined();
	});

	it('withholds itself over a plaintext element, which declares no marks', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		const leaf = await land(editor, 'main.errata[0]');
		select(leaf, 0, 3);

		const { schema } = editor.getActiveLeaf()!.views.focusedView().state;
		expect(hasMarks(schema)).toBe(false);
		expect(schema.marks.strong).toBeUndefined();
		expect(await surface()).toBeNull();
	});

	it('finds no active leaf in a held element, and the one a write releases under the caret', () => {
		const q = probe();
		const doc = load([LIST, 'Second note']);
		const mounted = mountInner(q, doc);
		const { editor } = mounted;
		const leaf = field(mounted.target, 'Notes').querySelector<HTMLElement>('.ProseMirror')!;
		expect(leaf.getAttribute('contenteditable')).toBe('false');
		// A held leaf is a focusable read-only textbox on the block schema, which has
		// marks: what keeps the surface off it is that it announces nothing.
		leaf.focus();
		flushSync();
		expect(document.activeElement).toBe(leaf);
		expect(editor.getActiveLeaf()).toBeUndefined();

		q.writer(doc).set('notes', ['Plain', 'Second note']);
		rederive(mounted);
		expect(leaf.getAttribute('contenteditable')).toBe('true');
		expect(editor.getActiveLeaf()?.views.view.dom).toBe(leaf);

		q.writer(doc).set('notes', [LIST, 'Second note']);
		rederive(mounted);
		expect(leaf.getAttribute('contenteditable')).toBe('false');
		expect(editor.getActiveLeaf()).toBeUndefined();
	});
});

describe('the formatting popover over a field’s own leaf', () => {
	it('answers through the controller, the anchor button with it', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		await land(editor, 'main.notes[0]');
		const intro = await land(editor, 'main.intro');
		select(intro, 0, 3);

		const active = editor.getActiveLeaf();
		expect(active?.controller).toBeDefined();
		expect(active?.views.view.dom).toBe(intro);
		const popover = await surface();
		expect(labels(popover!)).toContain(DEFAULT_VISUAL_STRINGS.formatAnchor);
	});

	it('finds none once a form control takes the focus', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		await land(editor, 'main.notes[0]');
		await editor.focusField('main.author');
		await settle();

		expect(editor.getActiveLeaf()).toBeUndefined();
	});
});
