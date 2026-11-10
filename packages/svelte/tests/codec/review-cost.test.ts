// @vitest-environment jsdom
// What the review layer redoes as the reader works beside a batch of proposals, counted as work:
// the paragraphs whose words are read to be diffed. A keystroke reads only the paragraph it
// changed, and the lit item moving reads nothing and reaches only a leaf that draws the item it
// left or the one it reached.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Node as PMNode } from 'prosemirror-model';
import { createField, type FieldController, type TextReview } from '$lib/core/codec';
import { example, md, mount, quill, viewOf } from './_util.js';

/** The text of each block read as words to diff: the layer reads one with a leaf node's stand-in
 *  and no block separator, which no other reader of a block's text passes. */
const read: string[] = [];
const textBetween = PMNode.prototype.textBetween;
vi.spyOn(PMNode.prototype, 'textBetween').mockImplementation(function (
	this: PMNode,
	...args: Parameters<PMNode['textBetween']>
) {
	if (args[2] === undefined && typeof args[3] === 'function') read.push(this.textContent);
	return textBetween.apply(this, args);
});
const reads = (): string[] => read.splice(0);

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const open: FieldController[] = [];
afterEach(() => {
	for (const field of open.splice(0)) field.destroy();
});

const paragraph = (n: number): string =>
	Array.from({ length: 12 }, (_, i) => `p${n}w${i}`).join(' ') + '.';

/** A leaf of `count` paragraphs, a proposal over each of the first `proposed`, named `prefix`n. */
function batch(prefix: string, count: number, proposed = count) {
	const doc = example();
	const texts = Array.from({ length: count }, (_, n) => paragraph(n));
	doc.replace({}, md(texts.join('\n\n')));
	const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
	open.push(field);
	const blocks = doc.blocks({});
	const items: TextReview[] = texts.slice(0, proposed).map((text, n) => ({
		id: `${prefix}${n}`,
		state: 'proposed',
		replace: [blocks[n].id],
		after: text.replace(`p${n}w3`, 'proposed')
	}));
	field.setReview(items);
	const view = viewOf(field);
	/** Type a letter at the start of paragraph `n`. */
	const type = (n: number): void => {
		let at = 1;
		for (let k = 0; k < n; k++) at += view.state.doc.child(k).nodeSize;
		view.dispatch(view.state.tr.insertText('x', at));
	};
	return { field, items, view, type };
}

describe('typing beside a batch of proposals', () => {
	it('reads only the paragraph the keystroke changed', () => {
		const leaf = batch('r', 8, 6);
		reads();
		leaf.type(2);
		const typed = reads();
		expect(typed).not.toEqual([]);
		expect(typed.every((text) => text.includes('p2w'))).toBe(true);
		leaf.type(7);
		expect(reads()).toEqual([]);
	});

	it('reads nothing when attention moves, and leaves a leaf that draws neither item alone', () => {
		const here = batch('a', 4);
		const there = batch('b', 4);
		const reached = vi.spyOn(there.view, 'setProps');
		reads();
		for (const lit of ['a0', 'a1', 'a2', undefined]) {
			here.field.setReview(here.items, lit);
			there.field.setReview(there.items, lit);
		}
		expect(reads()).toEqual([]);
		expect(reached).not.toHaveBeenCalled();
		there.field.setReview(there.items, 'b1');
		expect(reached).toHaveBeenCalledOnce();
	});
});
