// @vitest-environment jsdom
// A `text` or `richtext` field declaring `max:` holds its value to the cap at every
// depth a prose leaf mounts, and a labelled one draws its count, which the leaf names
// as its description: the carrier of a keystroke the cap refuses.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import { core, quillFromYaml } from '../helpers/fixtures.js';
import { field, leaf, mountEditor, paste, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const probe = () =>
	quillFromYaml(`quill:
  name: text_cap
  version: 1.0.0
  backend: typst
  description: Capped content fields at each depth.
typst:
  plate_file: plate.typ
main:
  fields:
    code:
      type: text
      max: 5
    note:
      type: text
    contact:
      type: object
      properties:
        zip:
          type: text
          max: 5
    tags:
      type: array
      items:
        type: richtext
        multiline: false
        max: 3
`);
const load = (): Document =>
	core.Document.fromMarkdown(
		['~~~', '$quill: text_cap@1.0.0', 'tags:', '  - ab', '~~~', ''].join('\n')
	);

const count = (scope: HTMLElement) => scope.querySelector('.qm-field-count')?.textContent;

describe('a field declaring max:', () => {
	it('lands a paste up to the cap and counts what it holds', () => {
		const doc = load();
		const mounted = mountEditor(probe(), doc);
		const code = field(mounted.target, 'Code');
		expect(count(code)).toBe('0 / 5');

		paste(leaf(code), 'abcdefgh');
		expect(doc.getStored('code')).toBe('abcde');
		expect(count(code)).toBe('5 / 5');

		paste(leaf(code), 'x');
		expect(doc.getStored('code')).toBe('abcde');

		const described = leaf(code).getAttribute('aria-describedby') ?? '';
		expect(described.split(' ').map((id) => document.getElementById(id)?.textContent)).toContain(
			'5 / 5'
		);
	});

	it('draws no count with no cap', () => {
		const mounted = mountEditor(probe(), load());
		expect(count(field(mounted.target, 'Note'))).toBeUndefined();
	});

	it('holds a subform cell to its cap, counting it in the cell’s label row', () => {
		const doc = load();
		const mounted = mountEditor(probe(), doc);
		const zip = field(mounted.target, 'Contact').querySelector<HTMLElement>(
			'[data-qm-prop="zip"]'
		)!;
		paste(leaf(zip), '1234567');
		flushSync();
		expect((doc.getStored('contact') as { zip: string }).zip).toBe('12345');
		expect(count(zip)).toBe('5 / 5');
	});

	it('holds an array element to its items’ cap', () => {
		const doc = load();
		const mounted = mountEditor(probe(), doc);
		const tags = field(mounted.target, 'Tags');
		const row = tags.querySelector<HTMLElement>('.ProseMirror[aria-label="Tags 1"]')!;
		paste(row, 'cdef');
		expect(row.textContent).toHaveLength(3);
		expect(probe().reader(doc).get('tags')).toEqual([row.textContent]);
	});
});
