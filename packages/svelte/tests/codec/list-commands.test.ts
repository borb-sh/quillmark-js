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
	it('Tab on the first item at a level is claimed and does nothing — nothing to sink under', () => {
		for (const [markdown, index] of [
			['- a\n- b', 0],
			['- a\n    - b', 1]
		] as const) {
			const state = startOf(markdown, index);
			expect(press(state, 'Tab').doc.toString(), markdown).toBe(state.doc.toString());
		}
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

	it('Shift-Tab on a top-level item is claimed and does nothing — no level above it', () => {
		for (const [markdown, index] of [
			['1. a\n2. b\n3. c', 1],
			['1. a\n2. b', 0]
		] as const) {
			const state = startOf(markdown, index);
			expect(keys['Shift-Tab'](state), markdown).toBe(true);
			expect(press(state, 'Shift-Tab').doc.toString(), markdown).toBe(state.doc.toString());
		}
	});

	it('Shift-Tab on a top-level continuation line does nothing, the item above keeping its marker', () => {
		const state = atBlock(docOf(ul(li(p('a'), p('b')), li(p('c')))), 1);
		expect(press(state, 'Shift-Tab').doc.toString()).toBe(state.doc.toString());
	});

	it('Shift-Tab pressed once too many out of a sub-list stops at the top level', () => {
		const once = press(startOf('1. a\n    1. b\n2. c', 1), 'Shift-Tab');
		expect(press(once, 'Shift-Tab').doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph("a")), list_item(paragraph("b")), list_item(paragraph("c"))))'
		);
	});

	it('outdenting a middle item splits the parent list around it', () => {
		expectPress(
			startOf('- a\n    - b\n    - c\n    - d', 2),
			'Shift-Tab',
			'doc(bullet_list(list_item(paragraph("a"), bullet_list(list_item(paragraph("b")))), list_item(paragraph("c"), bullet_list(list_item(paragraph("d"))))))'
		);
	});

	it('Tab outside a list, with no list before it, declines the key', () => {
		const state = after('plain text', 'plain');
		expect(run(state, keys['Tab'])).toBe(null);
		expect(run(state, keys['Shift-Tab'])).toBe(null);
	});

	it('Tab on a paragraph after a list moves it into the last item as its unnumbered line', () => {
		const next = expectPress(
			after('1. a\n2. b\n\ncd', 'c'),
			'Tab',
			'doc(ordered_list(list_item(paragraph("a")), list_item(paragraph("b"), paragraph("cd"))))'
		);
		expect(next.selection.$from.parent.textContent).toBe('cd');
		expect(next.selection.$from.parentOffset).toBe(1);
	});

	it('Tab lands the block after what the last item holds, a sub-list included', () => {
		expectPress(
			startOf('1. a\n    1. b\n\nc', 2),
			'Tab',
			'doc(ordered_list(list_item(paragraph("a"), ordered_list(list_item(paragraph("b"))), paragraph("c"))))'
		);
	});

	it('Tab moves a block after a list inside a quote, the quote kept', () => {
		expectPress(
			startOf('> - a\n>\n> b', 1),
			'Tab',
			'doc(blockquote(bullet_list(list_item(paragraph("a"), paragraph("b")))))'
		);
	});

	it('Tab declines on a block a paragraph stands between it and the list', () => {
		const state = startOf('- a\n\nb\n\nc', 2);
		expect(run(state, keys['Tab'])).toBe(null);
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

describe('Enter on an empty line inside a list', () => {
	it('on an empty MIDDLE item, takes the marker off and keeps the line under the item above', () => {
		expectPress(
			atBlock(docOf(ul(li(p('a')), li(p()), li(p('c')))), 1),
			'Enter',
			'doc(bullet_list(list_item(paragraph("a"), paragraph), list_item(paragraph("c"))))'
		);
	});

	it('the numbers below close up: nothing splits the list', () => {
		const next = press(press(after('1. a\n2. b\n3. c', 'a'), 'Enter'), 'Enter');
		expect(next.doc.childCount).toBe(1);
		expect(next.doc.child(0).childCount).toBe(3);
	});

	it('on an empty continuation line, puts the marker back on as the next item', () => {
		expectPress(
			atBlock(docOf(ul(li(p('a'), p()), li(p('c')))), 1),
			'Enter',
			'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph), list_item(paragraph("c"))))'
		);
	});

	it('on an empty continuation line of the last item, leaves the list, the item keeping its marker', () => {
		expectPress(
			atBlock(docOf(ul(li(p('a')), li(p('b'), p()))), 2),
			'Enter',
			'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph("b"))), paragraph)'
		);
	});

	it('a continuation line typed in, Enter at its end opens the next item', () => {
		expectPress(
			atBlockEnd(docOf(ul(li(p('a'), p('cont')), li(p('c')))), 1),
			'Enter',
			'doc(bullet_list(list_item(paragraph("a"), paragraph("cont")), list_item(paragraph), list_item(paragraph("c"))))'
		);
	});
});

describe('Backspace takes an item’s marker off', () => {
	it('at the start of the first item, lifts out of the list', () => {
		expectPress(
			startOf('- a\n- b', 0),
			'Backspace',
			'doc(paragraph("a"), bullet_list(list_item(paragraph("b"))))'
		);
	});

	it('the first item lifted, the next counts from the list’s start', () => {
		const next = press(startOf('1. a\n2. b', 0), 'Backspace');
		expect(next.doc.child(1).attrs.start).toBe(1);
	});

	it('mid-text, declines the key so the browser deletes a character', () => {
		expect(run(after('- ab', 'a'), keys['Backspace'])).toBe(null);
	});

	it('at the start of a later item, its text stays under the item above', () => {
		const one = expectPress(
			startOf('1. a\n2. b\n3. c', 1),
			'Backspace',
			'doc(ordered_list(list_item(paragraph("a"), paragraph("b")), list_item(paragraph("c"))))'
		);
		expect(one.doc.child(0).attrs.start).toBe(1);
		expect(one.selection.$from.parent.textContent).toBe('b');
		expect(one.selection.$from.parentOffset).toBe(0);
		// The press after takes the line out to full width, and the one after that joins it.
		const two = expectPress(
			one,
			'Backspace',
			'doc(ordered_list(list_item(paragraph("a"))), paragraph("b"), ordered_list(list_item(paragraph("c"))))'
		);
		expectPress(
			two,
			'Backspace',
			'doc(ordered_list(list_item(paragraph("ab"))), ordered_list(list_item(paragraph("c"))))'
		);
	});

	it('an item’s other blocks come with it, its nested list among them', () => {
		expectPress(
			startOf('1. a\n2. b\n    1. x\n3. c', 1),
			'Backspace',
			'doc(ordered_list(list_item(paragraph("a"), paragraph("b"), ordered_list(list_item(paragraph("x")))), list_item(paragraph("c"))))'
		);
	});

	it('a nested later item continues its nested sibling', () => {
		expectPress(
			startOf('- a\n    - b\n    - c', 2),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("a"), bullet_list(list_item(paragraph("b"), paragraph("c"))))))'
		);
	});

	it('a nested first item continues the item it is nested in, ahead of the rest of its list', () => {
		expectPress(
			startOf('- a\n    - b\n    - c', 1),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("a"), paragraph("b"), bullet_list(list_item(paragraph("c"))))))'
		);
	});

	it('a nested first item’s own nested list joins the rest of its list', () => {
		expectPress(
			startOf('- a\n    - b\n        - x\n    - c', 1),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("a"), paragraph("b"), bullet_list(list_item(paragraph("x")), list_item(paragraph("c"))))))'
		);
	});

	it('an empty item is spent, the caret at the end of the line above', () => {
		const next = expectPress(
			atBlock(docOf(ul(li(p('a')), li(p()), li(p('c')))), 1),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph("c"))))'
		);
		expect(next.selection.from).toBe(4);
	});

	it('Enter then Backspace is the list it was', () => {
		const state = after('1. a\n2. b\n3. c', 'a');
		expect(press(press(state, 'Enter'), 'Backspace').doc.toString()).toBe(state.doc.toString());
	});

	it('at a top-level continuation line, takes it out to full width', () => {
		expectPress(
			atBlock(docOf(ul(li(p('a'), p('b')))), 1),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("a"))), paragraph("b"))'
		);
	});

	it('a line taken out splits the list, and the tail counts from 1', () => {
		const one = press(startOf('3. a\n4. b\n5. c', 1), 'Backspace');
		const two = press(one, 'Backspace');
		expect(two.doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph("a"))), paragraph("b"), ordered_list(list_item(paragraph("c"))))'
		);
		expect(two.doc.child(0).attrs.start).toBe(3);
		expect(two.doc.child(2).attrs.start).toBe(1);
		expect(two.selection.$from.parent.textContent).toBe('b');
		expect(two.selection.$from.parentOffset).toBe(0);
	});

	it('a line taken out brings the item’s lines after it', () => {
		expectPress(
			atBlock(docOf(ul(li(p('a'), p('b'), p('c')), li(p('d')))), 1),
			'Backspace',
			'doc(bullet_list(list_item(paragraph("a"))), paragraph("b"), paragraph("c"), bullet_list(list_item(paragraph("d"))))'
		);
	});

	it('a line with a sub-list below it in its item stays, the press the ordinary join', () => {
		expect(run(startOf('1. a\n\n    b\n\n    1. x', 1), keys['Backspace'])).toBe(null);
	});

	it('a nested continuation line keeps the ordinary join', () => {
		expect(run(atBlock(docOf(ul(li(p('a'), ul(li(p('b'), p('c')))))), 2), keys['Backspace'])).toBe(
			null
		);
	});
});

describe('Delete joins the line below onto the caret’s', () => {
	it('the item below joins, the list closing up', () => {
		expectPress(
			endOf('1. a\n2. b\n3. c', 0),
			'Delete',
			'doc(ordered_list(list_item(paragraph("ab")), list_item(paragraph("c"))))'
		);
	});

	it('a nested first item below joins, the rest of its list staying nested', () => {
		expectPress(
			endOf('- a\n    - b\n    - c', 0),
			'Delete',
			'doc(bullet_list(list_item(paragraph("ab"), bullet_list(list_item(paragraph("c"))))))'
		);
	});

	it('the item below keeps its nested list under the joined line', () => {
		expectPress(
			endOf('1. a\n2. b\n    1. x\n3. c', 0),
			'Delete',
			'doc(ordered_list(list_item(paragraph("ab"), ordered_list(list_item(paragraph("x")))), list_item(paragraph("c"))))'
		);
	});

	it('reaches the item below at a shallower level than the caret’s', () => {
		expectPress(
			endOf('- a\n    - b\n- c', 1),
			'Delete',
			'doc(bullet_list(list_item(paragraph("a"), bullet_list(list_item(paragraph("bc"))))))'
		);
	});

	it('joins a list’s first line onto the line above it', () => {
		expectPress(
			endOf('head\n\n- a\n- b', 0),
			'Delete',
			'doc(paragraph("heada"), bullet_list(list_item(paragraph("b"))))'
		);
	});

	it('joins a block after the list onto the list’s last line', () => {
		expectPress(
			atBlockEnd(docOf(ul(li(p('a'), p('cont'))), p('b')), 1),
			'Delete',
			'doc(bullet_list(list_item(paragraph("a"), paragraph("contb"))))'
		);
	});

	it('spends an empty item below, joining nothing past it', () => {
		expectPress(
			atBlockEnd(docOf(ul(li(p('a')), li(p()), li(p('c')))), 0),
			'Delete',
			'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph("c"))))'
		);
	});

	it('spends an empty item rather than unmarking the one below it', () => {
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

	it('takes only the marker off a fence below: a fence takes no prose line', () => {
		const fence = n.code_block.create(null, blockSchema.text('code'));
		expectPress(
			atBlockEnd(docOf(ul(li(p('a')), li(fence))), 0),
			'Delete',
			'doc(bullet_list(list_item(paragraph("a"), code_block("code"))))'
		);
	});

	it('leaves the caret where the key was pressed', () => {
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

	it('declines between two blocks outside every list', () => {
		expect(run(endOf('head\n\ntail', 0), keys['Delete'])).toBe(null);
	});

	it('at the last item’s end, joins the line below onto it', () => {
		expectPress(
			atBlockEnd(docOf(ul(li(p('a'))), p('tail')), 0),
			'Delete',
			'doc(bullet_list(list_item(paragraph("atail"))))'
		);
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
