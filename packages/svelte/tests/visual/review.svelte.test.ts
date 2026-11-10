// @vitest-environment jsdom
// Review on the surface: a host's list drawn where each item is, a proposal taken as the
// editor's own edit, and every answer handed back as an event.
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
const card = (): HTMLElement | null => document.querySelector<HTMLElement>('.qm-review-card');
const toast = (target: HTMLElement) => target.querySelector<HTMLElement>('.qm-toast');
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

describe('a changed field', () => {
	const changed = (doc: Document): ReviewItem[] => [
		{ id: 'r1', state: 'changed', field: doc.pathFor('subtitle'), before: 'An older subtitle' }
	];

	it('marks the control, and raises its card with what the value was on focus', () => {
		const r = review(changed);
		const control = openField(r.target, main, 'subtitle').querySelector('.qm-field-control')!;
		expect(control.getAttribute('data-qm-review')).toBe('r1');
		expect(card()).toBeNull();
		leaf(control as HTMLElement).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		flushSync();
		expect(card()?.textContent).toContain('An older subtitle');
		expect(r.lit.at(-1)).toBe('r1');
	});

	it('asks the host for the change back, and writes nothing', () => {
		const r = review(changed);
		const before = r.doc.toMarkdown();
		const control = openField(r.target, main, 'subtitle').querySelector('.qm-field-control')!;
		leaf(control as HTMLElement).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		flushSync();
		card()!.querySelector<HTMLButtonElement>('.qm-review-undo')!.click();
		flushSync();
		expect(r.events).toEqual([{ id: 'r1', action: 'undo' }]);
		expect(r.doc.toMarkdown()).toBe(before);
		expect(r.changes).toEqual([]);
		expect(r.target.querySelector('[data-qm-review]')).toBeNull();
	});

	it('answers the reject chord from inside the field', () => {
		const r = review(changed);
		press(leaf(openField(r.target, main, 'subtitle')), keyOf(REVIEW_KEYS.reject), mod);
		expect(r.events).toEqual([{ id: 'r1', action: 'undo' }]);
	});
});

describe('a proposed field value', () => {
	const proposed =
		(after: unknown) =>
		(doc: Document): ReviewItem[] => [
			{ id: 'r1', state: 'proposed', field: doc.pathFor('columns'), after }
		];
	const row = (r: Reviewed) =>
		openField(r.target, main, 'columns').querySelector<HTMLElement>('.qm-review-proposal')!;

	it('stands under the control as the value that would come', () => {
		const r = review(proposed(2));
		expect(row(r).querySelector('ins')?.textContent).toBe('2');
		expect(r.doc.getStored('columns')).toBeUndefined();
	});

	it('is written down the field lane when taken, with the step back on the toast', async () => {
		const r = review(proposed(2));
		row(r).querySelector<HTMLButtonElement>('.qm-review-accept')!.click();
		flushSync();
		expect(r.doc.getStored('columns')).toBe(2);
		expect(r.changes.map((c) => c.source)).toEqual(['field']);
		expect(r.events).toEqual([{ id: 'r1', action: 'accept' }]);
		expect(r.target.querySelector('.qm-review-proposal')).toBeNull();

		toast(r.target)!.querySelector<HTMLButtonElement>('.qm-toast-action')!.click();
		flushSync();
		await settle();
		expect(r.doc.getStored('columns')).toBeUndefined();
	});

	it('is left alone when turned down', () => {
		const r = review(proposed(2));
		row(r).querySelector<HTMLButtonElement>('.qm-review-dismiss')!.click();
		flushSync();
		expect(r.events).toEqual([{ id: 'r1', action: 'dismiss' }]);
		expect(r.changes).toEqual([]);
		expect(r.target.querySelector('.qm-review-proposal')).toBeNull();
	});

	it('stands, unanswered, where the field’s writer refuses it', () => {
		const r = review(proposed('several'));
		row(r).querySelector<HTMLButtonElement>('.qm-review-accept')!.click();
		flushSync();
		expect(r.events).toEqual([]);
		expect(r.errors.map((e) => e.code)).toEqual(['commit-refused']);
		expect(r.target.querySelector('.qm-review-proposal')).not.toBeNull();
	});

	it('reads a line of words as an edit of the line, and a text leaf re-reads it once taken', () => {
		const r = review((doc) => [
			{
				id: 'r1',
				state: 'proposed',
				field: doc.pathFor('subtitle'),
				after: `${stored(doc, 'subtitle')}, revised`
			}
		]);
		const before = stored(r.doc, 'subtitle') as string;
		const subtitle = openField(r.target, main, 'subtitle');
		const proposal = subtitle.querySelector<HTMLElement>('.qm-review-proposal')!;
		expect(proposal.querySelector('del')).toBeNull();
		expect(proposal.querySelector('ins')?.textContent).toBe(', revised');
		press(leaf(subtitle), keyOf(REVIEW_KEYS.accept), mod);
		expect(stored(r.doc, 'subtitle')).toBe(`${before}, revised`);
		expect(leafText(subtitle)).toBe(`${before}, revised`);
	});
});

describe('an item in a closed group', () => {
	const items = (doc: Document): ReviewItem[] => [
		{ id: 'r1', state: 'proposed', field: doc.pathFor('columns'), after: 2 }
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
});

describe('an item in the body', () => {
	const anchored =
		(state: 'changed' | 'proposed') =>
		(doc: Document): ReviewItem[] => {
			const word = doc.main.body.text.split(' ')[1];
			const at = doc.main.body.text.indexOf(word);
			doc.apply({}, { steps: [{ anchor: { id: '~a1', start: at, end: at + word.length } }] });
			return state === 'changed'
				? [{ id: 'r1', state, anchor: '~a1', before: 'was' }]
				: [{ id: 'r1', state, anchor: '~a1', after: 'A proposed line.' }];
		};

	it('is drawn in the leaf holding its anchor', () => {
		const r = review(anchored('changed'));
		expect(r.target.querySelector('.ProseMirror .qm-review-changed')).not.toBeNull();
	});

	it('is the leaf’s own edit when taken, and the event follows the change', () => {
		const r = review(anchored('proposed'));
		r.target.querySelector<HTMLButtonElement>('.ProseMirror .qm-review-accept')!.click();
		flushSync();
		expect(r.doc.main.body.text.startsWith('A proposed line.')).toBe(true);
		expect(r.changes.map((c) => c.source)).toEqual(['prose']);
		expect(r.events).toEqual([{ id: 'r1', action: 'accept' }]);
	});

	it('is drawn no more once answered, while the list still holds it', () => {
		const r = review(anchored('proposed'));
		r.target.querySelector<HTMLButtonElement>('.ProseMirror .qm-review-dismiss')!.click();
		flushSync();
		expect(r.target.querySelector('[data-qm-review]')).toBeNull();
		r.props.review = [...r.props.review!];
		flushSync();
		expect(r.target.querySelector('[data-qm-review]')).toBeNull();
		r.props.review = [];
		flushSync();
		r.props.review = anchoredAgain();
		flushSync();
		expect(r.target.querySelector('[data-qm-review]')).not.toBeNull();
	});
	const anchoredAgain = (): ReviewItem[] => [
		{ id: 'r1', state: 'proposed', anchor: '~a1', after: 'A proposed line.' }
	];
});

describe('a host’s step', () => {
	it('is offered on the toast, and taken by the key from inside a text leaf', () => {
		const r = review(() => []);
		let undone = 0;
		r.editor.offerUndo('Three places edited', () => undone++);
		flushSync();
		expect(toast(r.target)?.textContent).toContain('Three places edited');
		press(leaf(r.target), 'z', mod);
		expect(undone).toBe(1);
		expect(toast(r.target)).toBeNull();
	});

	it('is withdrawn by the function offering it returned', () => {
		const r = review(() => []);
		let undone = 0;
		const withdraw = r.editor.offerUndo('Three places edited', () => undone++);
		flushSync();
		withdraw();
		flushSync();
		expect(toast(r.target)).toBeNull();
		press(document.body, 'z', mod);
		expect(undone).toBe(0);
	});

	it('gives way to the reader’s next edit', () => {
		const r = review((doc) => [
			{ id: 'r1', state: 'proposed', field: doc.pathFor('columns'), after: 2 }
		]);
		let undone = 0;
		r.editor.offerUndo('Three places edited', () => undone++);
		flushSync();
		openField(r.target, main, 'columns')
			.querySelector<HTMLButtonElement>('.qm-review-accept')!
			.click();
		flushSync();
		press(document.body, 'z', mod);
		expect(undone).toBe(0);
		expect(r.doc.getStored('columns')).toBeUndefined();
	});
});
