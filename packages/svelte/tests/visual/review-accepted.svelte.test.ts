// @vitest-environment jsdom
// An accepted proposal the host still lists: drawn as the change it made, with the card that takes
// it back out of order and opens it again, and counted in what the editor reports it draws.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, tick } from 'svelte';
import type { Document } from '@quillmark/wasm';
import type { ReviewDrawn, ReviewEvent, ReviewItem } from '$lib/visual';
import { quill, example } from '../helpers/fixtures.js';
import {
	mountEditor,
	openField,
	settle,
	type,
	unmountAll,
	type EditorRef,
	type Mounted
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const main = quill().schema.main;
const card = (): HTMLElement | null => document.querySelector<HTMLElement>('.qm-review-card');

interface Kept extends Mounted<EditorRef> {
	doc: Document;
	events: ReviewEvent[];
	drawn: ReviewDrawn[];
}

/** An editor whose host leaves an accepted item on its list, as the README's recipe does. */
function kept(items: (doc: Document) => ReviewItem[], listed = true): Kept {
	const doc = example();
	const events: ReviewEvent[] = [];
	const drawn: ReviewDrawn[] = [];
	const mounted = mountEditor(quill(), doc, {
		review: listed ? items(doc) : [],
		onReview: (e) => events.push(e),
		onReviewDrawn: (d) => drawn.push(d)
	});
	return { ...mounted, doc, events, drawn };
}

/** Lay anchor `id` over the second word of the body. */
function anchor(doc: Document, id: string): void {
	const text = doc.main.body.text;
	const word = text.split(' ')[1];
	const at = text.indexOf(word);
	doc.apply({}, { steps: [{ anchor: { id, start: at, end: at + word.length } }] });
}

const pair = (doc: Document): ReviewItem[] => {
	anchor(doc, '~a');
	return [
		{ id: 'A', state: 'proposed', anchor: '~a', after: 'The body, proposed.' },
		{ id: 'F', state: 'proposed', field: doc.pathFor('columns'), after: 2 }
	];
};

describe('an accepted proposal still listed', () => {
	it('draws as the change it made, in text and in a field, and is reported as accepted', async () => {
		const r = kept(pair);
		openField(r.target, main, 'columns');
		await settle();
		expect([...r.editor.answerReview('all', 'accept')].sort()).toEqual(['A', 'F']);
		await settle();
		expect(r.target.querySelector('.qm-review-chip, .qm-review-proposal')).toBeNull();
		expect(r.target.querySelector('.ProseMirror .qm-review-changed')?.textContent).toContain(
			'proposed'
		);
		const control = r.target.querySelector('.qm-field-control.qm-review-set');
		expect(control?.getAttribute('data-qm-review')).toBe('F');
		const report = r.drawn.at(-1)!;
		expect([...report.accepted].sort()).toEqual(['A', 'F']);
		expect([...report.order].sort()).toEqual(['A', 'F']);
	});

	it('is taken back from its card out of order, and opens again', async () => {
		const r = kept(pair);
		const body = r.doc.main.body.text;
		openField(r.target, main, 'columns');
		await settle();
		r.editor.answerReview('all', 'accept');
		await settle();
		expect(await r.editor.revealReview('A')).toBe(true);
		flushSync();
		card()!.querySelector<HTMLButtonElement>('.qm-review-undo')!.click();
		await settle();
		expect(r.events.at(-1)).toEqual({ id: 'A', action: 'reopen' });
		expect(r.doc.main.body.text).toBe(body);
		expect(r.doc.getStored('columns')).toBe(2);
		expect(r.target.querySelector('.qm-review-chip')).not.toBeNull();
		expect(r.drawn.at(-1)!.accepted).toEqual(['F']);
	});

	it('writes a field’s old value back from its card, and drops its mark once the reader sets another', async () => {
		const r = kept(pair);
		openField(r.target, main, 'columns');
		await settle();
		r.editor.answerReview(['F'], 'accept');
		await settle();
		expect(await r.editor.revealReview('F')).toBe(true);
		flushSync();
		card()!.querySelector<HTMLButtonElement>('.qm-review-undo')!.click();
		await settle();
		expect(r.doc.getStored('columns')).toBeUndefined();
		expect(r.events.at(-1)).toEqual({ id: 'F', action: 'reopen' });
		expect(r.target.querySelector('.qm-review-proposal')).not.toBeNull();

		r.editor.answerReview(['F'], 'accept');
		await settle();
		const field = openField(r.target, main, 'columns');
		const input = field.querySelector<HTMLInputElement>('input')!;
		type(input, '3');
		await settle();
		expect(r.doc.getStored('columns')).toBe(3);
		expect(
			r.target.querySelector('.qm-field-control.qm-review-set, .qm-review-proposal')
		).toBeNull();
		expect(r.drawn.at(-1)!.accepted).toEqual([]);
		expect(r.events.at(-1)).toEqual({ id: 'F', action: 'accept' });
	});

	it('takes every accepted proposal back with one call', async () => {
		const r = kept(pair);
		const body = r.doc.main.body.text;
		openField(r.target, main, 'columns');
		await settle();
		r.editor.answerReview('all', 'accept');
		await settle();
		expect([...r.editor.answerReview('all', 'reopen')].sort()).toEqual(['A', 'F']);
		await settle();
		expect(r.doc.main.body.text).toBe(body);
		expect(r.doc.getStored('columns')).toBeUndefined();
		expect(r.drawn.at(-1)!.accepted).toEqual([]);
		expect(r.drawn.at(-1)!.order).toHaveLength(2);
	});

	it('is accepted on arrival: a list handed over and accepted before the next frame', async () => {
		const doc = example();
		const items = pair(doc);
		const events: ReviewEvent[] = [];
		const r = mountEditor(quill(), doc, { review: [], onReview: (e) => events.push(e) });
		openField(r.target, main, 'columns');
		await settle();
		r.props.review = items;
		await tick();
		expect([...r.editor.answerReview('all', 'accept')].sort()).toEqual(['A', 'F']);
		expect(doc.main.body.text).toContain('The body, proposed.');
		expect(doc.getStored('columns')).toBe(2);
	});
});
