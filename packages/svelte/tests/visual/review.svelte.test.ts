// @vitest-environment jsdom
// Review on the surface: a host's list drawn where each item is, answered on the one answer card
// or by the review keys, a proposal taken as the editor's own edit, and every answer handed back
// as an event.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import { REVIEW_KEYS } from '$lib/core/codec';
import type { ReviewEvent, ReviewItem } from '$lib/visual';
import { quill, example } from '../helpers/fixtures.js';
import {
	leaf,
	leafText,
	mountEditor,
	openField,
	press,
	settle,
	unmountAll,
	type EditorRef,
	type Mounted
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const main = quill().schema.main;
/** One of the answer card's two buttons. */
const answer = (target: HTMLElement, action: 'accept' | 'dismiss') =>
	target.querySelector<HTMLButtonElement>(`.qm-review-card .qm-review-card-${action}`)!;
const keyOf = (chord: string): string => chord.slice(chord.lastIndexOf('-') + 1);
const mod = { ctrlKey: true };

interface Reviewed extends Mounted<EditorRef> {
	doc: Document;
	events: ReviewEvent[];
	lit: (string | undefined)[];
}

function review(items: (doc: Document) => ReviewItem[]): Reviewed {
	const doc = example();
	const events: ReviewEvent[] = [];
	const lit: (string | undefined)[] = [];
	const mounted = mountEditor(quill(), doc, {
		review: items(doc),
		onReview: (e) => events.push(e),
		onReviewFocus: (id) => lit.push(id)
	});
	return { ...mounted, doc, events, lit };
}

/** The text a stored `text` or rich text value holds. */
const stored = (doc: Document, name: string): unknown =>
	(doc.getStored(name) as { text?: string } | undefined)?.text ?? doc.getStored(name);

describe('an accepted field proposal', () => {
	it('leaves the control as any value it holds, with no answer left on it', () => {
		const r = review((doc) => [
			{ id: 'r1', field: doc.pathFor('subtitle'), after: 'A newer subtitle' }
		]);
		const before = r.doc.toMarkdown();
		expect(r.editor.answerReview(['r1'], 'accept')).toEqual(['r1']);
		flushSync();
		const field = openField(r.target, main, 'subtitle');
		expect(field.querySelector('[data-qm-review]')).toBeNull();
		press(leaf(field), keyOf(REVIEW_KEYS.dismiss), mod);
		expect(r.events).toEqual([{ id: 'r1', action: 'accept' }]);
		expect(r.doc.toMarkdown()).not.toBe(before);
	});
});

describe('a proposed field value', () => {
	const proposed =
		(after: unknown) =>
		(doc: Document): ReviewItem[] => [{ id: 'r1', field: doc.pathFor('columns'), after }];

	it('strikes the number its control holds and tints the one that would come, writing nothing', async () => {
		const r = review(proposed(2));
		const columns = openField(r.target, main, 'columns');
		const input = columns.querySelector<HTMLInputElement>('.qm-field-control input')!;
		const held = input.value;
		const drawn = columns.querySelector('.qm-number-review')!;
		expect(drawn.querySelector('del')?.textContent).toBe(held);
		expect(drawn.querySelector('ins')?.textContent).toBe('2');
		expect(drawn.querySelector('ins')?.getAttribute('data-qm-review')).toBe('r1');
		expect(columns.querySelector('[data-qm-proposed]')).toBeNull();
		await settle();
		expect(r.target.querySelector('.qm-review-card')?.textContent).not.toContain('2');
		expect(r.doc.getStored('columns')).toBeUndefined();
	});

	it('leaves the default unsaid while it stands', () => {
		const r = review(proposed(2));
		const columns = openField(r.target, main, 'columns').closest('.qm-field')!;
		expect(columns.querySelector('[id$="-default"]')).toBeNull();
		r.editor.answerReview(['r1'], 'dismiss');
		flushSync();
		expect(columns.querySelector('[id$="-default"]')).not.toBeNull();
	});

	it('shows a switch as the face it would take, marked', () => {
		const r = review((doc) => [
			{ id: 'r1', field: doc.pathFor('draft_watermark'), before: false, after: true }
		]);
		const field = openField(r.target, main, 'draft_watermark');
		expect(field.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
		expect(field.querySelector('[data-qm-proposed]')).not.toBeNull();
		expect(r.doc.getStored('draft_watermark')).not.toBe(true);
	});

	it('draws no answers of its own: the answer card on it answers it', async () => {
		const r = review(proposed(2));
		expect(openField(r.target, main, 'columns').querySelector('.qm-review-card')).toBeNull();
		await settle();
		expect(r.lit.at(-1)).toBe('r1');
		expect(answer(r.target, 'accept').textContent).toContain('Accept');
		expect(answer(r.target, 'dismiss').textContent).toContain('Dismiss');
	});

	it('is written down the field lane when taken, and ⌘Z writes back what it replaced', async () => {
		const r = review(proposed(2));
		await settle();
		answer(r.target, 'accept').click();
		flushSync();
		expect(r.doc.getStored('columns')).toBe(2);
		expect(r.changes.map((c) => c.source)).toEqual(['field']);
		expect(r.events).toEqual([{ id: 'r1', action: 'accept' }]);
		expect(r.target.querySelector('[data-qm-review~="r1"]')).toBeNull();
		expect(r.target.querySelector('.qm-toast')).toBeNull();

		press(document.body, 'z', mod);
		await settle();
		expect(r.doc.getStored('columns')).toBeUndefined();
		expect(r.events.at(-1)).toEqual({ id: 'r1', action: 'reopen' });
	});

	it('is current once the focus arrives in its field', async () => {
		const r = review((doc) => [
			{ id: 'sub', field: doc.pathFor('subtitle'), after: 'A newer subtitle' },
			...proposed(2)(doc)
		]);
		await settle();
		const control = openField(r.target, main, 'columns').querySelector('.qm-field-control')!;
		control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		flushSync();
		expect(r.lit.at(-1)).toBe('r1');
	});

	it('leaves the focus where it was when answered from the card', async () => {
		const r = review(proposed(2));
		await settle();
		const columns = openField(r.target, main, 'columns');
		const input = columns.querySelector<HTMLElement>('input')!;
		input.focus();
		answer(r.target, 'dismiss').click();
		flushSync();
		expect(document.activeElement).toBe(input);
	});

	it('is left alone when turned down', async () => {
		const r = review(proposed(2));
		await settle();
		press(document.body, keyOf(REVIEW_KEYS.dismiss), mod);
		expect(r.events).toEqual([{ id: 'r1', action: 'dismiss' }]);
		expect(r.changes).toEqual([]);
		expect(r.target.querySelector('[data-qm-review~="r1"]')).toBeNull();
	});

	it('stands, unanswered, where the field’s writer refuses it', () => {
		const r = review(proposed('several'));
		expect(r.editor.answerReview(['r1'], 'accept')).toEqual([]);
		flushSync();
		expect(r.events).toEqual([]);
		expect(r.errors.map((e) => e.code)).toEqual(['commit-refused']);
		expect(r.target.querySelector('[data-qm-review~="r1"]')).not.toBeNull();
	});

	it('draws a line of words as an edit of the line in its leaf, and the leaf re-reads it once taken', async () => {
		const r = review((doc) => [
			{
				id: 'r1',

				field: doc.pathFor('subtitle'),
				after: `${stored(doc, 'subtitle')}, revised`
			}
		]);
		const before = stored(r.doc, 'subtitle') as string;
		const subtitle = openField(r.target, main, 'subtitle');
		await settle();
		expect(leaf(subtitle).querySelector('.qm-review-del')).toBeNull();
		expect(leaf(subtitle).querySelector('.qm-review-ins')?.textContent).toBe(', revised');
		expect(subtitle.querySelector('[data-qm-proposed]')).toBeNull();
		expect(stored(r.doc, 'subtitle')).toBe(before);
		press(leaf(subtitle), keyOf(REVIEW_KEYS.accept), mod);
		expect(stored(r.doc, 'subtitle')).toBe(`${before}, revised`);
		expect(leafText(subtitle)).toBe(`${before}, revised`);
	});
});

describe('an item in a closed group', () => {
	const items = (doc: Document): ReviewItem[] => [
		{ id: 'r1', field: doc.pathFor('columns'), after: 2 }
	];
	const marked = (r: Reviewed) =>
		[...r.target.querySelectorAll('.qm-group-reviewed')].map((flag) =>
			flag.closest('.qm-group-header')!.getAttribute('aria-expanded')
		);

	it('marks the header that opens it', () => {
		expect(marked(review(items))).toEqual(['false']);
	});

	it('is brought to the reader by its id, its group opened, and lit', async () => {
		const r = review(items);
		expect(await r.editor.revealReview('r1')).toBe(true);
		flushSync();
		expect(marked(r)).toEqual([]);
		expect(r.lit.at(-1)).toBe('r1');
		expect(await r.editor.revealReview('nowhere')).toBe(false);
	});

	it('takes the focus to its field when asked to', async () => {
		const r = review(items);
		expect(await r.editor.revealReview('r1', { focus: true })).toBe(true);
		flushSync();
		const control = openField(r.target, main, 'columns').querySelector('.qm-field-control')!;
		expect(control.contains(document.activeElement)).toBe(true);
	});
});

describe('an item in the body', () => {
	const first = (doc: Document): ReviewItem[] => [
		{
			id: 'r1',

			field: 'main.body',
			replace: [doc.blocks({})[0].id],
			after: 'A proposed line.'
		}
	];

	it('is drawn in the body’s leaf', () => {
		const r = review(first);
		expect(r.target.querySelector('.ProseMirror [data-qm-review="r1"]')).not.toBeNull();
	});

	it('is the leaf’s own edit when taken, and the event follows the change', async () => {
		const r = review(first);
		await settle();
		answer(r.target, 'accept').click();
		flushSync();
		expect(r.doc.main.body.text.startsWith('A proposed line.')).toBe(true);
		expect(r.changes.map((c) => c.source)).toEqual(['prose']);
		expect(r.events).toEqual([{ id: 'r1', action: 'accept' }]);
	});

	it('takes the caret when revealed with the focus', async () => {
		const r = review(first);
		expect(await r.editor.revealReview('r1', { focus: true })).toBe(true);
		flushSync();
		const body = r.target
			.querySelector('[data-qm-review="r1"]')!
			.closest<HTMLElement>('.ProseMirror')!;
		expect(document.activeElement).toBe(body);
		press(body, keyOf(REVIEW_KEYS.dismiss), mod);
		expect(r.events).toEqual([{ id: 'r1', action: 'dismiss' }]);
	});

	it('is drawn no more once answered, while the list still holds it', () => {
		const r = review(first);
		r.editor.answerReview(['r1'], 'dismiss');
		flushSync();
		expect(r.target.querySelector('[data-qm-review]')).toBeNull();
		r.props.review = [...r.props.review!];
		flushSync();
		expect(r.target.querySelector('[data-qm-review]')).toBeNull();
		r.props.review = [];
		flushSync();
		r.props.review = first(r.doc);
		flushSync();
		expect(r.target.querySelector('[data-qm-review]')).not.toBeNull();
	});
});

describe('a removed card’s step', () => {
	it('leaves a removed card the key’s once an answer given over it is taken back', () => {
		const r = review((doc) => [{ id: 'r1', field: doc.pathFor('columns'), after: 2 }]);
		const before = r.doc.toMarkdown();
		r.target.querySelector<HTMLButtonElement>('.qm-card-delete')!.click();
		flushSync();
		const without = r.doc.toMarkdown();
		r.editor.answerReview(['r1'], 'accept');
		flushSync();
		press(document.body, 'z', mod);
		flushSync();
		expect(r.doc.toMarkdown()).toBe(without);
		press(document.body, 'z', mod);
		flushSync();
		expect(r.doc.toMarkdown()).toBe(before);
	});
});
