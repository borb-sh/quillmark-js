// @vitest-environment jsdom
// Behavioral input-rule coverage, which is the only kind there is: counting the mounted
// rules proves nothing, a rule that fires at the wrong position still being one rule.
// Typing is simulated the way the browser drives it: per-char through `handleTextInput`
// (the inputrules plugin's entry), falling back to a plain insert when no rule claims
// the char.
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { blockSchema, inputRulesPlugin } from '$lib/core/codec';
import { representable } from './_util.js';

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

/** The first paragraph's text plus, per child, its text and mark names. */
function inlineShape(view: EditorView): { text: string; runs: [string, string[]][] } {
	const para = view.state.doc.child(0);
	const runs: [string, string[]][] = [];
	para.forEach((child) => {
		runs.push([child.text ?? '', child.marks.map((m) => m.type.name)]);
	});
	return { text: para.textContent, runs };
}

describe('mark input rules fire with exact positions', () => {
	it('*em* mid-sentence keeps the char before the delimiter', () => {
		const view = mountView();
		type(view, 'word *em*');
		expect(inlineShape(view)).toEqual({
			text: 'word em',
			runs: [
				['word ', []],
				['em', ['em']]
			]
		});
		view.destroy();
	});

	it('*em* directly after a non-space char (5*6*)', () => {
		const view = mountView();
		type(view, '5*6*');
		expect(inlineShape(view)).toEqual({
			text: '56',
			runs: [
				['5', []],
				['6', ['em']]
			]
		});
		view.destroy();
	});

	it('*em* whose prefix char equals the captured text (e*e*)', () => {
		const view = mountView();
		type(view, 'e*e*');
		expect(inlineShape(view)).toEqual({
			text: 'ee',
			runs: [
				['e', []],
				['e', ['em']]
			]
		});
		view.destroy();
	});

	it('*em* at line start', () => {
		const view = mountView();
		type(view, '*em*');
		expect(inlineShape(view)).toEqual({ text: 'em', runs: [['em', ['em']]] });
		view.destroy();
	});

	it('**strong** mid-sentence', () => {
		const view = mountView();
		type(view, 'a **b**');
		expect(inlineShape(view)).toEqual({
			text: 'a b',
			runs: [
				['a ', []],
				['b', ['strong']]
			]
		});
		view.destroy();
	});

	it('~~strike~~ and `code`', () => {
		const view = mountView();
		type(view, 'x ~~y~~');
		expect(inlineShape(view).runs).toEqual([
			['x ', []],
			['y', ['strike']]
		]);
		view.destroy();
		const view2 = mountView();
		type(view2, 'x `y`');
		expect(inlineShape(view2).runs).toEqual([
			['x ', []],
			['y', ['code']]
		]);
		view2.destroy();
	});

	it('the mark does not bleed into the next typed char', () => {
		const view = mountView();
		type(view, 'a *b* c');
		expect(inlineShape(view)).toEqual({
			text: 'a b c',
			runs: [
				['a ', []],
				['b', ['em']],
				[' c', []]
			]
		});
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
// The rule therefore mints the same exit `---` and a block island do.
describe('the ` ``` ` fence shorthand', () => {
	it('opens the paragraph after it, so the end of a body is not a dead end', () => {
		const view = mountView();
		type(view, '```');
		expect(view.state.doc.toString()).toBe('doc(code_block, paragraph)');
		// The caret stays in the fence, not in the exit it minted.
		expect(view.state.selection.$from.parent.type.name).toBe('code_block');
		view.destroy();
	});

	it('keeps the block that already follows rather than opening a second', () => {
		const view = mountView();
		const { paragraph } = blockSchema.nodes;
		view.dispatch(view.state.tr.insert(2, paragraph.create(null, blockSchema.text('after'))));
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
		type(view, '```');
		expect(view.state.doc.toString()).toBe('doc(code_block, paragraph("after"))');
		view.destroy();
	});
});

// A list shorthand at the head of an item that already exists is the text an author
// typed: firing there mints an item whose only content is another item, and Tab is the
// gesture that nests (under the previous sibling, which is the shape a nesting has).
describe('the list shorthands decline at the head of an existing item', () => {
	/** A view over `- alpha`, caret at the item's own start. */
	function itemView(): EditorView {
		const view = mountView();
		type(view, '- alpha');
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
		return view;
	}

	it('`- ` stays literal', () => {
		const view = itemView();
		type(view, '- ');
		expect(view.state.doc.toString()).toBe('doc(bullet_list(list_item(paragraph("- alpha"))))');
		view.destroy();
	});

	it('`1. ` stays literal', () => {
		const view = itemView();
		type(view, '1. ');
		expect(view.state.doc.toString()).toBe('doc(bullet_list(list_item(paragraph("1. alpha"))))');
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
		const view = itemView();
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
