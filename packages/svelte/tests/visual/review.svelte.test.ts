// @vitest-environment jsdom
// Review on the surface: a host's list drawn where each item is, a proposal taken as the
// editor's own edit, and every answer handed back as an event.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import { REVIEW_KEYS } from '$lib/core/codec';
import { HOVER_MS } from '$lib/visual/review.svelte';
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
/** The beat the focus rests in a changed field before its card rises. */
const rested = async (): Promise<void> => {
	await new Promise((done) => setTimeout(done, HOVER_MS));
	flushSync();
};

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
	const proposed = (doc: Document): ReviewItem[] => [
		{ id: 'r1', field: doc.pathFor('subtitle'), after: 'A newer subtitle' }
	];
	/** The editor over `proposed`, `r1` accepted. */
	function accepted(): Reviewed & { before: string } {
		const r = review(proposed);
		const before = r.doc.toMarkdown();
		expect(r.editor.answerReview(['r1'], 'accept')).toEqual(['r1']);
		flushSync();
		return { ...r, before };
	}

	it('marks the control, and raises its card with what the value was once the focus rests', async () => {
		const r = accepted();
		const was = stored(example(), 'subtitle') as string;
		const control = openField(r.target, main, 'subtitle').querySelector('.qm-field-control')!;
		expect(control.getAttribute('data-qm-review')).toBe('r1');
		leaf(control as HTMLElement).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		flushSync();
		expect(r.lit.at(-1)).toBe('r1');
		expect(card()).toBeNull();
		await rested();
		expect(card()?.textContent).toContain(was);
	});

	it('is taken back by its card’s Undo, and opens again', async () => {
		const r = accepted();
		const control = openField(r.target, main, 'subtitle').querySelector('.qm-field-control')!;
		leaf(control as HTMLElement).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		await rested();
		card()!.querySelector<HTMLButtonElement>('.qm-review-undo')!.click();
		flushSync();
		expect(r.events).toEqual([
			{ id: 'r1', action: 'accept' },
			{ id: 'r1', action: 'reopen' }
		]);
		expect(r.doc.toMarkdown()).toBe(r.before);
		expect(r.target.querySelector('.qm-review-proposal[data-qm-review="r1"]')).not.toBeNull();
	});

	it('answers the reject chord from inside the field by taking it back', () => {
		const r = accepted();
		press(leaf(openField(r.target, main, 'subtitle')), keyOf(REVIEW_KEYS.dismiss), mod);
		expect(r.events.at(-1)).toEqual({ id: 'r1', action: 'reopen' });
		expect(r.doc.toMarkdown()).toBe(r.before);
	});
});

describe('a proposed field value', () => {
	const proposed =
		(after: unknown) =>
		(doc: Document): ReviewItem[] => [{ id: 'r1', field: doc.pathFor('columns'), after }];
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

	it('is the lit item while the focus is in its field', () => {
		const r = review(proposed(2));
		const control = openField(r.target, main, 'columns').querySelector('.qm-field-control')!;
		control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		flushSync();
		expect(r.lit.at(-1)).toBe('r1');
	});

	it('hands the focus back to the control when answered from its row', () => {
		const r = review(proposed(2));
		const columns = openField(r.target, main, 'columns');
		const dismiss = row(r).querySelector<HTMLButtonElement>('.qm-review-dismiss')!;
		dismiss.focus();
		dismiss.click();
		flushSync();
		expect(columns.querySelector('.qm-field-control')!.contains(document.activeElement)).toBe(true);
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

	it('is the leaf’s own edit when taken, and the event follows the change', () => {
		const r = review(first);
		r.target.querySelector<HTMLButtonElement>('.ProseMirror .qm-review-accept')!.click();
		flushSync();
		expect(r.doc.main.body.text.startsWith('A proposed line.')).toBe(true);
		expect(r.changes.map((c) => c.source)).toEqual(['prose']);
		expect(r.events).toEqual([{ id: 'r1', action: 'accept' }]);
	});

	it('takes the caret when revealed with the focus, so its chords answer', async () => {
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
		r.target.querySelector<HTMLButtonElement>('.ProseMirror .qm-review-dismiss')!.click();
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
		openField(r.target, main, 'columns')
			.querySelector<HTMLButtonElement>('.qm-review-accept')!
			.click();
		flushSync();
		press(document.body, 'z', mod);
		flushSync();
		expect(r.doc.toMarkdown()).toBe(without);
		press(document.body, 'z', mod);
		flushSync();
		expect(r.doc.toMarkdown()).toBe(before);
	});
});
