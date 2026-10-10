// @vitest-environment jsdom
// A block `richtext` cell on a record row takes the block schema and the whole row, so
// a list it holds survives an edit, and a `plaintext` cell without `inline` takes the
// plain schema and the whole row, so an address keeps its lines. A leaf narrowed to one
// textblock over content that holds more is read-only and commits nothing, so no
// keystroke writes the flattening back. The reference quill declares none of these
// shapes, so the probe is its own quill.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Content, Document } from '@quillmark/wasm';
import { core, quillFromYaml } from '../helpers/fixtures.js';
import {
	field,
	heldNote,
	mountEditor,
	paste,
	press,
	summaries,
	unmountAll
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const YAML = `quill:
  name: block_cell
  version: 1.0.0
  backend: typst
  description: Block prose cells on a record row, and prose arrays.
typst:
  plate_file: plate.typ
main:
  fields:
    jobs:
      type: array
      items:
        type: object
        properties:
          title:
            type: string
          details:
            type: richtext
          address:
            type: plaintext
      default: []
    notes:
      type: array
      items:
        type: richtext
      default: []
    tags:
      type: array
      items:
        type: plaintext
      default: []
`;
const probe = () => quillFromYaml(YAML);
const load = (): Document =>
	core.Document.fromMarkdown(
		[
			'~~~',
			'$quill: block_cell@1.0.0',
			'jobs:',
			'  - title: Archives',
			'    details: |',
			'      - Analyzed patterns',
			'      - Building pipelines',
			'    address: |',
			'      12 Main St',
			'      Springfield',
			'notes:',
			'  - |',
			'    - one',
			'    - two',
			'tags:',
			'  - |',
			'    plain block scalar',
			'  - |-',
			'    12 Main St',
			'    Springfield',
			'~~~',
			''
		].join('\n')
	);

const listItems = (rt: Content): string[] =>
	rt.lines
		.map((line, i) => ({ line, text: rt.text.split('\n')[i] }))
		.filter(({ line }) => line.containers.some((c) => c.container === 'list_item'))
		.map(({ text }) => text);

describe('a block richtext cell on a record row', () => {
	it('draws the list it holds across the row, and keeps it through an edit', () => {
		const q = probe();
		const doc = load();
		const mounted = mountEditor(q, doc);
		const jobs = field(mounted.target, 'Jobs');
		summaries(jobs)[0].click();
		flushSync();

		const cell = jobs.querySelector<HTMLElement>('[data-qm-prop="details"]')!;
		expect(cell.classList.contains('qm-prop-wide')).toBe(true);
		const leaf = cell.querySelector<HTMLElement>('.ProseMirror')!;
		expect([...leaf.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
			'Analyzed patterns',
			'Building pipelines'
		]);

		press(leaf, 'Enter');
		expect(mounted.changes.at(-1)?.path).toBe('main.jobs');
		const details = (doc.getStored('jobs') as Array<{ details: Content }>)[0].details;
		expect(listItems(details)).toEqual(['Analyzed patterns', 'Building pipelines']);
	});
});

describe('a plaintext cell without `inline` on a record row', () => {
	it('draws the lines it holds across the row, and keeps them through an edit', () => {
		const q = probe();
		const doc = load();
		const mounted = mountEditor(q, doc);
		const jobs = field(mounted.target, 'Jobs');
		summaries(jobs)[0].click();
		flushSync();

		const cell = jobs.querySelector<HTMLElement>('[data-qm-prop="address"]')!;
		expect(cell.classList.contains('qm-prop-wide')).toBe(true);
		const leaf = cell.querySelector<HTMLElement>('.ProseMirror')!;
		expect(leaf.getAttribute('contenteditable')).toBe('true');
		expect(heldNote(leaf)).toBeNull();
		expect(leaf.querySelector('p')?.innerHTML).toBe('12 Main St<br>Springfield');

		paste(leaf, 'Apt 4, ');
		expect(mounted.changes.at(-1)?.path).toBe('main.jobs');
		const address = (doc.getStored('jobs') as Array<{ address: string }>)[0].address;
		expect(address).toBe('Apt 4, 12 Main St\nSpringfield\n');
	});

	it('holds one over lines upstream does not call plain, and commits nothing', () => {
		const q = probe();
		const doc = load();
		doc.storeField('jobs', [
			{ title: 'Archives', address: core.importMarkdown('- one\n- two').content }
		]);
		const before = JSON.stringify(doc.getStored('jobs'));
		const mounted = mountEditor(q, doc);
		const jobs = field(mounted.target, 'Jobs');
		summaries(jobs)[0].click();
		flushSync();
		const leaf = jobs.querySelector<HTMLElement>('[data-qm-prop="address"] .ProseMirror')!;

		expect(leaf.getAttribute('contenteditable')).toBe('false');
		expect(heldNote(leaf)).not.toBeNull();
		expect([...leaf.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two']);
		paste(leaf, 'pasted');
		expect(JSON.stringify(doc.getStored('jobs'))).toBe(before);
	});
});

describe('a narrowed leaf over structure it cannot hold', () => {
	it('draws the structure read-only, as a focusable textbox with a note, and commits nothing', () => {
		const q = probe();
		const doc = load();
		const before = JSON.stringify(doc.getStored('notes'));
		const mounted = mountEditor(q, doc);
		const leaf = field(mounted.target, 'Notes').querySelector<HTMLElement>('.ProseMirror')!;

		expect(leaf.getAttribute('contenteditable')).toBe('false');
		expect(leaf.getAttribute('role')).toBe('textbox');
		expect(leaf.getAttribute('aria-readonly')).toBe('true');
		expect(leaf.tabIndex).toBe(0);
		expect(heldNote(leaf)).not.toBeNull();
		expect([...leaf.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two']);

		paste(leaf, 'pasted');
		expect(JSON.stringify(doc.getStored('notes'))).toBe(before);
		expect(mounted.changes).toEqual([]);
	});

	it('holds a multi-line plaintext element, one textblock whatever it declares', () => {
		const q = probe();
		const doc = load();
		const mounted = mountEditor(q, doc);
		const leaf = field(mounted.target, 'Tags').querySelectorAll<HTMLElement>('.ProseMirror')[1];

		expect(leaf.getAttribute('contenteditable')).toBe('false');
		expect(heldNote(leaf)).not.toBeNull();
		// The line break a narrowed decode would have joined to a space.
		expect(leaf.querySelector('p')?.innerHTML).toBe('12 Main St<br>Springfield');
	});

	it('edits a one-line value a YAML block scalar left a trailing newline on', () => {
		const q = probe();
		const doc = load();
		const mounted = mountEditor(q, doc);
		const leaf = field(mounted.target, 'Tags').querySelector<HTMLElement>('.ProseMirror')!;

		expect(leaf.getAttribute('contenteditable')).toBe('true');
		expect(leaf.hasAttribute('aria-describedby')).toBe(false);
		// One textblock: the plain schema would open a second one on the kept newline.
		expect(leaf.querySelectorAll('p')).toHaveLength(1);
		paste(leaf, 'new ');
		expect(mounted.changes.at(-1)?.path).toBe('main.tags');
		expect(String((doc.getStored('tags') as unknown[])[0])).toContain('new plain block scalar');
	});
});
