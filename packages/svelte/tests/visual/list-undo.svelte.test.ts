// @vitest-environment jsdom
// A list's own undo: a change to its rows lives in no leaf's history, so ⌘/Ctrl+Z
// anywhere in the list takes the latest one back, and ⌘/Ctrl+Shift+Z puts it forward,
// while the rows stand where that change left them. An edit in a row since is the row's
// to undo first.
import { describe, it, expect, afterEach } from 'vitest';
import { tick } from 'svelte';
import { quill, example, literal } from '../helpers/fixtures.js';
import {
	mountEditor,
	openField,
	paste,
	press,
	settle,
	summaries,
	unmountAll
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const rows = (target: HTMLElement): HTMLElement[] => [
	...target.querySelectorAll<HTMLElement>('.ProseMirror[aria-label^="Errata "]')
];
const undo = (el: HTMLElement) => press(el, 'z', { ctrlKey: true, cancelable: true });
const redo = (el: HTMLElement) =>
	press(el, 'z', { ctrlKey: true, shiftKey: true, cancelable: true });

function open(errata: string[]) {
	const q = quill();
	const doc = example();
	q.writer(doc).set('errata', errata);
	const mounted = mountEditor(q, doc);
	const stored = () => literal(doc.getStored('errata'));
	return { ...mounted, q, doc, stored };
}

describe('a list’s undo', () => {
	it('takes a split back, the caret where it was, and redo splits again', async () => {
		const { target, editor, stored } = open(['abcdef', 'ghi']);
		await editor.setCaret({ field: 'main.errata[0]', pos: 3, granularity: 'cluster' });
		await tick();
		press(rows(target)[0], 'Enter', { cancelable: true });
		await settle();
		expect(stored()).toEqual(['abc', 'def', 'ghi']);

		undo(rows(target)[1]);
		await settle();
		expect(stored()).toEqual(['abcdef', 'ghi']);
		expect(rows(target).map((r) => r.textContent)).toEqual(['abcdef', 'ghi']);
		expect(document.activeElement).toBe(rows(target)[0]);
		expect(window.getSelection()?.anchorOffset).toBe(3);

		redo(rows(target)[0]);
		await settle();
		expect(stored()).toEqual(['abc', 'def', 'ghi']);
		expect(document.activeElement).toBe(rows(target)[1]);
	});

	it('takes a join back', async () => {
		const { target, editor, stored } = open(['abc', 'def', 'ghi']);
		await editor.setCaret({ field: 'main.errata[1]', pos: 0, granularity: 'cluster' });
		await tick();
		press(rows(target)[1], 'Backspace', { cancelable: true });
		await settle();
		expect(stored()).toEqual(['abcdef', 'ghi']);

		undo(rows(target)[0]);
		await settle();
		expect(stored()).toEqual(['abc', 'def', 'ghi']);
		expect(document.activeElement).toBe(rows(target)[1]);
	});

	it('takes a paste over several rows back whole, in one step', async () => {
		const { target, editor, stored } = open(['abcdef']);
		await editor.setCaret({ field: 'main.errata[0]', pos: 3, granularity: 'cluster' });
		await tick();
		paste(rows(target)[0], 'one\ntwo\nthree');
		await settle();
		expect(stored()).toEqual(['abcone', 'two', 'threedef']);

		undo(rows(target)[2]);
		await settle();
		expect(stored()).toEqual(['abcdef']);
		// The paste's first line left no step in the row's own history to undo again.
		undo(rows(target)[0]);
		await settle();
		expect(stored()).toEqual(['abcdef']);
	});

	it('takes a move back', async () => {
		const { target, stored } = open(['abc', 'def']);
		const first = rows(target)[0];
		first.focus();
		press(first, 'ArrowDown', { altKey: true, cancelable: true });
		await settle();
		expect(stored()).toEqual(['def', 'abc']);

		undo(first);
		await settle();
		expect(stored()).toEqual(['abc', 'def']);
		expect(rows(target)[0]).toBe(first);
	});

	it('takes an insert back, and the removal of an empty row', async () => {
		const { target, editor, stored } = open(['abc']);
		await editor.setCaret({ field: 'main.errata[0]', pos: 3, granularity: 'cluster' });
		await tick();
		press(rows(target)[0], 'Enter', { cancelable: true });
		await settle();
		expect(stored()).toEqual(['abc', '']);
		press(rows(target)[1], 'Backspace', { cancelable: true });
		await settle();
		expect(stored()).toEqual(['abc']);

		undo(rows(target)[0]);
		await settle();
		expect(stored()).toEqual(['abc', '']);
		undo(rows(target)[1]);
		await settle();
		expect(stored()).toEqual(['abc']);
	});

	it('leaves an edit typed since to the row, and takes the change once the row is back', async () => {
		const { target, editor, stored } = open(['abcdef']);
		await editor.setCaret({ field: 'main.errata[0]', pos: 3, granularity: 'cluster' });
		await tick();
		press(rows(target)[0], 'Enter', { cancelable: true });
		await settle();
		const lower = rows(target)[1];
		// jsdom types nothing through a contenteditable, so the edit goes in as a paste.
		paste(lower, 'X');
		await settle();
		expect(stored()).toEqual(['abc', 'Xdef']);

		undo(lower);
		await settle();
		expect(stored()).toEqual(['abc', 'def']);
		undo(lower);
		await settle();
		expect(stored()).toEqual(['abcdef']);
	});

	it('takes a table row added back once its cell is undone to empty', async () => {
		const q = quill();
		const doc = example();
		q.writer(doc).set('contributors', [{ name: 'Ada' }]);
		const { target, editor } = mountEditor(q, doc);
		const stored = () => literal(doc.getStored('contributors')) as unknown[];
		const cell = (row: number) =>
			target.querySelector<HTMLElement>(`.ProseMirror[aria-label="Contributors ${row} Name"]`)!;
		await editor.setCaret({ field: 'main.contributors[0].name', pos: 3, granularity: 'cluster' });
		await tick();
		press(cell(1), 'Enter', { cancelable: true });
		await settle();
		const added = stored();
		paste(cell(2), 'X');
		await settle();

		undo(cell(2));
		await settle();
		expect(stored()).toHaveLength(added.length);
		undo(cell(2));
		await settle();
		expect(stored()).toHaveLength(added.length - 1);
	});

	it('hands a row moved by its handle the focus, where undo takes the move back', async () => {
		const q = quill();
		const doc = example();
		doc.unchecked.storeField('revisions', [
			{ note: 'A', pages: 1 },
			{ note: 'B', pages: 2 }
		]);
		const { target } = mountEditor(q, doc);
		const order = () =>
			(q.reader(doc).get('revisions') as Array<{ note: string }>).map((r) => r.note);
		const arr = openField(target, q.schema.main, 'revisions');
		const rowsOf = () => [...arr.querySelectorAll<HTMLElement>('.qm-element')];
		rowsOf().forEach((row, i) => {
			row.getBoundingClientRect = () => ({ top: i * 50, bottom: i * 50 + 40 }) as DOMRect;
		});
		const grip = rowsOf()[0].querySelector<HTMLElement>('.qm-row-handle')!;
		const at = (type: string, y: number) =>
			grip.dispatchEvent(
				new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientY: y })
			);
		at('pointerdown', 20);
		at('pointermove', 70);
		at('pointerup', 70);
		await settle();
		expect(order()).toEqual(['B', 'A']);
		const moved = summaries(arr)[1];
		expect(document.activeElement).toBe(moved);

		undo(moved);
		await settle();
		expect(order()).toEqual(['A', 'B']);
	});
});
