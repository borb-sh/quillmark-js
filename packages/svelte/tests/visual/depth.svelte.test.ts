// @vitest-environment jsdom
// The mirror reaching the schema's depth (VISUAL_EDITOR §"Structure mirrors the
// schema"). A nested `array` or `object` property mounts its own control at the next
// rung instead of a line pointing at the source view, and the figure it draws is the
// same one at every depth: collapsed rows, one open at a time, a subform under each.
// Driven off the reference quill's `appendices` — an `array<object<array<object>>>` —
// and off the variant cell `distribution.embargoed.notices`, read back through the
// document rather than off a captured callback.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { init, type Document, type Quill } from '@quillmark/wasm';
import { quill } from '../helpers/fixtures.js';
import {
	field,
	mountEditor,
	openGroup,
	pick,
	repeater,
	stubLayout,
	summaries,
	summaryTexts,
	type,
	type Mounted
} from '../helpers/surface.js';

// The gate every mounted suite stands behind; the classes are reached off the fixture.
await init();
stubLayout();

let mounted: Mounted | undefined;
afterEach(() => {
	mounted?.unmount();
	mounted = undefined;
});

const read = (q: Quill, doc: Document, name: string) => q.reader(doc).get(name);

/** The `appendices` field, its group opened. */
function appendices(target: HTMLElement): HTMLElement {
	openGroup(target, 'Content');
	return field(target, 'Appendices');
}

describe('a nested array property', () => {
	it('draws as a record list inside the open row, no placeholder anywhere', () => {
		const q = quill();
		const doc = q.seedDocument();
		mounted = mountEditor(q, doc);
		const outer = appendices(mounted.target);

		// The outer rows, summarized by the `items.ui.title` template.
		expect(summaryTexts(outer)).toEqual(['Sources', 'Glossary']);

		summaries(outer)[0].click();
		flushSync();
		// The open row's subform holds the `title` cell and, one rung in, the `entries`
		// repeater: a nested array mounts the control an array field mounts.
		const row = outer.querySelector<HTMLElement>('.qm-element.open')!;
		expect(row.querySelector('input[type="text"]')).not.toBeNull();
		const inner = repeater(row.querySelector('.qm-object')!);
		expect(inner.querySelector('.qm-field-label span')?.textContent).toBe('Entries');
		// Its rows are collapsed rows again, summarized by the inline `plaintext` label —
		// the row has no `string` cell, so the fallback reads the first short prose cell.
		expect(summaryTexts(inner)).toEqual(['Primary', 'Secondary']);
		expect(mounted.target.querySelector('.qm-unsupported')).toBeNull();
	});

	it('opens one entry at a time, two rungs in, and commits the whole tree by value', () => {
		const q = quill();
		const doc = q.seedDocument();
		mounted = mountEditor(q, doc);
		const outer = appendices(mounted.target);
		summaries(outer)[0].click();
		flushSync();
		const inner = repeater(outer.querySelector('.qm-element.open .qm-object')!);

		summaries(inner)[1].click();
		flushSync();
		const entry = inner.querySelector<HTMLElement>('.qm-element.open')!;
		// The entry's cells at their own controls: the label and note are prose leaves,
		// the page an input. Depth is what is open, not the schema: two rungs of subform.
		expect(entry.querySelectorAll('.ProseMirror')).toHaveLength(2);
		const page = entry.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
		expect(page.value).toBe('14');

		type(page, '15');
		// The commit is the whole field: the nested row re-encodes up through the open
		// appendix, and `reader.get` reads the committed tree back.
		const tree = read(q, doc, 'appendices') as Array<{ entries: Array<{ page: number }> }>;
		expect(tree[0].entries[1].page).toBe(15);
		expect(tree[0].entries[0].page).toBe(12);
		expect(tree[1].entries[0].page).toBe(20);
		expect(mounted.changes.at(-1)?.path).toBe('main.appendices');
	});

	it('keeps the open rows mounted across a commit inside them', () => {
		const q = quill();
		const doc = q.seedDocument();
		mounted = mountEditor(q, doc);
		const outer = appendices(mounted.target);
		summaries(outer)[0].click();
		flushSync();
		const appendix = outer.querySelector<HTMLElement>('.qm-element.open')!;
		const title = appendix.querySelector<HTMLInputElement>('input[type="text"]')!;
		const inner = repeater(appendix.querySelector('.qm-object')!);
		summaries(inner)[0].click();
		flushSync();
		const entry = inner.querySelector<HTMLElement>('.qm-element.open')!;
		const leaf = entry.querySelector<HTMLElement>('.ProseMirror')!;

		type(entry.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!, '13');

		// Both rows are keyed by session id, so the re-derive the commit causes leaves the
		// appendix's title input and the entry's prose leaf as the same nodes: no remount,
		// no caret lost.
		expect(outer.querySelector('.qm-element.open input[type="text"]')).toBe(title);
		expect(inner.querySelector('.qm-element.open')).toBe(entry);
		expect(entry.querySelector('.ProseMirror')).toBe(leaf);
	});

	it('adds a nested row open and removes it, the list committing whole each time', () => {
		const q = quill();
		const doc = q.seedDocument();
		mounted = mountEditor(q, doc);
		const outer = appendices(mounted.target);
		summaries(outer)[1].click();
		flushSync();
		const inner = repeater(outer.querySelector('.qm-element.open .qm-object')!);
		expect(summaryTexts(inner)).toEqual(['Terms']);

		inner.querySelector<HTMLButtonElement>('.qm-add-el')!.click();
		flushSync();
		const tree = read(q, doc, 'appendices') as Array<{ entries: unknown[] }>;
		expect(tree[1].entries).toEqual([{ label: 'Terms', page: 20 }, {}]);
		// A row added is a row to fill in: it arrives open.
		expect(inner.querySelectorAll('.qm-element')).toHaveLength(2);
		expect(inner.querySelectorAll('.qm-element.open')).toHaveLength(1);
		// Scoped to the row itself: the appendix around `inner` is an open element too,
		// and a descendant selector's ancestor clause reaches outside its root.
		const added = inner.querySelector<HTMLElement>('.qm-element.open')!;
		expect(added.querySelector('.qm-element-title')?.textContent).toBe('Entries 2');

		inner.querySelectorAll<HTMLButtonElement>('.qm-row-btn.qm-remove')[1].click();
		flushSync();
		expect((read(q, doc, 'appendices') as Array<{ entries: unknown[] }>)[1].entries).toEqual([
			{ label: 'Terms', page: 20 }
		]);
	});

	it('is a query container of its own at every rung', () => {
		// The capacity ladder is CSS's (`.qm-tracks`, controls.css) and jsdom computes no
		// layout, so what is checkable here is the shape the rules key on: every subform
		// carries the recipe class on its grid, and no subform draws the section's count
		// by inheriting it. What `container-type` then does is the browser's (PLAYGROUND
		// §"Reaching it from source").
		const q = quill();
		mounted = mountEditor(q, q.seedDocument());
		const outer = appendices(mounted.target);
		summaries(outer)[0].click();
		flushSync();
		const grids = [...outer.querySelectorAll<HTMLElement>('.qm-object > .qm-object-grid')];
		expect(grids.length).toBeGreaterThan(0);
		for (const g of grids) expect(g.classList.contains('qm-tracks')).toBe(true);
	});
});

describe('a container inside a variant cell', () => {
	it('draws the record list under the discriminant and commits it into the container', () => {
		const q = quill();
		const doc = q.seedDocument();
		mounted = mountEditor(q, doc);
		openGroup(mounted.target, 'Metadata');
		const dist = field(mounted.target, 'Distribution');

		pick(dist.querySelector<HTMLElement>('.qm-select')!, 'embargoed');
		const notices = repeater(dist);
		expect(notices.querySelector('.qm-field-label span')?.textContent).toBe('Notices');
		expect(summaryTexts(notices)).toEqual([]);

		notices.querySelector<HTMLButtonElement>('.qm-add-el')!.click();
		flushSync();
		const row = notices.querySelector<HTMLElement>('.qm-element.open')!;
		type(row.querySelector<HTMLInputElement>('input[type="text"]')!, 'Legal');
		// A richtext cell inside a row inside a variant cell: a leaf at three rungs.
		expect(row.querySelector('.ProseMirror')).not.toBeNull();
		expect(doc.getStored('distribution')).toEqual({
			value: 'embargoed',
			notices: [{ party: 'Legal' }]
		});
		// The row summarizes by its `string` cell once it has one.
		expect(summaryTexts(notices)).toEqual(['Legal']);
	});
});

describe('a card title over a variant-bearing enum', () => {
	it('reads the discriminant member, not the container it rests as', () => {
		const q = quill();
		const doc = q.seedDocument();
		mounted = mountEditor(q, doc);
		// The seeded `figure` card carries `placement: {value: 'float'}`; its `ui.title`
		// is `{placement}`.
		const slots = [...mounted.target.querySelectorAll<HTMLElement>('.qm-card-slot')];
		const figure = slots.find((s) =>
			[...s.querySelectorAll('[data-leaf-key]')].some((e) =>
				e.getAttribute('data-leaf-key')?.endsWith(':caption')
			)
		)!;
		expect(figure.querySelector<HTMLInputElement>('.qm-card-title')?.placeholder).toBe('float');
	});
});
