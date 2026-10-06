// @vitest-environment jsdom
// A block `richtext` cell on a record row mounts no island view, so a table or an image
// in it draws only as the node's placeholder: the cell is held over one, drawn
// read-only with the note in its box, and no keystroke or paste commits. The hold is
// judged of each value the row's re-derive hands down, so a write that brings an
// island holds the cell and one that takes the last away releases it. The probe is its
// own quill: a record list with a block prose cell, and a string whose commit
// re-derives.
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
  name: island_cell
  version: 1.0.0
  backend: typst
  description: A block prose cell on a record row, and a string beside it.
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
      default: []
    author:
      type: string
`;
const probe = () => quillFromYaml(YAML);
const ISLANDS = '| a | b |\n|---|---|\n| 1 | 2 |\n\nSee ![chart](chart.png) here.';
const load = (details: string): Document => {
	const doc = core.Document.fromMarkdown(
		['~~~', '$quill: island_cell@1.0.0', '~~~', ''].join('\n')
	);
	doc.storeField('jobs', [{ title: 'Archives', details }]);
	return doc;
};

/** Commit the string beside the rows: a revision, and so a re-derive. */
function rederive(m: Mounted): void {
	type(field(m.target, 'Author').querySelector<HTMLInputElement>('input')!, 'Ann');
}

/** The open first row's details cell. */
function detailsLeaf(m: Mounted): HTMLElement {
	const jobs = field(m.target, 'Jobs');
	summaries(jobs)[0].click();
	flushSync();
	return jobs.querySelector<HTMLElement>('[data-qm-prop="details"] .ProseMirror')!;
}

const islandTypes = (q: ReturnType<typeof probe>, doc: Document): string[] | undefined =>
	q
		.reader(doc)
		.getContentAt({ field: 'jobs' }, [0, 'details'])
		?.islands.map((i) => i.type);

function expectHeld(leaf: HTMLElement): void {
	expect(leaf.getAttribute('contenteditable')).toBe('false');
	expect(leaf.getAttribute('aria-readonly')).toBe('true');
	expect(heldNote(leaf)).not.toBeNull();
	expect(leaf.querySelector('[data-qm-island="table"]')).not.toBeNull();
	expect(leaf.querySelector('[data-qm-island="image"]')).not.toBeNull();
}

/** What takes a selected island out of an editable leaf, which mounts with the table
 *  opening the value selected. */
function strike(leaf: HTMLElement): void {
	press(leaf, 'Backspace');
	press(leaf, 'Delete');
	paste(leaf, 'Z');
}

describe('a block richtext cell over an island', () => {
	it('mounts held, and no keystroke or paste commits', () => {
		const q = probe();
		const doc = load(ISLANDS);
		const before = JSON.stringify(doc.getStored('jobs'));
		const mounted = mountEditor(q, doc);
		const leaf = detailsLeaf(mounted);
		expectHeld(leaf);

		strike(leaf);
		expect(JSON.stringify(doc.getStored('jobs'))).toBe(before);
		expect(islandTypes(q, doc)).toEqual(['table', 'image']);
		expect(mounted.changes).toEqual([]);
		expectHeld(leaf);
	});

	it('holds once a write brings an island, before a keystroke can reach it', () => {
		const q = probe();
		const doc = load('Plain details');
		const mounted = mountEditor(q, doc);
		const leaf = detailsLeaf(mounted);
		expect(leaf.getAttribute('contenteditable')).toBe('true');
		expect(heldNote(leaf)).toBeNull();

		q.writer(doc).set('jobs', [{ title: 'Archives', details: ISLANDS }]);
		rederive(mounted);
		expectHeld(leaf);

		const before = JSON.stringify(doc.getStored('jobs'));
		strike(leaf);
		expect(JSON.stringify(doc.getStored('jobs'))).toBe(before);
		expect(islandTypes(q, doc)).toEqual(['table', 'image']);
	});

	it('releases once a write takes the islands away, and edits again', () => {
		const q = probe();
		const doc = load(ISLANDS);
		const mounted = mountEditor(q, doc);
		const leaf = detailsLeaf(mounted);
		expectHeld(leaf);

		q.writer(doc).set('jobs', [{ title: 'Archives', details: 'Plain details' }]);
		rederive(mounted);
		expect(leaf.getAttribute('contenteditable')).toBe('true');
		expect(heldNote(leaf)).toBeNull();
		expect(leaf.textContent).toBe('Plain details');

		paste(leaf, 'Z');
		expect(mounted.changes.at(-1)?.path).toBe('main.jobs');
		expect(q.reader(doc).getContentAt({ field: 'jobs' }, [0, 'details'])?.text).toContain('Z');
	});
});
