// @vitest-environment jsdom
// Spike: a transient anchor (id under `~`) through the prose leaf: the leaf reads one the stored
// document already holds, writes one, moves it with an edit, and none of it reaches `toStored`.
import { describe, it, expect } from 'vitest';
import { createField } from '$lib/core/codec';
import { mount, quill, example, viewOf } from './_util.js';

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

describe('transient anchors in the prose leaf', () => {
	it('writes one that moves with an edit and never reaches the stored form', () => {
		const doc = example();
		const clean = doc.toStored();
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		field.insertAnchor('~w1', 2, 6);
		const view = viewOf(field);
		view.dispatch(view.state.tr.insertText('XY', 1));
		expect(doc.main.body.anchors).toEqual([{ id: '~w1', start: 4, end: 8 }]);
		expect(field.anchorsInRange(4, 8)).toEqual(['~w1']);
		expect(doc.toStored()).not.toContain('~w1');
		expect(doc.toStored()).not.toBe(clean);
		field.destroy();
	});

	it('reads one the document already holds', () => {
		const doc = example();
		doc.apply({}, { steps: [{ anchor: { id: '~w1', start: 2, end: 6 } }] });
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		expect(field.anchorsInRange(2, 6)).toEqual(['~w1']);
		field.destroy();
	});
});
