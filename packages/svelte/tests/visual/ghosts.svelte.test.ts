// @vitest-environment jsdom
// What an empty field shows, drawn (VISUAL_EDITOR §"Structure mirrors the schema"). At
// rest a ghost is what prints: a `default:`, or the `none` an optional cell prints
// unanswered, worded `strings.optionalGhost`. While a free-text field holds the focus
// it is the field's `example:`, until the first keystroke. An empty body ghosts its
// kind's `body.example` ahead of the consumer's wording.
//
// On its own quill, one cell per case, so no case leans on what the reference quill
// happens to declare. A prose leaf's focus is its view's (`ProseMirror-focused`, which
// `prose.css` keys the example on), so a leaf is read by the attributes that rule
// draws from; an input's is its own `placeholder`.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { init, type Document, type Quill, type ResolvedField } from '@quillmark/wasm';
import type { FieldController, LeafViews } from '$lib/core/codec';
import { DEFAULT_VISUAL_STRINGS } from '$lib/visual/strings';
import TextField from '$lib/visual/TextField.svelte';
import VisualEditorInner from '$lib/visual/VisualEditorInner.svelte';
import { field, mountEditor, stubLayout, type, type Mounted } from '../helpers/surface.js';

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
    ref:
      type: string?
      example: RFC 9110
    size:
      type: integer?
    level:
      type: enum?
      values: [low, high]
    flag:
      type: boolean?
    aside:
      type: plaintext?
      inline: true
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

/** A seed, every field unset and every body empty, or the document `md` spells. */
function open(extra: Record<string, unknown> = {}, md?: string): HTMLElement {
	const q = ghosts();
	const doc = md == null ? q.seedDocument() : q.parse(md);
	mounted = mountEditor(q, doc, extra);
	return mounted.target;
}

/** A document answering the given main-card lines. */
const answering = (...lines: string[]) =>
	['~~~', '$quill: ghosts@1.0.0', '$kind: main', ...lines, '~~~', ''].join('\n');

interface InnerRef {
	focusField(field: string): Promise<void>;
	getActiveLeaf(): FieldController | undefined;
}

/** Mounted at `VisualEditorInner`, which holds `getActiveLeaf`: jsdom drives no
 *  contenteditable, so an edit is a transaction dispatched into the leaf's own view. */
function openInner(doc: Document): { target: HTMLElement; editor: InnerRef } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(VisualEditorInner, { target, props: { doc, quill: ghosts() } });
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
	};
	return { target, editor: app as unknown as InnerRef };
}

const input = (scope: HTMLElement): HTMLInputElement => scope.querySelector('input')!;
/** The decorated empty paragraph of the prose leaf inside `scope`. */
const leafGhost = (scope: HTMLElement): HTMLElement | null =>
	scope.querySelector<HTMLElement>('.ProseMirror .qm-prose-placeholder');
/** A subform's cell, by the property it draws. */
const cell = (scope: HTMLElement, key: string): HTMLElement =>
	scope.querySelector<HTMLElement>(`[data-qm-prop="${key}"]`)!;

describe('the example ghost', () => {
	it('shows on a focused, unset text field, and goes at blur', () => {
		const target = open();
		const heading = input(field(target, 'Heading'));
		expect(heading.placeholder).toBe('');

		heading.focus();
		flushSync();
		expect(heading.placeholder).toBe('Findings');

		heading.blur();
		flushSync();
		expect(heading.placeholder).toBe('');
	});

	it('goes at the first keystroke, and an input emptied after it ghosts what prints', () => {
		// The control alone, its value held unset, so what clears the example is the
		// keystroke and not the commit that re-derives the field.
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
		el.focus();
		flushSync();
		expect(el.placeholder).toBe('Findings');

		el.value = 'F';
		el.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		el.value = '';
		el.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(el.placeholder).toBe('At rest');
	});

	it('gives way to a `default:`, which is what prints', () => {
		const target = open();
		const kept = input(field(target, 'Kept'));
		kept.focus();
		flushSync();
		expect(kept.placeholder).toBe('Kept');
		// A content default resolves as `Content`, and ghosts as the text it prints.
		const motto = leafGhost(field(target, 'Motto'));
		expect(motto?.dataset.placeholder).toBe('Always be testing.');
		expect(motto?.hasAttribute('data-example')).toBe(false);
	});

	it('rides a prose leaf as the attribute its focus rule draws', () => {
		const target = open();
		const lead = leafGhost(field(target, 'Lead'));
		// Markdown, so it ghosts as the text it renders.
		expect(lead?.dataset.example).toBe('What the section found.');
		// Nothing at rest: the field declares no `default:`, so nothing prints.
		expect(lead?.hasAttribute('data-placeholder')).toBe(false);
	});

	it('reaches an object’s cells and a table’s, by `sub.example`', () => {
		const target = open();
		const contact = field(target, 'Contact');

		const name = input(cell(contact, 'name'));
		name.focus();
		flushSync();
		expect(name.placeholder).toBe('Ada Lovelace');
		expect(leafGhost(cell(contact, 'note'))?.dataset.example).toBe('In person');
		// A cell's markdown `default:` ghosts as the text it prints, as a field's does.
		expect(leafGhost(cell(contact, 'motto'))?.dataset.placeholder).toBe('Always be testing.');

		const rows = field(target, 'Rows');
		rows.querySelector<HTMLButtonElement>('.qm-add-el')!.click();
		flushSync();
		const who = input(cell(rows.querySelector<HTMLElement>('.qm-array-row')!, 'who'));
		who.focus();
		flushSync();
		expect(who.placeholder).toBe('Grace Hopper');
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
		const q = ghosts();
		const doc = q.seedDocument();
		const { target, editor } = openInner(doc);
		expect(leafGhost(field(target, 'Aside'))?.dataset.placeholder).toBe(NONE);

		await editor.focusField('main.aside');
		const { view } = editor.getActiveLeaf() as FieldController & LeafViews;
		view.dispatch(view.state.tr.insertText('x', 1));
		view.dispatch(view.state.tr.delete(1, 2));
		flushSync();

		// Emptied, the leaf holds an empty answer, and the boundary says so.
		const rows: ResolvedField[] = q.reader(doc).resolve().main.fields;
		const aside = rows.find((row) => row.name === 'aside');
		expect(aside?.source).toBe('authored');
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
