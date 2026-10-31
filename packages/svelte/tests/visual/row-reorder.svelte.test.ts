// @vitest-environment jsdom
// Reorder on an `object` row (VISUAL_EDITOR §"Settled and open"): a drag handle on the
// row's head, and Alt+↑/↓ from anywhere in the row as the keyboard twin, the nearest row
// answering. One splice of the ids and the values together, then the array commits
// whole, so the element keeps its id and everything mounted under it. Driven off the
// reference quill's `revisions` with three rows, and off `appendices` for a row inside a
// row.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { Document, Quill } from '@quillmark/wasm';
import { quill, example } from '../helpers/fixtures.js';
import {
	mountEditor,
	openField,
	press,
	settle,
	summaries,
	summaryTexts,
	unmountAll
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

function threeRows(): Document {
	const doc = example();
	doc.storeField('revisions', [
		{ note: 'A', pages: 1 },
		{ note: 'B', pages: 2 },
		{ note: 'C', pages: 3 }
	]);
	return doc;
}
const order = (q: Quill, doc: Document) =>
	(q.reader(doc).get('revisions') as Array<{ note: string }>).map((r) => r.note);

const revisions = (target: HTMLElement) => openField(target, quill().schema.main, 'revisions');
const rows = (arr: HTMLElement) => [...arr.querySelectorAll<HTMLElement>('.qm-element')];
const handle = (arr: HTMLElement, k: number) =>
	rows(arr)[k].querySelector<HTMLElement>('.qm-row-handle')!;
/** Stand the rows 40px tall at `tops`, which jsdom lays out as none. */
function stand(arr: HTMLElement, tops: number[]): void {
	rows(arr).forEach((row, i) => {
		const top = tops[i];
		row.getBoundingClientRect = () => ({ top, bottom: top + 40 }) as DOMRect;
	});
}
/** The rows 10px apart from the top. */
const layOut = (arr: HTMLElement) => stand(arr, [0, 50, 100]);
/** Drive a handle drag: the press, the travel and the release, all on the handle, which
 *  holds the pointer once pressed. jsdom implements no pointer capture. */
function dragHandle(el: HTMLElement, ys: number[], end = 'pointerup'): void {
	const at = (type: string, y: number) =>
		el.dispatchEvent(
			new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientY: y })
		);
	at('pointerdown', ys[0]);
	for (const y of ys.slice(1)) at('pointermove', y);
	flushSync();
	at(end, ys[ys.length - 1]);
	flushSync();
}

describe('reorder on an object row', () => {
	it('moves the row by its handle onto the row it is dropped on, and commits the order', () => {
		const q = quill();
		const doc = threeRows();
		const mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		layOut(arr);
		expect(summaryTexts(arr)).toEqual(['A', 'B', 'C']);
		const grip = handle(arr, 0);
		// Pointer-only: nothing a screen reader reaches, the summary declaring the keys.
		expect(grip.getAttribute('aria-hidden')).toBe('true');
		expect(summaries(arr)[0].getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp Alt+ArrowDown');

		dragHandle(grip, [20, 70, 120]);
		expect(order(q, doc)).toEqual(['B', 'C', 'A']);
		expect(summaryTexts(arr)).toEqual(['B', 'C', 'A']);
		expect(mounted.changes.at(-1)).toMatchObject({ source: 'field', path: 'main.revisions' });
		// Past either end lands at that end.
		layOut(arr);
		dragHandle(handle(arr, 2), [120, -300]);
		expect(order(q, doc)).toEqual(['A', 'B', 'C']);
	});

	it('marks the lifted row and the drop while the drag is held, and leaves no trace', () => {
		const q = quill();
		const doc = threeRows();
		const mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		layOut(arr);
		const grip = handle(arr, 0);
		grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 20 }));
		grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 70 }));
		flushSync();
		expect(rows(arr)[0].classList.contains('lifted')).toBe(true);
		expect(rows(arr)[1].dataset.drop).toBe('after');
		grip.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, clientY: 70 }));
		flushSync();
		expect(order(q, doc)).toEqual(['A', 'B', 'C']);
		expect(arr.querySelector('.lifted, [data-drop]')).toBeNull();
	});

	it('re-picks the drop as the rows scroll under a held drag', () => {
		const q = quill();
		const doc = threeRows();
		const mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		layOut(arr);
		const grip = handle(arr, 0);
		const at = (type: string, y: number) =>
			grip.dispatchEvent(new PointerEvent(type, { bubbles: true, clientY: y }));
		at('pointerdown', 20);
		at('pointermove', 70);
		flushSync();
		expect(rows(arr)[1].dataset.drop).toBe('after');

		// A scroll by any hand moves the rows under a still pointer.
		stand(arr, [-50, 0, 50]);
		arr.dispatchEvent(new Event('scroll'));
		flushSync();
		expect(rows(arr)[2].dataset.drop).toBe('after');
		at('pointerup', 70);
		flushSync();
		expect(order(q, doc)).toEqual(['B', 'C', 'A']);
	});

	describe('held at the edge', () => {
		const frames: FrameRequestCallback[] = [];
		const run = () => frames.splice(0).forEach((f) => f(0));
		let scrolled = 0;
		const page = () => document.scrollingElement ?? document.documentElement;
		beforeEach(() => {
			scrolled = 0;
			vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
			page().scrollBy = ((o: ScrollToOptions) => (scrolled += o.top ?? 0)) as Element['scrollBy'];
		});
		afterEach(() => {
			frames.length = 0;
			vi.unstubAllGlobals();
			delete (page() as Partial<Element>).scrollBy;
		});
		function lastRowPastTheFold() {
			const q = quill();
			const doc = threeRows();
			const arr = revisions(mountEditor(q, doc).target);
			stand(arr, [innerHeight - 140, innerHeight - 90, innerHeight - 30]);
			const grip = handle(arr, 2);
			const at = (type: string, y: number) =>
				grip.dispatchEvent(new PointerEvent(type, { bubbles: true, clientY: y }));
			return { q, doc, arr, at };
		}

		it('scrolls toward the rows out of view once the pointer has left the edge', () => {
			const { at } = lastRowPastTheFold();
			// Pressed in the band: nothing scrolls until the pointer has been out of it.
			at('pointerdown', innerHeight - 20);
			at('pointermove', innerHeight - 26);
			run();
			expect(scrolled).toBe(0);
			at('pointermove', innerHeight / 2);
			run();
			at('pointermove', innerHeight - 1);
			run();
			expect(scrolled).toBeGreaterThan(0);
			const held = scrolled;
			at('pointermove', innerHeight / 2);
			run();
			expect(scrolled).toBe(held);
			at('pointerup', innerHeight / 2);
		});

		it('scrolls nothing past the end of the list', () => {
			const { arr, at } = lastRowPastTheFold();
			stand(arr, [100, 150, 200]);
			at('pointerdown', 210);
			at('pointermove', innerHeight / 2);
			run();
			at('pointermove', innerHeight - 1);
			run();
			expect(scrolled).toBe(0);
			at('pointerup', innerHeight - 1);
		});

		it('ends the drag with no move when the handle loses the pointer', () => {
			const { q, doc, arr, at } = lastRowPastTheFold();
			at('pointerdown', innerHeight - 20);
			at('pointermove', innerHeight / 2);
			run();
			at('pointermove', innerHeight - 1);
			at('lostpointercapture', innerHeight - 1);
			flushSync();
			run();
			expect(frames).toHaveLength(0);
			expect(scrolled).toBe(0);
			expect(arr.querySelector('.lifted, [data-drop]')).toBeNull();
			expect(order(q, doc)).toEqual(['A', 'B', 'C']);
		});
	});

	it('moves nothing on a press that stays in the dead zone, or a drop on its own row', () => {
		const q = quill();
		const doc = threeRows();
		const mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		layOut(arr);
		const n = mounted.changes.length;
		dragHandle(handle(arr, 1), [70, 72]);
		dragHandle(handle(arr, 1), [70, 30, 75]);
		expect(order(q, doc)).toEqual(['A', 'B', 'C']);
		expect(mounted.changes).toHaveLength(n);
	});

	it('leaves a key a cell already took to that cell', () => {
		const q = quill();
		const doc = threeRows();
		const mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		summaries(arr)[1].click();
		flushSync();
		const input = arr.querySelector<HTMLInputElement>(
			'.qm-element.open input[inputmode="numeric"]'
		)!;
		// Cancelable, as a key off the keyboard is, so the cell's `preventDefault` lands.
		input.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
		press(input, 'ArrowDown', { altKey: true, cancelable: true });
		expect(order(q, doc)).toEqual(['A', 'B', 'C']);

		// Alt with another modifier is a different chord, not the reorder.
		press(input, 'ArrowDown', { altKey: true, shiftKey: true, cancelable: true });
		expect(order(q, doc)).toEqual(['A', 'B', 'C']);
		press(input, 'ArrowDown', { altKey: true, cancelable: true });
		expect(order(q, doc)).toEqual(['A', 'C', 'B']);
	});

	it('moves the row by Alt+arrow from its summary, and keeps the open row open', async () => {
		const q = quill();
		const doc = threeRows();
		const mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);

		// Open the middle row, then move it up from its own summary.
		const summary = summaries(arr)[1];
		summary.click();
		flushSync();
		expect(arr.querySelector('.qm-element.open .qm-element-title')?.textContent).toBe('B');
		summary.focus();
		press(summary, 'ArrowUp', { altKey: true });
		expect(order(q, doc)).toEqual(['B', 'A', 'C']);
		// The same row, still open, now first: the id moved with the value.
		expect(arr.querySelectorAll('.qm-element.open')).toHaveLength(1);
		expect(arr.querySelector('.qm-element.open .qm-element-title')?.textContent).toBe('B');
		expect(summaries(arr)[0]).toBe(summary);
		await settle();
		expect(document.activeElement).toBe(summary);

		// A bare arrow is not the gesture: the summary's own keys are untouched.
		press(summary, 'ArrowDown');
		expect(order(q, doc)).toEqual(['B', 'A', 'C']);
		// At the edge the move is a no-op that commits nothing.
		const before = mounted.changes.length;
		press(summary, 'ArrowUp', { altKey: true });
		expect(order(q, doc)).toEqual(['B', 'A', 'C']);
		expect(mounted.changes).toHaveLength(before);
	});

	it("keeps the open row's subform mounted across its own move", () => {
		const q = quill();
		const doc = threeRows();
		const mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		summaries(arr)[0].click();
		flushSync();
		const note = arr.querySelector<HTMLElement>(
			'.qm-element.open [data-qm-prop="note"] .ProseMirror'
		)!;
		expect(note.textContent).toBe('A');

		layOut(arr);
		dragHandle(handle(arr, 0), [20, 70]);
		// The keyed row moved as one node: the subform's leaf is the same element.
		expect(arr.querySelector('.qm-element.open [data-qm-prop="note"] .ProseMirror')).toBe(note);
		expect(order(q, doc)).toEqual(['B', 'A', 'C']);
	});

	it('answers from the nearest row alone: a press in a nested row leaves the record around it', () => {
		const q = quill();
		const doc = example();
		const mounted = mountEditor(q, doc);
		const outer = openField(mounted.target, q.schema.main, 'appendices');
		summaries(outer)[0].click();
		flushSync();
		// The open appendix's own list, a rung in: its rows are its own, not this field's.
		const inner = outer.querySelector<HTMLElement>('.qm-element.open .qm-array')!;
		const [first, second] = summaryTexts(inner);
		const appendices = summaryTexts(outer);
		const n = mounted.changes.length;

		press(summaries(inner)[0], 'ArrowDown', { altKey: true });
		flushSync();
		expect(summaryTexts(inner)).toEqual([second, first]);
		expect(summaryTexts(outer)).toEqual(appendices);
		// One move, one commit: the key reached the appendix row and was not its to answer.
		expect(mounted.changes.length).toBe(n + 1);
	});

	it('offers no reorder on a scalar or prose row', () => {
		const q = quill();
		const mounted = mountEditor(q, example());
		// `authors` is `text[]` and `keywords` `richtext[]`: edit-in-place rows.
		for (const name of ['authors', 'keywords']) {
			const f = openField(mounted.target, q.schema.main, name);
			expect(f.querySelectorAll('.qm-row-handle')).toHaveLength(0);
			expect(f.querySelectorAll('.qm-row-btn.qm-remove').length).toBeGreaterThan(0);
		}
	});
});
