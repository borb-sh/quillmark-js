// @vitest-environment jsdom
// A numeric field's entry grammar (NumberField): plain decimal, an optional sign and
// digits and for a `number` one `.`. An insertion that leaves a prefix of it is refused
// before it lands; a settled entry in it commits as a number, and anything else reaches
// the boundary as the raw string, whose coercion refuses it onto the field. A commit is
// read back through `resolve`, whose rung says whether anything was written.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document, Quill, ResolvedField } from '@quillmark/wasm';
import { quillFromYaml } from '../helpers/fixtures.js';
import { field, mountEditor, type, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const QUILL_YAML = `quill:
  name: numbers
  version: 1.0.0
  backend: typst
  description: One integer and one number.
typst:
  plate_file: plate.typ
main:
  fields:
    pages:
      type: integer
      default: 12
    size:
      type: number
      default: 10.5
`;

let q: Quill;
let doc: Document;
function open(): HTMLElement {
	q = quillFromYaml(QUILL_YAML);
	doc = q.seedDocument();
	return mountEditor(q, doc).target;
}

const row = (name: string): ResolvedField =>
	q
		.reader(doc)
		.resolve()
		.main.fields.find((r: ResolvedField) => r.name === name)!;

const input = (scope: HTMLElement): HTMLInputElement => scope.querySelector('input')!;
const diagnostic = (scope: HTMLElement): string =>
	scope.querySelector('[role="status"]')?.textContent?.trim() ?? '';

/** Offer `data` over the selection `[from, to)` as a keystroke or a paste does, and
 *  apply it where the control lets it land. True when it landed. */
function insert(
	el: HTMLInputElement,
	data: string,
	from = el.value.length,
	to = from,
	inputType = 'insertText'
): boolean {
	el.setSelectionRange(from, to);
	const e = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true });
	if (!el.dispatchEvent(e)) return false;
	el.setRangeText(data, from, to, 'end');
	el.dispatchEvent(new InputEvent('input', { inputType, data, bubbles: true }));
	flushSync();
	return true;
}

describe('an integer field', () => {
	it('lands a sign and digits, and refuses what no whole number holds', () => {
		const pages = input(field(open(), 'Pages'));
		pages.value = '';
		expect(insert(pages, '-')).toBe(true);
		expect(insert(pages, '4')).toBe(true);
		expect(insert(pages, '2')).toBe(true);
		for (const refused of ['.', 'e', 'x', ',', '-', ' 1']) {
			expect(insert(pages, refused), refused).toBe(false);
		}
		expect(insert(pages, '+', 0)).toBe(false);
		expect(pages.value).toBe('-42');
	});

	it('lands a paste that is a number once trimmed, and refuses one that is not', () => {
		const pages = input(field(open(), 'Pages'));
		expect(insert(pages, ' 1000\t', 0, pages.value.length, 'insertFromPaste')).toBe(true);
		expect(insert(pages, '1,000', 0, pages.value.length, 'insertFromPaste')).toBe(false);
		expect(pages.value).toBe(' 1000\t');
		pages.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		expect(row('pages')).toMatchObject({ source: 'authored', value: 1000 });
	});

	it('lets a stored value outside the grammar be deleted', () => {
		const pages = input(field(open(), 'Pages'));
		pages.value = 'abc';
		pages.setSelectionRange(2, 3);
		const e = new InputEvent('beforeinput', {
			inputType: 'deleteContentBackward',
			bubbles: true,
			cancelable: true
		});
		expect(pages.dispatchEvent(e)).toBe(true);
		expect(insert(pages, '1')).toBe(false);
		expect(insert(pages, '7', 0, 3)).toBe(true);
	});

	it('commits a whole number, and hands any other entry to the boundary to refuse', () => {
		const target = open();
		const pages = input(field(target, 'Pages'));
		type(pages, '+07');
		expect(row('pages')).toMatchObject({ source: 'authored', value: 7 });

		for (const entry of ['0x1F', 'Infinity', '1e3', '11.9', '-']) {
			type(pages, entry);
			expect(row('pages').value, entry).toBe(7);
			expect(diagnostic(field(target, 'Pages')), entry).not.toBe('');
			expect(pages.value, entry).toBe(entry);
		}
	});
});

describe('a number field', () => {
	it('lands one decimal point, and refuses a second', () => {
		const size = input(field(open(), 'Size'));
		size.value = '';
		for (const ch of ['-', '.', '5']) expect(insert(size, ch), ch).toBe(true);
		expect(insert(size, '.')).toBe(false);
		expect(insert(size, 'e')).toBe(false);
		expect(size.value).toBe('-.5');
	});

	it('commits a decimal, and hands any other entry to the boundary to refuse', () => {
		const target = open();
		const size = input(field(target, 'Size'));
		for (const [entry, value] of [
			['11.5', 11.5],
			['.5', 0.5],
			['5.', 5],
			['-2.25', -2.25]
		] as const) {
			type(size, entry);
			expect(row('size'), entry).toMatchObject({ source: 'authored', value });
		}
		for (const entry of ['Infinity', '1.000.0', '.']) {
			type(size, entry);
			expect(row('size').value, entry).toBe(-2.25);
			expect(diagnostic(field(target, 'Size')), entry).not.toBe('');
		}
	});
});
