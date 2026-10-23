// @vitest-environment jsdom
// Two lists of one kind an edit leaves touching are one list (`touching.ts`): each
// gesture that opens such a seam joins it, and a seam that arrived with the document
// stays. Keys are driven through the composed body keymap, shorthands through the
// input-rules plugin as typed.
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { blockSchema, bodyKeymap, decode, inputRulesPlugin } from '$lib/core/codec';
import { atBlock, atBlockEnd, keyDriver, md, representable, startOf, textblocks } from './_util.js';

const { expectPress, press } = keyDriver(bodyKeymap(blockSchema));

const n = blockSchema.nodes;
const p = (text?: string) => n.paragraph.create(null, text ? blockSchema.text(text) : undefined);
const li = (...blocks: PMNode[]) => n.list_item.create(null, blocks);
const ol = (...items: PMNode[]) => n.ordered_list.create(null, items);
const ul = (...items: PMNode[]) => n.bullet_list.create(null, items);
const docOf = (...blocks: PMNode[]) => n.doc.create(null, blocks);

/** A selection from `from` chars into textblock `first` to `to` chars into `last`. */
function across(doc: PMNode, first: number, from: number, last: number, to: number): EditorState {
	const blocks = textblocks(doc);
	return EditorState.create({
		doc,
		selection: TextSelection.create(doc, blocks[first].start + from, blocks[last].start + to)
	});
}

const SPLIT = docOf(ol(li(p('a')), li(p('b'))), p('mid'), ol(li(p('c'))));
const JOINED =
	'doc(ordered_list(list_item(paragraph("a")), list_item(paragraph("b")), list_item(paragraph("c"))))';

describe('taking the line between two lists joins them', () => {
	it('Backspace at its head, emptied first', () => {
		const emptied = docOf(ol(li(p('a')), li(p('b'))), p(), ol(li(p('c'))));
		expectPress(atBlock(emptied, 2), 'Backspace', JOINED);
	});

	it('Backspace at its head joins its text up and the list below after it', () => {
		const next = expectPress(
			atBlock(SPLIT, 2),
			'Backspace',
			'doc(ordered_list(list_item(paragraph("a")), list_item(paragraph("bmid")), list_item(paragraph("c"))))'
		);
		expect(next.selection.$from.parentOffset).toBe(1);
	});

	it('Delete at the end of the line above', () => {
		const next = expectPress(
			atBlockEnd(SPLIT, 1),
			'Delete',
			'doc(ordered_list(list_item(paragraph("a")), list_item(paragraph("bmid")), list_item(paragraph("c"))))'
		);
		expect(next.selection.$from.parentOffset).toBe(1);
	});

	it('a selection from the line above through it', () => {
		for (const key of ['Backspace', 'Delete'])
			expectPress(
				across(SPLIT, 1, 1, 2, 3),
				key,
				'doc(ordered_list(list_item(paragraph("a")), list_item(paragraph("b")), list_item(paragraph("c"))))'
			);
	});

	it('the list keeps the start the upper one counted from', () => {
		const typed = docOf(n.ordered_list.create({ start: 4 }, [li(p('a'))]), p(), ol(li(p('c'))));
		const next = press(atBlock(typed, 1), 'Backspace');
		expect(next.doc.childCount).toBe(1);
		expect(next.doc.child(0).attrs.start).toBe(4);
	});

	it('lists of two kinds stay two', () => {
		const mixed = docOf(ul(li(p('a'))), p(), ol(li(p('c'))));
		expectPress(
			atBlock(mixed, 1),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("a"))), ordered_list(list_item(paragraph("c"))))'
		);
	});
});

describe('a seam no edit opened stays', () => {
	const pair = () => docOf(ol(li(p('a')), li(p('b'))), ol(li(p('c'))));

	it('a selection inside the upper list leaves the boundary below it', () => {
		expectPress(
			across(pair(), 0, 1, 1, 1),
			'Backspace',
			'doc(ordered_list(list_item(paragraph("a"))), ordered_list(list_item(paragraph("c"))))'
		);
	});

	it('a selection within one line is the base keymap’s', () => {
		const state = across(pair(), 1, 0, 1, 1);
		expect(press(state, 'Backspace').doc.childCount).toBe(2);
	});
});

describe('a line numbered beside a list joins it', () => {
	function view(doc: PMNode, block: number): EditorView {
		const state = atBlock(doc, block);
		return new EditorView(document.createElement('div'), {
			state: EditorState.create({
				doc: state.doc,
				selection: state.selection,
				plugins: [inputRulesPlugin(blockSchema)]
			})
		});
	}

	function type(v: EditorView, text: string): void {
		for (const ch of text) {
			const { from, to } = v.state.selection;
			const deflt = () => v.state.tr.insertText(ch, from, to);
			if (!v.someProp('handleTextInput', (f) => f(v, from, to, ch, deflt))) v.dispatch(deflt());
		}
	}

	it('`1. ` on the line above a list', () => {
		const v = view(docOf(p('zero'), ol(li(p('a')))), 0);
		v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1)));
		type(v, '1. ');
		expect(v.state.doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph("zero")), list_item(paragraph("a"))))'
		);
		expect(representable(v.state)).toBe(true);
	});

	it('`1. ` on the line under a list, whatever number is typed', () => {
		for (const typed of ['1. ', '7. ']) {
			const v = view(docOf(ol(li(p('a')), li(p('b'))), p()), 2);
			type(v, typed);
			expect(v.state.doc.toString(), typed).toBe(
				'doc(ordered_list(list_item(paragraph("a")), list_item(paragraph("b")), list_item(paragraph)))'
			);
		}
	});

	it('`7. ` away from any list still counts from 7', () => {
		const v = view(docOf(p()), 0);
		type(v, '7. ');
		expect(v.state.doc.child(0).attrs.start).toBe(7);
	});

	it('`- ` between two bullet lists makes the three one', () => {
		const v = view(docOf(ul(li(p('a'))), p(), ul(li(p('c')))), 1);
		type(v, '- ');
		expect(v.state.doc.toString()).toBe(
			'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph), list_item(paragraph("c"))))'
		);
	});
});

describe('reading never joins', () => {
	it('an imported pair decodes as two lists', () => {
		const doc = decode(md('1. a\n2. b\n\n<!-- -->\n\n1. c'), blockSchema);
		expect(doc.childCount).toBe(2);
		expect(startOf('1. a\n2. b\n\n<!-- -->\n\n1. c', 0).doc.childCount).toBe(2);
	});
});
