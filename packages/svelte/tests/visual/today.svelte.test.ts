// @vitest-environment jsdom
// A date field holding `today` (canon `SCHEMAS.md` §"The render date"): the Today
// toggle writes it and, pressed, writes the render date's digits instead; `T` in a
// segment writes it; a segment edit writes a whole date. The render date is read off
// `resolve`, which reports a `today` cell as the date it renders.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document, Quill, ResolvedField } from '@quillmark/wasm';
import { quillFromYaml } from '../helpers/fixtures.js';
import { field, mountEditor, press, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const QUILL_YAML = `quill:
  name: today
  version: 1.0.0
  backend: typst
  description: A date written as the render date.
typst:
  plate_file: plate.typ
main:
  fields:
    dated:
      type: date
    stamped:
      type: date
      default: today
    logged:
      type: datetime
`;

let q: Quill;
let doc: Document;
function open(...lines: string[]): HTMLElement {
	q = quillFromYaml(QUILL_YAML);
	doc = q.parse(['~~~', '$quill: today@1.0.0', '$kind: main', ...lines, '~~~', ''].join('\n'));
	return mountEditor(q, doc).target;
}

const row = (name: string): ResolvedField =>
	q
		.reader(doc)
		.resolve()
		.main.fields.find((r: ResolvedField) => r.name === name)!;
const stored = (name: string): unknown => q.reader(doc).get(name);
const renderDate = (): string => row('stamped').value as string;

const toggle = (scope: HTMLElement): HTMLButtonElement =>
	scope.querySelector<HTMLButtonElement>('.qm-date-today')!;
const segment = (scope: HTMLElement, part: string): HTMLElement =>
	scope.querySelector<HTMLElement>(`[data-segment="${part}"]`)!;
const digits = (scope: HTMLElement): string =>
	['year', 'month', 'day'].map((p) => segment(scope, p).textContent?.trim()).join('-');

describe('a stored `today`', () => {
	it('draws the render date at the default rung with the toggle pressed', () => {
		const dated = field(open('dated: today'), 'Dated');
		expect(digits(dated)).toBe(renderDate());
		expect(dated.querySelector('.qm-date')!.hasAttribute('data-default')).toBe(true);
		expect(toggle(dated).getAttribute('aria-pressed')).toBe('true');
		expect(toggle(dated).hasAttribute('data-default')).toBe(false);
	});

	it('writes nothing as the focus crosses its segments and leaves', () => {
		const dated = field(open('dated: today'), 'Dated');
		segment(dated, 'month').focus();
		flushSync();
		segment(dated, 'day').focus();
		flushSync();
		segment(dated, 'day').blur();
		flushSync();
		expect(stored('dated')).toBe('today');
	});

	it('pressed off, writes the digits it showed', () => {
		const dated = field(open('dated: today'), 'Dated');
		toggle(dated).click();
		flushSync();
		expect(stored('dated')).toBe(renderDate());
		expect(toggle(dated).getAttribute('aria-pressed')).toBe('false');
		expect(dated.querySelector('.qm-date')!.hasAttribute('data-default')).toBe(false);
	});

	it('takes a segment edit as a whole date, the other segments the render date’s', () => {
		const dated = field(open('dated: today'), 'Dated');
		const day = segment(dated, 'day');
		day.focus();
		flushSync();
		press(day, 'ArrowUp');
		const [y, m] = renderDate().split('-');
		expect(stored('dated')).toMatch(new RegExp(`^${y}-${m}-\\d{2}$`));
		expect(stored('dated')).not.toBe(renderDate());
	});
});

describe('writing `today`', () => {
	it('is the toggle’s press over a fixed date', () => {
		const dated = field(open('dated: 2026-03-14'), 'Dated');
		expect(toggle(dated).getAttribute('aria-pressed')).toBe('false');
		toggle(dated).click();
		flushSync();
		expect(stored('dated')).toBe('today');
		expect(toggle(dated).getAttribute('aria-pressed')).toBe('true');
	});

	it('is `T` in a segment, over an empty field', () => {
		const dated = field(open(), 'Dated');
		press(segment(dated, 'month'), 't');
		expect(stored('dated')).toBe('today');
		expect(digits(dated)).toBe(renderDate());
	});
});

describe('a `datetime`', () => {
	it('holds no `today`: no toggle, and `T` writes nothing', () => {
		const logged = field(open(), 'Logged');
		expect(logged.querySelector('.qm-date-today')).toBeNull();
		press(segment(logged, 'month'), 't');
		expect(stored('logged')).toBeUndefined();
	});
});

describe('a `default: today`', () => {
	it('presses the toggle at the default rung and writes nothing unasked', () => {
		const stamped = field(open(), 'Stamped');
		expect(digits(stamped)).toBe(renderDate());
		expect(toggle(stamped).getAttribute('aria-pressed')).toBe('true');
		expect(toggle(stamped).hasAttribute('data-default')).toBe(true);
		expect(row('stamped').source).toBe('default');
	});

	it('pressed off, writes the render date’s digits', () => {
		const stamped = field(open(), 'Stamped');
		toggle(stamped).click();
		flushSync();
		expect(row('stamped')).toMatchObject({ source: 'authored', value: renderDate() });
		expect(stored('stamped')).toBe(renderDate());
	});
});
