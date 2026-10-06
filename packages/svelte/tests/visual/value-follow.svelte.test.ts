// @vitest-environment jsdom
// A by-value prose leaf, an array's element or a record row's cell, follows the value
// its parent's re-derive hands it: a write that lands in the store while it is mounted
// replaces its view, so the next keystroke edits that value rather than the one the leaf
// mounted over, and the hold is judged again of what arrives. Its own commit, echoed
// back through the same re-derive, replaces nothing. The probe is its own quill: a prose
// array, a record list with a prose cell, and a string whose commit re-derives.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import { core, quillFromYaml } from '../helpers/fixtures.js';
import {
	field,
	heldNote,
	mountEditor,
	paste,
	press,
	summaries,
	type,
	unmountAll,
	type Mounted
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const YAML = `quill:
  name: value_follow
  version: 1.0.0
  backend: typst
  description: By-value prose leaves, and a string beside them.
typst:
  plate_file: plate.typ
main:
  fields:
    notes:
      type: array
      items:
        type: richtext
      default: []
    jobs:
      type: array
      items:
        type: object
        properties:
          title:
            type: string
          summary:
            type: richtext
            inline: true
      default: []
    author:
      type: string
`;
const probe = () => quillFromYaml(YAML);
const load = (): Document =>
	core.Document.fromMarkdown(
		[
			'~~~',
			'$quill: value_follow@1.0.0',
			'notes:',
			'  - First note',
			'jobs:',
			'  - title: Archives',
			'    summary: Old summary',
			'~~~',
			''
		].join('\n')
	);
const LIST = '- one\n- two';

/** Commit the string beside the leaves: a revision, and so a re-derive. */
function rederive(m: Mounted): void {
	type(field(m.target, 'Author').querySelector<HTMLInputElement>('input')!, 'Ann');
}

const noteLeaf = (m: Mounted): HTMLElement =>
	field(m.target, 'Notes').querySelector<HTMLElement>('.ProseMirror')!;

/** The open first row's summary cell. */
function summaryLeaf(m: Mounted): HTMLElement {
	const jobs = field(m.target, 'Jobs');
	summaries(jobs)[0].click();
	flushSync();
	return jobs.querySelector<HTMLElement>('[data-qm-prop="summary"] .ProseMirror')!;
}

const items = (leaf: HTMLElement): string[] =>
	[...leaf.querySelectorAll('li')].map((li) => li.textContent ?? '');

describe('a by-value prose leaf over an external write', () => {
	it('a cell of an open row draws the stored value, and its next keystroke keeps it', () => {
		const q = probe();
		const doc = load();
		const mounted = mountEditor(q, doc);
		const leaf = summaryLeaf(mounted);
		expect(leaf.textContent).toBe('Old summary');

		q.writer(doc).set('jobs', [{ title: 'Archives', summary: 'New summary' }]);
		rederive(mounted);
		paste(leaf, 'Z');
		expect(q.reader(doc).getContentAt({ field: 'jobs' }, [0, 'summary'])?.text).toBe(
			'ZNew summary'
		);
		expect(leaf.textContent).toBe('ZNew summary');
	});

	it('an array element draws the stored value, and its next keystroke keeps it', () => {
		const q = probe();
		const doc = load();
		const mounted = mountEditor(q, doc);
		const leaf = noteLeaf(mounted);
		expect(leaf.textContent).toBe('First note');

		q.writer(doc).set('notes', ['Second note']);
		rederive(mounted);
		paste(leaf, 'Z');
		expect(q.reader(doc).getContentAt({ field: 'notes' }, [0])?.text).toBe('ZSecond note');
		expect(leaf.textContent).toBe('ZSecond note');
	});

	it('holds a leaf whose stored value gains structure, before a keystroke can write over it', () => {
		const q = probe();
		const doc = load();
		const mounted = mountEditor(q, doc);
		const leaf = noteLeaf(mounted);
		expect(leaf.getAttribute('contenteditable')).toBe('true');

		q.writer(doc).set('notes', [LIST]);
		rederive(mounted);
		expect(leaf.getAttribute('contenteditable')).toBe('false');
		expect(heldNote(leaf)).not.toBeNull();
		expect(items(leaf)).toEqual(['one', 'two']);

		const before = JSON.stringify(doc.getStored('notes'));
		paste(leaf, 'Z');
		expect(JSON.stringify(doc.getStored('notes'))).toBe(before);
	});

	it('releases a held leaf whose stored value becomes one plain paragraph', () => {
		const q = probe();
		const doc = load();
		doc.storeField('jobs', [{ title: 'Archives', summary: core.importMarkdown(LIST) }]);
		const mounted = mountEditor(q, doc);
		const leaf = summaryLeaf(mounted);
		expect(leaf.getAttribute('contenteditable')).toBe('false');
		expect(items(leaf)).toEqual(['one', 'two']);

		q.writer(doc).set('jobs', [{ title: 'Archives', summary: 'plain' }]);
		rederive(mounted);
		expect(leaf.getAttribute('contenteditable')).toBe('true');
		expect(heldNote(leaf)).toBeNull();
		expect(leaf.textContent).toBe('plain');

		paste(leaf, 'Z');
		expect(q.reader(doc).getContentAt({ field: 'jobs' }, [0, 'summary'])?.text).toBe('Zplain');
	});

	it('measures a write against its own last commit, not the value it mounted over', () => {
		const q = probe();
		const doc = load();
		const mounted = mountEditor(q, doc);
		const leaf = noteLeaf(mounted);

		paste(leaf, 'Z');
		q.writer(doc).set('notes', ['First note']);
		rederive(mounted);
		expect(leaf.textContent).toBe('First note');
	});

	it('keeps its view across its own commit, so the keystroke stays undoable', () => {
		const q = probe();
		const doc = load();
		const mounted = mountEditor(q, doc);
		const leaf = noteLeaf(mounted);

		paste(leaf, 'Z');
		expect(mounted.changes.at(-1)?.path).toBe('main.notes');
		expect(q.reader(doc).getContentAt({ field: 'notes' }, [0])?.text).toBe('ZFirst note');

		// A replaced state carries no history, so the undo would find nothing to revert.
		press(leaf, 'z', { ctrlKey: true });
		expect(leaf.textContent).toBe('First note');
		expect(q.reader(doc).getContentAt({ field: 'notes' }, [0])?.text).toBe('First note');
	});
});
