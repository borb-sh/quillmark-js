// @vitest-environment jsdom
// A `plaintext` field is multi-line unless it declares `inline`: upstream's literal
// codec reads one line per `\n`, so a leaf narrowed to one textblock would join an
// address's lines and commit the joined text on the first edit. Without `inline` the
// leaf runs paragraphs and hard breaks, held over content upstream's `isPlain` refuses;
// with it, one textblock. Either way it commits the literal string, the rest form a
// saved document reads back unchanged. The reference quill declares no `plaintext`
// field without `inline`, so the schema is built here.
import { describe, it, expect } from 'vitest';
import { init, type Document, type Quill } from '@quillmark/wasm';
import { Slice } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { Selection, TextSelection } from 'prosemirror-state';
import { createField, type FieldController } from '$lib/core/codec';
import { mount, press } from './_util.js';

const core = await init();

const QUILL_YAML = `
quill:
  name: plain_probe
  version: 0.1.0
  backend: typst
  description: A plaintext field without inline and one with it.
typst:
  plate_file: plate.typ
main:
  fields:
    address:
      type: plaintext
      default: ""
    line:
      type: plaintext
      inline: true
      default: ""
`;

// Re-wrapped in this realm's `Uint8Array`: under jsdom the encoder's output comes from
// another realm and the boundary refuses it by identity.
const bytes = (s: string): Uint8Array => new Uint8Array(new TextEncoder().encode(s));
const probe = (): Quill =>
	core.Quill.fromTree(
		new Map([
			['Quill.yaml', bytes(QUILL_YAML)],
			['plate.typ', bytes('#set page(width: 200pt)\n')]
		])
	);
const load = (): Document =>
	core.Document.fromMarkdown(
		[
			'~~~',
			'$quill: plain_probe@0.1.0',
			'address: |-',
			'  12 Main St',
			'  Springfield',
			'line: One line',
			'~~~',
			''
		].join('\n')
	);

const viewOf = (f: FieldController): EditorView =>
	(f as FieldController & { view: EditorView }).view;

function leaf(q: Quill, doc: Document, field: string, inline = false, errors: string[] = []) {
	const f = createField({
		doc,
		quill: q,
		addr: { field },
		container: mount(),
		plaintext: true,
		inline,
		onError: (e) => errors.push(e.code)
	});
	return { f, view: viewOf(f) };
}

const caretAtEnd = (view: EditorView): void =>
	view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));

/** The field as a saved document reads it back: `toMarkdown`, a fresh parse, and the
 *  schema-bound read. */
function saved(q: Quill, doc: Document, field: string): unknown {
	const back = core.Document.fromMarkdown(doc.toMarkdown());
	const value = q.reader(back).get(field);
	back.free();
	return value;
}

/** A paste as the DOM delivers one: jsdom implements no `DataTransfer`, and `getData`
 *  is all ProseMirror's paste handler reads. */
function paste(view: EditorView, text: string): void {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? text : '') }
	});
	view.dom.dispatchEvent(event);
}

describe('a plaintext field without `inline`', () => {
	it('keeps both lines of an address through an edit', () => {
		const q = probe();
		const doc = load();
		const errors: string[] = [];
		const { f, view } = leaf(q, doc, 'address', false, errors);

		expect(view.state.doc.toString()).toBe(
			'doc(paragraph("12 Main St", hard_break, "Springfield"))'
		);
		view.dispatch(view.state.tr.insertText('Apt 4, ', 1));

		expect(errors).toEqual([]);
		expect(doc.getStored('address')).toBe('Apt 4, 12 Main St\nSpringfield');
		expect(saved(q, doc, 'address')).toBe('Apt 4, 12 Main St\nSpringfield');
		f.destroy();
		doc.free();
	});

	// The shapes `toMarkdown` respells when the field rests as a content object: a break
	// as a trailing backslash, a blank line, a newline at either edge, trailing spaces.
	it.each([
		['a lone newline', 'a\nb'],
		['a blank line', 'a\n\nb'],
		['a trailing newline', 'a\n'],
		['a leading newline', '\na'],
		['trailing spaces', 'a  \nb  '],
		['markdown delimiters', 'x *y* z\n- not a list']
	])('an edit rests %s as the string a saved document reads back', (_, value) => {
		const q = probe();
		const doc = load();
		q.writer(doc).set('address', value);
		const { f, view } = leaf(q, doc, 'address');
		view.dispatch(view.state.tr.insertText('!', 1));

		expect(doc.getStored('address')).toBe(`!${value}`);
		expect(saved(q, doc, 'address')).toBe(`!${value}`);
		f.destroy();
		doc.free();
	});

	it('opens a line on Enter and on Shift-Enter, each one stored `\\n`', () => {
		const q = probe();
		const doc = load();
		const { f, view } = leaf(q, doc, 'address');
		caretAtEnd(view);
		press(view, 'Enter');
		view.dispatch(view.state.tr.insertText('IL'));
		press(view, 'Enter', { shiftKey: true });
		view.dispatch(view.state.tr.insertText('USA'));

		expect(view.state.doc.toString()).toBe(
			'doc(paragraph("12 Main St", hard_break, "Springfield"), paragraph("IL", hard_break, "USA"))'
		);
		expect(saved(q, doc, 'address')).toBe('12 Main St\nSpringfield\nIL\nUSA');
		// A paragraph is a line: the stylesheet's rhythm between blocks answers to
		// `data-qm-line`, so a boundary draws the one line down a break does.
		expect([...view.dom.children].map((p) => p.hasAttribute('data-qm-line'))).toEqual([true, true]);
		f.destroy();
		doc.free();
	});

	it('pastes text literally, a blank line kept, and copies it back the same way', () => {
		const q = probe();
		const doc = load();
		const { f, view } = leaf(q, doc, 'address');
		caretAtEnd(view);
		paste(view, '\none\n\ntwo');

		expect(saved(q, doc, 'address')).toBe('12 Main St\nSpringfield\none\n\ntwo');
		let text = '';
		view.someProp('clipboardTextSerializer', (s) => {
			text = s(new Slice(view.state.doc.content, 0, 0), view);
		});
		expect(text).toBe('12 Main St\nSpringfield\none\n\ntwo');
		f.destroy();
		doc.free();
	});

	it('builds no mark from a shorthand, delimiters kept', () => {
		const q = probe();
		const doc = load();
		const { f, view } = leaf(q, doc, 'address');
		caretAtEnd(view);
		view.dispatch(view.state.tr.insertText(' **x*'));
		const pos = view.state.selection.head;
		const intercepted = view.someProp('handleTextInput', (h) =>
			h(view, pos, pos, '*', () => view.state.tr)
		);
		expect(intercepted).toBeFalsy();
		view.dispatch(view.state.tr.insertText('*'));
		expect(doc.getStored('address')).toBe('12 Main St\nSpringfield **x**');
		f.destroy();
		doc.free();
	});
});

describe('a plaintext field declaring `inline`', () => {
	it('stays one textblock: Enter and Shift-Enter open nothing', () => {
		const q = probe();
		const doc = load();
		const { f, view } = leaf(q, doc, 'line', true);
		caretAtEnd(view);
		press(view, 'Enter');
		press(view, 'Enter', { shiftKey: true });

		expect(view.state.schema.nodes.hard_break).toBeUndefined();
		expect(view.state.doc.toString()).toBe('doc(paragraph("One line"))');
		f.destroy();
		doc.free();
	});

	it.each([
		['trailing spaces', 'one line  '],
		['leading spaces', '  one line'],
		['markdown delimiters', 'x *y* z']
	])('an edit rests %s as the string a saved document reads back', (_, value) => {
		const q = probe();
		const doc = load();
		q.writer(doc).set('line', value);
		const { f, view } = leaf(q, doc, 'line', true);
		view.dispatch(view.state.tr.insertText('!', 1));

		expect(doc.getStored('line')).toBe(`!${value}`);
		expect(saved(q, doc, 'line')).toBe(`!${value}`);
		f.destroy();
		doc.free();
	});
});

describe('a plaintext field without `inline` over content `isPlain` refuses', () => {
	it('holds, committing nothing, and releases on the re-hydrate that leaves it plain', () => {
		const q = probe();
		const doc = load();
		doc.overwrite({ field: 'address' }, core.importMarkdown('- one\n- two'));
		const before = JSON.stringify(doc.getStored('address'));
		const holds: boolean[] = [];
		const f = createField({
			doc,
			quill: q,
			addr: { field: 'address' },
			container: mount(),
			plaintext: true,
			onHold: (held) => holds.push(held)
		});
		const view = viewOf(f);
		expect(holds).toEqual([true]);
		expect(view.editable).toBe(false);
		expect(view.state.doc.firstChild?.type.name).toBe('bullet_list');
		// The transaction a keystroke dispatches, which the typed write would store joined.
		view.dispatch(view.state.tr.insertText('Z', Selection.atStart(view.state.doc).from));
		expect(JSON.stringify(doc.getStored('address'))).toBe(before);

		q.writer(doc).set('address', '12 Main St\nSpringfield');
		f.applyExternal();
		expect(holds).toEqual([true, false]);
		expect(view.editable).toBe(true);
		expect(view.state.doc.toString()).toBe(
			'doc(paragraph("12 Main St", hard_break, "Springfield"))'
		);
		view.dispatch(view.state.tr.insertText('Z', 1));
		expect(doc.getStored('address')).toBe('Z12 Main St\nSpringfield');
		f.destroy();
		doc.free();
	});

	it('does not hold for a mark alone, which the decode drops', () => {
		const q = probe();
		const doc = load();
		doc.overwrite({ field: 'address' }, core.importMarkdown('**12** Main St'));
		const { f, view } = leaf(q, doc, 'address');
		expect(view.editable).toBe(true);
		expect(view.state.doc.toString()).toBe('doc(paragraph("12 Main St"))');
		f.destroy();
		doc.free();
	});
});
