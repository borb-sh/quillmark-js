// @vitest-environment jsdom
// A content field's `max:` as a bound no edit crosses: a keystroke at the cap lands
// nothing, a paste lands what fits, and a value stored past the cap edits down. The
// count is Quillmark's, so the leaf refuses exactly what `validation::over_length`
// would warn of.
import { describe, it, expect } from 'vitest';
import type { Document } from '@quillmark/wasm';
import { undo } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';
import { capCount, createField, type FieldController } from '$lib/core/codec';
import { core, mount, probeQuill, viewOf } from './_util.js';

/** A plain-text paste event jsdom can carry: it implements no `ClipboardEvent`. */
function pasteEvent(): ClipboardEvent {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { getData: () => '', setData: () => {} }
	});
	return event as ClipboardEvent;
}

const q = probeQuill(`
quill:
  name: cap_probe
  version: 0.1.0
  backend: typst
  description: Content fields capped by max.
typst:
  plate_file: plate.typ
main:
  fields:
    code:
      type: text
      max: 5
    note:
      type: text
      multiline: true
      max: 8
    tag:
      type: richtext
      multiline: false
      max: 6
    memo:
      type: richtext
      multiline: true
      max: 12
`);

const docWith = (fields: Record<string, string> = {}): Document =>
	core.Document.fromMarkdown(
		[
			'~~~',
			'$quill: cap_probe@0.1.0',
			'$kind: main',
			...Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
			'~~~',
			'',
			''
		].join('\n')
	);

type Leaf = 'code' | 'note' | 'tag' | 'memo';
const SHAPE: Record<Leaf, { inline: boolean; plaintext: boolean; max: number; trimEnd: boolean }> =
	{
		code: { inline: true, plaintext: true, max: 5, trimEnd: true },
		note: { inline: false, plaintext: true, max: 8, trimEnd: false },
		tag: { inline: true, plaintext: false, max: 6, trimEnd: false },
		memo: { inline: false, plaintext: false, max: 12, trimEnd: false }
	};

function leaf(doc: Document, name: Leaf): FieldController {
	const { inline, plaintext, max, trimEnd } = SHAPE[name];
	return createField({
		doc,
		quill: q,
		addr: { field: name },
		container: mount(),
		inline,
		plaintext,
		cap: { max, trimEnd }
	});
}

/** Quillmark's own count for `name`, `undefined` where it warns nothing. */
function overLength(doc: Document, name: Leaf): unknown {
	return q
		.validate(doc)
		.find((d) => d.code === 'validation::over_length' && d.path === `main.${name}`)?.args?.actual;
}

describe('typing', () => {
	it('lands up to the cap and nothing past it', () => {
		const doc = docWith();
		const field = leaf(doc, 'code');
		const view = viewOf(field);
		for (const ch of 'abcdefg') view.dispatch(view.state.tr.insertText(ch));
		expect(doc.getStored('code')).toBe('abcde');
		expect(overLength(doc, 'code')).toBeUndefined();
		field.destroy();
	});

	it('counts a character, not a UTF-16 unit', () => {
		const doc = docWith();
		const field = leaf(doc, 'code');
		const view = viewOf(field);
		view.dispatch(view.state.tr.insertText('😀😀😀😀'));
		view.dispatch(view.state.tr.insertText('😀'));
		view.dispatch(view.state.tr.insertText('x'));
		expect(doc.getStored('code')).toBe('😀😀😀😀😀');
		field.destroy();
	});

	it('counts a line break as one in a multiline field', () => {
		const doc = docWith();
		const field = leaf(doc, 'memo');
		const view = viewOf(field);
		view.dispatch(view.state.tr.insertText('hello'));
		view.dispatch(view.state.tr.split(view.state.selection.from));
		view.dispatch(view.state.tr.insertText('world!'));
		expect(capCount(view.state.doc)).toBe(12);
		view.dispatch(view.state.tr.insertText('?'));
		expect(field.getContent().text).toBe('hello\nworld!');
		field.destroy();
	});

	it('undoes past what the cap refused', () => {
		const doc = docWith();
		const field = leaf(doc, 'tag');
		const view = viewOf(field);
		view.dispatch(view.state.tr.insertText('abcdef'));
		view.dispatch(view.state.tr.insertText('g'));
		undo(view.state, view.dispatch);
		expect(view.state.doc.textContent).toBe('');
		field.destroy();
	});
});

describe('paste', () => {
	it('lands what fits and drops the rest', () => {
		const doc = docWith({ tag: 'ab' });
		const field = leaf(doc, 'tag');
		const view = viewOf(field);
		view.pasteText('123456789', pasteEvent());
		expect(field.getContent().text).toBe('1234ab');
		field.destroy();
	});

	it('cuts a paste over a selection by what the selection frees', () => {
		const doc = docWith({ code: 'abcde' });
		const field = leaf(doc, 'code');
		const view = viewOf(field);
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 5)));
		view.pasteText('XYZW', pasteEvent());
		expect(doc.getStored('code')).toBe('aXYZe');
		field.destroy();
	});

	it('lands nothing in a full field', () => {
		const doc = docWith({ note: 'abcdefgh' });
		const field = leaf(doc, 'note');
		const view = viewOf(field);
		view.pasteText('more', pasteEvent());
		expect(doc.getStored('note')).toBe('abcdefgh');
		field.destroy();
	});

	it('cuts a multi-line paste inside its lines', () => {
		const doc = docWith();
		const field = leaf(doc, 'note');
		const view = viewOf(field);
		view.pasteText('one\ntwo\nthree', pasteEvent());
		expect(doc.getStored('note')).toBe('one\ntwo\n');
		expect(overLength(doc, 'note')).toBeUndefined();
		field.destroy();
	});
});

describe('a value stored past the cap', () => {
	it('edits down and grows no further', () => {
		const doc = docWith({ code: 'abcdefgh' });
		const field = leaf(doc, 'code');
		const view = viewOf(field);
		view.dispatch(view.state.tr.insertText('x', 1));
		expect(doc.getStored('code')).toBe('abcdefgh');
		view.dispatch(view.state.tr.delete(1, 2));
		expect(doc.getStored('code')).toBe('bcdefgh');
		view.dispatch(view.state.tr.insertText('X', 1, 2));
		expect(doc.getStored('code')).toBe('Xcdefgh');
		field.destroy();
	});
});

describe('the count is Quillmark’s', () => {
	const cases: [Leaf, string][] = [
		['code', 'abc   def'],
		['code', '😀👍🏽abcd'],
		['note', 'ab\ncd\nefgh\n\n'],
		['tag', '**bold** and _it_'],
		['memo', '- one\n- two\n\n> three four five']
	];
	for (const [name, value] of cases) {
		it(`${name}: ${JSON.stringify(value)}`, () => {
			const doc = docWith({ [name]: value });
			const field = leaf(doc, name);
			const counted = capCount(viewOf(field).state.doc, SHAPE[name].trimEnd);
			expect(overLength(doc, name) ?? '≤ max').toBe(counted > SHAPE[name].max ? counted : '≤ max');
			field.destroy();
		});
	}
});
