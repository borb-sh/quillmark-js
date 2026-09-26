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
import { flushSync } from 'svelte';
import { init, type Quill } from '@quillmark/wasm';
import { DEFAULT_VISUAL_STRINGS } from '$lib/visual/strings';
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
    count:
      type: integer
      example: 3
    tier:
      type: enum
      values: [low, high]
      example: low
    ref:
      type: string?
      example: RFC 9110
    size:
      type: integer?
    level:
      type: enum?
      values: [low, high]
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
afterEach(() => {
	mounted?.unmount();
	mounted = undefined;
});

/** A seed: every field unset and every body empty, one card of the one kind. */
function open(extra: Record<string, unknown> = {}): HTMLElement {
	const q = ghosts();
	mounted = mountEditor(q, q.seedDocument(), extra);
	return mounted.target;
}

const input = (scope: HTMLElement): HTMLInputElement => scope.querySelector('input')!;
/** The decorated empty paragraph of the prose leaf inside `scope`. */
const leafGhost = (scope: HTMLElement): HTMLElement | null =>
	scope.querySelector<HTMLElement>('.ProseMirror .qm-prose-placeholder');
/** A subform's cell, by the property it draws. */
const cell = (scope: HTMLElement, key: string): HTMLElement =>
	scope.querySelector<HTMLElement>(`[data-qm-prop="${key}"]`)!;

describe('the example ghost', () => {
	it('shows on a focused, unset text field, and goes at the first keystroke', () => {
		const target = open();
		const heading = input(field(target, 'Heading'));
		expect(heading.placeholder).toBe('');

		heading.focus();
		flushSync();
		expect(heading.placeholder).toBe('Findings');

		heading.blur();
		flushSync();
		expect(heading.placeholder).toBe('');

		heading.focus();
		flushSync();
		type(heading, 'F');
		expect(heading.placeholder).toBe('');
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
		expect(lead?.dataset.example).toBe('What the section *found*.');
		// Nothing at rest: the field declares no `default:`, so nothing prints.
		expect(lead?.hasAttribute('data-placeholder')).toBe(false);
	});

	it('takes none on a number or an enum, whatever they declare', () => {
		const target = open();
		const count = input(field(target, 'Count'));
		count.focus();
		flushSync();
		expect(count.placeholder).toBe('');
		const tier = field(target, 'Tier').querySelector<HTMLElement>('.qm-select')!;
		expect(tier.textContent?.trim()).not.toContain('low');
	});

	it('reaches an object’s cells and a table’s, by `sub.example`', () => {
		const target = open();
		const contact = field(target, 'Contact');

		const name = input(cell(contact, 'name'));
		name.focus();
		flushSync();
		expect(name.placeholder).toBe('Ada Lovelace');
		expect(leafGhost(cell(contact, 'note'))?.dataset.example).toBe('In person');

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
