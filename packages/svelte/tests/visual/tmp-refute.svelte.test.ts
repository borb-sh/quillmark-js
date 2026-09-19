// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import { init, type Document, type Quill } from '@quillmark/wasm';
import VisualEditor from '$lib/visual/VisualEditor.svelte';
import { quill } from '../helpers/fixtures.js';

await init();

Element.prototype.scrollIntoView ??= () => {};
Element.prototype.getAnimations ??= () => [];
Element.prototype.animate ??= () => ({}) as Animation;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
Element.prototype.hasPointerCapture ??= () => false;

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

function mountEditor(q: Quill, doc: Document) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(VisualEditor, { target, props: { doc, quill: q } });
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
	};
	return { target };
}
function field(target: HTMLElement, label: string): HTMLElement {
	return [...target.querySelectorAll<HTMLElement>('.qm-field')].find(
		(f) => f.querySelector('.qm-field-label span')?.textContent === label
	)!;
}
const rows = (root: HTMLElement): HTMLElement[] => [
	...root.querySelectorAll<HTMLElement>(':scope > .qm-array-rows > .qm-array-row')
];
function nested(row: HTMLElement, label: string): HTMLElement {
	return [...row.querySelectorAll<HTMLElement>('.qm-array')].find(
		(a) => a.querySelector('.qm-field-label span')?.textContent === label
	)!;
}
function open(root: HTMLElement, k: number): HTMLElement {
	const row = rows(root)[k];
	if (!row.classList.contains('open')) {
		(row.querySelector('.qm-element-summary') as HTMLElement).click();
		flushSync();
	}
	return rows(root)[k];
}
function cell(root: HTMLElement, label: string): HTMLElement {
	return [...root.querySelectorAll<HTMLElement>('.qm-object-prop')].find(
		(p) => p.querySelector('.qm-field-label span')?.textContent === label
	)!;
}
const vectorsOf = (doc: Document) =>
	doc.getStored('vectors') as { name?: string; tours?: { title?: string }[] }[] | undefined;

function seed(q: Quill, doc: Document): void {
	q.writer(doc).set('vectors', [
		{ name: 'Alpha', tours: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }] }
	]);
}

describe('REFUTE: Alt+Arrow from a table row Title cell', () => {
	it('moves the row', async () => {
		const q = quill();
		const doc = q.seedDocument();
		seed(q, doc);
		const { target } = mountEditor(q, doc);
		const tours = nested(
			open(field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!, 0),
			'Tours'
		);
		const titles = () =>
			(vectorsOf(doc)![0].tours ?? []).map((t) => (t as { title?: unknown }).title);
		expect(titles()).toEqual(['One', 'Two', 'Three']);
		expect(rows(tours)[0].classList.contains('qm-table-row')).toBe(true);
		// The handler is on the table row, not only on the collapsed summary.
		expect(rows(tours)[0].querySelector('.qm-element-summary')).toBeNull();

		// The deepest node inside the Title cell: the prose leaf's contenteditable.
		const titleCell = cell(rows(tours)[0], 'Title');
		const caretHost =
			titleCell.querySelector<HTMLElement>('[contenteditable]') ??
			titleCell.querySelector<HTMLElement>('input, textarea')!;
		expect(caretHost).toBeTruthy();
		caretHost.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true })
		);
		flushSync();
		await tick();
		expect(titles()).toEqual(['Two', 'One', 'Three']);

		// And the Season cell (a form control) too, downward from row 2.
		const seasonHost = cell(rows(tours)[2], 'Season').querySelector<HTMLElement>(
			'select, input, button, [contenteditable]'
		)!;
		seasonHost.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true })
		);
		flushSync();
		await tick();
		expect(titles()).toEqual(['Two', 'Three', 'One']);
	});
});
