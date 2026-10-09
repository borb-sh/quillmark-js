// @vitest-environment jsdom
// The guidance key. A described field's glyph is out of the tab order, and `Mod-/` on the
// control raises the description that control carries: the keyboard's one way in, so a
// field costs one Tab stop. Which glyph answers is the control's own `aria-describedby`,
// so a table cell reaches its column's description through the header.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { quill, example } from '../helpers/fixtures.js';
import { field, mountEditor, openGroup, press, unmountAll } from '../helpers/surface.svelte.js';

// A raise reads the trigger's target off its `::after`, which jsdom computes none of and
// says so on every call: the element's own style stands in.
beforeEach(() => {
	const real = window.getComputedStyle.bind(window);
	vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => real(el));
});
afterEach(() => {
	unmountAll();
	vi.restoreAllMocks();
});

const raised = (target: HTMLElement): HTMLElement[] => [
	...target.querySelectorAll<HTMLElement>('.qm-field-hint[aria-expanded="true"]')
];
const hintOf = (row: Element): HTMLElement => row.querySelector<HTMLElement>('.qm-field-hint')!;
const describedText = (control: Element): string[] =>
	(control.getAttribute('aria-describedby') ?? '')
		.split(/\s+/)
		.map((id) => document.getElementById(id)?.textContent ?? '');

function contactName(target: HTMLElement): { input: HTMLInputElement; hint: HTMLElement } {
	const contact = field(target, 'Point of contact');
	const label = [...contact.querySelectorAll<HTMLLabelElement>('.qm-object .qm-field-label')].find(
		(l) => l.querySelector('span')?.textContent === 'Name'
	)!;
	return {
		input: document.getElementById(label.htmlFor) as HTMLInputElement,
		hint: hintOf(label.parentElement!)
	};
}

describe('the guidance key', () => {
	it('keeps every guidance glyph out of the tab order', () => {
		const { target } = mountEditor(quill(), example());
		const hints = [...target.querySelectorAll<HTMLElement>('.qm-field-hint')];
		expect(hints.length).toBeGreaterThan(0);
		expect(hints.filter((h) => h.tabIndex !== -1)).toEqual([]);
	});

	it('raises the focused control’s own description, and lowers it again', () => {
		const { target } = mountEditor(quill(), example());
		openGroup(target, 'Who and what');
		const { input, hint } = contactName(target);
		input.focus();

		press(input, '/', { ctrlKey: true });
		expect(raised(target)).toEqual([hint]);

		press(input, '/', { metaKey: true });
		expect(raised(target)).toEqual([]);
	});

	it('lowers on Escape in the control and on focus leaving it', () => {
		const { target } = mountEditor(quill(), example());
		openGroup(target, 'Who and what');
		const { input } = contactName(target);
		input.focus();

		press(input, '/', { ctrlKey: true });
		press(input, 'Escape');
		expect(raised(target)).toEqual([]);

		press(input, '/', { ctrlKey: true });
		expect(raised(target)).toHaveLength(1);
		input.blur();
		flushSync();
		expect(raised(target)).toEqual([]);
	});

	it('reaches a table column’s description from any cell in it', () => {
		const { target } = mountEditor(quill(), example());
		const table = field(target, 'Contributors');
		const cell = table.querySelector<HTMLInputElement>(
			'input[aria-label="Contributors 2 Name required"]'
		)!;
		expect(describedText(cell)).toEqual(['As credited.']);

		cell.focus();
		press(cell, '/', { ctrlKey: true });
		const column = table.querySelector('.qm-array-table-col')!;
		expect(raised(target)).toEqual([hintOf(column)]);
	});
});
