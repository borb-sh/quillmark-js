// @vitest-environment jsdom
// Reorder on an `object` row (VISUAL_EDITOR §"Settled and open"): a drag handle on the
// row's head, and Alt+↑/↓ from anywhere in the row as the keyboard twin, the nearest row
// answering. One splice of the ids and the values together, then the array commits
// whole, so the element keeps its id and everything mounted under it. Driven off the
// reference quill's `revisions` with three rows, and off `appendices` for a row inside a
// row.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { Document, Quill } from '@quillmark/wasm';
import { quill, example } from '../helpers/fixtures.js';
import {
	field,
	mountEditor,
	openGroup,
	press,
	settle,
	summaries,
	summaryTexts,
	unmountAll
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

function threeRows(q: Quill): Document {
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

function revisions(target: HTMLElement): HTMLElement {
	openGroup(target, 'Metadata');
	return field(target, 'Revisions');
}
const rows = (arr: HTMLElement) => [...arr.querySelectorAll<HTMLElement>('.qm-element')];
const handle = (arr: HTMLElement, k: number) =>
	rows(arr)[k].querySelector<HTMLElement>('.qm-row-handle')!;
/** Stand the rows 40px tall and 10px apart from the top, which jsdom lays out as none. */
function layOut(arr: HTMLElement): void {
	rows(arr).forEach((row, i) => {
		const top = i * 50;
		row.getBoundingClientRect = () => ({ top, bottom: top + 40 }) as DOMRect;
	});
}
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
		const doc = threeRows(q);
		const mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		layOut(arr);
		expect(summaryTexts(arr)).toEqual(['A', 'B', 'C']);
		const grip = handle(arr, 0);
		// Pointer-only: nothing a screen reader reaches, the summary announcing the keys.
		expect(grip.tabIndex).toBe(-1);
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
		const doc = threeRows(q);
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

	it('re-picks the drop as the rows scroll under a held drag, and scrolls at the edge', () => {
		const q = quill();
		const doc = threeRows(q);
		const mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		layOut(arr);
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
		const page = document.scrollingElement ?? document.documentElement;
		let scrolled = 0;
		Object.defineProperty(page, 'scrollTop', {
			configurable: true,
			get: () => scrolled,
			set: (v: number) => (scrolled = v)
		});
		try {
			const grip = handle(arr, 0);
			const at = (type: string, y: number) =>
				grip.dispatchEvent(new PointerEvent(type, { bubbles: true, clientY: y }));
			at('pointerdown', 20);
			at('pointermove', 70);
			flushSync();
			expect(rows(arr)[1].dataset.drop).toBe('after');

			// A scroll by any hand moves the rows under a still pointer.
			rows(arr).forEach((row, i) => {
				const top = i * 50 - 50;
				row.getBoundingClientRect = () => ({ top, bottom: top + 40 }) as DOMRect;
			});
			arr.dispatchEvent(new Event('scroll'));
			flushSync();
			expect(rows(arr)[2].dataset.drop).toBe('after');

			// Held at the page's bottom edge, each frame scrolls it on; nowhere near, none.
			at('pointermove', innerHeight - 1);
			frames.splice(0).forEach((f) => f(0));
			expect(scrolled).toBeGreaterThan(0);
			const held = scrolled;
			at('pointermove', innerHeight / 2);
			frames.splice(0).forEach((f) => f(0));
			expect(scrolled).toBe(held);

			at('pointerup', innerHeight / 2);
			flushSync();
			expect(order(q, doc)).toEqual(['B', 'C', 'A']);
		} finally {
			vi.unstubAllGlobals();
			delete (page as { scrollTop?: number }).scrollTop;
		}
	});

	it('moves nothing on a press that stays in the dead zone, or a drop on its own row', () => {
		const q = quill();
		const doc = threeRows(q);
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
		const doc = threeRows(q);
		const mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		summaries(arr)[1].click();
		flushSync();
		const input = arr.querySelector<HTMLInputElement>('.qm-element.open input[type="text"]')!;
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
		const doc = threeRows(q);
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
		const doc = threeRows(q);
		const mounted = mountEditor(q, doc);
		const arr = revisions(mounted.target);
		summaries(arr)[0].click();
		flushSync();
		const input = arr.querySelector<HTMLInputElement>('.qm-element.open input[type="text"]')!;
		expect(input.value).toBe('A');

		layOut(arr);
		dragHandle(handle(arr, 0), [20, 70]);
		// The keyed row moved as one node: the subform's input is the same element.
		expect(arr.querySelector('.qm-element.open input[type="text"]')).toBe(input);
		expect(order(q, doc)).toEqual(['B', 'A', 'C']);
	});

	it('answers from the nearest row alone: a press in a nested row leaves the record around it', () => {
		const q = quill();
		const doc = example();
		const mounted = mountEditor(q, doc);
		openGroup(mounted.target, 'Content');
		const outer = field(mounted.target, 'Appendices');
		summaries(outer)[0].click();
		flushSync();
		// The open appendix's own list, a rung in: its rows are its own, not this field's.
		const inner = outer.querySelector<HTMLElement>('.qm-element.open .qm-array')!;
		expect(summaryTexts(inner)).toEqual(['Primary', 'Secondary']);
		const n = mounted.changes.length;

		press(summaries(inner)[0], 'ArrowDown', { altKey: true });
		flushSync();
		expect(summaryTexts(inner)).toEqual(['Secondary', 'Primary']);
		expect(summaryTexts(outer)).toEqual(['Sources', 'Glossary']);
		// One move, one commit: the key reached the appendix row and was not its to answer.
		expect(mounted.changes.length).toBe(n + 1);
	});

	it('offers no reorder on a scalar or prose row', () => {
		const q = quill();
		const mounted = mountEditor(q, example());
		// `authors` is `string[]` and `keywords` `richtext[]`: edit-in-place rows.
		for (const name of ['Authors', 'Keywords']) {
			openGroup(mounted.target, name === 'Authors' ? 'Who and what' : 'Content');
			const f = field(mounted.target, name);
			expect(f.querySelectorAll('.qm-row-handle')).toHaveLength(0);
			expect(f.querySelectorAll('.qm-row-btn.qm-remove').length).toBeGreaterThan(0);
		}
	});
});
