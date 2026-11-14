// @vitest-environment jsdom
// A `richtext` field declaring `shape: lines` holds formatted lines and no block:
// upstream reads the syntax of a list or a heading there as its characters, so a leaf on
// the block schema would offer structure the write refuses (`validation::not_lines`).
// The leaf runs paragraphs and hard breaks with the full mark set, held over content
// upstream's `isLines` refuses, and commits content as every `richtext` leaf does. The
// reference quill declares no such field on its main card, so the schema is built here.
import { describe, it, expect } from 'vitest';
import type { Document } from '@quillmark/wasm';
import { Slice } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { Selection, TextSelection } from 'prosemirror-state';
import { createField } from '$lib/core/codec';
import { core, md, mount, press, probeQuill, viewOf } from './_util.js';

const QUILL_YAML = `
quill:
  name: lines_probe
  version: 0.1.0
  backend: typst
  description: A richtext field of lines.
typst:
  plate_file: plate.typ
main:
  fields:
    memo_for:
      type: richtext
      shape: lines
      default: ""
`;

const q = probeQuill(QUILL_YAML);
const load = (): Document =>
	core.Document.parse(
		[
			'~~~',
			'$quill: lines_probe@0.1.0',
			'memo_for: |-',
			'  123 OG/CC',
			'  **123** MXG/CC',
			'~~~',
			''
		].join('\n')
	);

function leaf(doc: Document, errors: string[] = []) {
	q.conform(doc);
	const f = createField({
		doc,
		quill: q,
		addr: { field: 'memo_for' },
		container: mount(),
		paragraphs: true,
		onError: (e) => errors.push(e.code)
	});
	return { f, view: viewOf(f) };
}

const caretAtEnd = (view: EditorView): void =>
	view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));

/** The field as a saved document reads it back: `toMarkdown`, a fresh parse, the
 *  conform a bound load runs, and the field's markdown. */
function saved(doc: Document): string {
	const back = core.Document.parse(doc.toMarkdown());
	q.conform(back);
	const content = q.reader(back).getContent({ field: 'memo_for' });
	back.free();
	return content ? (core.exportMarkdown(content) as string) : '';
}

function paste(view: EditorView, text: string): void {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? text : '') }
	});
	view.dom.dispatchEvent(event);
}

describe('a richtext field declaring `shape: lines`', () => {
	it('mounts its lines with their marks on a schema that holds no block', () => {
		const doc = load();
		const errors: string[] = [];
		const { f, view } = leaf(doc, errors);

		expect(view.editable).toBe(true);
		expect(view.state.schema.nodes.bullet_list).toBeUndefined();
		expect(view.state.schema.nodes.heading).toBeUndefined();
		expect(view.state.schema.marks.strong).toBeDefined();
		expect(view.state.doc.toString()).toBe(
			'doc(paragraph("123 OG/CC", hard_break, strong("123"), " MXG/CC"))'
		);
		view.dispatch(view.state.tr.insertText('ACC/', 1));

		expect(errors).toEqual([]);
		expect(saved(doc)).toBe('ACC/123 OG/CC\n**123** MXG/CC');
		f.destroy();
		doc.free();
	});

	it('opens a paragraph on Enter and a line on Shift-Enter', () => {
		const doc = load();
		const { f, view } = leaf(doc);
		caretAtEnd(view);
		press(view, 'Enter', { shiftKey: true });
		view.dispatch(view.state.tr.insertText('123 MSG/CC'));
		press(view, 'Enter');
		view.dispatch(view.state.tr.insertText('SEE DISTRIBUTION'));

		expect(saved(doc)).toBe('123 OG/CC\n**123** MXG/CC\n123 MSG/CC\n\nSEE DISTRIBUTION');
		f.destroy();
		doc.free();
	});

	it('keeps a typed list marker as text, through a save and the load after it', () => {
		const doc = load();
		const errors: string[] = [];
		const { f, view } = leaf(doc, errors);
		const pos = Selection.atStart(view.state.doc).from;
		view.dispatch(view.state.tr.insertText('1.', pos));
		const at = view.state.selection.head;
		const intercepted = view.someProp('handleTextInput', (h) =>
			h(view, at, at, ' ', () => view.state.tr)
		);
		expect(intercepted).toBeFalsy();
		view.dispatch(view.state.tr.insertText(' '));

		expect(errors).toEqual([]);
		expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
		const back = core.Document.parse(doc.toMarkdown());
		q.conform(back);
		const content = q.reader(back).getContent({ field: 'memo_for' })!;
		expect(core.isLines(content)).toBe(true);
		expect(content.text.startsWith('1. 123 OG/CC')).toBe(true);
		back.free();
		f.destroy();
		doc.free();
	});

	it('pastes text literally, a newline a line and a blank line a paragraph', () => {
		const doc = load();
		const { f, view } = leaf(doc);
		caretAtEnd(view);
		paste(view, '\n- one\n\n# two');

		const content = q.reader(doc).getContent({ field: 'memo_for' })!;
		expect(core.isLines(content)).toBe(true);
		let text = '';
		view.someProp('clipboardTextSerializer', (s) => {
			text = s(new Slice(view.state.doc.content, 0, 0), view);
		});
		expect(text).toBe('123 OG/CC\n123 MXG/CC\n- one\n\n# two');
		f.destroy();
		doc.free();
	});
});

describe('a richtext field of lines over content `isLines` refuses', () => {
	it('holds, committing nothing, and releases on the re-hydrate that leaves it lines', () => {
		const doc = load();
		doc.replace({ field: 'memo_for' }, md('- one\n- two'));
		const before = JSON.stringify(doc.getStored('memo_for'));
		const holds: boolean[] = [];
		const f = createField({
			doc,
			quill: q,
			addr: { field: 'memo_for' },
			container: mount(),
			paragraphs: true,
			onHold: (held) => holds.push(held)
		});
		const view = viewOf(f);
		expect(holds).toEqual([true]);
		expect(view.editable).toBe(false);
		expect(view.state.doc.firstChild?.type.name).toBe('bullet_list');
		view.dispatch(view.state.tr.insertText('Z', Selection.atStart(view.state.doc).from));
		expect(JSON.stringify(doc.getStored('memo_for'))).toBe(before);

		doc.replace({ field: 'memo_for' }, md('one\\\ntwo'));
		f.applyExternal();
		expect(holds).toEqual([true, false]);
		expect(view.editable).toBe(true);
		expect(view.state.doc.toString()).toBe('doc(paragraph("one", hard_break, "two"))');
		f.destroy();
		doc.free();
	});
});
