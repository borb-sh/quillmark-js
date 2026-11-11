// @vitest-environment jsdom
// Every control under a proposal shows what Accept would write, and a commit on a control that
// shows one value answers the proposal on it (INVARIANTS §Review).
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Content, Document } from '@quillmark/wasm';
import type { ReviewDrawn, ReviewEvent, ReviewItem } from '$lib/visual';
import { proposalsBetween } from '$lib/visual';
import { quill, example } from '../helpers/fixtures.js';
import {
	activeView,
	leaf,
	mountInner,
	openField,
	openGroup,
	pick,
	press,
	settle,
	trigger,
	unmountAll,
	type InnerRef,
	type Mounted
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const main = quill().schema.main;

interface Reviewed extends Mounted<InnerRef> {
	doc: Document;
	events: ReviewEvent[];
	drawn: ReviewDrawn[];
}

function review(items: (doc: Document) => ReviewItem[], seed?: (doc: Document) => void): Reviewed {
	const doc = example();
	seed?.(doc);
	const events: ReviewEvent[] = [];
	const drawn: ReviewDrawn[] = [];
	const mounted = mountInner(quill(), doc, {
		review: items(doc),
		onReview: (e) => events.push(e),
		onReviewDrawn: (d) => drawn.push(d)
	});
	return { ...mounted, doc, events, drawn };
}

/** What item `id` draws in place: the words it strikes, then the words it writes. */
const drawnOf = (root: ParentNode, id: string): [string, string] => {
	const words = (selector: string) =>
		[...root.querySelectorAll(`${selector}[data-qm-review~="${id}"]`)]
			.map((el) => el.textContent)
			.join('');
	return [words('.qm-review-del'), words('.qm-review-ins')];
};
const text = (value: unknown): unknown => (value as { text?: string } | undefined)?.text ?? value;
const undo = (r: Reviewed): void => {
	press(r.target.querySelector<HTMLElement>('.qm-editor') ?? document.body, 'z', { ctrlKey: true });
	flushSync();
};

describe('a line of words under a proposal', () => {
	const subtitle = (doc: Document): ReviewItem[] => [
		{
			id: 'sub',
			field: doc.pathFor('subtitle'),
			before: 'A reference document',
			after: 'A revised reference document'
		}
	];

	it('leaves the reader’s typing beside it unstruck, and Accept keeps both', async () => {
		const r = review(subtitle);
		await settle();
		await r.editor.focusField('main.subtitle');
		const view = activeView(r.editor);
		view.dispatch(view.state.tr.insertText(', in print', view.state.doc.content.size - 1));
		flushSync();
		await settle();
		const field = openField(r.target, main, 'subtitle');
		expect(drawnOf(field, 'sub')).toEqual(['', 'revised ']);
		expect(r.drawn.at(-1)?.outdated).toEqual([]);
		r.editor.answerReview(['sub'], 'accept');
		flushSync();
		expect(text(r.doc.getStored('subtitle'))).toBe('A revised reference document, in print');
	});

	it('is outdated where the reader rewrote the words it rewrites, and Accept writes it whole', async () => {
		const r = review((doc) => [
			{
				id: 'sub',
				field: doc.pathFor('subtitle'),
				before: 'A reference document',
				after: 'A revised document'
			}
		]);
		await settle();
		await r.editor.focusField('main.subtitle');
		const view = activeView(r.editor);
		view.dispatch(view.state.tr.insertText('ref', 3, 12));
		flushSync();
		await settle();
		expect(r.drawn.at(-1)?.outdated).toEqual(['sub']);
		r.editor.answerReview(['sub'], 'accept');
		flushSync();
		expect(text(r.doc.getStored('subtitle'))).toBe('A revised document');
	});

	it('is drawn no more, and reported applied, once the reader has typed it', async () => {
		const r = review(subtitle);
		await settle();
		await r.editor.focusField('main.subtitle');
		const view = activeView(r.editor);
		view.dispatch(view.state.tr.insertText('revised ', 3));
		flushSync();
		await settle();
		expect(r.drawn.at(-1)?.open).toEqual([]);
		expect(r.drawn.at(-1)?.outdated).toEqual([]);
		expect(r.drawn.at(-1)?.undrawn).toEqual([{ id: 'sub', reason: 'applied' }]);
	});

	it('is left open by Accept all where it is outdated, the reader’s value kept', async () => {
		const r = review((doc) => [
			{ id: 'sub', field: doc.pathFor('subtitle'), before: 'Something else', after: 'New' },
			{ id: 'cols', field: doc.pathFor('columns'), after: 2 }
		]);
		await settle();
		expect(r.drawn.at(-1)?.outdated).toEqual(['sub']);
		expect(r.editor.answerReview('all', 'accept')).toEqual(['cols']);
		flushSync();
		expect(text(r.doc.getStored('subtitle'))).toBe('A reference document');
		expect(r.doc.getStored('columns')).toBe(2);
	});

	it('draws a change of formatting alone as the run struck and the run as it would read', async () => {
		const r = review((doc) => {
			const title = doc.getStored('title') as Content;
			const at = title.text.indexOf('Showcase');
			return [
				{
					id: 'em',
					field: doc.pathFor('title'),
					before: title,
					after: { ...title, marks: [{ type: 'emph', start: at, end: at + 8 }] }
				}
			];
		});
		await settle();
		const field = openField(r.target, main, 'title');
		expect(drawnOf(field, 'em')).toEqual(['Showcase', 'Showcase']);
		expect(field.querySelector('ins[data-qm-review~="em"] em')?.textContent).toBe('Showcase');
	});
});

describe('a cleared value', () => {
	it('shows what Accept leaves: the default a number, a choice and a date would print', async () => {
		const r = review(
			(doc) => [
				{ id: 'cols', field: doc.pathFor('columns'), before: 3 },
				{ id: 'accent', field: doc.pathFor('accent'), before: 'rust' },
				{ id: 'issued', field: doc.pathFor('issued'), before: '2026-03-01' }
			],
			(doc) => {
				const w = quill().writer(doc);
				w.set('columns', 3);
				w.set('accent', 'rust');
				w.set('issued', '2026-03-01');
			}
		);
		await settle();
		const cols = openField(r.target, main, 'columns').querySelector<HTMLInputElement>('input')!;
		expect(cols.value === '1' || cols.placeholder === '1').toBe(true);
		expect(trigger(openField(r.target, main, 'accent')).textContent?.trim()).toBe('slate');
		const issued = openField(r.target, main, 'issued').querySelector('.qm-date')?.textContent ?? '';
		expect(issued).toContain('2026');
		expect(issued).not.toContain('03');
		expect(r.drawn.at(-1)?.outdated).toEqual([]);
	});
});

describe('a control that shows one value', () => {
	const watermark = (doc: Document): ReviewItem[] => [
		{ id: 'wm', field: doc.pathFor('draft_watermark'), after: true }
	];

	it('answers a switch’s proposal with a press: the other state written and the proposal dismissed, ⌘Z bringing both back', async () => {
		const r = review(watermark);
		await settle();
		const field = openField(r.target, main, 'draft_watermark');
		const sw = () => field.querySelector<HTMLElement>('[role="switch"]')!;
		expect(sw().getAttribute('aria-checked')).toBe('true');
		sw().click();
		flushSync();
		expect(r.events).toEqual([{ id: 'wm', action: 'dismiss' }]);
		expect(r.doc.getStored('draft_watermark')).toBe(false);
		expect(sw().getAttribute('aria-checked')).toBe('false');
		expect(field.querySelector('[data-qm-review~="wm"]')).toBeNull();
		undo(r);
		await settle();
		expect(r.events.at(-1)).toEqual({ id: 'wm', action: 'reopen' });
		expect(r.doc.getStored('draft_watermark')).toBeUndefined();
		expect(sw().getAttribute('aria-checked')).toBe('true');
	});

	it('accepts a choice’s proposal where the reader picks the proposed member, and dismisses it for another', async () => {
		const r = review((doc) => [
			{ id: 'status', field: doc.pathFor('status'), before: 'draft', after: 'final' }
		]);
		await settle();
		const field = openField(r.target, main, 'status');
		expect(trigger(field).textContent?.trim()).toBe('final');
		pick(field, 'final');
		expect(r.events).toEqual([{ id: 'status', action: 'accept' }]);
		expect(r.doc.getStored('status')).toBe('final');
		undo(r);
		await settle();
		expect(r.doc.getStored('status')).toBe('draft');
		pick(openField(r.target, main, 'status'), 'approved');
		expect(r.events.at(-1)).toEqual({ id: 'status', action: 'dismiss' });
		expect(r.doc.getStored('status')).toBe('approved');
	});
});

describe('an answer’s list over a choice with variants and a checklist', () => {
	function between(edit: (doc: Document) => void) {
		return (doc: Document): ReviewItem[] => {
			const answer = doc.clone();
			edit(answer);
			const { items } = proposalsBetween(
				quill(),
				doc,
				answer,
				(() => {
					let n = 0;
					return () => `p${n++}`;
				})()
			);
			answer.free();
			return items;
		};
	}

	it('proposes the discriminant and each cell of its world apart, each drawn on its own control', async () => {
		const r = review(
			between(
				(answer) =>
					void quill().writer(answer).set('distribution', { value: 'embargoed', lift_on: 'June' })
			)
		);
		await settle();
		expect(r.drawn.at(-1)?.undrawn).toEqual([]);
		expect(r.drawn.at(-1)?.open).toHaveLength(2);
		const field = openField(r.target, main, 'distribution');
		expect(trigger(field).textContent?.trim()).toBe('embargoed');
		expect(drawnOf(field, 'p1')).toEqual(['', 'June']);
		r.editor.answerReview('all', 'accept');
		flushSync();
		expect(r.doc.getStored('distribution')).toMatchObject({ value: 'embargoed' });
	});

	it('proposes each member it ticks and each cell it changes apart', async () => {
		const r = review(
			between((answer) => {
				const checks = answer.getStored('checks') as Record<string, unknown>;
				void quill()
					.writer(answer)
					.set('checks', {
						...checks,
						spelling: { note: 'One typo in the abstract.' },
						figures: true
					});
			})
		);
		await settle();
		expect(r.drawn.at(-1)?.undrawn).toEqual([]);
		const checks = r.drawn.at(-1)!.open;
		expect(checks.length).toBeGreaterThanOrEqual(2);
		openGroup(r.target, 'Metadata');
		const figures = r.target.querySelector<HTMLInputElement>('[data-qm-prop="figures"] input')!;
		expect(figures.checked).toBe(true);
		expect(r.doc.getStored('checks')).not.toHaveProperty('figures');
	});
});

describe('a multi-line row of words', () => {
	it('draws its proposal as a word diff across its lines', async () => {
		const r = review((doc) => [
			{
				id: 'row',
				field: `${doc.pathFor('errata')}[1]`,
				before: 'Page 4 gives the wrong year.',
				after: 'Page 4 gives the wrong year.\nPage 5 too.'
			}
		]);
		await settle();
		const field = openField(r.target, main, 'errata');
		const [, ins] = drawnOf(leaf(field.querySelectorAll<HTMLElement>('.qm-array-row')[1]), 'row');
		expect(ins).toContain('Page 5 too.');
	});
});
