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
import { DEFAULT_VISUAL_STRINGS } from '$lib/visual/strings';
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

	it('names each glyph for the field it is about', () => {
		const { target } = mountEditor(quill(), example());
		const { hint } = contactNote(target);
		const label = hint.closest('.qm-field-label-row')!.querySelector('.qm-field-label span')!;
		expect(hint.getAttribute('aria-label')).toBe(
			DEFAULT_VISUAL_STRINGS.fieldGuidance(label.textContent!)
		);
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

	it.each(['Short', 'Long'])('stands behind its glyph, never under its label: %s', (name) => {
		const target = open();
		const scope = field(target, name);
		const row = scope.querySelector('.qm-field-label-row')!;
		const [words] = describedText(leaf(scope));
		expect(row.querySelector('.qm-field-hint')).not.toBeNull();
		for (const node of row.children)
			if (!node.matches('.qm-visually-hidden')) expect(node.textContent).not.toContain(words);
	});

	it('draws its markdown in the popover, described by its words alone', () => {
		const target = open();
		const long = field(target, 'Long');
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

	it('raises a short one by the key too', () => {
		const target = open();
		const short = field(target, 'Short');
		const input = leaf(short);
		input.focus();
		press(input, '/', { ctrlKey: true });
		expect(raised(target)).toEqual([hintOf(short)]);
		const surface = document.querySelector<HTMLElement>('.qm-hint-popover')!;
		expect(surface.querySelector('code')).not.toBeNull();
		expect(surface.textContent).not.toMatch(/[`*]/);
	});
});
