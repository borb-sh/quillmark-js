// @vitest-environment jsdom
// The matrix control: grouped ticks over the whole vocabulary, columns unfolding under a
// held member. Driven off the reference quill's `qualifications` on disk — five members in
// three blocks, two columns — and read back through the document, which is where the
// sparse map and the two rest forms are the assertion.
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
	return target;
}

const matrix = (target: HTMLElement): HTMLElement =>
	target.querySelector<HTMLElement>('.qm-matrix')!;
/** One member's box, by the title beside its tick. */
function member(target: HTMLElement, title: string): HTMLElement {
	const match = [...matrix(target).querySelectorAll<HTMLElement>('.qm-matrix-member')].find(
		(m) => m.querySelector('.qm-matrix-title')?.textContent?.trim() === title
	);
	if (!match) throw new Error(`no member ${title}`);
	return match;
}
const box = (target: HTMLElement, title: string): HTMLInputElement =>
	member(target, title).querySelector<HTMLInputElement>('input[type=checkbox]')!;

function toggle(el: HTMLInputElement, on: boolean): void {
	el.checked = on;
	el.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}
function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}
/** A held member's column control, by the label above it. */
function column(target: HTMLElement, title: string, label: string): HTMLInputElement {
	const prop = [...member(target, title).querySelectorAll<HTMLElement>('.qm-object-prop')].find(
		(p) => p.querySelector('.qm-field-label span')?.textContent === label
	);
	const input = prop?.querySelector('input');
	if (!input) throw new Error(`no column ${label} under ${title}`);
	return input;
}

const stored = (doc: Document) => doc.getStored('qualifications') as Record<string, unknown>;

describe('the matrix control', () => {
	it('draws the whole vocabulary in its groups, ticked from the document', () => {
		const q = quill();
		const doc = q.seedDocument();
		// A document through the transport door has been conformed through nothing: the
		// bare `true` is the spelling key-presence-is-the-tick leaves behind.
		q.writer(doc).set('qualifications', { cyber_200: true });
		const target = mountEditor(q, doc);

		const groups = [...matrix(target).querySelectorAll<HTMLElement>('.qm-matrix-group')];
		expect(groups.map((g) => g.querySelector('.qm-matrix-group-label')?.textContent)).toEqual([
			'Operations',
			'Training',
			undefined
		]);
		expect(
			[...matrix(target).querySelectorAll('.qm-matrix-title')].map((t) => t.textContent?.trim())
		).toEqual(['Flight CC', 'DODIN Ops', 'Cyber 200', 'Cyber 300', 'Instructor']);

		// A roster the page prints in full: every member draws, held or not.
		expect(box(target, 'Cyber 200').checked).toBe(true);
		expect(box(target, 'Flight CC').checked).toBe(false);
		// The count sits where an array's add chip sits.
		expect(matrix(target).querySelector('.qm-matrix-count')?.textContent).toBe('1 of 5 held');
	});

	it('unfolds a held member’s columns, and nothing under an unheld one', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		expect(member(target, 'Flight CC').querySelector('.qm-object')).toBeNull();
		toggle(box(target, 'Flight CC'), true);
		await tick();
		// A tick with no column written is the member object at its tick alone.
		expect(stored(doc)).toEqual({ flight_cc: { held: true } });
		expect(member(target, 'Flight CC').querySelector('.qm-object')).not.toBeNull();

		type(column(target, 'Flight CC', 'Year'), '2024');
		await tick();
		expect(stored(doc)).toEqual({ flight_cc: { held: true, year: 2024 } });
	});

	it('keeps an unticked member’s columns in the document and off the page', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		toggle(box(target, 'Cyber 300'), true);
		type(column(target, 'Cyber 300', 'Year'), '2019');
		await tick();
		expect(stored(doc)).toEqual({ cyber_300: { held: true, year: 2019 } });

		// An untick writes `held: false` and keeps the answer: tick, type, untick, retick
		// loses nothing.
		toggle(box(target, 'Cyber 300'), false);
		await tick();
		expect(stored(doc)).toEqual({ cyber_300: { held: false, year: 2019 } });
		expect(member(target, 'Cyber 300').querySelector('.qm-object')).toBeNull();

		toggle(box(target, 'Cyber 300'), true);
		await tick();
		expect(column(target, 'Cyber 300', 'Year').value).toBe('2019');
	});

	it('commits a sparse map, and unsets the field once it holds nothing', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);
		expect(stored(doc)).toBeUndefined();

		toggle(box(target, 'Instructor'), true);
		await tick();
		expect(Object.keys(stored(doc))).toEqual(['instructor']);

		// Unheld with no column written is absent from the map, and a map holding nothing
		// is an unset field: the `default:` resolves at render rather than a `{}` being
		// written, the unset rung every other control shares.
		toggle(box(target, 'Instructor'), false);
		await tick();
		expect(doc.getStored('qualifications')).toBeUndefined();
	});

	it('reads the tick at the floor\u2019s own coercion, not against `false` alone', async () => {
		const q = quill();
		const doc = q.seedDocument();
		// The quill-free store lane leaves a value exactly as it arrived, which is what
		// this control reads: the engine resolves `0` and `"false"` to an unheld member,
		// and a read testing identity against `false` drew both ticked.
		doc.storeField('qualifications', {
			flight_cc: { held: 0, year: 9 },
			dodin_ops: { held: 'false' },
			cyber_200: 0,
			cyber_300: 1,
			instructor: { year: 4 }
		});
		const target = mountEditor(q, doc);

		expect(box(target, 'Flight CC').checked).toBe(false);
		expect(box(target, 'DODIN Ops').checked).toBe(false);
		expect(box(target, 'Cyber 200').checked).toBe(false);
		expect(box(target, 'Cyber 300').checked).toBe(true);
		// Key presence is the tick: a mapping naming no `held` is held.
		expect(box(target, 'Instructor').checked).toBe(true);
		expect(matrix(target).querySelector('.qm-matrix-count')?.textContent).toBe('2 of 5 held');

		// An unheld member unfolds nothing, which is what keeps a column edit from
		// landing `held: true` on a member the document said was not held: the subform the
		// edit would come from is not mounted over it.
		expect(member(target, 'Flight CC').querySelector('.qm-object')).toBeNull();
		expect(member(target, 'Cyber 300').querySelector('.qm-object')).not.toBeNull();
	});

	it('names each tick by a real label, and walks a group with the arrow keys', () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		const tick = box(target, 'DODIN Ops');
		const label = member(target, 'DODIN Ops').querySelector('label')!;
		expect(label.getAttribute('for')).toBe(tick.id);
		expect(tick.hasAttribute('aria-label')).toBe(false);

		box(target, 'Flight CC').focus();
		box(target, 'Flight CC').dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
		);
		flushSync();
		expect(document.activeElement).toBe(box(target, 'DODIN Ops'));

		// A group is a list, not a ring: the walk clamps rather than crossing a heading
		// the arrow never named.
		box(target, 'DODIN Ops').dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
		);
		flushSync();
		expect(document.activeElement).toBe(box(target, 'DODIN Ops'));
	});
});
