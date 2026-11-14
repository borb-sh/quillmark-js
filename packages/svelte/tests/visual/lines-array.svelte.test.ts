// @vitest-environment jsdom
// An array whose `items` declares a `shape` holds elements of several lines each. The element
// mounts the leaf its scalar field of that shape mounts, so Enter breaks a line inside it, and
// the sibling insert moves to ⌘/Ctrl+Enter. A leaf of lines carries `data-qm-lines`, the hook
// `prose.css` sets its paragraphs single spaced by.
import { describe, it, expect, afterEach } from 'vitest';
import { tick } from 'svelte';
import { DocumentReader, type Document } from '@quillmark/wasm';
import { core, quillFromYaml, literal } from '../helpers/fixtures.js';
import {
	field,
	leaf,
	mountEditor,
	paste,
	press,
	settle,
	unmountAll
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const probe = () =>
	quillFromYaml(`quill:
  name: lines_array
  version: 1.0.0
  backend: typst
  description: Arrays of multiline elements beside one-line ones.
typst:
  plate_file: plate.typ
main:
  fields:
    addresses:
      type: array
      items:
        type: text
        shape: lines
    notes:
      type: array
      items:
        type: richtext
        shape: lines
    tags:
      type: array
      items:
        type: text
    recipients:
      type: richtext
      shape: lines
    subject:
      type: richtext
`);

const load = (): Document =>
	core.Document.parse(
		[
			'~~~',
			'$quill: lines_array@1.0.0',
			'addresses:',
			'  - abc',
			'notes:',
			'  - abc',
			'tags:',
			'  - abc',
			'~~~',
			''
		].join('\n')
	);

const rows = (target: HTMLElement, label: string): HTMLElement[] => [
	...target.querySelectorAll<HTMLElement>(`.ProseMirror[aria-label^="${label} "]`)
];

describe('an array of multiline elements', () => {
	it('breaks a line inside the element on Enter, and inserts a sibling on Ctrl+Enter', async () => {
		const q = probe();
		const doc = load();
		const { target, editor } = mountEditor(q, doc);
		const reader = () => new DocumentReader(q, doc);

		await editor.setCaret({ field: 'main.addresses[0]', pos: 3, granularity: 'cluster' });
		await tick();
		press(rows(target, 'Addresses')[0], 'Enter', { cancelable: true });
		await settle();
		expect(rows(target, 'Addresses')).toHaveLength(1);
		paste(rows(target, 'Addresses')[0], 'def');
		expect(literal(doc.getStored('addresses'))).toEqual(['abc\n\ndef']);

		press(rows(target, 'Addresses')[0], 'Enter', { ctrlKey: true, cancelable: true });
		await settle();
		expect(rows(target, 'Addresses')).toHaveLength(2);
		expect(reader().get('addresses')).toEqual(['abc\n\ndef', '']);
	});

	it('keeps a paste of several lines in the element', () => {
		const doc = load();
		const { target } = mountEditor(probe(), doc);
		paste(rows(target, 'Notes')[0], 'one\ntwo');
		expect(rows(target, 'Notes')).toHaveLength(1);
		expect(rows(target, 'Notes')[0].innerHTML).toMatch(/one<br[^>]*>two/);
	});

	it('still inserts a sibling on Enter in an array of one-line elements', async () => {
		const q = probe();
		const doc = load();
		const { target, editor } = mountEditor(q, doc);
		await editor.setCaret({ field: 'main.tags[0]', pos: 3, granularity: 'cluster' });
		await tick();
		press(rows(target, 'Tags')[0], 'Enter');
		expect(literal(doc.getStored('tags'))).toEqual(['abc', '']);
	});
});

describe('a leaf of lines', () => {
	it('carries data-qm-lines on a lines field and a lines element, and not on one-line leaves', () => {
		const { target } = mountEditor(probe(), load());
		expect(leaf(field(target, 'Recipients')).hasAttribute('data-qm-lines')).toBe(true);
		expect(rows(target, 'Addresses')[0].hasAttribute('data-qm-lines')).toBe(true);
		expect(rows(target, 'Notes')[0].hasAttribute('data-qm-lines')).toBe(true);
		expect(leaf(field(target, 'Subject')).hasAttribute('data-qm-lines')).toBe(false);
		expect(rows(target, 'Tags')[0].hasAttribute('data-qm-lines')).toBe(false);
	});
});
