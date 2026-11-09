// @vitest-environment jsdom
// An array of numbers, enums, booleans or dates draws each element with its type's own
// control. A row holds what the type holds empty, and a number, which has no empty
// answer, is added through a standing row that writes nothing until it holds one.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document, Quill } from '@quillmark/wasm';
import { quillFromYaml } from '../helpers/fixtures.js';
import { field, mountEditor, pick, press, type, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const QUILL_YAML = `quill:
  name: lists
  version: 1.0.0
  backend: typst
  description: Lists of scalars.
typst:
  plate_file: plate.typ
main:
  fields:
    counts:
      type: array
      items:
        type: integer
    tags:
      type: array
      items:
        type: enum
        values: [alpha, beta]
    flags:
      type: array
      items:
        type: boolean
    days:
      type: array
      items:
        type: date
`;

let q: Quill;
let doc: Document;
function open(...lines: string[]) {
	q = quillFromYaml(QUILL_YAML);
	doc = q.parse(['~~~', '$quill: lists@1.0.0', '$kind: main', ...lines, '~~~', ''].join('\n'));
	return mountEditor(q, doc);
}
const stored = (name: string): unknown => q.reader(doc).get(name);
const rows = (scope: HTMLElement): HTMLElement[] => [
	...scope.querySelectorAll<HTMLElement>('.qm-array-row')
];
const add = (scope: HTMLElement): void => {
	scope.querySelector<HTMLButtonElement>('.qm-add-el')!.click();
	flushSync();
};
const input = (row: HTMLElement): HTMLInputElement => row.querySelector<HTMLInputElement>('input')!;

describe('an array of numbers', () => {
	it('draws a number input per element and commits a number', () => {
		const counts = field(open('counts: [5, 6]').target, 'Counts');
		expect(rows(counts).map((r) => input(r).value)).toEqual(['5', '6']);
		type(input(rows(counts)[1]), '8');
		expect(stored('counts')).toEqual([5, 8]);
	});

	it('moves a row on Alt+↑/↓, and the standing row nowhere', () => {
		const counts = field(open('counts: [5, 6]').target, 'Counts');
		press(input(rows(counts)[1]), 'ArrowUp', { altKey: true, cancelable: true });
		flushSync();
		expect(stored('counts')).toEqual([6, 5]);
		add(counts);
		press(input(rows(counts)[2]), 'ArrowUp', { altKey: true, cancelable: true });
		flushSync();
		expect(stored('counts')).toEqual([6, 5]);
	});

	it('adds through a standing row that writes nothing until it holds a number', () => {
		const { target, errors } = open('counts: [5]');
		const counts = field(target, 'Counts');
		add(counts);
		expect(rows(counts)).toHaveLength(2);
		expect(stored('counts')).toEqual([5]);
		type(input(rows(counts)[1]), '7');
		expect(stored('counts')).toEqual([5, 7]);
		expect(rows(counts)).toHaveLength(2);
		expect(errors).toEqual([]);
	});

	it('dismisses the standing row by its remove, writing nothing', () => {
		const counts = field(open('counts: [5]').target, 'Counts');
		add(counts);
		rows(counts)[1].querySelector<HTMLButtonElement>('.qm-remove')!.click();
		flushSync();
		expect(rows(counts)).toHaveLength(1);
		expect(stored('counts')).toEqual([5]);
	});

	it('types the first number into the empty list’s standing row', () => {
		const counts = field(open().target, 'Counts');
		expect(rows(counts)).toHaveLength(1);
		type(input(rows(counts)[0]), '3');
		expect(stored('counts')).toEqual([3]);
	});

	it('removes the element a row emptied, and offers it back', () => {
		const { target, errors } = open('counts: [5, 6]');
		const counts = field(target, 'Counts');
		type(input(rows(counts)[0]), '');
		expect(stored('counts')).toEqual([6]);
		expect(errors).toEqual([]);
		target.querySelector<HTMLButtonElement>('.qm-toast-action')!.click();
		flushSync();
		expect(stored('counts')).toEqual([5, 6]);
	});
});

describe('an array of enums', () => {
	it('draws a listbox per element, and a pick writes a member', () => {
		const tags = field(open('tags: [alpha]').target, 'Tags');
		expect(rows(tags)[0].querySelector('.qm-select')).not.toBeNull();
		pick(rows(tags)[0], 'beta');
		expect(stored('tags')).toEqual(['beta']);
	});

	it('adds a blank element, which a pick answers', () => {
		const tags = field(open('tags: [alpha]').target, 'Tags');
		add(tags);
		expect(stored('tags')).toEqual(['alpha', '']);
		pick(rows(tags)[1], 'beta');
		expect(stored('tags')).toEqual(['alpha', 'beta']);
	});
});

describe('an array of booleans', () => {
	it('draws a switch per element, adds `false`, and a press writes `true`', () => {
		const flags = field(open().target, 'Flags');
		expect(rows(flags)).toHaveLength(0);
		add(flags);
		expect(stored('flags')).toEqual([false]);
		rows(flags)[0].querySelector<HTMLElement>('.qm-toggle')!.click();
		flushSync();
		expect(stored('flags')).toEqual([true]);
	});
});

describe('an array of dates', () => {
	it('draws the date control per element, and a segment edit writes a date', () => {
		const days = field(open('days: ["2026-03-04"]').target, 'Days');
		press(rows(days)[0].querySelector<HTMLElement>('[data-segment="day"]')!, 'ArrowUp');
		expect(stored('days')).toEqual(['2026-03-05']);
	});
});
