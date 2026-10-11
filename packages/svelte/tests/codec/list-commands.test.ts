// The list structure keys: Tab/Shift-Tab indent-outdent, and what
// Enter/Backspace/Delete mean inside a list. Driven through the bound commands
// `listKeymap` returns, not through re-derived copies of them, so a rebinding
// breaks these.
//
// Every mutation is also checked for representability: the resulting PM doc is
// encoded, pushed through the upstream normalizer, and re-decoded. A command that
// produces a shape `Content` cannot hold would pass a doc-shape assertion and
// still lose the user's edit on commit.
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { blockSchema, decode, listKeymap } from '$lib/core/codec';
import { md, atBlock, atBlockEnd, startOf, endOf, run, keyDriver } from './_util.js';

const keys = listKeymap(blockSchema);
const { press, expectPress } = keyDriver(keys);

/** A state over `markdown` with the caret just after the first `caretAfter`: the
 * mid-text position, where the keys keep their ordinary meaning. */
function after(markdown: string, caretAfter: string): EditorState {
	const doc = decode(md(markdown), blockSchema);
	let pos = -1;
	doc.descendants((node, p) => {
		if (pos < 0 && node.isText && node.text?.includes(caretAfter)) {
			pos = p + node.text.indexOf(caretAfter) + caretAfter.length;
		}
		return pos < 0;
	});
	if (pos < 0) throw new Error(`caret anchor not found: ${JSON.stringify(caretAfter)}`);
	return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
}

// Hand-built nodes for the empty-item shapes: markdown has no spelling for an
// item with no content, so these cases cannot come from `md()`.
const n = blockSchema.nodes;
const p = (text?: string) => n.paragraph.create(null, text ? blockSchema.text(text) : undefined);
const li = (...blocks: PMNode[]) => n.list_item.create(null, blocks);
const ul = (...items: PMNode[]) => n.bullet_list.create(null, items);
const docOf = (...blocks: PMNode[]) => n.doc.create(null, blocks);

describe('Tab / Shift-Tab change nesting depth', () => {
	it('Tab is inert on the first item at a level — nothing to sink under', () => {
		expect(run(startOf('- a\n- b', 0), keys['Tab'])).toBe(null);
	});

	it('Tab sinks from mid-text too — the caret’s offset is not the axis', () => {
		expectPress(
			after('- a\n- bc', 'b'),
			'Tab',
			'doc(bullet_list(list_item(paragraph("a"), bullet_list(list_item(paragraph("bc"))))))'
		);
	});

	it('Tab reuses the previous item’s existing nested list rather than adding one', () => {
		expectPress(
			startOf('- a\n    - b\n- c', 2),
			'Tab',
			'doc(bullet_list(list_item(paragraph("a"), bullet_list(list_item(paragraph("b")), list_item(paragraph("c"))))))'
		);
	});

	it('Shift-Tab outdents a nested item into the parent list', () => {
		expectPress(
			startOf('- a\n    - b', 1),
			'Shift-Tab',
			'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph("b"))))'
		);
	});

	it('Shift-Tab on a top-level item lifts it out to a paragraph', () => {
		expectPress(
			startOf('- a\n- b', 1),
			'Shift-Tab',
			'doc(bullet_list(list_item(paragraph("a"))), paragraph("b"))'
		);
	});

	it('outdenting a middle item splits the parent list around it', () => {
		expectPress(
			startOf('- a\n    - b\n    - c\n    - d', 2),
			'Shift-Tab',
			'doc(bullet_list(list_item(paragraph("a"), bullet_list(list_item(paragraph("b")))), list_item(paragraph("c"), bullet_list(list_item(paragraph("d"))))))'
		);
	});

	it('Tab outside a list declines the key, leaving it to the shell', () => {
		const state = after('plain text', 'plain');
		expect(run(state, keys['Tab'])).toBe(null);
		expect(run(state, keys['Shift-Tab'])).toBe(null);
	});
});

describe('Enter', () => {
	it('splits a non-empty item into two', () => {
		expectPress(
			after('- ab', 'a'),
			'Enter',
			'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph("b"))))'
		);
	});

	it('on an empty top-level item, exits the list to a paragraph', () => {
		expectPress(
			atBlock(docOf(ul(li(p('a')), li(p()))), 1),
			'Enter',
			'doc(bullet_list(list_item(paragraph("a"))), paragraph)'
		);
	});

	it('on an empty NESTED item, lifts exactly one level', () => {
		expectPress(
			atBlock(docOf(ul(li(p('a'), ul(li(p('b')), li(p()))))), 2),
			'Enter',
			'doc(bullet_list(list_item(paragraph("a"), bullet_list(list_item(paragraph("b")))), list_item(paragraph)))'
		);
	});

	it('at the start of a list that opens the document, opens a paragraph above it', () => {
		expectPress(
			startOf('- a\n- b', 0),
			'Enter',
			'doc(paragraph, bullet_list(list_item(paragraph("a")), list_item(paragraph("b"))))'
		);
	});

	it('the escape-above gesture keeps the caret with the text it pushed down', () => {
		const next = press(startOf('- a', 0), 'Enter');
		expect(next.doc.textBetween(next.selection.from, next.doc.content.size)).toBe('a');
	});

	// The gesture answers on exactly the shapes where a caret cannot already go, a
	// rule and an island being atoms; everywhere else Enter is the ordinary split,
	// so the key means one thing at every item a writer can escape by pressing Up.
	it('declines where the block above the list already takes a caret', () => {
		expectPress(
			startOf('intro\n\n- a\n- b', 1),
			'Enter',
			'doc(paragraph("intro"), bullet_list(list_item(paragraph), list_item(paragraph("a")), list_item(paragraph("b"))))'
		);
	});

	it('declines under a quote, whose last paragraph is a caret position', () => {
		expectPress(
			startOf('> quoted\n\n- a', 1),
			'Enter',
			'doc(blockquote(paragraph("quoted")), bullet_list(list_item(paragraph), list_item(paragraph("a"))))'
		);
	});

	it('at the start of a NESTED first item, splits instead of reaching the parent item', () => {
		expectPress(
			startOf('- a\n    - b', 1),
			'Enter',
			'doc(bullet_list(list_item(paragraph("a"), bullet_list(list_item(paragraph), list_item(paragraph("b"))))))'
		);
	});
});

describe('Backspace', () => {
	it('at the start of the first item, lifts out of the list', () => {
		expectPress(
			startOf('- a\n- b', 0),
			'Backspace',
			'doc(paragraph("a"), bullet_list(list_item(paragraph("b"))))'
		);
	});

	it('mid-text, declines the key so the browser deletes a character', () => {
		expect(run(after('- ab', 'a'), keys['Backspace'])).toBe(null);
	});

	it('at the start of a later item, lifts it out and splits the list around it', () => {
		const one = expectPress(
			startOf('- a\n- b\n- c', 1),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("a"))), paragraph("b"), bullet_list(list_item(paragraph("c"))))'
		);
		// The press after joins the paragraph onto the list's last line.
		expectPress(
			one,
			'Backspace',
			'doc(bullet_list(list_item(paragraph("ab"))), bullet_list(list_item(paragraph("c"))))'
		);
	});

	it('the items past a lifted one keep their numbers', () => {
		const next = expectPress(
			startOf('3. a\n4. b\n5. c', 1),
			'Backspace',
			'doc(ordered_list(list_item(paragraph("a"))), paragraph("b"), ordered_list(list_item(paragraph("c"))))'
		);
		expect(next.doc.child(0).attrs.start).toBe(3);
		expect(next.doc.child(2).attrs.start).toBe(5);
	});

	it('the items past a lifted one keep their numbers past a list it held', () => {
		for (const nested of ['1. x\n    2. y', '- x\n    - y']) {
			const next = press(startOf(`1. a\n2. b\n    ${nested}\n3. c`, 1), 'Backspace');
			expect(next.doc.child(1).textContent).toBe('b');
			expect(next.doc.child(2).attrs.start ?? 1, nested).toBe(1);
			expect(next.doc.child(3).type.name).toBe('ordered_list');
			expect(next.doc.child(3).attrs.start, nested).toBe(3);
		}
	});

	it('a nested later item lifts one level', () => {
		expectPress(
			startOf('- a\n    - b\n    - c', 2),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("a"), bullet_list(list_item(paragraph("b")))), list_item(paragraph("c"))))'
		);
	});

	it('at a later block of a multi-paragraph item, declines to the base keymap', () => {
		expect(run(atBlock(docOf(ul(li(p('a'), p('b')))), 1), keys['Backspace'])).toBe(null);
	});
});

// One seam, one edit, whichever side a writer approaches it from: each case states its
// document once and presses both keys at it — Delete at the end of the block above,
// Backspace at the head of the block below.
function seam(doc: PMNode, above: number, below: number, expected: string): void {
	expectPress(atBlockEnd(doc, above), 'Delete', expected);
	expectPress(atBlock(doc, below), 'Backspace', expected);
}

describe('Delete is Backspace at the seam below', () => {
	it('lifts the item below out of the list', () => {
		seam(
			decode(md('- a\n- b'), blockSchema),
			0,
			1,
			'doc(bullet_list(list_item(paragraph("a"))), paragraph("b"))'
		);
	});

	it('the items past the lifted one keep their numbers', () => {
		seam(
			decode(md('1. a\n2. b\n3. c'), blockSchema),
			0,
			1,
			'doc(ordered_list(list_item(paragraph("a"))), paragraph("b"), ordered_list(list_item(paragraph("c"))))'
		);
	});

	it('lifts a nested first item, where the item below is not a sibling', () => {
		seam(
			decode(md('- a\n    - b'), blockSchema),
			0,
			1,
			'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph("b"))))'
		);
	});

	it('joins a block after the list onto the list’s last line', () => {
		seam(
			docOf(ul(li(p('a'), p('cont'))), p('b')),
			1,
			2,
			'doc(bullet_list(list_item(paragraph("a"), paragraph("contb"))))'
		);
	});

	it('reaches the item below at a shallower level than the caret’s', () => {
		seam(
			decode(md('- a\n    - b\n- c'), blockSchema),
			1,
			2,
			'doc(bullet_list(list_item(paragraph("a"), bullet_list(list_item(paragraph("b"))))), paragraph("c"))'
		);
	});

	it('spends an empty item rather than unmarking the one below it', () => {
		// Delete's one exception to the reflection: Backspace at `c` still lifts it.
		expectPress(
			atBlockEnd(docOf(ul(li(p('a')), li(p()), li(p('c')))), 1),
			'Delete',
			'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph("c"))))'
		);
	});

	it('spends an empty item above a fence and leaves the fence a fence', () => {
		const fence = n.code_block.create(null, blockSchema.text('code'));
		const next = expectPress(
			atBlockEnd(docOf(ul(li(p('a')), li(p()), li(fence))), 1),
			'Delete',
			'doc(bullet_list(list_item(paragraph("a")), list_item(code_block("code"))))'
		);
		expect(next.selection.$from.parent.type.name).toBe('code_block');
	});

	it('leaves the caret where the key was pressed, merging and lifting alike', () => {
		for (const markdown of ['- a\n- b', '- a\n    - b']) {
			const state = endOf(markdown, 0);
			expect(press(state, 'Delete').selection.from, markdown).toBe(state.selection.from);
		}
	});

	it('mid-text, declines the key so the browser deletes a character', () => {
		expect(run(after('- ab', 'a'), keys['Delete'])).toBe(null);
	});

	it('at a seam inside one item, declines: two blocks of an item are not two items', () => {
		expect(run(atBlockEnd(docOf(ul(li(p('a'), p('b')))), 0), keys['Delete'])).toBe(null);
	});

	it('declines outside a list, the leading edge staying the base keymap’s', () => {
		expect(run(endOf('head\n\n- a', 0), keys['Delete'])).toBe(null);
	});

	it('at the last item’s end, joins the line below onto it', () => {
		seam(docOf(ul(li(p('a'))), p('tail')), 0, 1, 'doc(bullet_list(list_item(paragraph("atail"))))');
	});
});

describe('ordered lists carry their numbering through a mutation', () => {
	it('Tab nests a fresh ordered list starting at 1', () => {
		expectPress(
			startOf('1. a\n2. b', 1),
			'Tab',
			'doc(ordered_list(list_item(paragraph("a"), ordered_list(list_item(paragraph("b"))))))'
		);
	});

	it('a list that starts at 3 keeps its start when an item sinks', () => {
		const next = expectPress(
			startOf('3. a\n4. b', 1),
			'Tab',
			'doc(ordered_list(list_item(paragraph("a"), ordered_list(list_item(paragraph("b"))))))'
		);
		expect(next.doc.child(0).attrs.start).toBe(3);
	});
});
