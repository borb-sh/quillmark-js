// @vitest-environment jsdom
// The guidance key. A described field's glyph is out of the tab order, and `Mod-/` on the
// control raises the description that control carries: the keyboard's one way in, so a
// field costs one Tab stop. Which glyph answers is the control's own `aria-describedby`,
// so a table cell reaches its column's description through the header.
//
// And where a description is drawn. A short one stands under its label, the line itself
// describing the control, and a longer one behind the glyph; either draws its markdown
// as marks, and describes the control by its words alone.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { quill, example, quillFromYaml } from '../helpers/fixtures.js';
import {
	field,
	leaf,
	mountEditor,
	openField,
	press,
	unmountAll
} from '../helpers/surface.svelte.js';

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

/** The `contact` subform's `note` cell, whose description stands behind a glyph, its
 *  group opened. */
function contactNote(target: HTMLElement): { input: HTMLElement; hint: HTMLElement } {
	const contact = openField(target, quill().schema.main, 'contact');
	const label = [...contact.querySelectorAll<HTMLLabelElement>('.qm-object .qm-field-label')].find(
		(l) => l.querySelector('span')?.textContent === 'Note'
	)!;
	return {
		input: leaf(label.closest<HTMLElement>('.qm-object-prop')!),
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
		const { input, hint } = contactNote(target);
		input.focus();

		press(input, '/', { ctrlKey: true });
		expect(raised(target)).toEqual([hint]);

		press(input, '/', { metaKey: true });
		expect(raised(target)).toEqual([]);
	});

	it('lowers on Escape in the control and on focus leaving it', () => {
		const { target } = mountEditor(quill(), example());
		const { input } = contactNote(target);
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
		const cell = table.querySelector<HTMLElement>(
			'.ProseMirror[aria-label="Contributors 2 Name"]'
		)!;
		expect(describedText(cell)).toEqual(['As credited.']);

		cell.focus();
		press(cell, '/', { ctrlKey: true });
		const column = table.querySelector('.qm-array-table-col')!;
		expect(raised(target)).toEqual([hintOf(column)]);
	});
});

const DESCRIBED_YAML = `quill:
  name: described
  version: 1.0.0
  backend: typst
  description: A short description and a long one.
typst:
  plate_file: plate.typ
main:
  fields:
    short:
      type: text
      description: Set as \`code\`, *briefly*.
    long:
      type: text
      description: A description that runs well past what one line under a label holds, set as \`code\` and pointing at [a page](https://example.com) for the rest of it.
`;

describe('a description', () => {
	function open(): HTMLElement {
		const q = quillFromYaml(DESCRIBED_YAML);
		return mountEditor(q, q.seedDocument()).target;
	}
	const brief = (scope: Element) => scope.querySelector<HTMLElement>('.qm-field-brief');

	it('stands under its label where it is short, its markdown drawn', () => {
		const target = open();
		const short = field(target, 'Short');
		expect(short.querySelector('.qm-field-hint')).toBeNull();
		expect(brief(short)!.querySelector('code')).not.toBeNull();
		expect(brief(short)!.textContent).not.toMatch(/[`*]/);
		expect(describedText(leaf(short))).toEqual([brief(short)!.textContent]);
	});

	it('raises nothing for a description already on screen', () => {
		const target = open();
		const input = leaf(field(target, 'Short'));
		input.focus();
		press(input, '/', { ctrlKey: true });
		expect(raised(target)).toEqual([]);
	});

	it('keeps a long one behind its glyph, described by its words alone', () => {
		const target = open();
		const long = field(target, 'Long');
		expect(brief(long)).toBeNull();
		const [words] = describedText(leaf(long));
		expect(words).not.toMatch(/[`\]]/);

		const input = leaf(long);
		input.focus();
		press(input, '/', { ctrlKey: true });
		expect(raised(target)).toEqual([hintOf(long)]);
		const surface = document.querySelector<HTMLElement>('.qm-hint-popover')!;
		expect(surface.textContent).toBe(words);
		expect(surface.querySelector('code')).not.toBeNull();
		// A link is drawn as its words: the surface is not one to land in.
		expect(surface.querySelector('a')).toBeNull();
	});
});
