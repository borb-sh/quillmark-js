// @vitest-environment jsdom
// The mirror reaching the schema's depth (VISUAL_EDITOR §"Structure mirrors the
// schema"). A nested `array` or `object` property mounts its own control at the next
// rung, and the figure it draws is the same one at every depth: collapsed rows, a subform under each.
// Driven off the reference quill's `appendices` — an `array<object<array<object>>>` —
// and off the variant cell `distribution.embargoed.notices`, read back through the
// document rather than off a captured callback.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { DEFAULT_VISUAL_STRINGS as S } from '$lib/visual/strings';
import type { Document, Quill } from '@quillmark/wasm';
import { fieldTitle } from '$lib/visual/structure';
import { quill, example } from '../helpers/fixtures.js';
import {
	leaf,
	mountEditor,
	openField,
	pick,
	repeater,
	summaries,
	summaryTexts,
	type,
	typeLeaf,
	unmountAll
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const read = (q: Quill, doc: Document, name: string) => q.reader(doc).get(name);

type Appendix = { title: string; entries: Array<{ label: string; page: number }> };
const appendixTree = (q: Quill, doc: Document) => read(q, doc, 'appendices') as Appendix[];
const appendices = (target: HTMLElement) => openField(target, quill().schema.main, 'appendices');

describe('a nested array property', () => {
	it('draws as a record list inside the open row', () => {
		const q = quill();
		const doc = example();
		const mounted = mountEditor(q, doc);
		const outer = appendices(mounted.target);
		const tree = appendixTree(q, doc);

		// The outer rows, named by their number.
		expect(summaryTexts(outer)).toEqual(tree.map((_, k) => S.elementUntitled('Appendices', k + 1)));

		summaries(outer)[0].click();
		flushSync();
		// The open row's subform holds the `title` cell and, one rung in, the `entries`
		// repeater: a nested array mounts the control an array field mounts.
		const row = outer.querySelector<HTMLElement>('.qm-element.open')!;
		expect(row.querySelector('[data-qm-prop="title"] .ProseMirror')).not.toBeNull();
		const inner = repeater(row.querySelector('.qm-object')!);
		expect(inner.querySelector('.qm-field-label span')?.textContent).toBe(
			fieldTitle('entries', q.schema.main.fields.appendices.items!.properties!.entries)
		);
		// Its rows are collapsed rows again, named by their number.
		expect(summaryTexts(inner)).toEqual(
			tree[0].entries.map((_, k) => S.elementUntitled('Entries', k + 1))
		);
	});

	it('opens one entry at a time, two rungs in, and commits the whole tree by value', () => {
		const q = quill();
		const doc = example();
		const mounted = mountEditor(q, doc);
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
		const tree = appendixTree(q, doc);
		const was = tree[0].entries[1].page;
		expect(page.value).toBe(String(was));

		type(page, String(was + 1));
		// The commit is the whole field: the nested row re-encodes up through the open
		// appendix, and `reader.get` reads the committed tree back.
		tree[0].entries[1].page = was + 1;
		expect(appendixTree(q, doc)).toEqual(tree);
		expect(mounted.changes.at(-1)?.path).toBe('main.appendices');
	});

	it('keeps the open rows mounted across a commit inside them', () => {
		const q = quill();
		const doc = example();
		const mounted = mountEditor(q, doc);
		const outer = appendices(mounted.target);
		summaries(outer)[0].click();
		flushSync();
		const appendix = outer.querySelector<HTMLElement>('.qm-element.open')!;
		const title = leaf(appendix.querySelector<HTMLElement>('[data-qm-prop="title"]')!);
		const inner = repeater(appendix.querySelector('.qm-object')!);
		summaries(inner)[0].click();
		flushSync();
		const entry = inner.querySelector<HTMLElement>('.qm-element.open')!;
		const label = leaf(entry);

		type(entry.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!, '13');

		// Both rows are keyed by session id, so the re-derive the commit causes leaves the
		// appendix's title leaf and the entry's label leaf as the same nodes: no remount,
		// no caret lost.
		expect(leaf(outer.querySelector<HTMLElement>('.qm-element.open [data-qm-prop="title"]')!)).toBe(
			title
		);
		expect(inner.querySelector('.qm-element.open')).toBe(entry);
		expect(leaf(entry)).toBe(label);
	});

	it('adds a nested row open and removes it, the list committing whole each time', () => {
		const q = quill();
		const doc = example();
		const mounted = mountEditor(q, doc);
		const outer = appendices(mounted.target);
		summaries(outer)[1].click();
		flushSync();
		const inner = repeater(outer.querySelector('.qm-element.open .qm-object')!);
		// A list of one record draws it open.
		expect(summaryTexts(inner)).toEqual([S.elementUntitled('Entries', 1)]);
		expect(inner.querySelectorAll('.qm-element.open')).toHaveLength(1);

		inner.querySelector<HTMLButtonElement>('.qm-add-el')!.click();
		flushSync();
		const tree = read(q, doc, 'appendices') as Array<{ entries: unknown[] }>;
		expect(tree[1].entries).toEqual([{ label: 'Terms', page: 20 }, {}]);
		// A row added is a row to fill in: it arrives open, and the row it joins stays so.
		expect(inner.querySelectorAll('.qm-element')).toHaveLength(2);
		expect(summaries(inner).map((s) => s.getAttribute('aria-expanded'))).toEqual(['true', 'true']);
		expect(summaryTexts(inner)).toEqual([1, 2].map((n) => S.elementUntitled('Entries', n)));

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
		const mounted = mountEditor(q, example());
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
		const doc = example();
		const mounted = mountEditor(q, doc);
		const dist = openField(mounted.target, q.schema.main, 'distribution');

		pick(dist, 'embargoed');
		const notices = repeater(dist);
		expect(notices.querySelector('.qm-field-label span')?.textContent).toBe(
			fieldTitle('notices', q.schema.main.fields.distribution.variants!.embargoed.notices)
		);
		expect(summaryTexts(notices)).toEqual([]);

		notices.querySelector<HTMLButtonElement>('.qm-add-el')!.click();
		flushSync();
		const row = notices.querySelector<HTMLElement>('.qm-element.open')!;
		typeLeaf(row.querySelector<HTMLElement>('[data-qm-prop="party"]')!, 'Legal');
		// A richtext cell inside a row inside a variant cell: a leaf at three rungs.
		expect(row.querySelector('[data-qm-prop="text"] .ProseMirror')).not.toBeNull();
		expect(doc.getStored('distribution')).toEqual({
			value: 'embargoed',
			notices: [{ party: 'Legal' }]
		});
		// The row keeps its number whatever it holds, and as the list's one row stays open.
		expect(summaryTexts(notices)).toEqual([S.elementUntitled('Notices', 1)]);
		expect(notices.querySelectorAll('.qm-element.open')).toHaveLength(1);
	});
});
