// @vitest-environment jsdom
// A surface hung off a selection in a table cell clears the cell's row: the anchor keeps
// the selection's horizontal extent and takes the vertical one of the boxes it must clear.
import { describe, it, expect } from 'vitest';
import { across, type RangeAnchor } from '$lib/core/codec/anchor.js';

function boxed(left: number, top: number, right: number, bottom: number): Element {
	const el = document.createElement('div');
	el.getBoundingClientRect = () => new DOMRect(left, top, right - left, bottom - top);
	return el;
}

describe('across', () => {
	it("spans the selection's columns over every box's rows", () => {
		const selection: RangeAnchor = {
			contextElement: document.body,
			getBoundingClientRect: () => new DOMRect(40, 52, 30, 16)
		};
		const row = boxed(0, 50, 300, 80);
		const cell = boxed(30, 50, 100, 110);
		const anchor = across(selection, [row, cell]);
		const { left, right, top, bottom } = anchor.getBoundingClientRect();
		expect([left, right, top, bottom]).toEqual([40, 70, 50, 110]);
		expect(anchor.contextElement).toBe(selection.contextElement);
	});
});
