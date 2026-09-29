// @vitest-environment jsdom
// What an empty field shows, drawn (VISUAL_EDITOR §"The commitment ladder"). A default
// that prints is the value an unset control holds, at the default rung, and an edit
// takes it. Where nothing prints, a control draws words: the `none` an optional cell
// prints, worded `strings.optionalGhost`, and an enum's blank, worded `ui.blank_title`.
// A free-text field with nothing to print draws nothing. An empty body ghosts the
// consumer's wording, the `bodyPlaceholder` hook asked once per card with nothing kept
// between asks.
//
// On its own quill, one cell per case, so no case leans on what the reference quill
// happens to declare. A leaf is read by the attributes `prose.css` draws from; an
// input's ghost is its own `placeholder`. A commit is read back through `resolve`,
// whose rung says whether anything was written.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document, Quill, ResolvedField } from '@quillmark/wasm';
import type { BodyPlaceholderContext } from '$lib/visual/structure';
import { DEFAULT_VISUAL_STRINGS } from '$lib/visual/strings';
import { quillFromYaml } from '../helpers/fixtures.js';
import {
	activeView,
	field,
	mountEditor,
	mountInner,
	openList,
	press,
	trigger,
	type,
	unmountAll
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const NONE = DEFAULT_VISUAL_STRINGS.optionalGhost;

const QUILL_YAML = `quill:
  name: ghosts
  version: 1.0.0
  backend: typst
  description: One cell of each ghost the editor draws.
typst:
  plate_file: plate.typ
main:
  fields:
    heading:
      type: string
    lead:
      type: richtext
      inline: true
    kept:
      type: string
      default: Kept
    motto:
      type: richtext
      inline: true
      default: "*Always* be testing."
    signed_for:
      type: plaintext
      inline: true
      default: ""
    skippable:
      type: string
      default: ""
    size:
      type: integer?
    pages:
      type: integer
      default: 12
    tone:
      type: enum
      values: [low, high]
      default: high
    marking:
      type: enum
      values: [low, high]
      default: ""
      ui:
        blank_title: (no marking)
    dated:
      type: date
      default: 2026-01-15
    ref:
      type: string?
    level:
      type: enum?
      values: [low, high]
    flag:
      type: boolean?
    aside:
      type: plaintext?
      inline: true
    lines:
      type: array
      items:
        type: plaintext
        inline: true
      default:
        - First line
    tags:
      type: array
      items:
        type: string
      default: [alpha, beta]
    contact:
      type: object
      properties:
        name:
          type: string
        note:
          type: plaintext
          inline: true
        motto:
          type: richtext
          inline: true
          default: "*Always* be testing."
        desk:
          type: string
          default: B-12
        phone:
          type: string?
    crew:
      type: array
      items:
        type: object
        properties:
          who:
            type: string
          tag:
            type: string
            default: T
      default:
        - who: Ada
          tag: X
      ui:
        layout: table
card_kinds:
  entry:
    fields:
      label:
        type: string
`;

let q: Quill;
let doc: Document;
/** A seed, every field unset and every body empty, or the document `md` spells. */
function open(extra: Record<string, unknown> = {}, md?: string): HTMLElement {
	q = quillFromYaml(QUILL_YAML);
	doc = md == null ? q.seedDocument() : q.parse(md);
	return mountEditor(q, doc, extra).target;
}
/** A seed mounted at `VisualEditorInner`, whose leaves an edit is dispatched into. */
function openInner() {
	q = quillFromYaml(QUILL_YAML);
	doc = q.seedDocument();
	return mountInner(q, doc);
}

/** A main-card field's resolved row: its value and the rung that supplied it. */
const row = (name: string): ResolvedField =>
	q
		.reader(doc)
		.resolve()
		.main.fields.find((r: ResolvedField) => r.name === name)!;

/** A document answering the given main-card lines. */
const answering = (...lines: string[]) =>
	['~~~', '$quill: ghosts@1.0.0', '$kind: main', ...lines, '~~~', ''].join('\n');

const input = (scope: HTMLElement): HTMLInputElement => scope.querySelector('input')!;
const inputs = (scope: HTMLElement): HTMLInputElement[] => [...scope.querySelectorAll('input')];
/** The decorated empty paragraph of the prose leaf inside `scope`. */
const leafGhost = (scope: HTMLElement): HTMLElement | null =>
	scope.querySelector<HTMLElement>('.ProseMirror .qm-prose-placeholder');
const editable = (scope: HTMLElement): HTMLElement =>
	scope.querySelector<HTMLElement>('.ProseMirror')!;
/** A subform's cell, by the property it draws. */
const cell = (scope: HTMLElement, key: string): HTMLElement =>
	scope.querySelector<HTMLElement>(`[data-qm-prop="${key}"]`)!;

describe('a free-text field where nothing prints', () => {
	it('draws nothing, at rest and on focus', () => {
		const target = open();
		const heading = input(field(target, 'Heading'));
		expect(heading.placeholder).toBe('');
		heading.focus();
		flushSync();
		expect(heading.placeholder).toBe('');
		expect(leafGhost(field(target, 'Lead'))).toBeNull();
		// A type-empty default is the skippable marker, and prints nothing either.
		expect(leafGhost(field(target, 'Signed for'))).toBeNull();
		expect(input(field(target, 'Skippable')).placeholder).toBe('');
		expect(input(cell(field(target, 'Contact'), 'name')).placeholder).toBe('');
		expect(leafGhost(cell(field(target, 'Contact'), 'note'))).toBeNull();
	});
});

describe('a default that prints', () => {
	it('is the text the control holds, where nothing else ghosts', () => {
		const target = open();
		const kept = input(field(target, 'Kept'));
		expect(kept.value).toBe('Kept');
		expect(kept.placeholder).toBe('');
		// A content default resolves as `Content`, and the leaf holds the text it prints.
		const motto = field(target, 'Motto');
		expect(editable(motto).textContent).toBe('Always be testing.');
		expect(leafGhost(motto)).toBeNull();
		expect(editable(cell(field(target, 'Contact'), 'motto')).textContent).toBe(
			'Always be testing.'
		);
	});

	it('is held unwritten, at the default rung, until an edit', () => {
		const target = open();
		const kept = input(field(target, 'Kept'));
		expect(kept.hasAttribute('data-default')).toBe(true);

		kept.focus();
		flushSync();
		kept.blur();
		flushSync();
		// Tabbing through writes nothing.
		expect(row('kept').source).toBe('default');
		expect(kept.hasAttribute('data-default')).toBe(true);
	});

	it('is taken whole by the first edit, and the rung goes with it', () => {
		const target = open();
		const kept = input(field(target, 'Kept'));
		type(kept, 'Kept!');
		expect(row('kept')).toMatchObject({ source: 'authored', value: 'Kept!' });
		expect(kept.hasAttribute('data-default')).toBe(false);

		// A keystroke typed and removed pins the default as authored.
		type(kept, 'Kept');
		expect(row('kept')).toMatchObject({ source: 'authored', value: 'Kept' });
	});

	it('emptied, writes the empty answer, which is what prints empty', () => {
		const target = open();
		const kept = input(field(target, 'Kept'));
		type(kept, '');
		expect(row('kept')).toMatchObject({ source: 'authored', value: '' });
		expect(kept.value).toBe('');
		expect(kept.placeholder).toBe('');
	});

	it('emptied once written, still writes the empty answer rather than coming back', () => {
		const target = open();
		const kept = input(field(target, 'Kept'));
		type(kept, 'Kept!');
		type(kept, '');
		expect(row('kept')).toMatchObject({ source: 'authored', value: '' });
		expect(kept.value).toBe('');
		expect(kept.hasAttribute('data-default')).toBe(false);
	});

	it('leaves a field emptied where nothing prints unanswered', () => {
		const target = open();
		const heading = input(field(target, 'Heading'));
		type(heading, 'x');
		type(heading, '');
		expect(row('heading').source).toBe('blank');
		expect(heading.placeholder).toBe('');

		// A type-empty default prints nothing, so emptying returns the field to it.
		const skippable = input(field(target, 'Skippable'));
		type(skippable, 'x');
		type(skippable, '');
		expect(row('skippable').source).toBe('default');

		// And an optional cell returns to `none`.
		const ref = input(field(target, 'Ref'));
		type(ref, 'x');
		type(ref, '');
		expect(row('ref').source).not.toBe('authored');
		expect(ref.placeholder).toBe(NONE);
	});

	it('holds a number as its text, and a blank entry takes the default back', () => {
		const target = open();
		const pages = input(field(target, 'Pages'));
		expect(pages.value).toBe('12');
		expect(pages.hasAttribute('data-default')).toBe(true);

		type(pages, '');
		expect(row('pages').source).toBe('default');
		expect(pages.value).toBe('12');

		type(pages, '14');
		expect(row('pages')).toMatchObject({ source: 'authored', value: 14 });
		expect(pages.hasAttribute('data-default')).toBe(false);
	});

	it('holds a prose leaf’s content, which its first edit writes whole', async () => {
		const { target, editor } = openInner();
		const motto = field(target, 'Motto');
		expect(editable(motto).hasAttribute('data-default')).toBe(true);

		await editor.focusField('main.motto');
		const view = activeView(editor);
		view.dispatch(view.state.tr.insertText('!', view.state.doc.content.size - 1));
		flushSync();

		expect(q.reader(doc).get('motto')).toBe('*Always* be testing.!');
		expect(editable(motto).hasAttribute('data-default')).toBe(false);
	});

	it('takes a subform cell’s own `default:`, and writes that cell alone', () => {
		const target = open();
		const desk = input(cell(field(target, 'Contact'), 'desk'));
		expect(desk.value).toBe('B-12');
		expect(desk.hasAttribute('data-default')).toBe(true);
		type(desk, 'B-14');
		expect(q.reader(doc).get('contact')).toEqual({ desk: 'B-14' });
	});

	it('draws an enum’s default member at the default rung, and a blank as a word', () => {
		const target = open();
		const tone = trigger(field(target, 'Tone'));
		expect(tone.textContent?.trim()).toBe('high');
		expect(tone.dataset.ghosted).toBe('default');
		// The word is the quill's `ui.blank_title`, and the list offers no member row for
		// it: the one row it heads is the unset sentinel's.
		const marking = trigger(field(target, 'Marking'));
		expect(marking.dataset.ghosted).toBe('');
		expect(marking.textContent?.trim()).toBe('(no marking)');
		openList(marking);
		expect(
			[...document.querySelectorAll<HTMLElement>('.qm-select-item')].map(
				(r) => r.querySelector('.qm-select-ghost')?.textContent ?? r.textContent?.trim()
			)
		).toEqual(['(no marking)', 'low', 'high']);
	});

	it('words a stored blank by its `ui.blank_title` too, unghosted', () => {
		const marking = trigger(field(open({}, answering('marking: ""')), 'Marking'));
		expect(marking.textContent?.trim()).toBe('(no marking)');
		expect(marking.hasAttribute('data-ghosted')).toBe(false);
	});

	/** The date field's segments, by part. */
	const segment = (target: HTMLElement, part: string): HTMLElement =>
		field(target, 'Dated').querySelector<HTMLElement>(`[data-segment="${part}"]`)!;

	it('paints a date’s digits at the default rung, and a segment edit takes the rest', () => {
		const target = open();
		const segments = [...field(target, 'Dated').querySelectorAll<HTMLElement>('[data-segment]')]
			.filter((s) => s.getAttribute('data-segment') !== 'literal')
			.map((s) => s.dataset.ghosted);
		expect(segments).toEqual(['default', 'default', 'default']);

		const day = segment(target, 'day');
		day.focus();
		flushSync();
		expect(row('dated').source).toBe('default');
		press(day, 'ArrowUp');
		expect(row('dated')).toMatchObject({ source: 'authored', value: '2026-01-16' });
	});

	it('writes no date as the focus crosses its segments and leaves', () => {
		const target = open();
		segment(target, 'month').focus();
		flushSync();
		segment(target, 'day').focus();
		flushSync();
		segment(target, 'day').blur();
		flushSync();
		expect(row('dated').source).toBe('default');
	});

	it('keeps a seated date across another field’s commit', () => {
		const target = open();
		const day = segment(target, 'day');
		day.focus();
		flushSync();
		type(input(field(target, 'Kept')), 'Kept!');
		day.focus();
		flushSync();
		press(day, 'ArrowUp');
		expect(row('dated')).toMatchObject({ source: 'authored', value: '2026-01-16' });
	});
});

describe('an array’s default', () => {
	const rowsBox = (scope: HTMLElement): HTMLElement =>
		scope.querySelector<HTMLElement>('.qm-array-rows')!;

	it('draws its elements as rows at the default rung, and writes nothing unasked', () => {
		const target = open();
		const tags = field(target, 'Tags');
		expect(inputs(tags).map((i) => i.value)).toEqual(['alpha', 'beta']);
		expect(rowsBox(tags).hasAttribute('data-default')).toBe(true);
		expect(editable(field(target, 'Lines')).textContent).toBe('First line');
		expect(row('tags').source).toBe('default');
	});

	it('is taken whole by an edit in one row', () => {
		const target = open();
		const tags = field(target, 'Tags');
		type(inputs(tags)[1], 'gamma');
		expect(q.reader(doc).get('tags')).toEqual(['alpha', 'gamma']);
		expect(rowsBox(tags).hasAttribute('data-default')).toBe(false);
	});

	it('is taken whole by the add chip and by a remove, down to the empty answer', () => {
		const target = open();
		const lines = field(target, 'Lines');
		lines.querySelector<HTMLButtonElement>('.qm-add-el')!.click();
		flushSync();
		expect(q.reader(doc).get('lines')).toEqual(['First line', '']);

		const tags = field(target, 'Tags');
		for (const _ of [0, 1]) {
			tags.querySelector<HTMLButtonElement>('.qm-remove')!.click();
			flushSync();
		}
		expect(row('tags')).toMatchObject({ source: 'authored', value: [] });
	});

	it('is taken whole by Enter in a table row', () => {
		const target = open();
		const crew = field(target, 'Crew');
		press(input(cell(crew, 'who')), 'Enter');
		expect(q.reader(doc).get('crew')).toEqual([{ who: 'Ada', tag: 'X' }, {}]);
	});

	it('keeps a table row whose default declares a cell beside the caret', () => {
		const target = open();
		const crew = field(target, 'Crew');
		const who = input(cell(crew, 'who'));
		type(who, '');
		press(who, 'Backspace');
		expect(q.reader(doc).get('crew')).toEqual([{ tag: 'X' }]);
	});
});

describe('an optional cell', () => {
	it('takes its base type’s control, draws no `*`, and ghosts `None` at rest', () => {
		const target = open();
		const ref = field(target, 'Ref');
		expect(ref.querySelector('.qm-field-required')).toBeNull();
		expect(input(ref).placeholder).toBe(NONE);

		const size = field(target, 'Size');
		expect(input(size).getAttribute('inputmode')).toBe('numeric');
		expect(input(size).placeholder).toBe(NONE);

		const level = trigger(field(target, 'Level'));
		expect(level.textContent?.trim()).toBe(NONE);
		expect(level.hasAttribute('data-ghosted')).toBe(true);

		const aside = leafGhost(field(target, 'Aside'));
		expect(aside?.dataset.placeholder).toBe(NONE);

		expect(input(cell(field(target, 'Contact'), 'phone')).placeholder).toBe(NONE);
	});

	it('keeps `None` while it holds the focus', () => {
		const target = open();
		const ref = input(field(target, 'Ref'));
		ref.focus();
		flushSync();
		expect(ref.placeholder).toBe(NONE);
	});

	it('ghosts nothing once answered, an empty answer printing empty', () => {
		const target = open({}, answering('ref: ""', 'aside: ""', 'contact:', '  phone: ""'));
		expect(input(field(target, 'Ref')).placeholder).toBe('');
		expect(leafGhost(field(target, 'Aside'))).toBeNull();
		expect(input(cell(field(target, 'Contact'), 'phone')).placeholder).toBe('');
	});

	it('drops `None` from a prose leaf at its first edit, which answers it', async () => {
		const { target, editor } = openInner();
		expect(leafGhost(field(target, 'Aside'))?.dataset.placeholder).toBe(NONE);

		await editor.focusField('main.aside');
		const view = activeView(editor);
		view.dispatch(view.state.tr.insertText('x', 1));
		view.dispatch(view.state.tr.delete(1, 2));
		flushSync();

		// Emptied, the leaf holds an empty answer, and the boundary says so.
		expect(row('aside').source).toBe('authored');
		expect(leafGhost(field(target, 'Aside'))).toBeNull();
	});

	it('draws an unset `boolean?` as a third state, and a press answers it', () => {
		const target = open();
		const flag = field(target, 'Flag');
		const toggle = flag.querySelector<HTMLElement>('.qm-toggle')!;
		expect(toggle.getAttribute('role')).toBe('checkbox');
		expect(toggle.getAttribute('aria-checked')).toBe('mixed');
		expect(flag.querySelector('.qm-toggle-wrap')!.hasAttribute('data-unset')).toBe(true);

		toggle.click();
		flushSync();
		expect(toggle.getAttribute('aria-checked')).toBe('true');
		expect(flag.querySelector('.qm-toggle-wrap')!.hasAttribute('data-unset')).toBe(false);
	});

	it('words its ghost as the consumer does', () => {
		const target = open({ strings: { optionalGhost: 'Aucun' } });
		expect(input(field(target, 'Ref')).placeholder).toBe('Aucun');
	});
});

describe('the empty body', () => {
	const bodies = (target: HTMLElement): string[] =>
		[...target.querySelectorAll<HTMLElement>('.qm-body-leaf [data-placeholder]')].map(
			(el) => el.dataset.placeholder ?? ''
		);

	it('ghosts the consumer’s wording, asked per card', () => {
		const seen: BodyPlaceholderContext[] = [];
		const bodyPlaceholder = (ctx: BodyPlaceholderContext) => {
			seen.push(ctx);
			return `Write ${ctx.cardId}…`;
		};
		const entry = ['~~~', '$kind: entry', '~~~', ''].join('\n');
		const target = open({ strings: { bodyPlaceholder } }, `${answering()}\n${entry}\n${entry}`);
		// The hook carries each card and keeps nothing between asks, so two cards of one
		// kind can read two ways.
		expect(bodies(target)).toEqual(['Write main…', 'Write c0…', 'Write c1…']);
		// Main is asked, naming itself.
		expect(seen.some((s) => s.cardId === 'main' && s.kind === 'main' && s.isMain)).toBe(true);
	});

	it('falls to the built-in where neither answers', () => {
		const target = open();
		expect(bodies(target)).toEqual([
			DEFAULT_VISUAL_STRINGS.bodyGhost,
			DEFAULT_VISUAL_STRINGS.bodyGhost
		]);
	});

	it('ghosts nothing once edited back to empty', async () => {
		const { target, editor } = openInner();

		await editor.focusField('main.body');
		const view = activeView(editor);
		view.dispatch(view.state.tr.insertText('x', 1));
		view.dispatch(view.state.tr.delete(1, 2));
		flushSync();

		expect(doc.main.body.text).toBe('');
		expect(bodies(target)).toEqual([DEFAULT_VISUAL_STRINGS.bodyGhost]);
	});
});
