// @vitest-environment jsdom
// A date control's locale. Its segments are ordered and worded by the host's `locale`,
// else the browser's, and either is pinned to the calendar and digits a stored
// `YYYY-MM-DD` is written in, so the control shows the date the document holds. The
// document stores the same string whatever the locale.
//
// The order a locale gives is read off `Intl` under the same tag, never spelled here.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document, Quill, ResolvedField } from '@quillmark/wasm';
import { dateLocale } from '$lib/visual/strings';
import { quillFromYaml } from '../helpers/fixtures.js';
import { field, mountEditor, press, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const QUILL_YAML = `quill:
  name: dated
  version: 1.0.0
  backend: typst
  description: A date and a datetime.
typst:
  plate_file: plate.typ
main:
  fields:
    due:
      type: date
    logged:
      type: datetime
      default: 2026-01-15T16:30
`;
const STORED = ['~~~', '$quill: dated@1.0.0', '$kind: main', 'due: 2026-01-15', '~~~', ''].join(
	'\n'
);

let q: Quill;
let doc: Document;
function open(locale?: string): HTMLElement {
	q = quillFromYaml(QUILL_YAML);
	doc = q.parse(STORED);
	return mountEditor(q, doc, { locale }).target;
}
const segments = (scope: HTMLElement): HTMLElement[] =>
	[...scope.querySelectorAll<HTMLElement>('[data-segment]')].filter(
		(s) => s.dataset.segment !== 'literal'
	);
const parts = (scope: HTMLElement): string[] => segments(scope).map((s) => s.dataset.segment!);
/** The parts `Intl` orders a date and time into under `tag`, as the control names them. */
const ordered = (tag: string | undefined, options: Intl.DateTimeFormatOptions): string[] =>
	new Intl.DateTimeFormat(dateLocale(tag), options)
		.formatToParts(new Date(2026, 0, 15, 16, 30))
		.map((p) => p.type as string)
		.filter((type) => type !== 'literal');
const DATE = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
const TIME = { ...DATE, hour: '2-digit', minute: '2-digit' } as const;

describe('a date control’s locale', () => {
	it('orders the segments as the host’s locale does', () => {
		for (const tag of ['de-DE', 'ja-JP', 'en-US']) {
			const target = open(tag);
			expect(parts(field(target, 'Due'))).toEqual(ordered(tag, DATE));
			expect(parts(field(target, 'Logged'))).toEqual(ordered(tag, TIME));
			unmountAll();
		}
		expect(ordered('de-DE', DATE)).not.toEqual(ordered('en-US', DATE));
		expect(ordered('de-DE', TIME)).not.toEqual(ordered('en-US', TIME));
	});

	it('takes the browser’s where the host names none, or one that is no locale', () => {
		for (const tag of [undefined, 'not a locale']) {
			const target = open(tag);
			expect(parts(field(target, 'Due'))).toEqual(ordered(navigator.language, DATE));
			unmountAll();
		}
	});

	it('shows the stored date in a locale whose own calendar and digits differ', () => {
		for (const tag of ['th-TH', 'ar-EG', 'fa-IR']) {
			const target = open(tag);
			const shown = Object.fromEntries(
				segments(field(target, 'Due')).map((s) => [s.dataset.segment, Number(s.textContent)])
			);
			expect(shown).toEqual({ year: 2026, month: 1, day: 15 });
			unmountAll();
		}
	});

	it('words a default’s half of the day as the locale does', () => {
		const target = open('ko-KR');
		const period = field(target, 'Logged').querySelector<HTMLElement>(
			'[data-segment="dayPeriod"]'
		)!;
		const words = new Intl.DateTimeFormat(dateLocale('ko-KR'), { hour: 'numeric', hour12: true })
			.formatToParts(new Date(2026, 0, 15, 16))
			.find((p) => p.type === 'dayPeriod')!.value;
		expect(period.textContent?.trim()).toBe(words);
	});

	it('stores the same string under any locale', () => {
		const target = open('de-DE');
		const day = field(target, 'Due').querySelector<HTMLElement>('[data-segment="day"]')!;
		day.focus();
		flushSync();
		press(day, 'ArrowUp');
		const due = q
			.reader(doc)
			.resolve()
			.main.fields.find((r: ResolvedField) => r.name === 'due');
		expect(due).toMatchObject({ source: 'authored', value: '2026-01-16' });
	});
});
