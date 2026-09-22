// @vitest-environment jsdom
// Reorder on an `object` row (VISUAL_EDITOR §"Settled and open"): ↑/↓ on the row's
// head, disabled at either edge, and Alt+↑/↓ from anywhere in the row as the keyboard
// twin, the nearest row answering. One splice of the ids and the values together, then
// the array commits whole, so the element keeps its id and everything mounted under it.
// Driven off the reference quill's `revisions` with three rows, and off `appendices`
// for a row inside a row.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { init, type Document, type Quill } from '@quillmark/wasm';
import { quill } from '../helpers/fixtures.js';
import {
	field,
	mountEditor,
	openGroup,
	press,
	settle,
	stubLayout,
	summaries,
	summaryTexts,
	type Mounted
} from '../helpers/surface.js';

// The gate every mounted suite stands behind; the classes are reached off the fixture.
await init();
stubLayout();

let mounted: Mounted | undefined;
afterEach(() => {
	mounted?.unmount();
	mounted = undefined;
});

function threeRows(q: Quill): Document {
	const doc = q.seedDocument();
	doc.storeField('revisions', [
		{ note: 'A', pages: 1 },
		{ note: 'B', pages: 2 },
		{ note: 'C', pages: 3 }
	]);
	return doc;
}
const order = (q: Quill, doc: Document) =>
	(q.reader(doc).get('revisions') as Array<{ note: string }>).map((r) => r.note);

function revisions(target: HTMLElement): HTMLElement {
	openGroup(target, 'Metadata');
	return field(target, 'Revisions');
}
/** A row's reorder pair, by title. */
const rowButton = (arr: HTMLElement, k: number, title: string) =>
	[...arr.querySelectorAll<HTMLElement>('.qm-element')][k].querySelector<HTMLButtonElement>(
		`.qm-row-btn[title="${title}"]`
	)!;

describe('reorder on an object row', () => {
	it('moves the row by button, commits the order, and disables at the edges', async () => {
		const q = quill();
		const doc = threeRows(q);
		mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		expect(summaryTexts(arr)).toEqual(['A', 'B', 'C']);
		expect(rowButton(arr, 0, 'Move up').disabled).toBe(true);
		expect(rowButton(arr, 2, 'Move down').disabled).toBe(true);
		expect(rowButton(arr, 1, 'Move up').disabled).toBe(false);

		const down = rowButton(arr, 0, 'Move down');
		down.focus();
		down.click();
		flushSync();
		expect(order(q, doc)).toEqual(['B', 'A', 'C']);
		expect(summaryTexts(arr)).toEqual(['B', 'A', 'C']);
		expect(mounted.changes.at(-1)).toMatchObject({ source: 'field', path: 'main.revisions' });
		// The button that was pressed rode with its row, and is focused again once the
		// flush has moved it: a second press keeps moving the same row.
		await settle();
		expect(document.activeElement).toBe(down);
		expect(rowButton(arr, 1, 'Move down')).toBe(down);
	});

	it('hands the focus to the twin arrow when a move carries the pressed one to its edge', async () => {
		const q = quill();
		const doc = threeRows(q);
		mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);

		const down = rowButton(arr, 1, 'Move down');
		down.focus();
		down.click();
		flushSync();
		expect(order(q, doc)).toEqual(['A', 'C', 'B']);
		await settle();
		expect(down.disabled).toBe(true);
		expect(document.activeElement).toBe(rowButton(arr, 2, 'Move up'));
	});

	it('leaves a key a cell already took to that cell', () => {
		const q = quill();
		const doc = threeRows(q);
		mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		summaries(arr)[1].click();
		flushSync();
		const input = arr.querySelector<HTMLInputElement>('.qm-element.open input[type="text"]')!;
		// Cancelable, as a key off the keyboard is, so the cell's `preventDefault` lands.
		input.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
		press(input, 'ArrowDown', { altKey: true, cancelable: true });
		expect(order(q, doc)).toEqual(['A', 'B', 'C']);

		// Alt with another modifier is a different chord, not the reorder.
		press(input, 'ArrowDown', { altKey: true, shiftKey: true, cancelable: true });
		expect(order(q, doc)).toEqual(['A', 'B', 'C']);
		press(input, 'ArrowDown', { altKey: true, cancelable: true });
		expect(order(q, doc)).toEqual(['A', 'C', 'B']);
	});

	it('moves the row by Alt+arrow from its summary, and keeps the open row open', async () => {
		const q = quill();
		const doc = threeRows(q);
		mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);

		// Open the middle row, then move it up from its own summary.
		const summary = summaries(arr)[1];
		summary.click();
		flushSync();
		expect(arr.querySelector('.qm-element.open .qm-element-title')?.textContent).toBe('B');
		summary.focus();
		press(summary, 'ArrowUp', { altKey: true });
		expect(order(q, doc)).toEqual(['B', 'A', 'C']);
		// The same row, still open, now first: the id moved with the value.
		expect(arr.querySelectorAll('.qm-element.open')).toHaveLength(1);
		expect(arr.querySelector('.qm-element.open .qm-element-title')?.textContent).toBe('B');
		expect(summaries(arr)[0]).toBe(summary);
		await settle();
		expect(document.activeElement).toBe(summary);

		// A bare arrow is not the gesture: the summary's own keys are untouched.
		press(summary, 'ArrowDown');
		expect(order(q, doc)).toEqual(['B', 'A', 'C']);
		// At the edge the move is a no-op that commits nothing.
		const before = mounted.changes.length;
		press(summary, 'ArrowUp', { altKey: true });
		expect(order(q, doc)).toEqual(['B', 'A', 'C']);
		expect(mounted.changes).toHaveLength(before);
	});

	it("keeps the open row's subform mounted across its own move", () => {
		const q = quill();
		const doc = threeRows(q);
		mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		summaries(arr)[0].click();
		flushSync();
		const input = arr.querySelector<HTMLInputElement>('.qm-element.open input[type="text"]')!;
		expect(input.value).toBe('A');

		rowButton(arr, 0, 'Move down').click();
		flushSync();
		// The keyed row moved as one node: the subform's input is the same element.
		expect(arr.querySelector('.qm-element.open input[type="text"]')).toBe(input);
		expect(order(q, doc)).toEqual(['B', 'A', 'C']);
	});

	it('answers from the nearest row alone: a press in a nested row leaves the record around it', () => {
		const q = quill();
		const doc = q.seedDocument();
		mounted = mountEditor(q, doc);
		openGroup(mounted.target, 'Content');
		const outer = field(mounted.target, 'Appendices');
		summaries(outer)[0].click();
		flushSync();
		// The open appendix's own list, a rung in: its rows are its own, not this field's.
		const inner = outer.querySelector<HTMLElement>('.qm-element.open .qm-array')!;
		expect(summaryTexts(inner)).toEqual(['Primary', 'Secondary']);
		const n = mounted.changes.length;

		press(summaries(inner)[0], 'ArrowDown', { altKey: true });
		flushSync();
		expect(summaryTexts(inner)).toEqual(['Secondary', 'Primary']);
		expect(summaryTexts(outer)).toEqual(['Sources', 'Glossary']);
		// One move, one commit: the key reached the appendix row and was not its to answer.
		expect(mounted.changes.length).toBe(n + 1);
	});

	it('offers no reorder on a scalar or prose row', () => {
		const q = quill();
		mounted = mountEditor(q, q.seedDocument());
		// `authors` is `string[]` and `keywords` `richtext[]`: edit-in-place rows.
		for (const name of ['Authors', 'Keywords']) {
			openGroup(mounted.target, name === 'Authors' ? 'Who and what' : 'Content');
			const f = field(mounted.target, name);
			expect(f.querySelectorAll('.qm-row-btn[title="Move up"]')).toHaveLength(0);
			expect(f.querySelectorAll('.qm-row-btn.qm-remove').length).toBeGreaterThan(0);
		}
	});
});
