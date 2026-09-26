// @vitest-environment jsdom
// A `plaintext` field is multi-line unless it declares `inline`: upstream's literal
// codec reads one line per `\n`, so a leaf narrowed to one textblock would join an
// address's lines and commit the joined text on the first edit. Without `inline` the
// leaf runs paragraphs and hard breaks, held over content upstream's `isPlain` refuses;
// with it, one textblock. The reference quill declares no `plaintext` field without
// `inline`, so the schema is built here.
import { describe, it, expect } from 'vitest';
import { init, type Document, type Quill } from '@quillmark/wasm';
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

describe('a plaintext field without `inline`', () => {
	it('keeps both lines of an address through an edit', () => {
		const q = probe();
		const doc = load();
		const errors: string[] = [];
		const { f, view } = leaf(q, doc, 'address', false, errors);

		expect(view.dom.innerHTML).toBe('<p>12 Main St<br>Springfield</p>');
		view.dispatch(view.state.tr.insertText('Apt 4, ', 1));

		expect(errors).toEqual([]);
		const stored = q.reader(doc).getContent('address')!;
		expect(stored.text).toBe('Apt 4, 12 Main St\nSpringfield');
		expect(core.isPlain(stored)).toBe(true);
		f.destroy();
		doc.free();
	});

	it('opens a paragraph on Enter and a break on Shift-Enter', () => {
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
		expect(q.reader(doc).getContent('address')!.text).toBe('12 Main St\nSpringfield\nIL\nUSA');
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
});

describe('a plaintext field without `inline` over content `isPlain` refuses', () => {
	it('holds, and releases on the re-hydrate that leaves it plain', () => {
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
		view.dispatch(view.state.tr.insertText('Z', Selection.atStart(view.state.doc).from));
		expect(JSON.stringify(doc.getStored('address'))).toBe(before);

		q.writer(doc).set('address', '12 Main St\nSpringfield');
		f.applyExternal();
		expect(holds).toEqual([true, false]);
		expect(view.editable).toBe(true);
		expect(view.dom.innerHTML).toBe('<p>12 Main St<br>Springfield</p>');
		f.destroy();
		doc.free();
	});

	it('does not hold for a mark alone, which the decode drops', () => {
		const q = probe();
		const doc = load();
		doc.overwrite({ field: 'address' }, core.importMarkdown('**12** Main St'));
		const { f, view } = leaf(q, doc, 'address');
		expect(view.editable).toBe(true);
		expect(view.dom.innerHTML).toBe('<p>12 Main St</p>');
		f.destroy();
		doc.free();
	});
});
