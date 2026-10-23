// @vitest-environment jsdom
// The list toggle (Mod-Shift-7 / Mod-Shift-8): every line of a selection made the
// kind, or every one's marker taken off, driven through the bound keys. Each result
// is checked for representability too, as the list keys are (`list-commands.test.ts`).
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { blockSchema, bodyKeymap, decode, listKeymap } from '$lib/core/codec';
import { md, keyDriver, press as pressAt, textblocks } from './_util.js';

const keys = listKeymap(blockSchema);
const { press, expectPress } = keyDriver(keys);

/** A state over `markdown` selecting from the head of textblock `first` to the end of
 *  textblock `last`. */
function lines(markdown: string, first: number, last = first): EditorState {
	const doc = decode(md(markdown), blockSchema);
	const blocks = textblocks(doc);
	const to = blocks[last];
	return EditorState.create({
		doc,
		selection: TextSelection.create(doc, blocks[first].start, to.start + to.node.content.size)
	});
}

const NUMBER = 'Mod-Shift-7';
const BULLET = 'Mod-Shift-8';

describe('the toggle makes every line of a selection the kind', () => {
	it('numbers a run of paragraphs as one list, one item a line', () => {
		expectPress(
			lines('Alpha\n\nBravo\n\nCharlie', 0, 2),
			NUMBER,
			'doc(ordered_list(list_item(paragraph("Alpha")), list_item(paragraph("Bravo")), list_item(paragraph("Charlie"))))'
		);
	});

	it('numbers the caret’s line alone where nothing is selected', () => {
		const state = lines('Alpha\n\nBravo', 1);
		const caret = EditorState.create({
			doc: state.doc,
			selection: TextSelection.create(state.doc, state.selection.from + 2)
		});
		expectPress(
			caret,
			NUMBER,
			'doc(paragraph("Alpha"), ordered_list(list_item(paragraph("Bravo"))))'
		);
	});

	it('joins the lists of its kind the new items touch, above and below', () => {
		expectPress(
			lines('1. Alpha\n\nBravo\n\nCharlie\n\n1. Delta', 1, 2),
			NUMBER,
			'doc(ordered_list(list_item(paragraph("Alpha")), list_item(paragraph("Bravo")), list_item(paragraph("Charlie")), list_item(paragraph("Delta"))))'
		);
	});

	it('retypes a whole list of the other kind, and wraps the plain lines beside it', () => {
		expectPress(
			lines('Alpha\n\n- Bravo\n- Charlie', 0, 2),
			NUMBER,
			'doc(ordered_list(list_item(paragraph("Alpha")), list_item(paragraph("Bravo")), list_item(paragraph("Charlie"))))'
		);
	});

	it('splits the selected items out of a list of the other kind, and no more', () => {
		expectPress(
			lines('Alpha\n\n- Bravo\n- Charlie', 0, 1),
			NUMBER,
			'doc(ordered_list(list_item(paragraph("Alpha")), list_item(paragraph("Bravo"))), bullet_list(list_item(paragraph("Charlie"))))'
		);
	});

	it('takes a heading in as a paragraph item', () => {
		expectPress(
			lines('# Title\n\nBody', 0, 1),
			BULLET,
			'doc(bullet_list(list_item(paragraph("Title")), list_item(paragraph("Body"))))'
		);
	});

	it('leaves a fence where it stands, the lines either side of it two lists', () => {
		expectPress(
			lines('Alpha\n\n```\ncode\n```\n\nBravo', 0, 2),
			NUMBER,
			'doc(ordered_list(list_item(paragraph("Alpha"))), code_block("code"), ordered_list(list_item(paragraph("Bravo"))))'
		);
	});

	it('a selection ending at the head of a line leaves that line out', () => {
		const state = lines('Alpha\n\nBravo', 0, 1);
		const head = EditorState.create({
			doc: state.doc,
			selection: TextSelection.create(
				state.doc,
				state.selection.from,
				textblocks(state.doc)[1].start
			)
		});
		expectPress(
			head,
			NUMBER,
			'doc(ordered_list(list_item(paragraph("Alpha"))), paragraph("Bravo"))'
		);
	});
});

describe('the toggle takes the marker off where every line already carries it', () => {
	it('lifts a whole list out to paragraphs', () => {
		expectPress(
			lines('1. Alpha\n2. Bravo', 0, 1),
			NUMBER,
			'doc(paragraph("Alpha"), paragraph("Bravo"))'
		);
	});

	it('lifts middle items out, the tail counting from 1 again', () => {
		const next = expectPress(
			lines('3. Alpha\n4. Bravo\n5. Charlie\n6. Delta', 1, 2),
			NUMBER,
			'doc(ordered_list(list_item(paragraph("Alpha"))), paragraph("Bravo"), paragraph("Charlie"), ordered_list(list_item(paragraph("Delta"))))'
		);
		expect(next.doc.child(0).attrs.start).toBe(3);
		expect(next.doc.child(3).attrs.start).toBe(1);
	});

	it('in a sub-list, leaves the lines as the parent item’s continuation lines', () => {
		expectPress(
			lines('1. Alpha\n    - Bravo\n    - Charlie', 1, 2),
			BULLET,
			'doc(ordered_list(list_item(paragraph("Alpha"), paragraph("Bravo"), paragraph("Charlie"))))'
		);
	});

	it('reaches sub-lists of the kind under the items it lifts', () => {
		expectPress(
			lines('- Alpha\n    - Bravo\n- Charlie', 0, 2),
			BULLET,
			'doc(paragraph("Alpha"), paragraph("Bravo"), paragraph("Charlie"))'
		);
	});

	it('keeps the selection over the same text', () => {
		const next = press(lines('1. Alpha\n2. Bravo', 0, 1), NUMBER);
		const { from, to } = next.selection;
		expect(next.doc.textBetween(from, to, '|')).toBe('Alpha|Bravo');
	});

	it('is its own inverse over a run of paragraphs', () => {
		const state = lines('Alpha\n\nBravo\n\nCharlie', 0, 2);
		expect(press(press(state, BULLET), BULLET).doc.toString()).toBe(state.doc.toString());
	});
});

describe('a line under an item, its marker not its own', () => {
	const UNDER = '1. Alpha\n\n   Line\n\n2. Bravo';

	it('opens a sub-list of the kind under its item, the item keeping its marker', () => {
		expectPress(
			lines(UNDER, 1),
			NUMBER,
			'doc(ordered_list(list_item(paragraph("Alpha"), ordered_list(list_item(paragraph("Line")))), list_item(paragraph("Bravo"))))'
		);
		expectPress(
			lines(UNDER, 1),
			BULLET,
			'doc(ordered_list(list_item(paragraph("Alpha"), bullet_list(list_item(paragraph("Line")))), list_item(paragraph("Bravo"))))'
		);
	});

	it('the press after takes it back to a line under its item', () => {
		const state = lines(UNDER, 1);
		expect(press(press(state, NUMBER), NUMBER).doc.toString()).toBe(state.doc.toString());
	});

	it('joins a sub-list of the kind standing under it', () => {
		expectPress(
			lines('1. Alpha\n\n   Line\n\n   - Sub', 1),
			BULLET,
			'doc(ordered_list(list_item(paragraph("Alpha"), bullet_list(list_item(paragraph("Line")), list_item(paragraph("Sub"))))))'
		);
	});

	it('goes with its item where the item’s first line is selected too', () => {
		expectPress(
			lines(UNDER, 0, 2),
			NUMBER,
			'doc(paragraph("Alpha"), paragraph("Line"), paragraph("Bravo"))'
		);
	});

	it('beside a marked line, is the line the toggle numbers, and nothing comes off', () => {
		expectPress(
			lines(UNDER, 1, 2),
			NUMBER,
			'doc(ordered_list(list_item(paragraph("Alpha"), ordered_list(list_item(paragraph("Line")))), list_item(paragraph("Bravo"))))'
		);
	});
});

describe('the other kind', () => {
	it('bullets one numbered item as a list between two, the tail counting from 1', () => {
		const next = expectPress(
			lines('3. Alpha\n4. Bravo\n5. Charlie', 1),
			BULLET,
			'doc(ordered_list(list_item(paragraph("Alpha"))), bullet_list(list_item(paragraph("Bravo"))), ordered_list(list_item(paragraph("Charlie"))))'
		);
		const lists: number[] = [];
		next.doc.forEach((n) => n.attrs.start != null && lists.push(n.attrs.start));
		expect(lists).toEqual([3, 1]);
	});

	it('numbers the head of a bullet list, the rest staying bullets', () => {
		expectPress(
			lines('- Alpha\n- Bravo\n- Charlie', 0, 1),
			NUMBER,
			'doc(ordered_list(list_item(paragraph("Alpha")), list_item(paragraph("Bravo"))), bullet_list(list_item(paragraph("Charlie"))))'
		);
	});

	it('joins a split-out item to the list of its kind above', () => {
		expectPress(
			lines('1. Alpha\n\nBravo\n\n- Charlie\n- Delta', 1, 2),
			NUMBER,
			'doc(ordered_list(list_item(paragraph("Alpha")), list_item(paragraph("Bravo")), list_item(paragraph("Charlie"))), bullet_list(list_item(paragraph("Delta"))))'
		);
	});

	it('a sub-list of the other kind under a selected item is retyped with it', () => {
		expectPress(
			lines('1. Alpha\n    - Bravo', 0, 1),
			NUMBER,
			'doc(ordered_list(list_item(paragraph("Alpha"), ordered_list(list_item(paragraph("Bravo"))))))'
		);
	});
});

describe('the chord', () => {
	it('reaches the toggle as the browser reports it, the shifted digit read by its key code', () => {
		const state = lines('Alpha', 0);
		const view = new EditorView(document.createElement('div'), {
			state: EditorState.create({
				doc: state.doc,
				selection: state.selection,
				plugins: [keymap(bodyKeymap(blockSchema))]
			})
		});
		pressAt(view, '&', { ctrlKey: true, shiftKey: true, keyCode: 55 });
		expect(view.state.doc.toString()).toBe('doc(ordered_list(list_item(paragraph("Alpha"))))');
		pressAt(view, '*', { ctrlKey: true, shiftKey: true, keyCode: 56 });
		expect(view.state.doc.toString()).toBe('doc(bullet_list(list_item(paragraph("Alpha"))))');
		view.destroy();
	});
});
