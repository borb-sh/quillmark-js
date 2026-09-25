// @vitest-environment jsdom
// A block `richtext` cell on a record row takes the block schema and the whole row, so
// a list it holds survives an edit. A leaf narrowed to one textblock over content that
// holds more is read-only and commits nothing, so no keystroke writes the flattening
// back. The reference quill declares neither shape, so the probe is its own quill.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { init, type Content, type Document, type Quill } from '@quillmark/wasm';
import {
	field,
	mountEditor,
	press,
	stubLayout,
	summaries,
	type Mounted
} from '../helpers/surface.js';

const core = await init();
stubLayout();

const YAML = `quill:
  name: block_cell
  version: 1.0.0
  backend: typst
  description: A block richtext cell on a record row, and a block richtext array.
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
// Re-wrapped in this realm's `Uint8Array`: under jsdom the encoder's output comes from
// another realm and the boundary refuses it by identity.
const bytes = (s: string): Uint8Array => new Uint8Array(new TextEncoder().encode(s));
const probe = (): Quill =>
	core.Quill.fromTree(
		new Map([
			['Quill.yaml', bytes(YAML)],
			['plate.typ', bytes('#set page(width: 200pt)\n')]
		])
	);
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
			'  - plain scalar',
			'~~~',
			''
		].join('\n')
	);

let mounted: Mounted | undefined;
afterEach(() => {
	mounted?.unmount();
	mounted = undefined;
});

/** A paste as the DOM delivers one: jsdom implements no `DataTransfer`, and `getData`
 *  is all ProseMirror's paste handler reads. */
function paste(el: HTMLElement, text: string): void {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? text : '') }
	});
	el.dispatchEvent(event);
	flushSync();
}

/** The note a held leaf draws, inside its own box and naming nothing but itself. */
function heldNote(leaf: HTMLElement): HTMLElement | null {
	const note = document.getElementById(leaf.getAttribute('aria-describedby') ?? '');
	return note && leaf.closest('.qm-control-box')?.contains(note) ? note : null;
}

const listItems = (rt: Content): string[] =>
	rt.lines
		.map((line, i) => ({ line, text: rt.text.split('\n')[i] }))
		.filter(({ line }) => line.containers.some((c) => c.container === 'list_item'))
		.map(({ text }) => text);

describe('a block richtext cell on a record row', () => {
	it('draws the list it holds across the row, and keeps it through an edit', () => {
		const q = probe();
		const doc = load();
		mounted = mountEditor(q, doc);
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
		doc.free();
	});
});

describe('a narrowed leaf over structure it cannot hold', () => {
	it('draws the structure read-only, as a focusable textbox with a note, and commits nothing', () => {
		const q = probe();
		const doc = load();
		const before = JSON.stringify(doc.getStored('notes'));
		mounted = mountEditor(q, doc);
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
		doc.free();
	});

	it('holds a multi-line plaintext cell on a record row', () => {
		const q = probe();
		const doc = load();
		mounted = mountEditor(q, doc);
		const jobs = field(mounted.target, 'Jobs');
		summaries(jobs)[0].click();
		flushSync();
		const leaf = jobs.querySelector<HTMLElement>('[data-qm-prop="address"] .ProseMirror')!;

		expect(leaf.getAttribute('contenteditable')).toBe('false');
		expect(heldNote(leaf)).not.toBeNull();
		// The line break a narrowed decode would have joined to a space.
		expect(leaf.querySelector('p')?.innerHTML).toBe('12 Main St<br>Springfield');
		doc.free();
	});

	it('holds a plaintext element a YAML block scalar left a trailing newline on, and edits a plain one', () => {
		const q = probe();
		const doc = load();
		mounted = mountEditor(q, doc);
		const [block, plain] = field(mounted.target, 'Tags').querySelectorAll<HTMLElement>(
			'.ProseMirror'
		);

		// `plaintext` is verbatim, so the newline is a second line the narrowed decode
		// would drop.
		expect(block.getAttribute('contenteditable')).toBe('false');
		expect(heldNote(block)).not.toBeNull();

		expect(plain.getAttribute('contenteditable')).toBe('true');
		expect(plain.hasAttribute('aria-describedby')).toBe(false);
		paste(plain, 'new ');
		expect(mounted.changes.at(-1)?.path).toBe('main.tags');
		expect((doc.getStored('tags') as unknown[])[1]).toBe('new plain scalar');
		doc.free();
	});
});
