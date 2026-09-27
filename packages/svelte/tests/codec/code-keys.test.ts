// The code-block keys: Tab/Shift-Tab as literal indentation, Enter as
// a newline. Driven through `bodyKeymap`, the composed chains the leaf binds, so
// these cover precedence as much as the commands: the code link is only correct
// relative to the list link it sits ahead of.
//
// Every mutation is also checked for representability (encode → the upstream
// normalizer → decode is a fixpoint), because indentation is only real if it
// survives the boundary verbatim.
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { blockSchema, bodyKeymap, decode } from '$lib/core/codec';
import { baseKeymap } from 'prosemirror-commands';
import { md, startOf, endOf, run, shape, keyDriver } from './_util.js';

const keys = bodyKeymap(blockSchema);
const { press, expectPress } = keyDriver(keys);

/** Content start of the doc's first `code_block`: the origin every offset below
 * counts from, so a case reads in the code's own coordinates. */
function codeStart(doc: PMNode): number {
	let pos = -1;
	doc.descendants((node, p) => {
		if (pos < 0 && node.type === blockSchema.nodes.code_block) pos = p + 1;
		return pos < 0;
	});
	if (pos < 0) throw new Error('no code_block in doc');
	return pos;
}

/** A state over `markdown` with a selection at code offsets `[from, to]` (a caret
 * when `to` is omitted). */
function sel(markdown: string, from: number, to = from): EditorState {
	const doc = decode(md(markdown), blockSchema);
	const start = codeStart(doc);
	return EditorState.create({
		doc,
		selection: TextSelection.create(doc, start + from, start + to)
	});
}

const FENCE = '```\nfoo\nbar\n```';
/** A fence under a paragraph, and a fence over one: the two sides of the edge. */
const BELOW = 'head\n\n```\na\nb\n```';
const ABOVE = '```\ncode\n```\n\ntail';

describe('Tab indents', () => {
	it('inserts one unit at the caret', () => {
		expectPress(sel(FENCE, 0), 'Tab', 'doc(code_block("  foo\\nbar"))');
	});

	it('indents mid-line too — a code block takes the character, not a structure', () => {
		expectPress(sel(FENCE, 2), 'Tab', 'doc(code_block("fo  o\\nbar"))');
	});

	it('replaces a single-line selection — Tab types', () => {
		expectPress(sel(FENCE, 0, 3), 'Tab', 'doc(code_block("  \\nbar"))');
	});

	it('indents every line a multi-line selection covers', () => {
		expectPress(sel(FENCE, 1, 5), 'Tab', 'doc(code_block("  foo\\n  bar"))');
	});

	it('keeps the covered lines covered', () => {
		const next = press(sel(FENCE, 1, 5), 'Tab');
		const start = codeStart(next.doc);
		expect([next.selection.from - start, next.selection.to - start]).toEqual([0, 9]);
	});

	it('leaves out a line the selection only ends at', () => {
		// `to` sits at "bar"'s first offset: the selection does not reach into it.
		expectPress(sel(FENCE, 0, 4), 'Tab', 'doc(code_block("  foo\\nbar"))');
	});

	it('indents an empty code block', () => {
		const doc = blockSchema.nodes.doc.create(null, [blockSchema.nodes.code_block.create()]);
		const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
		expect(shape(press(state, 'Tab'))).toBe('doc(code_block("  "))');
	});
});

describe('Shift-Tab outdents', () => {
	it('removes one unit of spaces at the caret’s line', () => {
		expectPress(sel('```\n  foo\nbar\n```', 3), 'Shift-Tab', 'doc(code_block("foo\\nbar"))');
	});

	it('removes a literal tab — whatever Tab inserts, imported content carries either', () => {
		expectPress(sel('```\n\tfoo\nbar\n```', 2), 'Shift-Tab', 'doc(code_block("foo\\nbar"))');
	});

	it('removes a partial indent whole', () => {
		expectPress(sel('```\n foo\nbar\n```', 2), 'Shift-Tab', 'doc(code_block("foo\\nbar"))');
	});

	it('removes one level per line across a multi-line selection, either form', () => {
		expectPress(
			sel('```\n    foo\n\tbar\n```', 1, 12),
			'Shift-Tab',
			'doc(code_block("  foo\\nbar"))'
		);
	});

	it('declines when no covered line is indented — the key is not swallowed', () => {
		const state = sel(FENCE, 1);
		expect(run(state, keys['Shift-Tab'])).toBe(null);
		expect('Shift-Tab' in baseKeymap).toBe(false); // …so it reaches the browser: the leaf's exit
	});

	it('outdents only the lines it covers', () => {
		expectPress(sel('```\n  foo\n  bar\n```', 2, 4), 'Shift-Tab', 'doc(code_block("foo\\n  bar"))');
	});
});

describe('Enter takes a newline', () => {
	it('splits the line at the caret', () => {
		expectPress(sel(FENCE, 2), 'Enter', 'doc(code_block("fo\\no\\nbar"))');
	});
});

// Precedence is load-bearing rather than cosmetic: `list_item > code_block` is
// reachable from ordinary imported markdown, and the list link's own meanings there
// are all wrong; Tab nests the item, Shift-Tab lifts the block clean out of the
// list, Enter splits the item in two. The code link ahead of it is what these
// shapes guard.
describe('inside a list item, the code link wins', () => {
	const IN_ITEM = '- item\n\n    ```\n    code\n    ```';

	it('Tab indents the code instead of nesting the item', () => {
		expectPress(
			sel(IN_ITEM, 0),
			'Tab',
			'doc(bullet_list(list_item(paragraph("item"), code_block("  code"))))'
		);
	});

	it('Shift-Tab outdents the code instead of lifting it out of the list', () => {
		expectPress(
			sel('- item\n\n    ```\n      code\n    ```', 4),
			'Shift-Tab',
			'doc(bullet_list(list_item(paragraph("item"), code_block("code"))))'
		);
	});

	it('Enter takes a newline instead of splitting the item', () => {
		expectPress(
			sel(IN_ITEM, 2),
			'Enter',
			'doc(bullet_list(list_item(paragraph("item"), code_block("co\\nde"))))'
		);
	});

	it('Shift-Tab with nothing to remove falls through to the list link', () => {
		expectPress(
			sel(IN_ITEM, 0),
			'Shift-Tab',
			'doc(paragraph("item"), code_block("code"))' // the list link lifts the item
		);
	});
});

// The edge, from both sides: a press that would join a fence with the prose block it
// stands against retypes the fence and joins nothing, and the press after that is the
// ordinary prose join.
describe('a join at a fence’s edge retypes the fence first', () => {
	it('Backspace at a fence’s head', () => {
		const one = expectPress(
			startOf(BELOW, 1),
			'Backspace',
			'doc(paragraph("head"), paragraph("a", hard_break, "b"))'
		);
		expectPress(one, 'Backspace', 'doc(paragraph("heada", hard_break, "b"))');
	});

	it('Delete at the end of the block above one', () => {
		const one = expectPress(
			endOf(BELOW, 0),
			'Delete',
			'doc(paragraph("head"), paragraph("a", hard_break, "b"))'
		);
		expectPress(one, 'Delete', 'doc(paragraph("heada", hard_break, "b"))');
	});

	it('Backspace at the head of the block after one', () => {
		const one = expectPress(
			startOf(ABOVE, 1),
			'Backspace',
			'doc(paragraph("code"), paragraph("tail"))'
		);
		expectPress(one, 'Backspace', 'doc(paragraph("codetail"))');
	});

	it('Delete at a fence’s end', () => {
		const one = expectPress(endOf(ABOVE, 0), 'Delete', 'doc(paragraph("code"), paragraph("tail"))');
		expectPress(one, 'Delete', 'doc(paragraph("codetail"))');
	});

	it('a heading is prose like any other block', () => {
		expectPress(
			startOf('# head\n\n```\ncode\n```', 1),
			'Backspace',
			'doc(heading("head"), paragraph("code"))'
		);
	});

	it('a fence against a paragraph of its own item', () => {
		expectPress(
			startOf('- text\n\n  ```\n  code\n  ```', 1),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("text"), paragraph("code"))))'
		);
	});

	it('the exit paragraph a fence mints is still there after the press', () => {
		// `toCodeBlock` mints it because a gap cursor will not sit beside a fence, so a
		// press that takes it back leaves the caret nowhere to go.
		const doc = blockSchema.nodes.doc.create(null, [
			blockSchema.nodes.code_block.create(null, blockSchema.text('code')),
			blockSchema.nodes.paragraph.create()
		]);
		const state = EditorState.create({ doc, selection: TextSelection.create(doc, 7) });
		expectPress(state, 'Backspace', 'doc(paragraph("code"), paragraph)');
	});

	it('the caret stays in the block it was in', () => {
		const next = press(startOf(ABOVE, 1), 'Backspace');
		expect(next.selection.$from.parent.textContent).toBe('tail');
		expect(next.selection.$from.parentOffset).toBe(0);
	});
});

describe('the edge rule declines where a join retypes nothing', () => {
	it('two fences join as one', () => {
		expectPress(startOf('```\na\n```\n\n```\nb\n```', 1), 'Backspace', 'doc(code_block("ab"))');
	});

	it('two paragraphs join', () => {
		expectPress(startOf('a\n\nb', 1), 'Backspace', 'doc(paragraph("ab"))');
	});

	it('at a container’s edge the block moves whole', () => {
		// The base keymap joins no text there: it moves the block in or out, and a fence
		// crossing that boundary is still a fence.
		expectPress(
			startOf('> quoted\n\n```\ncode\n```', 1),
			'Backspace',
			'doc(blockquote(paragraph("quoted"), code_block("code")))'
		);
		expectPress(
			startOf('- item\n\n```\ncode\n```', 1),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("item")), list_item(code_block("code"))))'
		);
	});

	it('a fence that opens the body has no edge to be against', () => {
		expect(run(sel(ABOVE, 0), keys['Backspace'])).toBe(null);
	});

	it('mid-fence it is not this key at all', () => {
		expect(run(sel(FENCE, 2), keys['Backspace'])).toBe(null);
	});
});

// A press at a later item's start is the list link's merge, which declines across this
// same edge (`lists.ts`): the base keymap merges the items instead, each block whole.
describe('in a list the items merge, each block whole', () => {
	it('an item of prose after an item that is a fence', () => {
		expectPress(
			startOf('- ```\n  code\n  ```\n- b', 1),
			'Backspace',
			'doc(bullet_list(list_item(code_block("code"), paragraph("b"))))'
		);
	});

	it('an item that is a fence after an item of prose', () => {
		expectPress(
			startOf('- a\n- ```\n  code\n  ```', 1),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("a"), code_block("code"))))'
		);
	});

	it('two items of prose still merge to one line', () => {
		expectPress(
			startOf('- a\n- b', 1),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("ab"))))'
		);
	});

	it('the first item still lifts, whatever sits above the list', () => {
		expectPress(
			startOf('```\ncode\n```\n\n- item', 1),
			'Backspace',
			'doc(code_block("code"), paragraph("item"))'
		);
	});
});

describe('outside a code block the links decline', () => {
	it('Tab still sinks a list item', () => {
		expectPress(
			startOf('- a\n- b', 1),
			'Tab',
			'doc(bullet_list(list_item(paragraph("a"), bullet_list(list_item(paragraph("b"))))))'
		);
	});

	it('Enter still splits a list item', () => {
		expectPress(
			startOf('- a\n- b', 1),
			'Enter',
			'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph), list_item(paragraph("b"))))'
		);
	});
});
