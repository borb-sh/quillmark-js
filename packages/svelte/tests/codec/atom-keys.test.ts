// The block-atom link: a delete against an island or a divider selects it, and the
// press after that deletes it.
//
// Driven through the composed chain (`bodyKeymap`) rather than the link alone, because
// what is under test is as much the precedence as the command: a Backspace at the start
// of a list's first item still lifts the item, whatever sits above the list.
import { describe, it, expect } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { blockSchema, bodyKeymap, decode } from '$lib/core/codec';
import { md, startOf, endOf, run, shape, keyDriver } from './_util.js';

const keys = bodyKeymap(blockSchema);
const { press } = keyDriver(keys);

const TABLE = 'para\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntail';
const RULE = 'para\n\n---\n\ntail';

/** The node a state has selected, or `undefined` for a text selection. */
function selectedNode(state: EditorState): string | undefined {
	const { selection } = state;
	return selection instanceof NodeSelection ? selection.node.type.name : undefined;
}

describe('a delete against a block atom selects it', () => {
	it('Backspace at the start of the block after a table selects the table', () => {
		const next = press(startOf(TABLE, 1), 'Backspace');
		expect(selectedNode(next)).toBe('island_block');
		// Nothing went: the press that selects destroys nothing, which is the whole of
		// what it is for.
		expect(shape(next)).toBe(shape(startOf(TABLE, 1)));
	});

	it('the press after that deletes it', () => {
		const selected = press(startOf(TABLE, 1), 'Backspace');
		const next = press(selected, 'Backspace');
		expect(next.doc.toString()).toBe('doc(paragraph("para"), paragraph("tail"))');
	});

	it('Delete at the end of the block before a table selects it too', () => {
		// One rule, both sides: which side the caret approached from is not what a delete
		// against an atom means.
		const next = press(endOf(TABLE, 0), 'Delete');
		expect(selectedNode(next)).toBe('island_block');
		expect(press(next, 'Delete').doc.toString()).toBe('doc(paragraph("para"), paragraph("tail"))');
	});

	it('a divider is an atom like any other', () => {
		expect(selectedNode(press(startOf(RULE, 1), 'Backspace'))).toBe('horizontal_rule');
		expect(selectedNode(press(endOf(RULE, 0), 'Delete'))).toBe('horizontal_rule');
	});
});

describe('the link declines everywhere the neighbour can be entered', () => {
	it('a quote is a container, not an atom', () => {
		const next = press(startOf('> quoted\n\ntail', 1), 'Backspace');
		expect(selectedNode(next)).toBeUndefined();
	});

	it('mid-text it is not this key at all', () => {
		const doc = decode(md(TABLE), blockSchema);
		let at = -1;
		doc.descendants((node, pos) => {
			if (node.isTextblock && node.textContent === 'tail') at = pos + 2;
			return true;
		});
		const state = EditorState.create({ doc, selection: TextSelection.create(doc, at) });
		expect(run(state, keys['Backspace'])).toBe(null);
	});

	it('the list link keeps the first item, whatever sits above the list', () => {
		// A table above a list, and the caret at the item's start: the item lifts, which
		// is the list's own answer and outranks the neighbour's.
		const state = startOf('| a |\n|---|\n| 1 |\n\n- alpha', 0);
		const next = press(state, 'Backspace');
		expect(selectedNode(next)).toBeUndefined();
		expect(next.doc.toString()).toBe('doc(island_block, paragraph("alpha"))');
	});

	it('an island below a list is a neighbour, not the item’s seam', () => {
		// The mirror: the list link reads the seam below an item and declines where nothing
		// there opens one, so the atom link answers as it does anywhere else.
		const next = press(endOf('- alpha\n\n| a |\n|---|\n| 1 |', 0), 'Delete');
		expect(selectedNode(next)).toBe('island_block');
	});
});
