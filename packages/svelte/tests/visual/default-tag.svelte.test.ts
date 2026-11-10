// @vitest-environment jsdom
// The label row's end, drawn (INVARIANTS §"The commitment ladder"). An unset field whose
// `default:` prints is tagged as showing it, and the tag describes its control. A field
// written over such a default holds the way back in the same place, named for the field,
// and taking it unsets the field and lands the focus on its control.
//
// On its own quill, one cell per case. A commit is read back through `resolve`, whose
// rung says whether anything is written.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document, Quill, ResolvedField } from '@quillmark/wasm';
import { DEFAULT_VISUAL_STRINGS } from '$lib/visual/strings';
import { quillFromYaml } from '../helpers/fixtures.js';
import { field, leaf, mountEditor, type, typeLeaf, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const QUILL_YAML = `quill:
  name: standing
  version: 1.0.0
  backend: typst
  description: One cell of each standing a field takes against its default.
typst:
  plate_file: plate.typ
main:
  fields:
    heading:
      type: text
    kept:
      type: text
      default: Kept
    skippable:
      type: text
      default: ""
    pages:
      type: integer
      default: 12
    notify:
      type: boolean
      default: true
    ref:
      type: text?
    lines:
      type: array
      items:
        type: text
      default:
        - First line
    contact:
      type: object
      properties:
        desk:
          type: text
          default: B-12
`;

let q: Quill;
let doc: Document;
/** A seed, every field unset, or the document `md` spells. */
function open(md?: string): HTMLElement {
	q = quillFromYaml(QUILL_YAML);
	doc = md == null ? q.seedDocument() : q.parse(md);
	return mountEditor(q, doc).target;
}
const row = (name: string): ResolvedField =>
	q
		.reader(doc)
		.resolve()
		.main.fields.find((r: ResolvedField) => r.name === name)!;
/** A document answering the given main-card lines. */
const answering = (...lines: string[]) =>
	['~~~', '$quill: standing@1.0.0', '$kind: main', ...lines, '~~~', ''].join('\n');

const tag = (scope: HTMLElement) => scope.querySelector<HTMLElement>('.qm-field-default');
const reset = (scope: HTMLElement) => scope.querySelector<HTMLButtonElement>('.qm-field-reset');
/** The text of the nodes an id-list attribute of `el` points at, in its order. */
const referenced = (el: Element, attr: string): string[] =>
	(el.getAttribute(attr) ?? '')
		.split(' ')
		.filter(Boolean)
		.map((id) => document.getElementById(id)?.textContent?.trim() ?? '');
const input = (scope: HTMLElement): HTMLInputElement => scope.querySelector('input')!;

describe('an unset field whose default prints', () => {
	it('is tagged at its label, and the tag describes its control', () => {
		const target = open();
		for (const [label, control] of [
			['Kept', leaf(field(target, 'Kept'))],
			['Pages', input(field(target, 'Pages'))],
			['Notify', field(target, 'Notify').querySelector('[role="switch"]')!]
		] as const) {
			const scope = field(target, label);
			expect(tag(scope)?.textContent).toBe(DEFAULT_VISUAL_STRINGS.fieldDefault);
			expect(referenced(control, 'aria-describedby')).toContain(
				DEFAULT_VISUAL_STRINGS.fieldDefault
			);
			expect(reset(scope)).toBeNull();
		}
	});

	it('goes untagged where nothing prints, and where the field holds cells', () => {
		const target = open();
		for (const label of ['Heading', 'Skippable', 'Ref', 'Lines', 'Contact']) {
			const scope = field(target, label);
			expect(tag(scope)).toBeNull();
			expect(reset(scope)).toBeNull();
		}
	});
});

describe('a field written over its default', () => {
	it('swaps the tag for a reset named for the field', () => {
		const target = open();
		const pages = field(target, 'Pages');
		type(input(pages), '40');
		expect(tag(pages)).toBeNull();
		expect(referenced(reset(pages)!, 'aria-labelledby')).toEqual([
			DEFAULT_VISUAL_STRINGS.fieldReset,
			'Pages'
		]);
		expect(input(pages).hasAttribute('aria-describedby')).toBe(false);
	});

	it('offers no reset where no default would print', () => {
		const target = open(answering('heading: Written', 'skippable: Written', 'ref: Written'));
		for (const label of ['Heading', 'Skippable', 'Ref']) {
			expect(reset(field(target, label))).toBeNull();
		}
	});

	it('is unset by the reset, which lands the focus on its control', () => {
		const target = open(answering('pages: 40', 'notify: false'));
		const pages = field(target, 'Pages');
		reset(pages)!.click();
		flushSync();
		expect(row('pages').source).toBe('default');
		expect(document.activeElement).toBe(input(pages));
		expect(tag(pages)).not.toBeNull();
		expect(reset(pages)).toBeNull();

		const notify = field(target, 'Notify');
		reset(notify)!.click();
		flushSync();
		expect(row('notify').source).toBe('default');
		expect(document.activeElement).toBe(notify.querySelector('[role="switch"]'));
	});

	it('follows a text field through its own commits, and takes the default back', () => {
		const target = open();
		const kept = field(target, 'Kept');
		const held = leaf(kept).textContent;
		// Emptied, the field holds the empty answer, and only the reset unsets it.
		typeLeaf(kept, '');
		expect(row('kept').source).toBe('authored');
		expect(tag(kept)).toBeNull();
		expect(referenced(leaf(kept), 'aria-describedby')).toEqual([]);

		reset(kept)!.click();
		flushSync();
		expect(row('kept').source).toBe('default');
		expect(leaf(kept).textContent).toBe(held);
		expect(referenced(leaf(kept), 'aria-describedby')).toEqual([
			DEFAULT_VISUAL_STRINGS.fieldDefault
		]);
		expect(reset(kept)).toBeNull();
	});
});
