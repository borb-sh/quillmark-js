// @vitest-environment jsdom
// The variant control: a discriminant select over `values:`, and under it the cells
// the chosen world brings into play. Driven off the reference quill's `distribution`
// field on disk — three members, one of them declaring no cells at all — as a pointer
// drives it, and read back through the document rather than off a captured callback.
//
// The claims that are the feature: a world's cells appear and retire with the pick,
// obligation is per world (`lift_on` is required on an embargoed document and exists
// nowhere else), an answer the discriminant strands is kept rather than dropped, and a
// content cell (`handling`'s two) is a leaf at the depth it sits.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { init, type Quill, type Document } from '@quillmark/wasm';
import VisualEditor from '$lib/visual/VisualEditor.svelte';
import { quill } from '../helpers/fixtures.js';

const core = await init();

Element.prototype.scrollIntoView ??= () => {};
Element.prototype.getAnimations ??= () => [];
// The rects a prose cell's view measures; jsdom implements neither.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
// jsdom implements no pointer-capture API, and the trigger probes for one before it
// opens (see enum-policy).
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
	return target;
}

function field(target: HTMLElement, label: string): HTMLElement {
	const match = [...target.querySelectorAll<HTMLElement>('.qm-field')].find(
		(f) => f.querySelector('.qm-field-label span')?.textContent === label
	);
	if (!match) throw new Error(`no field labelled ${label}`);
	return match;
}

/** Open the variant's discriminant list as a pointer opens it (see enum-policy). */
function openList(target: HTMLElement, name = 'Distribution'): void {
	const trigger = field(target, name).querySelector<HTMLElement>('.qm-select')!;
	trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
	trigger.click();
	flushSync();
}

function press(row: HTMLElement | undefined, what: string): void {
	if (!row) throw new Error(`no ${what} in the open list`);
	row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
	flushSync();
}

/** Pick a world by its option text. The sentinel is excluded by class rather than by
 *  text: it ghosts the resolved default, so its row reads `internal` too. */
function pickWorld(target: HTMLElement, text: string, name = 'Distribution'): void {
	openList(target, name);
	press(
		[...target.querySelectorAll<HTMLElement>('.qm-select-item')].find(
			(el) => !el.querySelector('.qm-select-ghost') && el.textContent?.trim() === text
		),
		`option ${text}`
	);
}

/** Pick the unset sentinel: the clear-back-to-default affordance. */
function clearWorld(target: HTMLElement, name = 'Distribution'): void {
	openList(target, name);
	press(
		[...target.querySelectorAll<HTMLElement>('.qm-select-item')].find((el) =>
			el.querySelector('.qm-select-ghost')
		),
		'unset sentinel'
	);
}

/** The drawn cells of the live world, label text in declaration order. The marker is
 *  a sibling node inside the label, so the text is normalized rather than compared
 *  raw: what the assertions are about is the name and its obligation, not the
 *  whitespace `FieldLabel`'s markup leaves between the two. */
function cellLabels(target: HTMLElement, name = 'Distribution'): string[] {
	return [
		...field(target, name).querySelectorAll<HTMLElement>('.qm-object-prop .qm-field-label')
	].map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

/** A cell's text input, by the label it sits under. */
function cellInput(target: HTMLElement, label: string): HTMLInputElement {
	const prop = [
		...field(target, 'Distribution').querySelectorAll<HTMLElement>('.qm-object-prop')
	].find((p) => p.querySelector('.qm-field-label')?.textContent?.trim().startsWith(label));
	const input = prop?.querySelector('input');
	if (!input) throw new Error(`no cell input under ${label}`);
	return input;
}

function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}

const stored = (doc: Document) => doc.getStored('distribution');

describe('a variant enum field', () => {
	it('draws the cells of the world the document renders as, and retires them on a flip', () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		// Unset: the ghosted `default:` is `internal`, which declares no cells. The drawn
		// world follows the ghost rather than nothing, so the form shows the cells the
		// document will actually print.
		expect(stored(doc)).toBeUndefined();
		expect(cellLabels(target)).toEqual([]);

		// `lift_on` declares no `default:` and is obliged; `held_by` declares `""` and is
		// not. The pair is what the axis buys: required *in this world*.
		pickWorld(target, 'embargoed');
		expect(cellLabels(target)).toEqual(['Lift on *', 'Held by']);

		// One world's cells are not the other's: the flip retires both and brings the
		// licence in, rather than accumulating a union of every world's fields.
		pickWorld(target, 'public');
		expect(cellLabels(target)).toEqual(['License']);

		pickWorld(target, 'internal');
		expect(cellLabels(target)).toEqual([]);
	});

	it('names an obliged cell through a real label, and says "required" on the marker', () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		pickWorld(target, 'embargoed');
		// A cell is named the way every other control on the surface is: a `<label for>`
		// pointing at it, so the name is the label's own text and there is no second
		// `aria-label` beside it for an implementation to have to choose between.
		const input = cellInput(target, 'Lift on');
		expect(input.getAttribute('aria-label')).toBeNull();
		const label = target.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`);
		expect(label?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Lift on *');
		// The glyph announces the word rather than the character, and it rides inside the
		// label so it names the control along with the text.
		expect(label?.querySelector('.qm-field-required')?.getAttribute('aria-label')).toBe('required');

		const unobliged = cellInput(target, 'Held by');
		expect(
			target
				.querySelector<HTMLLabelElement>(`label[for="${unobliged.id}"]`)
				?.querySelector('.qm-field-required')
		).toBeNull();
	});

	it('commits a cell into the container, keeping the discriminant beside it', () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		pickWorld(target, 'embargoed');
		expect(stored(doc)).toEqual({ value: 'embargoed' });

		type(cellInput(target, 'Lift on'), '2027-01-01');
		expect(stored(doc)).toEqual({ value: 'embargoed', lift_on: '2027-01-01' });

		// The container commits by value, so the cell beside it has to ride along.
		type(cellInput(target, 'Held by'), 'Legal');
		expect(stored(doc)).toEqual({
			value: 'embargoed',
			lift_on: '2027-01-01',
			held_by: 'Legal'
		});
	});

	it('keeps an answer the discriminant strands, through the flip and back', () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		pickWorld(target, 'embargoed');
		type(cellInput(target, 'Lift on'), '2027-01-01');

		// Flip away to compare: the boundary carries a stranded answer and warns rather
		// than dropping it, and the control does the same. Dropping here would spend the
		// answer on the ordinary gesture.
		pickWorld(target, 'internal');
		expect(cellLabels(target)).toEqual([]);
		expect(stored(doc)).toEqual({ value: 'internal', lift_on: '2027-01-01' });

		// And back: the answer is still the document's, so the cell re-draws filled.
		pickWorld(target, 'embargoed');
		expect(cellInput(target, 'Lift on').value).toBe('2027-01-01');
		expect(stored(doc)).toEqual({ value: 'embargoed', lift_on: '2027-01-01' });
	});

	it('clears the discriminant alone, and the whole field when it held nothing else', () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		// Nothing beside the discriminant: clearing leaves an empty container, which is
		// an unset field — removed, so the `default:` resolves at render rather than a
		// `{}` being written.
		pickWorld(target, 'public');
		expect(stored(doc)).toEqual({ value: 'public' });
		clearWorld(target);
		expect(stored(doc)).toBeUndefined();

		// With an answer beside it, clearing is the discriminant's own gesture: it takes
		// that cell and leaves the answer, for the same reason a flip does.
		pickWorld(target, 'embargoed');
		type(cellInput(target, 'Lift on'), '2027-01-01');
		clearWorld(target);
		expect(stored(doc)).toEqual({ lift_on: '2027-01-01' });
	});
});

// The reference quill's other variant, and the shape a real quill declares: the
// `default:` is the blank, the members are markings rather than ids, and the cells are
// prose. Driven off `handling` on disk exactly as the block above is driven off
// `distribution`.
describe('a variant whose default is the blank', () => {
	const held = (doc: Document) => doc.getStored('handling');
	const trigger = (target: HTMLElement) =>
		field(target, 'Handling').querySelector<HTMLElement>('.qm-select')!;

	it('draws the discriminant alone, ghosting the em dash the blank has no glyph for', () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		// The blank owns no world, so there is nothing under the select to draw — and
		// the ghost is the blank's own em dash rather than a member's name.
		expect(cellLabels(target, 'Handling')).toEqual([]);
		expect(trigger(target).textContent?.trim()).toBe('—');
		expect(trigger(target).hasAttribute('data-ghosted')).toBe(true);
		expect(held(doc)).toBeUndefined();
	});

	it('picks a member spelled as it is marked, spaces and all', () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		pickWorld(target, 'CLOSE HOLD', 'Handling');
		expect(held(doc)).toEqual({ value: 'CLOSE HOLD' });
		expect(trigger(target).textContent?.trim()).toBe('CLOSE HOLD');
		expect(trigger(target).hasAttribute('data-ghosted')).toBe(false);
		// A member declaring no cells draws none, blank default or not.
		expect(cellLabels(target, 'Handling')).toEqual([]);

		clearWorld(target, 'Handling');
		expect(held(doc)).toBeUndefined();
	});

	it('names its prose cells, marks the obliged one, and mounts a leaf in each', () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);

		pickWorld(target, 'CONTROLLED', 'Handling');
		// Obligation is per world and per cell: `controlled_by` declares no `default:`
		// and `caveat` declares the blank. `reviews` is the world's container cell, which
		// the subform recurses into rather than standing a line.
		expect(cellLabels(target, 'Handling')).toEqual(['Controlled by *', 'Caveat', 'Reviews']);

		// A content cell is a leaf like any other, at the depth it sits: the cell mounts
		// the prose leaf its scalar field mounts, named by the label beside it.
		const cells = [
			...field(target, 'Handling').querySelectorAll<HTMLElement>('.qm-object-prop')
		].filter((c) => c.querySelector('.ProseMirror'));
		expect(cells).toHaveLength(2);
		for (const cell of cells) {
			const leaf = cell.querySelector<HTMLElement>('.ProseMirror');
			const named = cell.querySelector<HTMLElement>('.qm-field-label span');
			expect(leaf!.getAttribute('aria-labelledby')).toBe(named?.parentElement?.id);
		}
		// The pick is still the whole of what the discriminant commits: a cell rests
		// only once it is written.
		expect(held(doc)).toEqual({ value: 'CONTROLLED' });
	});

	// The read the cells mount over, at the depth they sit: `schema_at` steps a
	// variant's key, so a stored cell decodes at the codec its own type declares
	// rather than answering `edit::field_not_content` for the `enum` above it.
	it('reads a stored cell at its own codec, and rests an edited one back at it', () => {
		const q = quill();
		const doc = q.seedDocument();
		q.writer(doc).set('handling', {
			value: 'CONTROLLED',
			controlled_by: 'SPEC/AA',
			caveat: 'no *markup*, just text'
		});
		const target = mountEditor(q, doc);

		const leaves = [
			...field(target, 'Handling').querySelectorAll<HTMLElement>('.qm-object-prop .ProseMirror')
		];
		expect(leaves.map((l) => l.textContent)).toEqual(['SPEC/AA', 'no *markup*, just text']);
		// `plaintext`, so the asterisks are characters and nothing was lowered from them.
		expect(leaves[1].querySelector('em, strong')).toBeNull();

		// The write is the other lane: the container commits whole, and the typed writer
		// rests a cell's `Content` back as the literal string the codec names. (jsdom
		// implements no contenteditable, so the keystroke that produces one is out of
		// reach here, as it is for an array's prose row.)
		q.writer(doc).set('handling', {
			value: 'CONTROLLED',
			controlled_by: core.importMarkdown('SPEC/BB'),
			caveat: ''
		});
		expect(held(doc)).toEqual({ value: 'CONTROLLED', controlled_by: 'SPEC/BB', caveat: '' });
	});
});
