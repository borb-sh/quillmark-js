// @vitest-environment jsdom
// The mirror at the schema's depth: a subform recursing into a nested `array` /
// `object` rather than standing a line, the row reorder and the row summary over it, the
// grid arm a short-celled row asks for, the cap on an array, and a landing that resolves
// the whole path instead of one trailing index.
//
// Driven off the reference quill on disk — `vectors`, a record holding a repeater of its
// own, and `handling`'s `CONTROLLED` world, a container inside a variant's cell — and read
// back through the document rather than off a captured callback: the assertion is what the
// boundary holds after the gesture, which is what a host recompiles from.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import { init, type Document, type Quill } from '@quillmark/wasm';
import VisualEditor from '$lib/visual/VisualEditor.svelte';
import { quill } from '../helpers/fixtures.js';

const core = await init();

Element.prototype.scrollIntoView ??= () => {};
Element.prototype.getAnimations ??= () => [];
// The wash is `Element.animate`, which jsdom does not implement: a run that never
// finishes leaves the node in place, which is what the granularity assertion reads.
Element.prototype.animate ??= () => ({}) as Animation;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
Element.prototype.hasPointerCapture ??= () => false;

interface EditorRef {
	focusField(field: string): Promise<void>;
	setCaret(at: { field: string; pos?: number }): Promise<void>;
}

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

function mountEditor(q: Quill, doc: Document) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(VisualEditor, { target, props: { doc, quill: q } }) as unknown as EditorRef;
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
	};
	return { target, editor: app };
}

function field(target: HTMLElement, label: string): HTMLElement {
	const match = [...target.querySelectorAll<HTMLElement>('.qm-field')].find(
		(f) => f.querySelector('.qm-field-label span')?.textContent === label
	);
	if (!match) throw new Error(`no field labelled ${label}`);
	return match;
}

/** The rows of the repeater `root` holds, outermost first: a row is a box whatever
 *  figure it draws in. */
const rows = (root: HTMLElement): HTMLElement[] => [
	...root.querySelectorAll<HTMLElement>(':scope > .qm-array-rows > .qm-array-row')
];
/** The repeater one rung inside an open row, by the label its own track draws. */
function nested(row: HTMLElement, label: string): HTMLElement {
	const match = [...row.querySelectorAll<HTMLElement>('.qm-array')].find(
		(a) => a.querySelector('.qm-field-label span')?.textContent === label
	);
	if (!match) throw new Error(`no nested repeater labelled ${label}`);
	return match;
}
const summaries = (root: HTMLElement): string[] =>
	rows(root).map((r) => r.querySelector('.qm-element-title')?.textContent?.trim() ?? '');
const addChip = (root: HTMLElement): HTMLButtonElement =>
	root.querySelector<HTMLButtonElement>(':scope > .qm-array-header .qm-add-el')!;

function click(el: Element | null | undefined): void {
	(el as HTMLElement).click();
	flushSync();
}
/** Open a collapsed row by its summary, which is the control the press lands on. */
function open(root: HTMLElement, k: number): HTMLElement {
	const row = rows(root)[k];
	if (!row.classList.contains('open')) click(row.querySelector('.qm-element-summary'));
	return rows(root)[k];
}
function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}
/** A cell's own control inside a subform, by the property label above it. */
function cell(root: HTMLElement, label: string): HTMLElement {
	const prop = [...root.querySelectorAll<HTMLElement>('.qm-object-prop')].find(
		(p) => p.querySelector('.qm-field-label span')?.textContent === label
	);
	if (!prop) throw new Error(`no cell labelled ${label}`);
	return prop;
}

const vectorsOf = (doc: Document) =>
	doc.getStored('vectors') as { name?: string; tours?: { title?: string }[] }[] | undefined;

/** Seed `vectors` with `n` strands, each carrying `tours` titles, through the boundary —
 *  the state a document arrives in, rather than one the editor typed itself. */
function seedVectors(q: Quill, doc: Document, strands: { name: string; tours?: string[] }[]): void {
	q.writer(doc).set(
		'vectors',
		strands.map((s) => ({
			name: s.name,
			tours: (s.tours ?? []).map((t) => ({ title: t }))
		}))
	);
}

describe('a subform at depth', () => {
	it('recurses into a nested repeater, and commits the whole tree by value', async () => {
		const q = quill();
		const doc = q.seedDocument();
		seedVectors(q, doc, [{ name: 'Alpha', tours: ['One'] }]);
		const { target } = mountEditor(q, doc);
		const vectors = field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!;

		// The old arm stood a line here and pointed at the source view. Nothing does.
		expect(target.querySelector('.qm-unsupported')).toBeNull();

		const row = open(vectors, 0);
		const tours = nested(row, 'Tours');
		expect(rows(tours)).toHaveLength(1);

		// An edit two rungs down commits the whole field: the boundary holds the tree,
		// and `reader.get` reads it back at each leaf's own codec.
		type(cell(tours, 'Nights').querySelector('input')!, '3');
		await tick();
		const held = vectorsOf(doc)!;
		expect(held).toHaveLength(1);
		expect(held[0].tours).toHaveLength(1);
		expect((held[0].tours![0] as { nights?: number }).nights).toBe(3);
		const read = q.reader(doc).get('vectors') as { tours: { nights: number }[] }[];
		expect(read[0].tours[0].nights).toBe(3);
	});

	it('draws a nested container on its own row, and a one-line cell in a track', () => {
		const q = quill();
		const doc = q.seedDocument();
		seedVectors(q, doc, [{ name: 'Alpha' }]);
		const { target } = mountEditor(q, doc);
		const row = open(field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!, 0);

		// A shape the document's own height sets takes the row; a one-line cell shares.
		expect(cell(row, 'Name').classList.contains('full')).toBe(false);
		expect(cell(row, 'Brief').classList.contains('full')).toBe(true);
		expect(cell(row, 'Tours').classList.contains('full')).toBe(true);
	});

	it('steps its own capacity rather than inheriting the section’s', () => {
		const q = quill();
		const doc = q.seedDocument();
		seedVectors(q, doc, [{ name: 'Alpha' }]);
		const { target } = mountEditor(q, doc);
		const row = open(field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!, 0);

		// The ladder is walked once per subform: the box is the query container and the
		// grid inside it reads the answer, so a subform three rungs in draws the capacity
		// its own width carries. Presence against absence — the widths themselves are the
		// stylesheet's, and no test of theirs survives a retune.
		const subform = row.querySelector<HTMLElement>('.qm-object')!;
		expect(subform.querySelector(':scope > .qm-object-grid')?.classList).toContain('qm-capacity');
		const inner = nested(row, 'Tours');
		expect(inner.closest('.qm-object')).toBe(subform);
	});

	it('recurses inside a variant’s cell, which is the same subform', () => {
		const q = quill();
		const doc = q.seedDocument();
		q.writer(doc).set('handling', { value: 'CONTROLLED' });
		const { target } = mountEditor(q, doc);
		const reviews = field(target, 'Handling').querySelector<HTMLElement>('.qm-array')!;

		expect(reviews.querySelector('.qm-field-label span')?.textContent).toBe('Reviews');
		click(addChip(reviews));
		type(cell(rows(reviews)[0], 'Reviewer').querySelector('input')!, 'Ada');

		expect(doc.getStored('handling')).toEqual({
			value: 'CONTROLLED',
			reviews: [{ reviewer: 'Ada' }]
		});
	});
});

describe('a record row', () => {
	it('summarizes by `items.ui.title`, and falls to its first inline cell', () => {
		const q = quill();
		const doc = q.seedDocument();
		seedVectors(q, doc, [{ name: 'Alpha', tours: ['Spring run'] }, { name: '' }]);
		// `revisions` declares no `ui.title` and its first cell is a `string`; `tours`
		// declares none either and has no `string` cell at all, only an inline leaf.
		q.writer(doc).set('revisions', [{ note: 'Reset the margins' }]);
		const { target } = mountEditor(q, doc);
		const vectors = field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!;

		// `items.ui.title` is `"{name}"`; a row with nothing in it reads its indexed name.
		expect(summaries(vectors)).toEqual(['Alpha', 'Vectors 2']);
		expect(summaries(field(target, 'Revisions').querySelector<HTMLElement>('.qm-array')!)).toEqual([
			'Reset the margins'
		]);
	});

	it('reorders by button and by keyboard, committing the order whole', async () => {
		const q = quill();
		const doc = q.seedDocument();
		seedVectors(q, doc, [{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
		const { target } = mountEditor(q, doc);
		const vectors = field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!;
		expect(summaries(vectors)).toEqual(['A', 'B', 'C']);

		const actions = (k: number) => [
			...rows(vectors)[k].querySelectorAll<HTMLButtonElement>('.qm-row-actions button')
		];
		// Disabled at either edge, present at both: the card header's own rule at the
		// row's rung.
		expect(actions(0)[0].disabled).toBe(true);
		expect(actions(2)[1].disabled).toBe(true);

		click(actions(2)[0]);
		await tick();
		expect(vectorsOf(doc)!.map((v) => v.name)).toEqual(['A', 'C', 'B']);
		expect(summaries(vectors)).toEqual(['A', 'C', 'B']);

		// Alt+arrow on the row's own control is the twin over the same op.
		const summary = rows(vectors)[0].querySelector<HTMLElement>('.qm-element-summary')!;
		summary.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true })
		);
		flushSync();
		await tick();
		expect(vectorsOf(doc)!.map((v) => v.name)).toEqual(['C', 'A', 'B']);
	});

	it('keeps the open row open across its own move', async () => {
		const q = quill();
		const doc = q.seedDocument();
		seedVectors(q, doc, [{ name: 'A' }, { name: 'B' }]);
		const { target } = mountEditor(q, doc);
		const vectors = field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!;

		open(vectors, 1);
		expect(rows(vectors)[1].classList.contains('open')).toBe(true);

		click([...rows(vectors)[1].querySelectorAll<HTMLButtonElement>('.qm-row-actions button')][0]);
		await tick();
		// The element keeps its session id through the splice, so the row that moved is
		// the row that is open — and nothing inside it remounted.
		expect(summaries(vectors)).toEqual(['B', 'A']);
		expect(rows(vectors)[0].classList.contains('open')).toBe(true);
	});
});

describe('a card titled by a variant-bearing field', () => {
	it('reads the member its discriminant selects, not the container it rests as', () => {
		const q = quill();
		const doc = q.seedDocument();
		// `strand` declares `ui.title: "{topic}"` over an `enum` carrying `variants:`, so
		// the field rests as a container and the template reads it. `titleText` of an
		// object with no `.text` was `''`, which is a card with no name at all.
		const at = [...Array(doc.cardCount).keys()].find(
			(i) => q.reader(doc).card(i).kind === 'strand'
		);
		expect(at).toBeDefined();
		q.writer(doc).card(at!).set('topic', { value: 'experience' });
		const { target } = mountEditor(q, doc);

		const titles = [...target.querySelectorAll<HTMLInputElement>('.qm-card-title')].map(
			(i) => i.value || i.placeholder
		);
		expect(titles).toContain('experience');
	});
});

describe('the grid arm', () => {
	it('draws a short-celled row as a table with headers, and a record row as a list', () => {
		const q = quill();
		const doc = q.seedDocument();
		seedVectors(q, doc, [{ name: 'Alpha', tours: ['One', 'Two'] }]);
		const { target } = mountEditor(q, doc);
		const vectors = field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!;

		// `vectors` asks for nothing and holds a block leaf either way: a record list.
		expect(vectors.querySelector(':scope > .qm-table-head')).toBeNull();
		expect(rows(vectors)[0].classList.contains('qm-table-row')).toBe(false);

		const tours = nested(open(vectors, 0), 'Tours');
		// `tours` asks for the table and every cell is one line high, so it draws one.
		const head = tours.querySelector<HTMLElement>(':scope > .qm-table-head')!;
		// The name, without the `*` the obliged column carries beside it.
		expect(
			[...head.querySelectorAll('.qm-table-col')].map((c) => c.childNodes[0]?.textContent)
		).toEqual(['Title', 'Season', 'Nights', 'Lead']);
		// The header is chrome: the name each control is reached by is its own label.
		expect(head.getAttribute('aria-hidden')).toBe('true');
		expect(rows(tours)).toHaveLength(2);
		for (const row of rows(tours)) {
			expect(row.classList.contains('qm-table-row')).toBe(true);
			// Nothing opens, because nothing is hidden: the cells are mounted.
			expect(row.querySelector('.qm-element-summary')).toBeNull();
			expect(row.querySelectorAll('.qm-object-prop')).toHaveLength(4);
		}
	});

	it('draws no header over nothing, and says which column asks', () => {
		const q = quill();
		const doc = q.seedDocument();
		seedVectors(q, doc, [{ name: 'Alpha' }]);
		const { target } = mountEditor(q, doc);
		const tours = nested(
			open(field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!, 0),
			'Tours'
		);

		// A strip of column names above an empty list names columns the document has no
		// line in; the rows box already holds that rule for itself.
		expect(rows(tours)).toHaveLength(0);
		expect(tours.querySelector(':scope > .qm-table-head')).toBeNull();

		click(addChip(tours));
		flushSync();
		const head = tours.querySelector<HTMLElement>(':scope > .qm-table-head')!;
		expect(head).not.toBeNull();
		// `title` declares no `default:`, so the column asks — and its cell's own label,
		// which carries the `*`, is off the page at the table rung.
		const cols = [...head.querySelectorAll<HTMLElement>('.qm-table-col')];
		expect(cols[0].querySelector('.qm-table-req')).not.toBeNull();
		expect(cols[2].querySelector('.qm-table-req')).toBeNull();
	});

	it('carries the row machine, not a second one', async () => {
		const q = quill();
		const doc = q.seedDocument();
		seedVectors(q, doc, [{ name: 'Alpha', tours: ['One', 'Two', 'Three'] }]);
		const { target } = mountEditor(q, doc);
		const tours = nested(
			open(field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!, 0),
			'Tours'
		);

		// Add, remove and move are the same verbs the record list runs.
		click([...rows(tours)[0].querySelectorAll<HTMLButtonElement>('.qm-row-actions button')][1]);
		await tick();
		const titles = () =>
			(vectorsOf(doc)![0].tours ?? []).map((t) => (t as { title?: unknown }).title);
		expect(titles()).toEqual(['Two', 'One', 'Three']);

		click([...rows(tours)[2].querySelectorAll<HTMLButtonElement>('.qm-row-actions button')][2]);
		await tick();
		expect(titles()).toEqual(['Two', 'One']);

		// The keyboard twin reaches a table row too, which draws no summary to hang it
		// on: the press is made from whichever cell the caret is in, and the row is what
		// moves. Named as a group with it, so which row that is is said and not only seen.
		expect(rows(tours)[0].getAttribute('aria-label')).toBe('Tours 1');
		const cellInput = rows(tours)[1].querySelector<HTMLInputElement>('input')!;
		cellInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true })
		);
		flushSync();
		await tick();
		expect(titles()).toEqual(['One', 'Two']);
	});

	it('spends the row\u2019s trailing inset on the row\u2019s own control, not on what it unfolds', () => {
		const q = quill();
		const doc = q.seedDocument();
		seedVectors(q, doc, [{ name: 'Alpha', tours: ['One'] }]);
		const { target } = mountEditor(q, doc);
		const vectors = field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!;
		const row = open(vectors, 0);

		// `--row-actions` inherits, so a descendant rule would stand every control inside
		// an open row off the end by three slabs the cluster does not cover. The row's own
		// summary takes it; the subform under it is on the recipe's own inset.
		const summary = row.querySelector<HTMLElement>('.qm-element-summary')!;
		expect(summary.matches('.qm-element-head > .qm-element-summary')).toBe(true);
		const nameInput = cell(row, 'Name').querySelector<HTMLInputElement>('input')!;
		expect(nameInput.matches('.qm-array-row > .qm-input')).toBe(false);
	});
});

describe('an array declaring `max:`', () => {
	it('disables the add chip at the cap, re-enables on a remove, and draws the count', async () => {
		const q = quill();
		const doc = q.seedDocument();
		seedVectors(q, doc, [{ name: 'A' }, { name: 'B' }]);
		const { target } = mountEditor(q, doc);
		const vectors = field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!;
		const count = () => vectors.querySelector('.qm-array-count')?.textContent;

		expect(count()).toBe('2 / 3');
		expect(addChip(vectors).disabled).toBe(false);

		click(addChip(vectors));
		await tick();
		expect(vectorsOf(doc)).toHaveLength(3);
		expect(count()).toBe('3 / 3');
		expect(addChip(vectors).disabled).toBe(true);

		// The cap reads off the surface with the chip disabled: a disabled button takes
		// no focus, so the group names the count rather than the chip carrying a title.
		const group = vectors.closest('[role="group"]') ?? vectors;
		const described = (group.getAttribute('aria-describedby') ?? '').split(/\s+/);
		expect(described).toContain(vectors.querySelector('.qm-array-count')!.id);

		// No editor gesture commits a fourth.
		click(addChip(vectors));
		await tick();
		expect(vectorsOf(doc)).toHaveLength(3);

		click([...rows(vectors)[0].querySelectorAll<HTMLButtonElement>('.qm-row-actions button')][2]);
		await tick();
		expect(count()).toBe('2 / 3');
		expect(addChip(vectors).disabled).toBe(false);
	});
});

describe('a landing past the first rung', () => {
	it('resolves the whole path through nested rows', async () => {
		const q = quill();
		const doc = q.seedDocument();
		seedVectors(q, doc, [
			{ name: 'Alpha', tours: ['One', 'Two', 'Three'] },
			{ name: 'Beta', tours: [] }
		]);
		const { target, editor } = mountEditor(q, doc);
		const vectors = field(target, 'Vectors').querySelector<HTMLElement>('.qm-array')!;
		expect(rows(vectors).every((r) => !r.classList.contains('open'))).toBe(true);

		await editor.setCaret({ field: 'main.vectors[0].tours[2].title' });

		// The landing opens vector 0 on its way through, and lands in the tour the
		// address named rather than on the field that holds it.
		expect(rows(vectors)[0].classList.contains('open')).toBe(true);
		const tours = nested(rows(vectors)[0], 'Tours');
		const landed = rows(tours)[2];
		expect(landed.contains(document.activeElement)).toBe(true);

		// The arrival wash marks what the address named: the innermost row, not the
		// repeater around it.
		expect(landed.querySelector('.qm-bloom')).not.toBeNull();
		expect(vectors.querySelector(':scope > .qm-array-rows > .qm-bloom')).toBeNull();
	});

	it('blooms the box it settled in, which is a box a wash can sit inside', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const { target, editor } = mountEditor(q, doc);

		// The wash is an inset child of the box the landing settled in, so that box has to
		// be positioned or the paint resolves against the nearest ancestor that is — the
		// field — saying the field where the click said the cell.
		await editor.focusField('main.contact.email');
		const cellEl = cell(field(target, 'Point of contact'), 'Email');
		expect(cellEl.querySelector(':scope > .qm-bloom')).not.toBeNull();
		expect(cellEl.classList.contains('qm-object-prop')).toBe(true);

		await editor.focusField('main.qualifications.cyber_200.held');
		const memberEl = (document.activeElement as HTMLElement).closest('.qm-matrix-member')!;
		expect(memberEl.querySelector(':scope > .qm-bloom')).not.toBeNull();
	});

	it('washes the roster a label-owning control stands over, not the label above it', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const { target, editor } = mountEditor(q, doc);

		// A control that draws the field's own label track stands inside the box `Field`
		// would otherwise bloom, so the wash would paint the label and the count with it.
		// Both repeater and matrix name the box beneath instead. Parentage is the half a
		// layout-free run can read: the wash is an inset absolute child, so the box it
		// actually paints is the nearest positioned ancestor, which each of these two
		// boxes is by its own rule — the CSS's to carry, and not restated here.
		await editor.focusField('main.qualifications');
		const matrixBloom = field(target, 'Qualifications').querySelector('.qm-bloom')!;
		expect(matrixBloom.parentElement?.classList.contains('qm-matrix-groups')).toBe(true);
		expect(matrixBloom.parentElement?.querySelector('.qm-matrix-count')).toBeNull();

		await editor.focusField('main.vectors');
		const arrayBloom = field(target, 'Vectors').querySelector('.qm-bloom')!;
		expect(arrayBloom.parentElement?.querySelector('.qm-field-label')).toBeNull();
	});

	it('lands a variant where its own label points, which is the discriminant', async () => {
		const q = quill();
		const doc = q.seedDocument();
		q.writer(doc).set('distribution', { value: 'public' });
		const { target, editor } = mountEditor(q, doc);

		// `focusField` is the function a label click calls, so the two cannot land in
		// different places: the cells of the live world are reached by their own labels,
		// and by an address that names one.
		const label = field(target, 'Distribution').querySelector('label')!;
		await editor.focusField('main.distribution');
		expect((document.activeElement as HTMLElement).id).toBe(label.getAttribute('for'));

		await editor.focusField('main.distribution.license');
		expect((document.activeElement as HTMLElement).id).not.toBe(label.getAttribute('for'));
	});

	it('lands a property path on the property, and a matrix member on its tick', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const { target, editor } = mountEditor(q, doc);

		await editor.focusField('main.contact.email');
		expect(cell(field(target, 'Point of contact'), 'Email').contains(document.activeElement)).toBe(
			true
		);

		await editor.focusField('main.qualifications.cyber_200.held');
		const box = document.activeElement as HTMLInputElement;
		expect(box.type).toBe('checkbox');
		expect(box.closest('.qm-matrix-member')?.textContent).toContain('Cyber 200');
	});

	it('reads own keys only: a prototype name is not a rung', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const errors: { code: string }[] = [];
		const targetEl = document.createElement('div');
		document.body.appendChild(targetEl);
		const app = mount(VisualEditor, {
			target: targetEl,
			props: { doc, quill: q, onError: (e: { code: string }) => errors.push(e) }
		}) as unknown as EditorRef;
		flushSync();
		cleanup = () => {
			void unmount(app);
			targetEl.remove();
		};

		// A step is a string off a document address and a schema map is a plain object, so
		// `properties['toString']` answers with `Object.prototype`'s — a rung the schema
		// never declared, handed to a control whose own maps answer the same way.
		for (const path of [
			'main.qualifications.toString',
			'main.qualifications.constructor',
			'main.contact.hasOwnProperty',
			'main.vectors[0].toString',
			'main.handling.valueOf'
		]) {
			await app.focusField(path);
		}
		expect(errors.every((e) => e.code === 'target-unknown')).toBe(true);
		expect(errors).toHaveLength(5);
	});

	it('stops at a leaf: the discriminant holds a member and nothing under it', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const errors: { code: string }[] = [];
		const targetEl = document.createElement('div');
		document.body.appendChild(targetEl);
		const app = mount(VisualEditor, {
			target: targetEl,
			props: { doc, quill: q, onError: (e: { code: string }) => errors.push(e) }
		}) as unknown as EditorRef;
		flushSync();
		cleanup = () => {
			void unmount(app);
			targetEl.remove();
		};

		// The walk is checked to the end of the path, so a step past a leaf names nothing
		// rather than reading the container it hangs off a second time: `value` is the
		// discriminant cell, and `license` is a cell of a world beside it, not inside it.
		await app.focusField('main.distribution.value.license');
		// And a step past an array's own leaf element is no address either.
		await app.focusField('main.keywords[0].nowhere');
		expect(errors.map((e) => e.code)).toEqual(['target-unknown', 'target-unknown']);

		// The rung itself still lands: the discriminant is the field's own control.
		errors.length = 0;
		await app.focusField('main.distribution.value');
		expect(errors).toEqual([]);
		expect((document.activeElement as HTMLElement)?.closest('.qm-variant')).not.toBeNull();
	});

	it('declines a step the schema does not declare, and says so', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const errors: { code: string; path?: string }[] = [];
		const targetEl = document.createElement('div');
		document.body.appendChild(targetEl);
		const app = mount(VisualEditor, {
			target: targetEl,
			props: { doc, quill: q, onError: (e: { code: string; path?: string }) => errors.push(e) }
		}) as unknown as EditorRef;
		flushSync();
		cleanup = () => {
			void unmount(app);
			targetEl.remove();
		};

		await app.focusField('main.vectors[0].nowhere');
		expect(errors.map((e) => e.code)).toContain('target-unknown');
	});
});
