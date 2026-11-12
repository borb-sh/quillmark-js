// @vitest-environment jsdom
// The order the editor reports its open items in is the page's, whatever order the host lists
// them in: read here off the page, which the editor itself never asks.
import { it, expect, afterEach } from 'vitest';
import type { Document } from '@quillmark/wasm';
import type { ReviewDrawn, ReviewItem } from '$lib/visual';
import { quill, example } from '../helpers/fixtures.js';
import { mountEditor, settle, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

/** The ids the page draws, each at its first element, in the page's order. */
const paged = (target: HTMLElement): string[] => {
	const out: string[] = [];
	for (const el of target.querySelectorAll('[data-qm-review]'))
		for (const id of (el.getAttribute('data-qm-review') ?? '').split(' ').filter(Boolean))
			if (!out.includes(id)) out.push(id);
	return out;
};

async function run(items: (doc: Document) => ReviewItem[], seed?: (doc: Document) => void) {
	const doc = example();
	seed?.(doc);
	const drawn: ReviewDrawn[] = [];
	const listed = items(doc);
	const { target } = mountEditor(quill(), doc, {
		review: listed,
		onReviewDrawn: (d) => drawn.push(d)
	});
	await settle();
	await settle();
	return {
		last: drawn.at(-1)!,
		page: paged(target),
		listed: listed.map((item) => item.id),
		target
	};
}

const seed = (doc: Document): void => {
	const w = quill().writer(doc);
	w.set('contact', { name: 'Ada', email: 'a@example.org', note: 'n' });
	w.set('authors', ['A', 'B', 'C']);
	w.set('contributors', [
		{ name: 'Ada', role: 'Editor' },
		{ name: 'Bo', role: 'Writer' }
	]);
	w.set('tab_stops', [1, 2, 3]);
};

it('fields, cells and rows listed in reverse', async () => {
	const { last, page, listed } = await run((doc) => {
		const p = (name: string) => doc.pathFor(name);
		const items: ReviewItem[] = [
			{ id: 'copies', field: `${p('imprint')}.copies`, after: 9 },
			{ id: 'tracking', field: p('tracking_id'), after: 'T-9' },
			{ id: 'tab2', field: `${p('tab_stops')}[2]`, before: 3, after: 30 },
			{ id: 'tab0', field: `${p('tab_stops')}[0]`, before: 1, after: 10 },
			{ id: 'columns', field: p('columns'), after: 3 },
			{ id: 'role1', field: `${p('contributors')}[1].role`, before: 'Writer', after: 'Poet' },
			{ id: 'role0', field: `${p('contributors')}[0].role`, before: 'Editor', after: 'Chief' },
			{ id: 'name0', field: `${p('contributors')}[0].name`, before: 'Ada', after: 'Grace' },
			{ id: 'note', field: `${p('contact')}.note`, after: 'm' },
			{ id: 'email', field: `${p('contact')}.email`, after: 'g@example.org' },
			{ id: 'cname', field: `${p('contact')}.name`, before: 'Ada', after: 'Grace' },
			{ id: 'auth2', field: `${p('authors')}[2]`, before: 'C', after: 'Cy' },
			{ id: 'auth0', field: `${p('authors')}[0]`, before: 'A', after: 'Al' },
			{ id: 'subtitle', field: p('subtitle'), after: 'Sub' }
		];
		return items;
	}, seed);
	expect(last.undrawn).toEqual([]);
	expect(last.open).toEqual(page);
	expect(last.open).not.toEqual(listed);
});

it('blocks and cards listed in reverse', async () => {
	const { last, page, listed } = await run((doc) => {
		const blocks = doc.blocks({});
		const field = doc.pathFor({})!;
		const card = (i: number) => doc.pathFor({ card: i })!;
		const cb = (i: number) => doc.blocks({ card: i });
		const items: ReviewItem[] = [
			{ id: 'end', field, insert: 'end', after: 'A last paragraph.' },
			{ id: 'c3', field: card(3), replace: [cb(3)[0].id], after: 'Figure note, rewritten.' },
			{ id: 'rm1', remove: 1 },
			{ id: 'addEnd', add: { kind: 'note', payloadItems: [] } as never, after: 4 },
			{ id: 'c0', field: card(0), replace: [cb(0)[0].id], after: 'Section body, rewritten.' },
			{ id: 'add0b', add: { kind: 'note', payloadItems: [] } as never, after: 0 },
			{ id: 'addHead', add: { kind: 'note', payloadItems: [] } as never },
			{ id: 'b3', field, replace: [blocks.at(-1)!.id], after: 'A closing paragraph, shorter.' },
			{ id: 'after0', field, insert: { after: blocks[0].id }, after: 'A new second paragraph.' },
			{ id: 'b1', field, replace: [blocks[1].id], after: 'A bullet, rewritten.' },
			{ id: 'before0', field, insert: { before: blocks[0].id }, after: 'A new first paragraph.' },
			{ id: 'b0', field, replace: [blocks[0].id], after: 'The body, rewritten.' }
		];
		return items;
	});
	expect(last.undrawn).toEqual([]);
	expect(last.open).toEqual(page);
	expect(last.open).not.toEqual(listed);
});

it("a matrix's cells and a list's members listed in reverse", async () => {
	const { last, page, listed } = await run((doc) => {
		const p = (name: string) => doc.pathFor(name);
		const items: ReviewItem[] = [
			{ id: 'added-severity', field: `${p('checks')}.kerning_pairs.severity`, after: 'minor' },
			{ id: 'added-note', field: `${p('checks')}.kerning_pairs.note`, after: 'Loose.' },
			{ id: 'roster-severity', field: `${p('checks')}.spelling.severity`, after: 'minor' },
			{ id: 'roster-note', field: `${p('checks')}.spelling.note`, after: 'One typo.' },
			{ id: 'keyword-1', field: `${p('keywords')}[1]`, after: 'two' },
			{ id: 'keyword-0', field: `${p('keywords')}[0]`, after: 'one' }
		];
		return items;
	});
	expect(last.undrawn).toEqual([]);
	expect(last.open).toEqual(page);
	expect(last.open).not.toEqual(listed);
});

it('orders the places one mark stands for as the row would draw them', async () => {
	const { last, target } = await run((doc) => {
		const p = (name: string) => doc.pathFor(name);
		const items: ReviewItem[] = [
			{ id: 'entry-page', field: `${p('appendices')}[0].entries[1].page`, after: 15 },
			{ id: 'entry-label', field: `${p('appendices')}[0].entries[0].label`, after: 'First' },
			{ id: 'appendix-title', field: `${p('appendices')}[0].title`, after: 'Notes' }
		];
		return items;
	});
	const marks = last.open.map((id) => target.querySelector(`[data-qm-review~="${id}"]`));
	expect(new Set(marks).size).toBe(1);
	expect(last.open).toEqual(['appendix-title', 'entry-label', 'entry-page']);
});
