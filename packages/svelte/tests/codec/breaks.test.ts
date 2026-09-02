// @vitest-environment jsdom
// One spelling of a within-block line break, whatever gesture opens one. A range
// crossing a fence's edge is what does: the delete merges the two textblocks and the
// fence's text arrives in the survivor with its `\n`s, which the leaf's DOM collapses
// to a space while the store and the preview read them as the line boundaries they are.
//
// Driven over a state carrying the plugin, the way `proseLeafPlugins` mounts it:
// `appendTransaction` runs on `state.apply`, so the keymap chains and the normalizer
// compose here as they do in a leaf.
import { describe, it, expect } from 'vitest';
import { DOMParser } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { blockSchema, bodyKeymap, decode, inlineSchema } from '$lib/core/codec';
import { linebreakPlugin } from '$lib/core/codec/breaks.js';
import { md, keyDriver, representable, shape } from './_util.js';

const keys = bodyKeymap(blockSchema);
const { press, expectPress } = keyDriver(keys);

/** Whether the leaf's binding claims `key` at all: the one thing a doc-shape assertion
 *  cannot see, a swallowed key and an unbound one leaving the same document. */
const claims = (state: EditorState, key: string): boolean => !!keys[key]?.(state, undefined);

/** A state over `markdown`, normalizer mounted, selecting PM range `[from, to]`. */
function sel(markdown: string, from: number, to: number): EditorState {
	const doc = decode(md(markdown), blockSchema);
	return EditorState.create({
		doc,
		selection: TextSelection.create(doc, from, to),
		plugins: [linebreakPlugin(blockSchema)]
	});
}

const PARA_THEN_FENCE = 'para\n\n```\nalpha\nbeta\n```';

describe('a range across a fence edge', () => {
	// `doc(paragraph("para"), code_block("alpha\nbeta"))`: PM 5 ends the paragraph's
	// text and PM 7 opens the fence's, so the range is the boundary between them and
	// nothing else.
	it('leaves breaks where Backspace merges the fence into the paragraph', () => {
		const next = press(sel(PARA_THEN_FENCE, 5, 7), 'Backspace');
		expect(shape(next)).toBe('doc(paragraph("paraalpha", hard_break, "beta"))');
		expect(representable(next)).toBe(true);
	});

	it('leaves breaks where Delete does', () => {
		const next = press(sel(PARA_THEN_FENCE, 5, 7), 'Delete');
		expect(shape(next)).toBe('doc(paragraph("paraalpha", hard_break, "beta"))');
	});

	it('leaves breaks where Enter splits what the delete merged', () => {
		const next = press(sel(PARA_THEN_FENCE, 5, 7), 'Enter');
		expect(shape(next)).toBe('doc(paragraph("para"), paragraph("alpha", hard_break, "beta"))');
		expect(representable(next)).toBe(true);
	});
});

// A heading holds no break: it is a block of one line, so the store clears a
// continuation after one. The space is what every door spells the boundary as, and
// the three that can reach a heading are asserted here and in `block-keys`.
describe('a block that holds no break takes a space', () => {
	it('a fence merged into a heading arrives spaced, not run together', () => {
		const next = press(sel('# head\n\n```\nalpha\nbeta\n```', 5, 7), 'Backspace');
		expect(shape(next)).toBe('doc(heading("headalpha beta"))');
		expect(representable(next)).toBe(true);
	});

	it('the space carries the marks the break stood under', () => {
		const doc = blockSchema.nodes.doc.create(null, [
			blockSchema.nodes.heading.create({ level: 1 }, [
				blockSchema.text('a\nb', [blockSchema.marks.strong.create()])
			])
		]);
		const state = EditorState.create({ doc, plugins: [linebreakPlugin(blockSchema)] });
		// `appendTransaction` runs on a doc change, so a keystroke is what triggers it.
		const next = state.apply(state.tr.insertText('X', 1));
		expect(shape(next)).toBe('doc(heading(strong("Xa b")))');
	});
});

describe('what it leaves alone', () => {
	it('a code block keeps its own newlines', () => {
		const doc = decode(md('```\nalpha\nbeta\n```'), blockSchema);
		const state = EditorState.create({
			doc,
			selection: TextSelection.create(doc, 3),
			plugins: [linebreakPlugin(blockSchema)]
		});
		expect(shape(press(state, 'Enter'))).toBe('doc(code_block("al\\npha\\nbeta"))');
	});

	it('a schema with no break node mounts it as a no-op', () => {
		const doc = decode(md('one'), inlineSchema);
		const state = EditorState.create({ doc, plugins: [linebreakPlugin(inlineSchema)] });
		expect(shape(state.apply(state.tr.insertText('x', 2)))).toBe('doc(paragraph("oxne"))');
	});
});

describe('Shift-Enter', () => {
	it('opens a break in a paragraph', () => {
		expectPress(sel('one two', 4, 4), 'Shift-Enter', 'doc(paragraph("one", hard_break, " two"))');
	});

	it('opens one inside a list item, where the line stays the item’s', () => {
		expectPress(
			sel('- one two', 6, 6),
			'Shift-Enter',
			'doc(bullet_list(list_item(paragraph("one", hard_break, " two"))))'
		);
	});

	it('takes the selection it is pressed over', () => {
		expectPress(sel('one two', 4, 8), 'Shift-Enter', 'doc(paragraph("one", hard_break))');
	});

	it('carries no marks itself, and leaves the caret carrying the run’s', () => {
		const next = press(sel('**bold text**', 5, 5), 'Shift-Enter');
		expect(shape(next)).toBe('doc(paragraph(strong("bold"), hard_break, strong(" text")))');
		expect(next.storedMarks?.map((m) => m.type.name)).toEqual(['strong']);
	});

	// A heading holds no break (`schema.ts` §`takesLineBreak`). Both cases below have to
	// be *claimed* rather than declined: a declined key is the browser's, and its `<br>`
	// is the space a heading parses one to.
	it('is swallowed in a heading, not declined', () => {
		const state = sel('# a title', 4, 4);
		expect(claims(state, 'Shift-Enter')).toBe(true);
		expect(shape(press(state, 'Shift-Enter'))).toBe('doc(heading("a title"))');
	});

	it('a heading parses a `<br>` as a space', () => {
		const dom = window.document.createElement('div');
		dom.innerHTML = '<h1>a<br>title</h1>';
		expect(DOMParser.fromSchema(blockSchema).parse(dom).toString()).toBe('doc(heading("a title"))');
	});

	it('is a newline in a code block, where that is the same line', () => {
		expectPress(
			sel('```\nalpha\nbeta\n```', 3, 3),
			'Shift-Enter',
			'doc(code_block("al\\npha\\nbeta"))'
		);
	});

	it('leaves a selected island alone, and claims the key to keep it that way', () => {
		const doc = decode(md('| a |\n| - |\n| b |'), blockSchema);
		const state = EditorState.create({
			doc,
			selection: NodeSelection.create(doc, 0),
			plugins: [linebreakPlugin(blockSchema)]
		});
		expect(claims(state, 'Shift-Enter')).toBe(true);
		expect(shape(press(state, 'Shift-Enter'))).toBe(shape(state));
	});
});
