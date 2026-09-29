// @vitest-environment jsdom
// An array of `plaintext`, which the reference quill declares as `errata`: rows an
// author writes verbatim, where markdown in one is the text rather than markup.
//
// The type is what the row has to agree with, and it agrees on both lanes. The row
// reads through `reader.getContentAt`, which decodes an element at the codec its
// `items` type names, so a literal string opens as content carrying its own
// asterisks and no mark. It writes back the `Content` every prose leaf hands up,
// which the typed writer rests as the literal string again — the claim that lets a
// `plaintext` element mount the same prose leaf its scalar field does.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import { DocumentReader, type Quill, type Document } from '@quillmark/wasm';
import { core, quill, example } from '../helpers/fixtures.js';
import { field, mountEditor, press, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

/** The element leaves labelled `label`, in DOM order, located by the accessible name
 *  each carries (`${label} ${index + 1}`, ArrayField). */
const leaves = (target: HTMLElement, label: string): HTMLElement[] => [
	...target.querySelectorAll<HTMLElement>(`.ProseMirror[aria-label^="${label} "]`)
];
const rows = (target: HTMLElement) => leaves(target, 'Errata');
const add = (target: HTMLElement) => {
	field(target, 'Errata').querySelector<HTMLButtonElement>('.qm-add-el')!.click();
	flushSync();
};

const read = (q: Quill, doc: Document, name: string) => new DocumentReader(q, doc).get(name);

describe('an array of plaintext', () => {
	it('mounts its seeded string elements as prose rows, verbatim, logging nothing', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const q = quill();
			const doc = example();
			// The element rests as its literal string; the row reads it through the codec
			// the declared type names rather than off the stored value.
			const seeded = doc.getStored('errata') as string[];
			expect(seeded.every((e) => typeof e === 'string')).toBe(true);
			expect(seeded.length).toBeGreaterThan(1);

			const { target, errors } = mountEditor(q, doc);
			expect(rows(target).map((r) => r.textContent)).toEqual(seeded);
			// The type distinction, on screen: the seed's `**asterisks**` are characters
			// in the row, and no emphasis was lowered from them.
			expect(rows(target)[0].textContent).toContain('**asterisks**');
			expect(rows(target)[0].querySelector('em, strong')).toBeNull();
			// The messages, not just the count: a failure here should name what it saw.
			expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([]);
			expect(error.mock.calls.map((c) => String(c[0]))).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			warn.mockRestore();
			error.mockRestore();
		}
	});

	it('adds an element and rests it as a string', () => {
		const q = quill();
		const doc = example();
		const { target } = mountEditor(q, doc);

		const seeded = doc.getStored('errata') as string[];
		add(target);
		expect(rows(target)).toHaveLength(seeded.length + 1);
		expect(rows(target).at(-1)!.textContent).toBe('');

		// A prose row commits `Content`, and the slot it lands in is a `plaintext`
		// one: what rests is the string, so the array stays a string array.
		const grown = [...seeded, ''];
		expect(read(q, doc, 'errata')).toEqual(grown);
		expect(doc.getStored('errata')).toEqual(grown);
	});

	// The other half of that write, without the row: what a prose leaf hands up for
	// an edited element is a `Content`, and the typed writer is what turns it back
	// into the element's rest form. jsdom implements no contenteditable, so the
	// keystroke that produces one cannot be driven here; the writer's half is where the
	// claim lives anyway.
	it('rests an edited element as its literal string', () => {
		const q = quill();
		const doc = example();
		q.writer(doc).set('errata', [core.importMarkdown('Page 9 omits the colophon.')]);
		expect(doc.getStored('errata')).toEqual(['Page 9 omits the colophon.']);
	});

	it('removes an element on Backspace only once it reads empty', () => {
		const q = quill();
		const doc = example();
		const { target } = mountEditor(q, doc);

		const seeded = doc.getStored('errata') as string[];
		// A populated element keeps its row: the emptiness test reads the element's
		// committed value, which a seeded row has.
		press(rows(target)[0], 'Backspace');
		expect(rows(target)).toHaveLength(seeded.length);

		// An added row is the empty one, and it goes.
		add(target);
		press(rows(target).at(-1)!, 'Backspace');
		expect(rows(target).map((r) => r.textContent)).toEqual(seeded);
		expect(read(q, doc, 'errata')).toEqual(seeded);
	});

	it('inserts a sibling on Enter', () => {
		const q = quill();
		const doc = example();
		const { target } = mountEditor(q, doc);

		const seeded = doc.getStored('errata') as string[];
		press(rows(target)[0], 'Enter');
		expect(rows(target)).toHaveLength(seeded.length + 1);
		// The new row is the first one's sibling, not the list's tail.
		expect(rows(target)[1].textContent).toBe('');
		expect(doc.getStored('errata')).toEqual([seeded[0], '', ...seeded.slice(1)]);
	});

	// The landing is the row's, not the field's: a `plaintext` element rides the same
	// lowering a `richtext` one does, so the compile answers it cluster-exact and the
	// element lane carries the offset down (VISUAL_EDITOR.md §Surface).
	it('lands a caret at the offset the compile resolved, counting by code point', async () => {
		const q = quill();
		const doc = example();
		// An astral character before the offset is the hazard: 𝔘 is one code point and
		// two UTF-16 units, so USV 9 is UTF-16 10 and a naive offset lands short of it.
		q.writer(doc).set('errata', [core.importMarkdown('astral \u{1D518} tail here')]);
		const { target, editor } = mountEditor(q, doc);

		await editor.setCaret({ field: 'main.errata[0]', pos: 9, granularity: 'cluster' });
		await tick();

		expect(document.activeElement?.getAttribute('aria-label')).toBe('Errata 1');
		const sel = window.getSelection();
		expect(sel?.anchorNode?.textContent).toBe('astral \u{1D518} tail here');
		expect(sel?.anchorOffset).toBe(10);
		expect(rows(target)).toHaveLength(1);
	});
});

// The `richtext` twin, on a document through the transport door (`Document.fromMarkdown`):
// its elements rest as authored strings, the scalar field's rest form, and the row reads
// one at the codec the declared type names, so the emphasis is lowered by the boundary
// rather than by the row.
describe('an array of richtext loaded from markdown', () => {
	it('mounts authored-string elements as prose rows, with emphasis lowered', () => {
		const doc = core.Document.fromMarkdown(`~~~
$quill: showcase@1.0.0
$kind: main
title: Probe
keywords:
  - Dominion Fleet Intelligence, 2504, *Char Orbital Reconnaissance Summary*
  - Raynor's Raiders Field Report, 2504, *Zerg Hive Cluster Activity on Char*
~~~

Body.
`);
		expect((doc.getStored('keywords') as unknown[]).every((e) => typeof e === 'string')).toBe(true);

		const text = leaves(mountEditor(quill(), doc).target, 'Keywords').map((el) => el.textContent);
		expect(text).toEqual([
			'Dominion Fleet Intelligence, 2504, Char Orbital Reconnaissance Summary',
			"Raynor's Raiders Field Report, 2504, Zerg Hive Cluster Activity on Char"
		]);
		expect(text.some((t) => t?.includes('*'))).toBe(false);
	});
});
