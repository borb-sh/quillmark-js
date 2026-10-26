// @vitest-environment jsdom
// The formatting popover over a by-value prose leaf: an array's element, a cell of an
// open record row, a field-level subform's cell and a table's cell register no
// controller, and each announces its views on focus under the field it stands in, so
// the active-leaf seam hands back the focused one and a mark toggled at its view
// commits by value, as a keystroke does. A `text` element declares no marks and a
// held leaf announces nothing, so neither raises it. A field's own leaf answers through
// its controller's views. Over every leaf the surface draws the six mark buttons and
// withholds the anchor's, an anchor drawing nothing until comments do. Mod-K is a press
// of the Link button wherever the button stands, a table island's cell included. The
// probe is its own quill.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { toggleMark } from 'prosemirror-commands';
import { TextSelection } from 'prosemirror-state';
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
  description: By-value prose leaves at every site, a field's own leaf, and a number.
typst:
  plate_file: plate.typ
main:
  fields:
    notes:
      type: array
      items:
        type: richtext
        multiline: true
      default: []
    errata:
      type: array
      items:
        type: text
        multiline: true
      default: []
    jobs:
      type: array
      items:
        type: object
        properties:
          title:
            type: text
          summary:
            type: richtext
            multiline: false
      default: []
    crew:
      type: array
      items:
        type: object
        properties:
          who:
            type: text
          note:
            type: richtext
            multiline: false
      ui:
        layout: table
      default: []
    contact:
      type: object
      properties:
        phone:
          type: text
        note:
          type: richtext
          multiline: true
    intro:
      type: richtext
      multiline: true
    pages:
      type: integer
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

/** Select `[from, to)` of the leaf's first line as a pointer does: a press, the DOM
 *  range and the `selectionchange` both the view and the popover read it through, and the
 *  release. `pointer: false` is the keyboard's selection, the range with no press. `text`
 *  is the node the offsets count in, the line's first by default. */
function select(
	leaf: HTMLElement,
	from: number,
	to: number,
	pointer = true,
	text: Node = leaf.querySelector('p')!.firstChild!
): void {
	if (pointer) leaf.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	const range = document.createRange();
	range.setStart(text, from);
	range.setEnd(text, to);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
	document.dispatchEvent(new Event('selectionchange'));
	if (pointer) leaf.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
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
/** The list toggles, after the marks, over a leaf that holds lists. */
const LISTS = [
	DEFAULT_VISUAL_STRINGS.formatNumberedList,
	DEFAULT_VISUAL_STRINGS.formatBulletedList
];
const SIX = [
	DEFAULT_VISUAL_STRINGS.formatBold,
	DEFAULT_VISUAL_STRINGS.formatEmphasis,
	DEFAULT_VISUAL_STRINGS.formatUnderline,
	DEFAULT_VISUAL_STRINGS.formatStrikethrough,
	DEFAULT_VISUAL_STRINGS.formatCode,
	DEFAULT_VISUAL_STRINGS.formatLink
];
/** The family menu's trigger, last, and only over a registry. */
const FONT = [DEFAULT_VISUAL_STRINGS.formatFont];

/** Commit the number beside the leaves: a revision, and so a re-derive. */
function rederive(m: Mounted<InnerRef>): void {
	type(field(m.target, 'Pages').querySelector<HTMLInputElement>('input')!, '7');
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
			expect(hasMarks(view.state.schema)).toBe(true);

			// The popover's own `toggle`: the command straight at the view.
			toggleMark(view.state.schema.marks.strong)(view.state, view.dispatch);
			flushSync();
			expect(read([...at])?.marks).toEqual(STRONG);
			expect(read([...at])?.text).toBe(text);
			expect(mounted.changes.at(-1)?.path).toBe(`main.${name}`);
		});
	}

	it('rises over an element’s selection, and its bold commits', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		select(await land(editor, 'main.notes[0]'), 0, 3);

		const popover = await surface();
		expect(popover).not.toBeNull();
		expect(labels(popover!)).toEqual(SIX);
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

	it('withholds itself over a text element, which declares no marks', async () => {
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
	it('answers through the controller’s views, and withholds the anchor button', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		await land(editor, 'main.notes[0]');
		const intro = await land(editor, 'main.intro');
		select(intro, 0, 3);

		expect(editor.getActiveLeaf()?.views.view.dom).toBe(intro);
		const popover = await surface();
		expect(labels(popover!)).toEqual([...SIX, ...LISTS]);
		expect(labels(popover!)).not.toContain(DEFAULT_VISUAL_STRINGS.formatAnchor);
	});

	/** The family menu over `intro`'s first run, the registry holding Carlito alone. */
	async function familyShown(intro: string): Promise<(string | null)[]> {
		const q = probe();
		const doc = load();
		q.writer(doc).set('intro', intro);
		const fonts = [
			{ family: 'Carlito', weight: 400, style: 'normal' as const, index: 0, data: new Uint8Array() }
		];
		const { editor } = mountInner(q, doc, { fonts });
		const leaf = await land(editor, 'main.intro');
		const run = leaf.querySelector('[data-qm-font-family]')!;
		select(leaf, 0, 3, true, document.createTreeWalker(run, NodeFilter.SHOW_TEXT).nextNode()!);
		const popover = await surface();
		expect(labels(popover!)).toEqual([...SIX, ...LISTS, ...FONT]);
		return [...popover!.querySelectorAll('.qm-format-menu-shown')].map((s) => s.textContent);
	}

	it('draws the family menu over a registry, showing the family the selection is in', async () => {
		expect(await familyShown('<qm-span family="Carlito">Intro</qm-span> words')).toEqual([
			'Carlito'
		]);
	});

	it('shows a family the registry lacks as unavailable', async () => {
		expect(await familyShown('<qm-span family="Gone">Intro</qm-span> words')).toEqual([
			DEFAULT_VISUAL_STRINGS.formatFontMissing('Gone')
		]);
	});

	it('numbers the selected line, and the list lands in the store', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		const intro = await land(editor, 'main.intro');
		select(intro, 0, 3);
		(await surface())!
			.querySelector<HTMLButtonElement>(
				`[aria-label="${DEFAULT_VISUAL_STRINGS.formatNumberedList}"]`
			)!
			.click();
		flushSync();
		expect(intro.querySelector('ol > li')?.textContent).toBe('Intro words');
		expect(q.reader(doc).getContentAt({ field: 'intro' }, [])?.lines[0].containers).toHaveLength(1);
		expect(document.activeElement).toBe(intro);
	});

	it('rises over a keyboard selection once it stands still, and lowers at once', async () => {
		const { editor } = mountInner(probe(), load());
		const intro = await land(editor, 'main.intro');
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			select(intro, 0, 3, false);
			expect(await surface()).toBeNull();
			select(intro, 0, 4, false);
			await surface();
			vi.advanceTimersByTime(449);
			expect(await surface()).toBeNull();
			vi.advanceTimersByTime(1);
			expect(await surface()).not.toBeNull();
		} finally {
			vi.useRealTimers();
		}
		select(intro, 2, 2, false);
		expect((await surface())?.dataset.state ?? 'closed').toBe('closed');
	});

	it('finds none once a form control takes the focus', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		await land(editor, 'main.notes[0]');
		await editor.focusField('main.pages');
		await settle();

		expect(editor.getActiveLeaf()).toBeUndefined();
	});
});

describe('Mod-K raises the link prompt', () => {
	/** A cancelable Mod-K, so the test reads whether the editor claimed it. */
	function modK(el: Element): KeyboardEvent {
		const e = new KeyboardEvent('keydown', {
			key: 'k',
			ctrlKey: true,
			bubbles: true,
			cancelable: true
		});
		el.dispatchEvent(e);
		flushSync();
		return e;
	}
	const prompt = () => document.querySelector<HTMLInputElement>('.qm-link-input');
	function submit(value: string): void {
		const input = prompt()!;
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.form!.requestSubmit();
		flushSync();
	}
	const removeArm = () =>
		[...document.querySelectorAll('.qm-link-prompt button')].some(
			(b) => b.textContent === DEFAULT_VISUAL_STRINGS.linkRemove
		);

	it('over a selection, at once and without the browser, as the Link button does', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		const intro = await land(editor, 'main.intro');
		select(intro, 0, 5, false);

		const e = modK(intro);
		expect(e.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(prompt());
		expect(prompt()!.value).toBe('');
		expect(removeArm()).toBe(false);
		submit('example.com');
		const marks = q.reader(doc).getContent({ field: 'intro' })?.marks;
		expect(marks?.map((m) => [m.type, m.start, m.end])).toEqual([['link', 0, 5]]);
		expect(document.activeElement).toBe(intro);

		// Over the link it seeds the href and carries the remove arm.
		const view = editor.getActiveLeaf()!.views.view;
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
		modK(intro);
		expect(prompt()!.value).toBe('https://example.com');
		expect(removeArm()).toBe(true);
		// A second press inside the prompt is swallowed and keeps what is typed there.
		prompt()!.value = 'typed';
		prompt()!.dispatchEvent(new Event('input', { bubbles: true }));
		expect(modK(prompt()!).defaultPrevented).toBe(true);
		expect(prompt()!.value).toBe('typed');
	});

	it('declines where the Link button would not stand, leaving the key to the browser', async () => {
		const q = probe();
		const doc = load();
		const { editor } = mountInner(q, doc);
		const intro = await land(editor, 'main.intro');
		select(intro, 2, 2, false);
		expect(modK(intro).defaultPrevented).toBe(false);
		expect(prompt()).toBeNull();

		const errata = await land(editor, 'main.errata[0]');
		select(errata, 0, 5, false);
		expect(modK(errata).defaultPrevented).toBe(false);
		expect(prompt()).toBeNull();
	});

	it('in a table cell, writing the link into the cell', async () => {
		const q = probe();
		const doc = core.Document.fromMarkdown(
			[
				'~~~',
				'$quill: value_popover@1.0.0',
				'~~~',
				'',
				'| aa | bb |',
				'|---|---|',
				'| 1 | 2 |',
				''
			].join('\n')
		);
		const mounted = mountInner(q, doc);
		await land(mounted.editor, 'main.body');
		const cell = mounted.target.querySelector<HTMLElement>('.qm-table-cell-host .ProseMirror')!;
		cell.focus();
		flushSync();
		select(cell, 0, 2, false);
		expect(mounted.editor.getActiveLeaf()!.views.focusedView().dom).toBe(cell);

		expect(modK(cell).defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(prompt());
		submit('example.com');
		const table = doc.main.body.islands[0].props as {
			header: { text: string; marks: { type: string; start: number; end: number }[] }[];
		};
		expect(table.header[0].marks.map((m) => [m.type, m.start, m.end])).toEqual([['link', 0, 2]]);
	});
});
