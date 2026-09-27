// @vitest-environment jsdom
// A numeric field's entry grammar (NumberField): plain decimal, an optional sign and
// digits and for a `number` a `.` and an exponent. A keystroke that leaves the text
// outside a prefix of it does not land; a paste and a deletion land as they come. A
// settled entry in it commits as a number and anything else as the raw string, the
// boundary's coercion being the judge of that, so the control is mounted on its own and
// its commit read off the callback; one entry is driven through the editor to its
// refusal on the field.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ResolvedField } from '@quillmark/wasm';
import NumberField from '$lib/visual/NumberField.svelte';
import { quillFromYaml } from '../helpers/fixtures.js';
import { field, mountEditor, type, unmountAll } from '../helpers/surface.svelte.js';

const mounted: (() => void)[] = [];
afterEach(() => {
	for (const off of mounted.splice(0)) off();
	unmountAll();
});

/** A bare control over an empty value, its commits collected in order. */
function control(integer: boolean) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const commits: unknown[] = [];
	const app = mount(NumberField, {
		target,
		props: { value: undefined, integer, label: 'n', onCommit: (v) => commits.push(v) }
	});
	flushSync();
	mounted.push(() => {
		void unmount(app);
		target.remove();
	});
	return { input: target.querySelector('input')!, commits };
}

/** Offer `data` over the selection `[from, to)` as the browser does, landing it unless
 *  the control cancels. True when it landed as offered. */
function offer(
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

describe('a keystroke', () => {
	it('lands a sign and digits in an integer, and nothing a whole number lacks', () => {
		const { input } = control(true);
		for (const ch of ['-', '4', '2']) expect(offer(input, ch), ch).toBe(true);
		for (const ch of ['.', ',', 'e', 'x', '-']) expect(offer(input, ch), ch).toBe(false);
		expect(offer(input, '+', 0)).toBe(false);
		expect(input.value).toBe('-42');
	});

	it('lands one point and an exponent in a number', () => {
		const { input } = control(false);
		for (const ch of ['-', '.', '5']) expect(offer(input, ch), ch).toBe(true);
		expect(offer(input, '.')).toBe(false);
		for (const ch of ['e', '-', '7']) expect(offer(input, ch), ch).toBe(true);
		expect(offer(input, 'e')).toBe(false);
		expect(input.value).toBe('-.5e-7');
	});

	it('lands a comma as the point in a number, and not where one stands', () => {
		const { input, commits } = control(false);
		offer(input, '1');
		expect(offer(input, ',')).toBe(false);
		expect(input.value).toBe('1.');
		offer(input, '5');
		expect(offer(input, ',')).toBe(false);
		expect(input.value).toBe('1.5');
		input.dispatchEvent(new Event('change', { bubbles: true }));
		expect(commits).toEqual([1.5]);
	});

	it('refuses an insertion into a stored value outside the grammar, never a deletion', () => {
		const { input } = control(true);
		input.value = 'abc';
		input.setSelectionRange(2, 3);
		const del = new InputEvent('beforeinput', {
			inputType: 'deleteContentBackward',
			bubbles: true,
			cancelable: true
		});
		expect(input.dispatchEvent(del)).toBe(true);
		expect(offer(input, '1')).toBe(false);
		expect(offer(input, '7', 0, 3)).toBe(true);
	});
});

describe('a paste', () => {
	it('lands as it comes', () => {
		const { input } = control(true);
		expect(offer(input, '1,000', 0, 0, 'insertFromPaste')).toBe(true);
		expect(input.value).toBe('1,000');
	});
});

describe('a settled entry', () => {
	const settle = (integer: boolean, entries: string[]) => {
		const { input, commits } = control(integer);
		for (const entry of entries) type(input, entry);
		return commits;
	};

	it('commits an integer in the grammar as a number, and any other entry as itself', () => {
		const entries = ['+07', ' 12 ', '0x1F', 'Infinity', '1e3', '11.9', '1.000', '-', ''];
		expect(settle(true, entries)).toEqual([
			7,
			12,
			'0x1F',
			'Infinity',
			'1e3',
			'11.9',
			'1.000',
			'-',
			undefined
		]);
	});

	it('commits a number in the grammar as a number, and any other entry as itself', () => {
		const entries = ['11.5', '.5', '5.', '-2.25', '1e-7', 'Infinity', '1.000.0', '.', '1,5'];
		expect(settle(false, entries)).toEqual([
			11.5,
			0.5,
			5,
			-2.25,
			1e-7,
			'Infinity',
			'1.000.0',
			'.',
			'1,5'
		]);
	});

	it('a digit run past the largest number commits as itself', () => {
		const run = '9'.repeat(400);
		expect(settle(false, [run])).toEqual([run]);
	});
});

it('draws the refusal of an entry outside the grammar on its field', () => {
	const q = quillFromYaml(`quill:
  name: numbers
  version: 1.0.0
  backend: typst
  description: One integer.
typst:
  plate_file: plate.typ
main:
  fields:
    pages:
      type: integer
      default: 12
`);
	const doc = q.seedDocument();
	const { target } = mountEditor(q, doc);
	const pages = field(target, 'Pages');
	type(pages.querySelector('input')!, '0x1F');
	const row = q
		.reader(doc)
		.resolve()
		.main.fields.find((r: ResolvedField) => r.name === 'pages')!;
	expect(row.source).toBe('default');
	expect(pages.querySelector('[role="status"]')?.textContent?.trim()).not.toBe('');
});
