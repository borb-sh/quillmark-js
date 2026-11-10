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

/** Lay anchor `id` over the `n`th word of a rich text field's text, or of the body's. */
function anchor(doc: Document, field: string | undefined, id: string, n: number): void {
	const text = field
		? (doc.getStored(field) as { text: string }).text
		: (doc.main.body.text as string);
	const word = text.split(' ')[n];
	const at = text.indexOf(word);
	doc.apply(field ? { field } : {}, {
		steps: [{ anchor: { id, start: at, end: at + word.length } }]
	});
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

const spread = (doc: Document): ReviewItem[] => {
	anchor(doc, undefined, '~b', 1);
	anchor(doc, 'abstract', '~a', 1);
	return [
		{ id: 'body', state: 'proposed', anchor: '~b', after: 'A body line, proposed.' },
		{ id: 'cols', state: 'proposed', field: doc.pathFor('columns'), after: 2 },
		{ id: 'abs', state: 'proposed', anchor: '~a', after: 'An abstract, proposed.' }
	];
};

describe('the drawn report', () => {
	it('names the open items in the order the page shows them, across leaves and fields', async () => {
		const r = batch(spread);
		await settle();
		const { order, undrawn } = r.drawn.at(-1)!;
		expect([...order].sort()).toEqual(['abs', 'body', 'cols']);
		expect(order).toEqual(pageOrder(r.target, order));
		expect(undrawn).toEqual([]);
	});

	it('says why each item it does not draw is not drawn', async () => {
		const r = batch((doc) => {
			anchor(doc, undefined, '~b', 1);
			const body = doc.main.body.text as string;
			const first = body.split('\n')[0];
			return [
				{ id: 'nowhere', state: 'proposed', anchor: '~gone', after: 'Anything.' },
				{
					id: 'inside',
					state: 'proposed',
					field: `${doc.pathFor('contact')}.email`,
					after: 'a@b.c'
				},
				{ id: 'unknown', state: 'proposed', field: 'main.no_such_field', after: 1 },
				{ id: 'first', state: 'proposed', field: doc.pathFor('columns'), after: 2 },
				{ id: 'second', state: 'proposed', field: doc.pathFor('columns'), after: 3 },
				{ id: 'same', state: 'proposed', anchor: '~b', after: first }
			];
		});
		await settle();
		expect(r.drawn.at(-1)).toEqual({
			order: ['first'],
			accepted: [],
			outdated: [],
			undrawn: [
				{ id: 'nowhere', reason: 'anchor' },
				{ id: 'inside', reason: 'field' },
				{ id: 'unknown', reason: 'field' },
				{ id: 'second', reason: 'taken' },
				{ id: 'same', reason: 'applied' }
			]
		});
		expect(await r.editor.revealReview('same')).toBe(false);
	});
});

describe('answering by the host', () => {
	it('answers every item drawn, one event each, and leaves the focus where it was', async () => {
		const r = batch((doc) => {
			anchor(doc, undefined, '~b1', 1);
			const body = doc.main.body.text as string;
			const second = body.split('\n')[1].split(' ')[1];
			const at = body.indexOf(second, body.indexOf('\n'));
			doc.apply({}, { steps: [{ anchor: { id: '~b2', start: at, end: at + second.length } }] });
			return [
				{ id: 'p1', state: 'proposed', anchor: '~b1', after: 'The first, proposed.' },
				{ id: 'p2', state: 'proposed', anchor: '~b2', after: 'The second, proposed.' },
				{ id: 'cols', state: 'proposed', field: doc.pathFor('columns'), after: 2 }
			];
		});
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

	it('passes over a change when it dismisses them all, as it does when it accepts', async () => {
		const r = batch((doc) => {
			anchor(doc, undefined, '~c', 1);
			anchor(doc, undefined, '~p', 3);
			return [
				{ id: 'c1', state: 'changed', anchor: '~c', before: 'was' },
				{ id: 'p1', state: 'proposed', anchor: '~p', after: 'A proposed line.' }
			];
		});
		await settle();
		const body = r.doc.main.body.text;
		expect(r.editor.answerReview('all', 'dismiss')).toEqual(['p1']);
		flushSync();
		expect(r.events).toEqual([{ id: 'p1', action: 'dismiss' }]);
		expect(r.doc.main.body.text).toBe(body);
		expect(r.target.querySelector('[data-qm-review="c1"]')).not.toBeNull();
	});
});

describe('stepping', () => {
	it('walks the drawn items in page order and round from the end', async () => {
		const r = batch(spread);
		await settle();
		const { order } = r.drawn.at(-1)!;
		const walked: (string | undefined)[] = [];
		for (let i = 0; i <= order.length; i++)
			walked.push(await r.editor.stepReview(1, { focus: false }));
		expect(walked).toEqual([...order, order[0]]);
		expect(await r.editor.stepReview(-1, { focus: false })).toBe(order.at(-1));
	});

	it('steps to a proposal that adds after a paragraph another proposal rewrites, and answers it', async () => {
		const r = batch((doc) => {
			anchor(doc, undefined, '~a', 1);
			const at = (doc.main.body.text as string).indexOf(' ');
			doc.apply({}, { steps: [{ anchor: { id: '~p', start: at, end: at } }] });
			return [
				{ id: 'A', state: 'proposed', anchor: '~a', after: 'A rewrite.' },
				{ id: 'B', state: 'proposed', anchor: '~p', after: 'Added after.' }
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
		const { order } = r.drawn.at(-1)!;
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
		const order = chorded.drawn.at(-1)!.order;
		expect(await chorded.editor.stepReview(1)).toBe(order[0]);
		press(document.activeElement as HTMLElement, keyOf(REVIEW_KEYS.dismiss), mod);
		await settle();
		await settle();
		expect(chorded.events).toEqual([{ id: order[0], action: 'dismiss' }]);
		expect(chorded.lit.at(-1)).toBe(order[1]);
		unmountAll();

		const pressed = batch(spread);
		await settle();
		const first = pressed.drawn.at(-1)!.order[0];
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
		const order = r.drawn.at(-1)!.order;
		await r.editor.stepReview(1);
		const before = r.lit.length;
		press(document.activeElement as HTMLElement, keyOf(REVIEW_KEYS.dismiss), mod);
		await settle();
		await settle();
		expect(r.lit.slice(before)).not.toContain(order[1]);
	});
});
