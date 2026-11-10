// @vitest-environment jsdom
// An array of `text`, which the reference quill declares as `errata`: rows an
// author writes verbatim, where markdown in one is the text rather than markup.
//
// The type is what the row has to agree with, and it agrees on both lanes. The row
// reads through `reader.getContentAt`, which decodes an element at the codec its
// `items` type names, so a literal string opens as content carrying its own
// asterisks and no mark. It writes back the `Content` every prose leaf hands up,
// which the typed writer rests as the literal string again — the claim that lets a
// `text` element mount the same prose leaf its field does.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import { DocumentReader, type Quill, type Document } from '@quillmark/wasm';
import { core, quill, example, literal } from '../helpers/fixtures.js';
import { DEFAULT_VISUAL_STRINGS } from '$lib/visual/strings';
import { field, mountEditor, paste, press, settle, unmountAll } from '../helpers/surface.svelte.js';

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

describe('an array of `text`', () => {
	it('mounts its seeded string elements as prose rows, verbatim, logging nothing', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const q = quill();
			const doc = example();
			// The element rests as plain content; the row reads it through the codec the
			// declared type names, literally.
			const held = doc.getStored('errata') as { codec?: string }[];
			expect(held.every((e) => e.codec === 'plain')).toBe(true);
			const seeded = literal(held) as string[];
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

	it('adds an element and rests it as plain text', () => {
		const q = quill();
		const doc = example();
		const { target } = mountEditor(q, doc);

		const seeded = literal(doc.getStored('errata')) as string[];
		add(target);
		expect(rows(target)).toHaveLength(seeded.length + 1);
		expect(rows(target).at(-1)!.textContent).toBe('');

		// A prose row commits `Content`, and the slot it lands in is a `text`
		// one: what rests is plain content, its text literal.
		const grown = [...seeded, ''];
		expect(read(q, doc, 'errata')).toEqual(grown);
		expect(literal(doc.getStored('errata'))).toEqual(grown);
	});

	// The other half of that write, without the row: what a prose leaf hands up for
	// an edited element is a `Content`, and the typed writer is what turns it back
	// into the element's rest form. jsdom implements no contenteditable, so the
	// keystroke that produces one cannot be driven here; the writer's half is where the
	// claim lives anyway.
	it('rests an edited element as its literal string', () => {
		const q = quill();
		const doc = example();
		q.writer(doc).set('errata', [core.importMarkdown('Page 9 omits the colophon.').content]);
		expect(literal(doc.getStored('errata'))).toEqual(['Page 9 omits the colophon.']);
	});

	it('removes an element on Backspace only once it reads empty', () => {
		const q = quill();
		const doc = example();
		const { target } = mountEditor(q, doc);

		const seeded = literal(doc.getStored('errata')) as string[];
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

	it('moves a line on Alt+↑/↓, its leaf and the caret with it', async () => {
		const q = quill();
		const doc = example();
		const { target } = mountEditor(q, doc);
		const seeded = literal(doc.getStored('errata')) as string[];
		const first = rows(target)[0];
		first.focus();
		press(first, 'ArrowDown', { altKey: true, cancelable: true });
		await settle();
		expect(read(q, doc, 'errata')).toEqual([seeded[1], seeded[0], ...seeded.slice(2)]);
		expect(rows(target)[1]).toBe(first);
		expect(document.activeElement).toBe(first);
		// The first line has nowhere to go up.
		press(rows(target)[0], 'ArrowUp', { altKey: true, cancelable: true });
		expect(read(q, doc, 'errata')).toEqual([seeded[1], seeded[0], ...seeded.slice(2)]);
	});

	it('inserts a sibling on Enter at the end of a line', async () => {
		const q = quill();
		const doc = example();
		const { target, editor } = mountEditor(q, doc);

		const seeded = literal(doc.getStored('errata')) as string[];
		await editor.setCaret({
			field: 'main.errata[0]',
			pos: seeded[0].length,
			granularity: 'cluster'
		});
		await tick();
		press(rows(target)[0], 'Enter');
		expect(rows(target)).toHaveLength(seeded.length + 1);
		// The new row is the first one's sibling, not the list's tail.
		expect(rows(target)[1].textContent).toBe('');
		expect(literal(doc.getStored('errata'))).toEqual([seeded[0], '', ...seeded.slice(1)]);
	});

	it('splits a line on Enter short of its end, the caret at the start of the new row', async () => {
		const q = quill();
		const doc = example();
		q.writer(doc).set('errata', ['abcdef', 'ghi']);
		const { target, editor } = mountEditor(q, doc);

		await editor.setCaret({ field: 'main.errata[0]', pos: 3, granularity: 'cluster' });
		await tick();
		press(rows(target)[0], 'Enter', { cancelable: true });
		await settle();
		expect(literal(doc.getStored('errata'))).toEqual(['abc', 'def', 'ghi']);
		expect(rows(target).map((r) => r.textContent)).toEqual(['abc', 'def', 'ghi']);
		expect(document.activeElement).toBe(rows(target)[1]);
		const sel = window.getSelection();
		expect(sel?.anchorNode?.textContent).toBe('def');
		expect(sel?.anchorOffset).toBe(0);
	});

	it('joins a line onto the one above on Backspace at its start', async () => {
		const q = quill();
		const doc = example();
		q.writer(doc).set('errata', ['abc', 'def', 'ghi']);
		const { target, editor } = mountEditor(q, doc);

		await editor.setCaret({ field: 'main.errata[1]', pos: 0, granularity: 'cluster' });
		await tick();
		press(rows(target)[1], 'Backspace', { cancelable: true });
		await settle();
		expect(literal(doc.getStored('errata'))).toEqual(['abcdef', 'ghi']);
		expect(rows(target).map((r) => r.textContent)).toEqual(['abcdef', 'ghi']);
		expect(document.activeElement).toBe(rows(target)[0]);
		const sel = window.getSelection();
		expect(sel?.anchorNode?.textContent).toBe('abcdef');
		expect(sel?.anchorOffset).toBe(3);
		// The first line has nothing above it to join.
		await editor.setCaret({ field: 'main.errata[0]', pos: 0, granularity: 'cluster' });
		await tick();
		press(rows(target)[0], 'Backspace', { cancelable: true });
		await settle();
		expect(literal(doc.getStored('errata'))).toEqual(['abcdef', 'ghi']);
	});

	it('joins the next line onto this one on Delete at its end', async () => {
		const q = quill();
		const doc = example();
		q.writer(doc).set('errata', ['abc', 'def']);
		const { target, editor } = mountEditor(q, doc);

		await editor.setCaret({ field: 'main.errata[0]', pos: 3, granularity: 'cluster' });
		await tick();
		press(rows(target)[0], 'Delete', { cancelable: true });
		await settle();
		expect(literal(doc.getStored('errata'))).toEqual(['abcdef']);
		expect(document.activeElement).toBe(rows(target)[0]);
		expect(window.getSelection()?.anchorOffset).toBe(3);
	});

	it('takes a paste of several lines as a row per line', () => {
		const q = quill();
		const doc = example();
		q.writer(doc).set('errata', ['']);
		const { target } = mountEditor(q, doc);

		const event = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', {
			value: {
				getData: (type: string) => (type === 'text/plain' ? 'one\ntwo\n\nthree' : ''),
				setData: () => {}
			}
		});
		rows(target)[0].dispatchEvent(event);
		flushSync();
		expect(literal(doc.getStored('errata'))).toEqual(['one', 'two', 'three']);
		expect(rows(target).map((r) => r.textContent)).toEqual(['one', 'two', 'three']);
	});

	it('splits the row at the caret, its rest following the last line pasted', async () => {
		const q = quill();
		const doc = example();
		q.writer(doc).set('errata', ['abcdef']);
		const { target, editor } = mountEditor(q, doc);

		await editor.setCaret({ field: 'main.errata[0]', pos: 3, granularity: 'cluster' });
		await tick();
		paste(rows(target)[0], 'one\ntwo');
		await new Promise((r) => setTimeout(r, 0));
		expect(literal(doc.getStored('errata'))).toEqual(['abcone', 'twodef']);
		expect(rows(target).map((r) => r.textContent)).toEqual(['abcone', 'twodef']);
		expect(document.activeElement?.getAttribute('aria-label')).toBe('Errata 2');
		const sel = window.getSelection();
		expect(sel?.anchorNode?.textContent).toBe('twodef');
		expect(sel?.anchorOffset).toBe(3);
	});

	// The landing is the row's, not the field's: a `text` element rides the same
	// lowering a `richtext` one does, so the compile answers it cluster-exact and the
	// element lane carries the offset down (INVARIANTS §Surface).
	it('lands a caret at the offset the compile resolved, counting by code point', async () => {
		const q = quill();
		const doc = example();
		// An astral character before the offset is the hazard: 𝔘 is one code point and
		// two UTF-16 units, so the offset after it counts both.
		q.writer(doc).set('errata', [core.importMarkdown('astral \u{1D518} tail here').content]);
		const { target, editor } = mountEditor(q, doc);

		await editor.setCaret({ field: 'main.errata[0]', pos: 10, granularity: 'cluster' });
		await tick();

		expect(document.activeElement?.getAttribute('aria-label')).toBe('Errata 1');
		const sel = window.getSelection();
		expect(sel?.anchorNode?.textContent).toBe('astral \u{1D518} tail here');
		expect(sel?.anchorOffset).toBe(10);
		expect(rows(target)).toHaveLength(1);
	});
});

// The `richtext` twin, on a document through the transport door (`Document.parse`):
// its elements rest as authored strings, the scalar field's rest form, and the row reads
// one at the codec the declared type names, so the emphasis is lowered by the boundary
// rather than by the row.
describe('an array of richtext loaded from markdown', () => {
	it('mounts authored-string elements as prose rows, with emphasis lowered', () => {
		const doc = core.Document.parse(`~~~
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

	it('keeps the marks on both halves of a split, and a join mends them', async () => {
		const q = quill();
		const doc = example();
		q.writer(doc).set('keywords', [core.importMarkdown('*Schema* shapes').content]);
		const { target, editor } = mountEditor(q, doc);
		const keywords = () => leaves(target, 'Keywords');

		await editor.setCaret({ field: 'main.keywords[0]', pos: 3, granularity: 'cluster' });
		await tick();
		press(keywords()[0], 'Enter', { cancelable: true });
		await settle();
		expect((doc.getStored('keywords') as unknown[]).length).toBe(2);
		expect(keywords().map((el) => el.querySelector('em')?.textContent)).toEqual(['Sch', 'ema']);

		press(keywords()[1], 'Backspace', { cancelable: true });
		await settle();
		expect((doc.getStored('keywords') as unknown[]).length).toBe(1);
		expect(keywords()[0].innerHTML).toBe('<p><em>Schema</em> shapes</p>');
	});
});

// An empty list draws one row to type into, which is no element until it holds one.
describe('an empty list of lines', () => {
	const emptied = (): Document => {
		const doc = example();
		doc.removeField('errata');
		return doc;
	};
	const errata = (target: HTMLElement) => field(target, 'Errata');
	const standingRows = (target: HTMLElement) =>
		errata(target).querySelectorAll('.qm-array-row.standing');

	it('draws an empty standing row with its ghost and no remove, and writes nothing for a key', () => {
		const q = quill();
		const doc = emptied();
		const { target, changes } = mountEditor(q, doc);

		expect(rows(target)).toHaveLength(1);
		expect(standingRows(target)).toHaveLength(1);
		expect(
			rows(target)[0].querySelector('.qm-prose-placeholder')?.getAttribute('data-placeholder')
		).toBe(DEFAULT_VISUAL_STRINGS.arrayStanding);
		expect(errata(target).querySelector('.qm-remove')).toBeNull();

		press(rows(target)[0], 'Enter');
		press(rows(target)[0], 'Backspace');
		expect(literal(doc.getStored('errata'))).toBeUndefined();
		expect(changes).toHaveLength(0);
		expect(rows(target)).toHaveLength(1);
	});

	it('becomes the first element at its first edit, keeping its leaf', () => {
		const q = quill();
		const doc = emptied();
		const { target } = mountEditor(q, doc);

		const leaf = rows(target)[0];
		paste(leaf, 'Page 3 transposes two figures.');
		expect(literal(doc.getStored('errata'))).toEqual(['Page 3 transposes two figures.']);
		expect(rows(target)).toEqual([leaf]);
		expect(standingRows(target)).toHaveLength(0);
		expect(errata(target).querySelectorAll('.qm-remove')).toHaveLength(1);
	});

	it('stands again once the last element is removed', () => {
		const q = quill();
		const doc = example();
		q.writer(doc).set('errata', ['Only']);
		const { target } = mountEditor(q, doc);

		errata(target).querySelector<HTMLButtonElement>('.qm-remove')!.click();
		flushSync();
		expect(literal(doc.getStored('errata'))).toEqual([]);
		expect(standingRows(target)).toHaveLength(1);
		expect(rows(target)).toHaveLength(1);
	});
});
