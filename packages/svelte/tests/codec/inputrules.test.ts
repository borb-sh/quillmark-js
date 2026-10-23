// @vitest-environment jsdom
// Behavioral input-rule coverage, which is the only kind there is: counting the mounted
// rules proves nothing, a rule that fires at the wrong position still being one rule.
// Typing is simulated the way the browser drives it: per-char through `handleTextInput`
// (the inputrules plugin's entry), falling back to a plain insert when no rule claims
// the char.
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
	blockSchema,
	createField,
	inlineSchema,
	inputRulesPlugin,
	proseLeafPlugins
} from '$lib/core/codec';
import type { FieldController, LeafViews } from '$lib/core/codec';
import { md, mount, press, quill, representable } from './_util.js';

function mountView(): EditorView {
	const state = EditorState.create({
		doc: blockSchema.nodes.doc.create(null, blockSchema.nodes.paragraph.create()),
		plugins: [inputRulesPlugin(blockSchema)]
	});
	return new EditorView(document.createElement('div'), { state });
}

function type(view: EditorView, text: string): void {
	for (const ch of text) {
		const { from, to } = view.state.selection;
		const deflt = () => view.state.tr.insertText(ch, from, to);
		const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, deflt));
		if (!handled) view.dispatch(deflt());
	}
}

// Mid-sentence, after a non-space char, after a char equal to the captured text, at
// line start, and with a char typed after the closing delimiter.
describe('mark input rules fire with exact positions', () => {
	it.each([
		['word *em*', 'doc(paragraph("word ", em("em")))'],
		['5*6*', 'doc(paragraph("5", em("6")))'],
		['e*e*', 'doc(paragraph("e", em("e")))'],
		['*em*', 'doc(paragraph(em("em")))'],
		['a **b**', 'doc(paragraph("a ", strong("b")))'],
		['x ~~y~~', 'doc(paragraph("x ", strike("y")))'],
		['x `y`', 'doc(paragraph("x ", code("y")))'],
		['a *b* c', 'doc(paragraph("a ", em("b"), " c"))'],
		['a _em_', 'doc(paragraph("a ", em("em")))'],
		['_em_', 'doc(paragraph(em("em")))'],
		['a __b__', 'doc(paragraph("a ", strong("b")))'],
		['snake_case_name', 'doc(paragraph("snake_case_name"))'],
		['dunder__init__', 'doc(paragraph("dunder__init__"))']
	])('%s', (typed, shape) => {
		const view = mountView();
		type(view, typed);
		expect(view.state.doc.toString()).toBe(shape);
		view.destroy();
	});
});

// A typed URL links on the space that closes it, as a paste over a selection does.
describe('a typed URL links on the space after it', () => {
	const href = (view: EditorView): string[] => {
		const out: string[] = [];
		view.state.doc.descendants((node) => {
			for (const mark of node.marks) if (mark.type.name === 'link') out.push(mark.attrs.href);
		});
		return out;
	};

	it.each([
		['see https://example.com/a?b=1 ', 'https://example.com/a?b=1', 'https://example.com/a?b=1'],
		['www.example.com. ', 'www.example.com', 'https://www.example.com'],
		['(mailto:x@y.z) ', null, null],
		['(https://example.com) ', 'https://example.com', 'https://example.com']
	])('%s', (typed, text, link) => {
		const view = mountView();
		type(view, typed);
		expect(view.state.doc.textContent).toBe(typed);
		expect(href(view)).toEqual(link ? [link] : []);
		if (text) {
			let linked = '';
			view.state.doc.descendants((node) => {
				if (node.marks.some((m) => m.type.name === 'link')) linked += node.text;
			});
			expect(linked).toBe(text);
		}
		view.destroy();
	});

	it('a scheme nothing follows stays text', () => {
		const view = mountView();
		type(view, 'javascript://x ');
		expect(href(view)).toEqual([]);
		view.destroy();
	});

	it('inside code it stays text', () => {
		const view = mountView();
		type(view, '`https://example.com` ');
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 20)));
		type(view, ' ');
		expect(href(view)).toEqual([]);
		view.destroy();
	});
});

// A heading holds no `hard_break` (`schema.ts`), and `setBlockType` clears what a new
// type cannot hold by deleting it — which joins the text either side with nothing. The
// retype spaces the break first, which is what the break becomes at every other door.
describe('`# ` over a paragraph carrying a break', () => {
	it('spaces the break rather than running the words together', () => {
		const view = mountView();
		type(view, 'line one');
		view.dispatch(view.state.tr.replaceSelectionWith(blockSchema.nodes.hard_break.create()));
		type(view, 'line two');
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
		type(view, '# ');
		expect(view.state.doc.toString()).toBe('doc(heading("line one line two"))');
		expect(representable(view.state)).toBe(true);
		view.destroy();
	});
});

// `list_item` is `block+`, so `list_item > heading` is a shape the content holds and
// `importMarkdown` produces from `- # title`. A rule declining there would refuse to
// author what a document can arrive carrying, so `# ` fires inside an item — and is
// the one gesture that mints the shape, the wrap side retyping a heading it wraps.
describe('`# ` inside an item', () => {
	it('`- ` typed in a heading wraps it as a PARAGRAPH item', () => {
		const view = mountView();
		type(view, '## title');
		expect(view.state.doc.toString()).toBe('doc(heading("title"))');
		// Back to the block start, then the list shorthand.
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
		type(view, '- ');
		expect(view.state.doc.toString()).toBe('doc(bullet_list(list_item(paragraph("title"))))');
		view.destroy();
	});

	it('fires, minting the heading the content holds', () => {
		const view = mountView();
		type(view, '- item');
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
		type(view, '# ');
		expect(view.state.doc.toString()).toBe('doc(bullet_list(list_item(heading("item"))))');
		expect(representable(view.state)).toBe(true);
		view.destroy();
	});

	it('`# ` outside a list still makes a heading', () => {
		const view = mountView();
		type(view, '### deep');
		expect(view.state.doc.toString()).toBe('doc(heading("deep"))');
		expect(view.state.doc.child(0).attrs.level).toBe(3);
		view.destroy();
	});
});

// A code block is the one block a gap cursor will not sit beside, so a fence at the end
// of a body strands the caret harder than a divider would: no arrow key reaches past it.
// The rule therefore mints the same exit `---` and a block island do. It fires on Enter,
// so the language typed after the backticks is there to keep.
describe('the ` ``` ` fence shorthand', () => {
	function leafView(): EditorView {
		const state = EditorState.create({
			doc: blockSchema.nodes.doc.create(null, blockSchema.nodes.paragraph.create()),
			plugins: proseLeafPlugins(blockSchema, { inline: false })
		});
		return new EditorView(document.createElement('div'), { state });
	}

	it('stays the text it was typed as until Enter', () => {
		const view = leafView();
		type(view, '```');
		expect(view.state.doc.toString()).toBe('doc(paragraph("```"))');
		view.destroy();
	});

	it('opens the paragraph after it, so the end of a body is not a dead end', () => {
		const view = leafView();
		type(view, '```');
		press(view, 'Enter');
		expect(view.state.doc.toString()).toBe('doc(code_block, paragraph)');
		expect(view.state.doc.firstChild!.attrs.lang).toBe(null);
		// The caret stays in the fence, not in the exit it minted.
		expect(view.state.selection.$from.parent.type.name).toBe('code_block');
		view.destroy();
	});

	it('keeps the language typed after the backticks', () => {
		const view = leafView();
		type(view, '```rust');
		press(view, 'Enter');
		expect(view.state.doc.toString()).toBe('doc(code_block, paragraph)');
		expect(view.state.doc.firstChild!.attrs.lang).toBe('rust');
		view.destroy();
	});

	it('keeps the block that already follows rather than opening a second', () => {
		const view = leafView();
		const { paragraph } = blockSchema.nodes;
		view.dispatch(view.state.tr.insert(2, paragraph.create(null, blockSchema.text('after'))));
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
		type(view, '```');
		press(view, 'Enter');
		expect(view.state.doc.toString()).toBe('doc(code_block, paragraph("after"))');
		view.destroy();
	});

	it('is an ordinary Enter on any other line', () => {
		const view = leafView();
		type(view, 'a ```');
		press(view, 'Enter');
		expect(view.state.doc.toString()).toBe('doc(paragraph("a ```"), paragraph)');
		view.destroy();
	});
});

// A shorthand is a prefix, so it fires at a block's head alone: mid-sentence it would eat
// a dash. The slash menu's list pick runs at any caret (`slash.test.ts`); this door
// keeps the guard.
describe('the list shorthands stay literal past the head of a block', () => {
	it.each([
		['alpha - ', 'doc(paragraph("alpha - "))'],
		['alpha 1. ', 'doc(paragraph("alpha 1. "))'],
		['alpha 1) ', 'doc(paragraph("alpha 1) "))']
	])('%s', (typed, shape) => {
		const view = mountView();
		type(view, typed);
		expect(view.state.doc.toString()).toBe(shape);
		view.destroy();
	});
});

describe('`1) ` numbers a block as `1. ` does', () => {
	it.each([
		['1) ', 1],
		['3) ', 3]
	])('%s', (typed, start) => {
		const view = mountView();
		type(view, typed + 'a');
		const list = view.state.doc.firstChild!;
		expect(list.type.name).toBe('ordered_list');
		expect(list.attrs.start).toBe(start);
		expect(list.textContent).toBe('a');
		view.destroy();
	});
});

// A list shorthand at the head of an item that already exists is the item's: wrapping
// there would mint an item whose only content is another item. On a first item it
// retypes the list; on a later one the other kind sinks it into a sub-list, under the
// previous sibling, which is the shape a nesting has.
describe('the list shorthands at the head of an existing item', () => {
	/** A view over `markdown`'s list, typed, caret at the head of item `index`. */
	function itemView(lines: string[], index = 0): EditorView {
		const view = mountView();
		lines.forEach((line, i) => {
			if (i) view.dispatch(view.state.tr.split(view.state.selection.from, 2));
			type(view, line);
		});
		let at = -1;
		let seen = 0;
		view.state.doc.descendants((node, pos) => {
			if (node.type.name === 'paragraph' && seen++ === index) at = pos + 1;
			return at < 0;
		});
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
		return view;
	}

	it('`1. ` on a first item numbers a bulleted list, every item with it', () => {
		const view = itemView(['- alpha', 'beta'], 0);
		type(view, '1. ');
		expect(view.state.doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph("alpha")), list_item(paragraph("beta"))))'
		);
		view.destroy();
	});

	it('`- ` on a first item bullets a numbered list', () => {
		const view = itemView(['1. alpha', 'beta'], 0);
		type(view, '- ');
		expect(view.state.doc.toString()).toBe(
			'doc(bullet_list(list_item(paragraph("alpha")), list_item(paragraph("beta"))))'
		);
		view.destroy();
	});

	it('another number on a later numbered item stays literal: it renumbers nothing above', () => {
		const view = itemView(['1. alpha', 'beta'], 1);
		type(view, '7. ');
		expect(view.state.doc.child(0).attrs.start).toBe(1);
		expect(view.state.doc.child(0).child(1).textContent).toBe('7. beta');
		view.destroy();
	});

	it('`N. ` on a first item sets where the list counts from, back to 1 included', () => {
		const view = itemView(['7. alpha', 'beta']);
		type(view, '1. ');
		expect(view.state.doc.child(0).attrs.start).toBe(1);
		expect(view.state.doc.textContent).toBe('alphabeta');
		view.destroy();
	});

	it('the marker a list already has stays text', () => {
		for (const [lines, typed, index] of [
			[['- alpha', 'beta'], '- ', 1],
			[['1. alpha', 'beta'], '2. ', 1],
			[['1. alpha'], '1. ', 0]
		] as const) {
			const view = itemView([...lines], index);
			type(view, typed);
			expect(view.state.doc.textContent, typed).toContain(`${typed}`);
			view.destroy();
		}
	});

	it('the other kind on a later item opens a sub-list under the item above', () => {
		const view = itemView(['1. alpha', 'beta'], 1);
		type(view, '- ');
		expect(view.state.doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph("alpha"), bullet_list(list_item(paragraph("beta"))))))'
		);
		expect(representable(view.state)).toBe(true);
		view.destroy();
	});

	it('a later sub-item joins the sub-list of its kind standing above it', () => {
		const view = itemView(['1. alpha', 'beta', 'gamma'], 1);
		type(view, '- ');
		let gamma = -1;
		view.state.doc.descendants((node, pos) => {
			if (node.isText && node.text === 'gamma') gamma = pos;
			return gamma < 0;
		});
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, gamma)));
		type(view, '- ');
		expect(view.state.doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph("alpha"), bullet_list(list_item(paragraph("beta")), list_item(paragraph("gamma"))))))'
		);
		view.destroy();
	});

	it('`N. ` on a later bulleted item opens a numbered sub-list counting from N', () => {
		const view = itemView(['- alpha', 'beta'], 1);
		type(view, '3. ');
		const sub = view.state.doc.child(0).child(0).child(1);
		expect(sub.type.name).toBe('ordered_list');
		expect(sub.attrs.start).toBe(3);
		view.destroy();
	});

	it('a LATER block of the item still opens a sub-list, which is the gesture that works', () => {
		const view = mountView();
		const { bullet_list, list_item, paragraph } = blockSchema.nodes;
		view.updateState(
			EditorState.create({
				doc: blockSchema.nodes.doc.create(null, [
					bullet_list.create(null, [
						list_item.create(null, [
							paragraph.create(null, blockSchema.text('alpha')),
							paragraph.create()
						])
					])
				]),
				plugins: [inputRulesPlugin(blockSchema)]
			})
		);
		// The item's second paragraph: a continuation, and wrapping one is how a sub-list
		// opens under text.
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 10)));
		type(view, '- ');
		expect(view.state.doc.toString()).toBe(
			'doc(bullet_list(list_item(paragraph("alpha"), bullet_list(list_item(paragraph)))))'
		);
		view.destroy();
	});

	it('outside a list the shorthand is untouched', () => {
		const view = mountView();
		type(view, '- one');
		expect(view.state.doc.toString()).toBe('doc(bullet_list(list_item(paragraph("one"))))');
		view.destroy();
	});

	// `> ` is the one block shorthand that fires here: what it wraps the item's paragraph
	// in is a container the content holds, which is the whole of why the guard stops at
	// the list rules.
	it('`> ` fires, a quote inside an item being a shape the content holds', () => {
		const view = itemView(['- alpha']);
		type(view, '> ');
		expect(view.state.doc.toString()).toBe(
			'doc(bullet_list(list_item(blockquote(paragraph("alpha")))))'
		);
		expect(representable(view.state)).toBe(true);
		view.destroy();
	});
});

// `---` replaces its whole block, which is what the other block shorthands never do:
// a divider holds no content to retype into. So the cases are about what it consumes.
describe('the `---` divider shorthand', () => {
	it('replaces its block and opens the paragraph after it', () => {
		const view = mountView();
		type(view, '---');
		expect(view.state.doc.toString()).toBe('doc(horizontal_rule, paragraph)');
		// The caret is in the exit, not on the divider.
		expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
		view.destroy();
	});

	it('keeps the block that already follows rather than opening a second', () => {
		const view = mountView();
		const { paragraph } = blockSchema.nodes;
		// A block after the caret's is the exit already; the rule adds none.
		view.dispatch(view.state.tr.insert(2, paragraph.create(null, blockSchema.text('after'))));
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
		type(view, '---');
		expect(view.state.doc.toString()).toBe('doc(horizontal_rule, paragraph("after"))');
		view.destroy();
	});

	it('stays literal when the block holds anything else', () => {
		const view = mountView();
		type(view, 'a---');
		expect(view.state.doc.toString()).toBe('doc(paragraph("a---"))');
		view.destroy();
	});

	// A divider in an item is the heading case again: the content holds it and
	// `importMarkdown` produces it, so the rule authors it rather than declining.
	it("fires inside a list item, replacing the item's own first block", () => {
		const view = mountView();
		type(view, '- ');
		type(view, '---');
		expect(view.state.doc.toString()).toBe(
			'doc(bullet_list(list_item(horizontal_rule, paragraph)))'
		);
		expect(representable(view.state)).toBe(true);
		view.destroy();
	});
});

// The press right after a rule fired is where a writer says the shorthand guessed wrong,
// so Backspace there leaves the text it consumed. Driven through a leaf's whole stack,
// where the body's own Backspace chain would otherwise answer first.
describe('Backspace right after a shorthand takes it back', () => {
	function leafView(schema = blockSchema, inline = false): EditorView {
		const state = EditorState.create({
			doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create()),
			plugins: proseLeafPlugins(schema, { inline })
		});
		return new EditorView(document.createElement('div'), { state });
	}

	it.each(['# ', '- ', '1. ', '1) ', '> ', '---', 'a **b**', 'a __b__', 'a _b_', 'a ~~b~~'])(
		'%s',
		(typed) => {
			const view = leafView();
			type(view, typed);
			expect(view.state.doc.toString()).not.toBe(`doc(paragraph("${typed}"))`);
			press(view, 'Backspace');
			expect(view.state.doc.toString()).toBe(`doc(paragraph("${typed}"))`);
			view.destroy();
		}
	);

	it('a typed URL, the space kept', () => {
		const view = leafView();
		type(view, 'https://example.com ');
		press(view, 'Backspace');
		expect(view.state.doc.toString()).toBe('doc(paragraph("https://example.com "))');
		view.destroy();
	});

	it('a fence, language and all', () => {
		const view = leafView();
		type(view, '```rust');
		press(view, 'Enter');
		press(view, 'Backspace');
		expect(view.state.doc.toString()).toBe('doc(paragraph("```rust"))');
		view.destroy();
	});

	it('only on that press: a keystroke between keeps the shorthand', () => {
		const view = leafView();
		type(view, '# x');
		// The browser's own deletion of the `x`, which no keymap claims.
		view.dispatch(view.state.tr.delete(1, 2));
		press(view, 'Backspace');
		// The heading's own Backspace answers instead: its shape goes, and the `# ` the
		// shorthand consumed stays consumed.
		expect(view.state.doc.toString()).toBe('doc(paragraph)');
		view.destroy();
	});

	it("an inline leaf's mark rule", () => {
		const view = leafView(inlineSchema, true);
		type(view, '*em*');
		press(view, 'Backspace');
		expect(view.state.doc.toString()).toBe('doc(paragraph("*em*"))');
		view.destroy();
	});

	it("a table cell's mark rule", () => {
		const doc = quill().seedDocument();
		doc.overwrite({}, md('| a | b |\n|---|---|\n| 1 | 2 |'));
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		const cell = (field as FieldController & LeafViews).nestedViews()[2]!;
		cell.dispatch(cell.state.tr.setSelection(TextSelection.atEnd(cell.state.doc)));
		type(cell, ' **b**');
		press(cell, 'Backspace');
		expect(cell.state.doc.toString()).toBe('doc(paragraph("1 **b**"))');
		field.destroy();
	});
});

// The caret a block shorthand places is scrolled to, as a pick's is (`slash.test.ts`).
describe('a block shorthand scrolls the caret it places into view', () => {
	it.each(['# ', '- ', '1. ', '> ', '---'])('%s', (typed) => {
		const view = mountView();
		type(view, typed.slice(0, -1));
		const seen: Transaction[] = [];
		const dispatch = view.dispatch;
		view.dispatch = (tr) => {
			seen.push(tr);
			dispatch(tr);
		};
		type(view, typed.slice(-1));
		expect(seen.map((tr) => tr.scrolledIntoView)).toEqual([true]);
		view.destroy();
	});
});
