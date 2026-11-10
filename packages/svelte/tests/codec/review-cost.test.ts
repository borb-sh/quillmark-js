// @vitest-environment jsdom
// What the review layer redoes as the reader works beside a batch of proposals, counted as work:
// a keystroke diffs only the paragraph it changed, and the lit item moving diffs nothing and
// reaches only a leaf that draws the item it left or the one it reached.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createField, type FieldController, type TextReview } from '$lib/core/codec';
import * as diff from '$lib/core/codec/review-diff.js';
import { example, md, mount, quill, viewOf } from './_util.js';

vi.mock('$lib/core/codec/review-diff.js', async (actual) => {
	const real = await actual<typeof import('$lib/core/codec/review-diff.js')>();
	const diffs = { count: 0 };
	return {
		...real,
		diffs,
		wordDiff: (a: string, b: string) => (diffs.count++, real.wordDiff(a, b))
	};
});
const { diffs } = diff as unknown as { diffs: { count: number } };

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
	const items: TextReview[] = texts.slice(0, proposed).map((text, n) => {
		const at = doc.main.body.text.indexOf(text);
		field.insertAnchor(`~${prefix}${n}`, at, at + 4);
		return {
			id: `${prefix}${n}`,
			state: 'proposed',
			anchor: `~${prefix}${n}`,
			after: text.replace(`p${n}w3`, 'proposed')
		};
	});
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
	it('diffs only the paragraph the keystroke changed', () => {
		const leaf = batch('r', 8, 6);
		diffs.count = 0;
		leaf.type(2);
		expect(diffs.count).toBe(1);
		diffs.count = 0;
		leaf.type(7);
		expect(diffs.count).toBe(0);
	});

	it('diffs nothing when attention moves, and leaves a leaf that draws neither item alone', () => {
		const here = batch('a', 4);
		const there = batch('b', 4);
		const reached = vi.spyOn(there.view, 'setProps');
		diffs.count = 0;
		for (const lit of ['a0', 'a1', 'a2', undefined]) {
			here.field.setReview(here.items, lit);
			there.field.setReview(there.items, lit);
		}
		expect(diffs.count).toBe(0);
		expect(reached).not.toHaveBeenCalled();
		there.field.setReview(there.items, 'b1');
		expect(reached).toHaveBeenCalledOnce();
	});
});
