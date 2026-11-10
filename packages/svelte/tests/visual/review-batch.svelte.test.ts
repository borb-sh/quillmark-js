// @vitest-environment jsdom
// Review as a batch: what the editor draws of the host's list and why not, answers given by the
// host's call, and the steps and chords that walk the list.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import { REVIEW_KEYS } from '$lib/core/codec';
import type { ReviewDrawn, ReviewEvent, ReviewItem } from '$lib/visual';
import { quill, example } from '../helpers/fixtures.js';
import {
	mountEditor,
	press,
	settle,
	unmountAll,
	type EditorRef,
	type Mounted
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const keyOf = (chord: string): string => chord.slice(chord.lastIndexOf('-') + 1);
const mod = { ctrlKey: true };

interface Batch extends Mounted<EditorRef> {
	doc: Document;
	events: ReviewEvent[];
	drawn: ReviewDrawn[];
	lit: (string | undefined)[];
}

function batch(items: (doc: Document) => ReviewItem[], advance?: boolean): Batch {
	const doc = example();
	const events: ReviewEvent[] = [];
	const drawn: ReviewDrawn[] = [];
	const lit: (string | undefined)[] = [];
	const mounted = mountEditor(quill(), doc, {
		review: items(doc),
		onReview: (e) => events.push(e),
		onReviewDrawn: (d) => drawn.push(d),
		onReviewFocus: (id) => lit.push(id),
		...(advance === undefined ? {} : { reviewAdvance: advance })
	});
	return { ...mounted, doc, events, drawn, lit };
}

/** The `n`th block of a rich text field, or of the body: its path and its id. */
function block(doc: Document, field?: string, n = 0): { field: string; id: string } {
	const addr = field ? { field } : {};
	return { field: doc.pathFor(addr), id: doc.blocks(addr)[n].id };
}
/** A proposal rewriting the `n`th block of a rich text field, or of the body, to `after`. */
function over(doc: Document, id: string, after: string, field?: string, n = 0): ReviewItem {
	const at = block(doc, field, n);
	return { id, field: at.field, replace: [at.id], after };
}

/** The ids by where their first element stands in the page. */
function pageOrder(target: HTMLElement, ids: readonly string[]): string[] {
	const first = (id: string) =>
		[...target.querySelectorAll('[data-qm-review]')].find(
			(el) => el.getAttribute('data-qm-review') === id
		)!;
	return [...ids].sort((a, b) =>
		first(a).compareDocumentPosition(first(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
	);
}

const spread = (doc: Document): ReviewItem[] => [
	over(doc, 'body', 'A body line, proposed.'),
	{ id: 'cols', field: doc.pathFor('columns'), after: 2 },
	over(doc, 'abs', 'An abstract, proposed.', 'abstract')
];

describe('the drawn report', () => {
	it('names the open items in the order the page shows them, across leaves and fields', async () => {
		const r = batch(spread);
		await settle();
		const { open: order, undrawn } = r.drawn.at(-1)!;
		expect([...order].sort()).toEqual(['abs', 'body', 'cols']);
		expect(order).toEqual(pageOrder(r.target, order));
		expect(undrawn).toEqual([]);
	});

	it('says why each item it does not draw is not drawn', async () => {
		const r = batch((doc) => {
			const first = doc.blocks({})[0].markdown;
			return [
				{
					id: 'nowhere',

					field: doc.pathFor({}),
					replace: ['gone'],
					after: 'Anything.'
				},
				{
					id: 'inside',

					field: `${doc.pathFor('contact')}.no_such_cell`,
					after: 'a@b.c'
				},
				{ id: 'unknown', field: 'main.no_such_field', after: 1 },
				{ id: 'first', field: doc.pathFor('columns'), after: 2 },
				{ id: 'second', field: doc.pathFor('columns'), after: 3 },
				over(doc, 'same', first)
			];
		});
		await settle();
		expect(r.drawn.at(-1)).toEqual({
			open: ['first'],
			outdated: [],
			undrawn: [
				{ id: 'nowhere', reason: 'block' },
				{ id: 'inside', reason: 'field' },
				{ id: 'unknown', reason: 'field' },
				{ id: 'second', reason: 'taken' },
				{ id: 'same', reason: 'applied' }
			]
		});
		expect(await r.editor.revealReview('same')).toBe(false);
	});
});

describe('a proposal by blocks', () => {
	const blocks = (doc: Document): ReviewItem[] => {
		const [first] = doc.blocks({});
		return [
			{
				id: 'body',

				field: doc.pathFor({}),
				replace: [first.id],
				before: first.markdown,
				after: `${first.markdown} More.`
			},
			{
				id: 'abs',

				field: doc.pathFor('abstract'),
				insert: 'end',
				after: 'Appended.'
			},
			{ id: 'lost', field: doc.pathFor({}), replace: ['nope'], after: 'X.' },
			{ id: 'cols', field: doc.pathFor('columns'), before: 5, after: 2 }
		];
	};

	it('is drawn in the leaf of the field it names, and said outdated where its value moved', async () => {
		const r = batch(blocks);
		await settle();
		const { open: order, outdated, undrawn } = r.drawn.at(-1)!;
		expect([...order].sort()).toEqual(['abs', 'body', 'cols']);
		expect(order).toEqual(pageOrder(r.target, order));
		expect(outdated).toEqual(['cols']);
		expect(undrawn).toEqual([{ id: 'lost', reason: 'block' }]);
	});

	it('is taken by the host as the leaf’s own edit', async () => {
		const r = batch(blocks);
		await settle();
		expect([...r.editor.answerReview(['body', 'abs'], 'accept')].sort()).toEqual(['abs', 'body']);
		const [first] = r.doc.blocks({});
		expect(first.markdown.endsWith(' More.')).toBe(true);
		expect((r.doc.getStored('abstract') as { text: string }).text.endsWith('Appended.')).toBe(true);
		expect(r.events.map((e) => e.action)).toEqual(['accept', 'accept']);
	});
});

describe('answering by the host', () => {
	it('answers every item drawn, one event each, and leaves the focus where it was', async () => {
		const r = batch((doc) => [
			over(doc, 'p1', 'The first, proposed.'),
			over(doc, 'p2', 'The second, proposed.', undefined, 1),
			{ id: 'cols', field: doc.pathFor('columns'), after: 2 }
		]);
		await settle();
		const outside = document.createElement('button');
		document.body.append(outside);
		outside.focus();
		const answered = r.editor.answerReview('all', 'accept');
		flushSync();
		expect([...answered].sort()).toEqual(['cols', 'p1', 'p2']);
		expect(r.events.map((e) => e.action)).toEqual(['accept', 'accept', 'accept']);
		expect(r.doc.main.body.text).toContain('The first, proposed.');
		expect(r.doc.main.body.text).toContain('The second, proposed.');
		expect(r.doc.getStored('columns')).toBe(2);
		expect(document.activeElement).toBe(outside);
		outside.remove();
	});

	it('passes over an accepted proposal when it dismisses them all, leaving it plain text', async () => {
		const r = batch((doc) => [
			over(doc, 'c1', 'An accepted line.'),
			over(doc, 'p1', 'A proposed line.', undefined, 3)
		]);
		await settle();
		expect(r.editor.answerReview(['c1'], 'accept')).toEqual(['c1']);
		await settle();
		r.events.length = 0;
		const body = r.doc.main.body.text;
		expect(r.editor.answerReview('all', 'dismiss')).toEqual(['p1']);
		flushSync();
		expect(r.events).toEqual([{ id: 'p1', action: 'dismiss' }]);
		expect(r.doc.main.body.text).toBe(body);
		expect(body).toContain('An accepted line.');
		expect(r.target.querySelector('[data-qm-review="c1"]')).toBeNull();
	});
});

describe('stepping', () => {
	it('walks the drawn items in page order and round from the end', async () => {
		const r = batch(spread);
		await settle();
		const { open: order } = r.drawn.at(-1)!;
		const walked: (string | undefined)[] = [];
		for (let i = 0; i <= order.length; i++)
			walked.push(await r.editor.stepReview(1, { focus: false }));
		expect(walked).toEqual([...order, order[0]]);
		expect(await r.editor.stepReview(-1, { focus: false })).toBe(order.at(-1));
	});

	it('steps to a proposal that adds after a paragraph another proposal rewrites, and answers it', async () => {
		const r = batch((doc) => {
			const first = block(doc);
			return [
				over(doc, 'A', 'A rewrite.'),
				{
					id: 'B',

					field: first.field,
					insert: { after: first.id },
					after: 'Added after.'
				}
			];
		});
		await settle();
		expect(await r.editor.stepReview(1)).toBe('A');
		expect(await r.editor.stepReview(1)).toBe('B');
		press(document.activeElement as HTMLElement, keyOf(REVIEW_KEYS.accept), mod);
		expect(r.events).toEqual([{ id: 'B', action: 'accept' }]);
	});

	it('goes to the next and the previous item from the chords, from anywhere in the editor', async () => {
		const r = batch(spread);
		await settle();
		const { open: order } = r.drawn.at(-1)!;
		const root = r.target.querySelector<HTMLElement>('.qm-editor')!;
		const chord = async (dir: 'next' | 'previous') => {
			press(root, keyOf(REVIEW_KEYS[dir]), { ...mod, altKey: true });
			await settle();
			await settle();
		};
		await chord('next');
		expect(r.lit.at(-1)).toBe(order[0]);
		await chord('previous');
		expect(r.lit.at(-1)).toBe(order.at(-1));
	});

	it('goes on to the next item after an answer by chord, and stays after one by pointer', async () => {
		const chorded = batch(spread);
		await settle();
		const order = chorded.drawn.at(-1)!.open;
		expect(await chorded.editor.stepReview(1)).toBe(order[0]);
		press(document.activeElement as HTMLElement, keyOf(REVIEW_KEYS.dismiss), mod);
		await settle();
		await settle();
		expect(chorded.events).toEqual([{ id: order[0], action: 'dismiss' }]);
		expect(chorded.lit.at(-1)).toBe(order[1]);
		unmountAll();

		const pressed = batch(spread);
		await settle();
		const first = pressed.drawn.at(-1)!.open[0];
		const dismiss = [
			...pressed.target.querySelectorAll<HTMLButtonElement>('.qm-review-dismiss')
		].find((el) => el.closest('[data-qm-review]')?.getAttribute('data-qm-review') === first)!;
		dismiss.click();
		await settle();
		await settle();
		expect(pressed.events).toEqual([{ id: first, action: 'dismiss' }]);
		expect(pressed.lit.filter(Boolean)).toEqual([]);
	});

	it('stays on the answered item’s place when the host turns advancing off', async () => {
		const r = batch(spread, false);
		await settle();
		const order = r.drawn.at(-1)!.open;
		await r.editor.stepReview(1);
		const before = r.lit.length;
		press(document.activeElement as HTMLElement, keyOf(REVIEW_KEYS.dismiss), mod);
		await settle();
		await settle();
		expect(r.lit.slice(before)).not.toContain(order[1]);
	});
});
