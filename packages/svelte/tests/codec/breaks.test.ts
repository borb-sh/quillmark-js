// One spelling of a within-block line break, whatever gesture opens one. A range
// crossing a fence's edge is what does: the delete merges the two textblocks and the
// fence's text arrives in the survivor with its `\n`s, which the leaf's DOM collapses
// to a space while the store and the preview read them as the line boundaries they are.
//
// Driven over a state carrying the plugin, the way `proseLeafPlugins` mounts it:
// `appendTransaction` runs on `state.apply`, so the keymap chains and the normalizer
// compose here as they do in a leaf.
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { blockSchema, bodyKeymap, decode, inlineSchema } from '$lib/core/codec';
import { linebreakPlugin } from '$lib/core/codec/breaks.js';
import { md, keyDriver, representable, shape } from './_util.js';

const { press } = keyDriver(bodyKeymap(blockSchema));

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
