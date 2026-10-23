// Undo steps over the leaf's own plugin stack: typing groups as history groups it, and
// an edit that moves a block opens a step of its own. Every transaction carries one
// timestamp, so history's delay never separates them and only the plugin can.
import { describe, it, expect } from 'vitest';
import { EditorState, type Command, type Transaction } from 'prosemirror-state';
import { splitBlock } from 'prosemirror-commands';
import { undo } from 'prosemirror-history';
import { blockSchema, proseLeafPlugins } from '$lib/core/codec';
import { startOf } from './_util.js';

const AT = 1_000;

function leaf(state: EditorState): EditorState {
	return EditorState.create({
		doc: state.doc,
		selection: state.selection,
		plugins: proseLeafPlugins(blockSchema, { inline: false })
	});
}

function apply(state: EditorState, tr: Transaction): EditorState {
	return state.apply(tr.setTime(AT));
}

function typed(state: EditorState, text: string): EditorState {
	for (const ch of text) state = apply(state, state.tr.insertText(ch));
	return state;
}

function ran(state: EditorState, cmd: Command): EditorState {
	let out = state;
	expect(cmd(state, (tr) => (out = apply(state, tr)))).toBe(true);
	return out;
}

const undone = (state: EditorState): EditorState => ran(state, undo);

describe('an edit that moves a block is an undo step of its own', () => {
	it('typing alone is one step', () => {
		const state = typed(leaf(startOf('x', 0)), 'abc');
		expect(undone(state).doc.toString()).toBe('doc(paragraph("x"))');
	});

	it('Enter starts a step, the typing after it joining that step', () => {
		let state = leaf(EditorState.create({ schema: blockSchema }));
		state = typed(state, 'abc');
		state = ran(state, splitBlock);
		state = typed(state, 'def');
		state = undone(state);
		expect(state.doc.toString()).toBe('doc(paragraph("abc"))');
		expect(undone(state).doc.toString()).toBe('doc(paragraph)');
	});
});
