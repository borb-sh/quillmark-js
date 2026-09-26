// @vitest-environment jsdom
// What an empty field shows, drawn (VISUAL_EDITOR §"The commitment ladder"). A default
// that prints is the value an unset control holds, at the default rung, and an edit
// takes it. Where nothing prints, a control draws words: the `none` an optional cell
// prints, worded `strings.optionalGhost`, and a free-text field's `example:`, at rest
// and in `None`'s stead on focus. An empty body ghosts its kind's `body.example` ahead
// of the consumer's wording.
//
// On its own quill, one cell per case, so no case leans on what the reference quill
// happens to declare. A prose leaf's focus is its view's (`ProseMirror-focused`, which
// `prose.css` keys the example on), so a leaf is read by the attributes that rule
// draws from; an input's is its own `placeholder`. A commit is read back through
// `resolve`, whose rung says whether anything was written.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { init, type Document, type Quill, type ResolvedField } from '@quillmark/wasm';
import type { FieldController, LeafViews } from '$lib/core/codec';
import { DEFAULT_VISUAL_STRINGS } from '$lib/visual/strings';
import TextField from '$lib/visual/TextField.svelte';
import VisualEditorInner from '$lib/visual/VisualEditorInner.svelte';
import { field, mountEditor, press, stubLayout, type, type Mounted } from '../helpers/surface.js';

const core = await init();
stubLayout();

const NONE = DEFAULT_VISUAL_STRINGS.optionalGhost;

const QUILL_YAML = `quill:
  name: ghosts
  version: 1.0.0
  backend: typst
  description: One cell of each ghost the editor draws.
typst:
  plate_file: plate.typ
main:
  body:
    example: |
      The main body's own example.
  fields:
    heading:
      type: string
      example: Findings
    lead:
      type: richtext
      inline: true
      example: What the section *found*.
    kept:
      type: string
      default: Kept
      example: Never drawn
    motto:
      type: richtext
      inline: true
      default: "*Always* be testing."
      example: Never drawn
    signed_for:
      type: plaintext
      inline: true
      default: ""
      example: FOR THE COMMANDER
    skippable:
      type: string
      default: ""
      example: Skip me
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
    dated:
      type: date
      default: 2026-01-15
    ref:
      type: string?
      example: RFC 9110
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
          example: Ada Lovelace
        note:
          type: plaintext
          inline: true
          example: In person
        motto:
          type: richtext
          inline: true
          default: "*Always* be testing."
        desk:
          type: string
          default: B-12
        phone:
          type: string?
    rows:
      type: array
      items:
        type: object
        properties:
          who:
            type: string
            example: Grace Hopper
          lead:
            type: boolean
            default: false
      ui:
        layout: table
card_kinds:
  entry:
    fields:
      label:
        type: string
`;

// This realm's `Uint8Array`: under jsdom the encoder's output comes from another realm
// and the boundary refuses it by identity.
const bytes = (s: string): Uint8Array => new Uint8Array(new TextEncoder().encode(s));
const ghosts = (): Quill =>
	core.Quill.fromTree(
		new Map([
			['Quill.yaml', bytes(QUILL_YAML)],
			['plate.typ', bytes('#set page(width: 200pt)\n')]
		])
	);

let mounted: Mounted | undefined;
let cleanup: (() => void) | undefined;
afterEach(() => {
	mounted?.unmount();
	mounted = undefined;
	cleanup?.();
	cleanup = undefined;
});

let q: Quill;
let doc: Document;
/** A seed, every field unset and every body empty, or the document `md` spells. */
function open(extra: Record<string, unknown> = {}, md?: string): HTMLElement {
	q = ghosts();
	doc = md == null ? q.seedDocument() : q.parse(md);
	mounted = mountEditor(q, doc, extra);
	return mounted.target;
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

interface InnerRef {
	focusField(field: string): Promise<void>;
	getActiveLeaf(): FieldController | undefined;
}

/** Mounted at `VisualEditorInner`, which holds `getActiveLeaf`: jsdom drives no
 *  contenteditable, so an edit is a transaction dispatched into the leaf's own view. */
function openInner(d: Document): { target: HTMLElement; editor: InnerRef } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(VisualEditorInner, { target, props: { doc: d, quill: q } });
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
	};
	return { target, editor: app as unknown as InnerRef };
}

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

describe('the example ghost', () => {
	it('draws on an unset text field where nothing prints, at rest and on focus', () => {
		const target = open();
		const heading = input(field(target, 'Heading'));
		expect(heading.placeholder).toBe('Findings');

		heading.focus();
		flushSync();
		expect(heading.placeholder).toBe('Findings');
	});

	it('stands in for the placeholder while the input holds the focus', () => {
		// The control alone, its value held unset, so what moves the ghost is the focus
		// and not a commit that re-derives the field.
		const target = document.createElement('div');
		document.body.appendChild(target);
		const app = mount(TextField, {
			target,
			props: { value: undefined, placeholder: 'At rest', example: 'Findings', onCommit: () => {} }
		});
		cleanup = () => {
			void unmount(app);
			target.remove();
		};
		flushSync();
		const el = input(target);
		expect(el.placeholder).toBe('At rest');
		el.focus();
		flushSync();
		expect(el.placeholder).toBe('Findings');
		el.blur();
		flushSync();
		expect(el.placeholder).toBe('At rest');
	});

	it('gives way to a `default:` that prints, which the control holds as its text', () => {
		const target = open();
		const kept = input(field(target, 'Kept'));
		expect(kept.value).toBe('Kept');
		expect(kept.placeholder).toBe('');
		// A content default resolves as `Content`, and the leaf holds the text it prints.
		const motto = field(target, 'Motto');
		expect(editable(motto).textContent).toBe('Always be testing.');
		expect(leafGhost(motto)).toBeNull();
	});

	it('draws where a type-empty default prints nothing, the skippable marker', () => {
		const target = open();
		expect(leafGhost(field(target, 'Signed for'))?.dataset.example).toBe('FOR THE COMMANDER');
		const skippable = input(field(target, 'Skippable'));
		expect(skippable.value).toBe('');
		expect(skippable.placeholder).toBe('Skip me');
	});

	it('rides a prose leaf as the attribute its rule draws', () => {
		const target = open();
		const lead = leafGhost(field(target, 'Lead'));
		// Markdown, so it ghosts as the text it renders.
		expect(lead?.dataset.example).toBe('What the section found.');
		// Nothing prints: the field declares no `default:`.
		expect(lead?.hasAttribute('data-placeholder')).toBe(false);
	});

	it('reaches an object’s cells and a table’s, by `sub.example`', () => {
		const target = open();
		const contact = field(target, 'Contact');

		expect(input(cell(contact, 'name')).placeholder).toBe('Ada Lovelace');
		expect(leafGhost(cell(contact, 'note'))?.dataset.example).toBe('In person');
		// A cell's markdown `default:` is the text its leaf holds, as a field's is.
		expect(editable(cell(contact, 'motto')).textContent).toBe('Always be testing.');

		const rows = field(target, 'Rows');
		rows.querySelector<HTMLButtonElement>('.qm-add-el')!.click();
		flushSync();
		const who = input(cell(rows.querySelector<HTMLElement>('.qm-array-row')!, 'who'));
		expect(who.placeholder).toBe('Grace Hopper');
	});
});

describe('a default that prints', () => {
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

	it('leaves a field emptied where nothing prints unanswered', () => {
		const target = open();
		const heading = input(field(target, 'Heading'));
		type(heading, 'x');
		type(heading, '');
		expect(row('heading').source).toBe('blank');
		expect(heading.placeholder).toBe('Findings');

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
		q = ghosts();
		doc = q.seedDocument();
		const { target, editor } = openInner(doc);
		const motto = field(target, 'Motto');
		expect(editable(motto).hasAttribute('data-default')).toBe(true);

		await editor.focusField('main.motto');
		const { view } = editor.getActiveLeaf() as FieldController & LeafViews;
		view.dispatch(view.state.tr.insertText('!', view.state.doc.content.size - 1));
		flushSync();

		expect(q.reader(doc).get('motto')).toBe('*Always* be testing.!');
		expect(editable(motto).hasAttribute('data-default')).toBe(false);
		doc.free();
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
		const tone = field(target, 'Tone').querySelector<HTMLElement>('.qm-select')!;
		expect(tone.textContent?.trim()).toBe('high');
		expect(tone.dataset.ghosted).toBe('default');
		const marking = field(target, 'Marking').querySelector<HTMLElement>('.qm-select')!;
		expect(marking.dataset.ghosted).toBe('');
	});

	it('paints a date’s digits at the default rung, and a segment edit takes the rest', () => {
		const target = open();
		const dated = field(target, 'Dated');
		const segments = () =>
			[...dated.querySelectorAll<HTMLElement>('[data-date-field-segment]')].filter(
				(s) => s.getAttribute('data-segment') !== 'literal'
			);
		expect(segments().map((s) => s.dataset.ghosted)).toEqual(['default', 'default', 'default']);

		const day = segments().find((s) => s.getAttribute('data-segment') === 'day')!;
		day.focus();
		flushSync();
		expect(row('dated').source).toBe('default');
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

		const level = field(target, 'Level').querySelector<HTMLElement>('.qm-select')!;
		expect(level.textContent?.trim()).toBe(NONE);
		expect(level.hasAttribute('data-ghosted')).toBe(true);

		const aside = leafGhost(field(target, 'Aside'));
		expect(aside?.dataset.placeholder).toBe(NONE);

		expect(input(cell(field(target, 'Contact'), 'phone')).placeholder).toBe(NONE);
	});

	it('ghosts its `example:` in `None`’s stead while it holds the focus', () => {
		const target = open();
		const ref = input(field(target, 'Ref'));
		ref.focus();
		flushSync();
		expect(ref.placeholder).toBe('RFC 9110');
		ref.blur();
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
		q = ghosts();
		doc = q.seedDocument();
		const { target, editor } = openInner(doc);
		expect(leafGhost(field(target, 'Aside'))?.dataset.placeholder).toBe(NONE);

		await editor.focusField('main.aside');
		const { view } = editor.getActiveLeaf() as FieldController & LeafViews;
		view.dispatch(view.state.tr.insertText('x', 1));
		view.dispatch(view.state.tr.delete(1, 2));
		flushSync();

		// Emptied, the leaf holds an empty answer, and the boundary says so.
		expect(row('aside').source).toBe('authored');
		expect(leafGhost(field(target, 'Aside'))).toBeNull();
		doc.free();
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

	it('ghosts its kind’s `body.example` ahead of the consumer’s wording', () => {
		const target = open({ strings: { bodyPlaceholder: () => 'Consumer…' } });
		// Main declares an example and the card's kind declares none.
		expect(bodies(target)).toEqual(["The main body's own example.", 'Consumer…']);
	});

	it('falls to the built-in where neither answers', () => {
		const target = open();
		expect(bodies(target)).toEqual([
			"The main body's own example.",
			DEFAULT_VISUAL_STRINGS.bodyGhost
		]);
	});
});
