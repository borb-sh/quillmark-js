// @vitest-environment jsdom
// The table (`ui.layout: table`) and the cap (`max:`), both on the reference quill's
// `contributors`. The table is the record list's row machine in another presentation:
// the same ids, splices and landing over rows that are always open, each cell the
// property's ordinary control under a header and the remove alone at the row's end.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { init, type Document, type Quill } from '@quillmark/wasm';
import { quill, template } from '../helpers/fixtures.js';
import {
	field,
	mountEditor,
	press,
	settle,
	stubLayout,
	type,
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

const rows = (q: Quill, doc: Document) =>
	q.reader(doc).get('contributors') as Array<Record<string, unknown>>;
const table = (target: HTMLElement) => field(target, 'Contributors');
const headers = (t: HTMLElement) =>
	[...t.querySelectorAll<HTMLElement>('.qm-array-table-head .qm-field-label')].map(
		(l) => l.textContent?.replace(/\s+/g, ' ').trim() ?? ''
	);
// The cell's name is the row's and the column's composed, and `name` is obliged, so the
// word rides the name the way the `*` rides a label.
const nameCell = (t: HTMLElement, k: number) =>
	t.querySelector<HTMLInputElement>(`input[aria-label="Contributors ${k + 1} Name required"]`)!;
const count = (t: HTMLElement) => t.querySelector('.qm-array-count')?.textContent;
const addChip = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('.qm-add-el')!;

describe('an array<object> declaring ui.layout: table', () => {
	it('draws a header of column labels and a row of ordinary controls per element', () => {
		const q = quill();
		const doc = template();
		mounted = mountEditor(q, doc);
		const t = table(mounted.target);

		expect(t.querySelector('.qm-array-table')).not.toBeNull();
		expect(t.querySelector('.qm-element-summary')).toBeNull();
		// The obligation mark rides the header: `name` declares no default.
		expect(headers(t)).toEqual(['Name *', 'Role', 'Since', 'Lead']);
		expect(t.querySelectorAll('.qm-array-table-row')).toHaveLength(2);

		// Each cell is the property's own control, named by the row and the column.
		expect(nameCell(t, 0).value).toBe('Ada Lovelace');
		expect(nameCell(t, 1).value).toBe('Grace Hopper');
		const row = t.querySelector<HTMLElement>('.qm-array-table-row')!;
		expect(row.querySelector('.qm-select')?.getAttribute('aria-label')).toBe('Contributors 1 Role');
		expect(row.querySelector('[role="switch"]')).not.toBeNull();
		expect(row.querySelector('[data-date-field-segment]')).not.toBeNull();
		// No label inside a cell: the header names the column.
		expect(row.querySelectorAll('.qm-field-label')).toHaveLength(0);
	});

	it('gives up the track floor on the column a switch stands in', () => {
		const q = quill();
		mounted = mountEditor(q, template());
		const t = table(mounted.target);

		// `lead` is the boolean, and the floor is the header's to carry: a mark is one
		// width at every width, so its column rests at its own name and the rest of the
		// table keeps the width a control that fills its track needs.
		expect(
			[...t.querySelectorAll('.qm-array-table-col')].map((c) => c.classList.contains('mark'))
		).toEqual([false, false, false, true]);
	});

	it('commits a cell into its row, the array committing whole', () => {
		const q = quill();
		const doc = template();
		mounted = mountEditor(q, doc);
		const t = table(mounted.target);

		type(nameCell(t, 1), 'Grace B. Hopper');
		expect(rows(q, doc)[1]).toEqual({ name: 'Grace B. Hopper', role: 'reviewer' });
		expect(rows(q, doc)[0].name).toBe('Ada Lovelace');
		expect(mounted.changes.at(-1)?.path).toBe('main.contributors');
	});

	it('inserts a row below on Enter, keeping the column, and removes an empty row on Backspace', async () => {
		const q = quill();
		const doc = template();
		mounted = mountEditor(q, doc);
		const t = table(mounted.target);

		press(nameCell(t, 0), 'Enter');
		await settle();
		expect(rows(q, doc)).toHaveLength(3);
		expect(rows(q, doc)[1]).toEqual({});
		expect(t.querySelectorAll('.qm-array-table-row')).toHaveLength(3);
		// Enter keeps its column: the new row's name cell takes the caret.
		expect(document.activeElement).toBe(nameCell(t, 1));

		// Empty in every cell and empty under the caret: a deliberate press removes it.
		press(nameCell(t, 1), 'Backspace');
		await settle();
		expect(rows(q, doc)).toHaveLength(2);
		expect(rows(q, doc)[1].name).toBe('Grace Hopper');
	});

	it('removes a row cleared under the caret', async () => {
		const q = quill();
		const doc = template();
		mounted = mountEditor(q, doc);
		const t = table(mounted.target);

		press(nameCell(t, 0), 'Enter');
		await settle();
		type(nameCell(t, 1), 'Adele');
		expect(rows(q, doc)[1]).toEqual({ name: 'Adele' });

		// Cleared but not blurred: the cell declares no `default:`, so the clear drops its
		// key as it lands, and the row is empty before the Backspace reads it.
		const cell = nameCell(t, 1);
		cell.value = '';
		cell.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(rows(q, doc)[1]).toEqual({});

		press(cell, 'Backspace');
		await settle();
		expect(rows(q, doc)).toHaveLength(2);
		expect(rows(q, doc).map((r) => r.name)).toEqual(['Ada Lovelace', 'Grace Hopper']);
	});

	it('keeps a row whose other cells are filled, however empty the caret is', async () => {
		const q = quill();
		const doc = template();
		mounted = mountEditor(q, doc);
		const t = table(mounted.target);

		// Row 1 carries `role: reviewer`, so an empty name cell is not an empty row.
		type(nameCell(t, 1), '');
		press(nameCell(t, 1), 'Backspace');
		await settle();
		expect(rows(q, doc)).toHaveLength(2);
	});

	it('carries the remove alone: no reorder by button, and none by key', async () => {
		const q = quill();
		const doc = template();
		mounted = mountEditor(q, doc);
		const t = table(mounted.target);
		const first = t.querySelector<HTMLElement>('.qm-array-table-row')!;
		expect([...first.querySelectorAll('.qm-row-btn')].map((b) => b.getAttribute('title'))).toEqual([
			'Remove'
		]);
		// Named with the row it acts on; the action alone is the tooltip.
		expect(first.querySelector('.qm-row-btn')?.getAttribute('aria-label')).toBe(
			'Remove Contributors 1'
		);

		// The list's keyboard twin has no sibling here, so it answers nothing.
		press(nameCell(t, 0), 'ArrowDown', { altKey: true });
		await settle();
		expect(rows(q, doc).map((r) => r.name)).toEqual(['Ada Lovelace', 'Grace Hopper']);

		first.querySelector<HTMLButtonElement>('.qm-row-btn.qm-remove')!.click();
		flushSync();
		expect(rows(q, doc).map((r) => r.name)).toEqual(['Grace Hopper']);
		expect(nameCell(t, 0).value).toBe('Grace Hopper');
		// A pressed remove lands on the row above's: the button is pinned, so the clip
		// stays where the pointer left it.
		await settle();
		expect(document.activeElement).toBe(t.querySelector('.qm-array-table-row > .qm-remove'));
	});

	it('lands a field landing on the first cell, and a row address on that row', async () => {
		const q = quill();
		mounted = mountEditor(q, template());
		const t = table(mounted.target);

		await mounted.editor.focusField('main.contributors');
		await settle();
		expect(document.activeElement).toBe(nameCell(t, 0));

		// A scalar cell's address, which the compile never mints but the ladder reads:
		// the schema declares it, so the landing is that cell's control.
		await mounted.editor.setCaret({ field: 'main.contributors[1].role' });
		await settle();
		expect(document.activeElement?.getAttribute('aria-label')).toBe('Contributors 2 Role');
		expect(mounted.errors).toHaveLength(0);
	});
});

describe('an array declaring max:', () => {
	it('draws the count, disables the add chip at the cap, and re-enables on remove', async () => {
		const q = quill();
		const doc = template();
		mounted = mountEditor(q, doc);
		const t = table(mounted.target);
		expect(count(t)).toBe('2 / 3');
		expect(addChip(t).disabled).toBe(false);
		// The chip is described by the count, so focusing it says how many are left.
		const described = addChip(t).getAttribute('aria-describedby');
		expect(document.getElementById(described ?? '')?.textContent).toBe('2 / 3');

		addChip(t).click();
		flushSync();
		expect(rows(q, doc)).toHaveLength(3);
		expect(count(t)).toBe('3 / 3');
		expect(addChip(t).disabled).toBe(true);

		// No editor gesture commits a fourth: Enter on the last row inserts nothing.
		press(nameCell(t, 2), 'Enter');
		await settle();
		expect(rows(q, doc)).toHaveLength(3);

		[...t.querySelectorAll<HTMLButtonElement>('.qm-row-btn.qm-remove')].at(-1)!.click();
		flushSync();
		expect(rows(q, doc)).toHaveLength(2);
		expect(count(t)).toBe('2 / 3');
		expect(addChip(t).disabled).toBe(false);
	});

	it('draws no count on an array with no cap', () => {
		const q = quill();
		mounted = mountEditor(q, template());
		expect(count(field(mounted.target, 'Authors'))).toBeUndefined();
	});
});
