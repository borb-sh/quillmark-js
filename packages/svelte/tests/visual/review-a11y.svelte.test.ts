// @vitest-environment jsdom
// A proposal says itself to assistive tech in more than colour: a marked control is described by
// the value it holds now, and each step names the field it lands on.
import { describe, it, expect, afterEach } from 'vitest';
import type { Document } from '@quillmark/wasm';
import type { ReviewItem } from '$lib/visual';
import { DEFAULT_VISUAL_STRINGS as words } from '$lib/visual/strings';
import { fieldTitle } from '$lib/visual/structure';
import { quill, example } from '../helpers/fixtures.js';
import { mountInner, openField, settle, trigger, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const main = quill().schema.main;

function review(items: (doc: Document) => ReviewItem[], seed?: (doc: Document) => void) {
	const doc = example();
	seed?.(doc);
	return mountInner(quill(), doc, { review: items(doc) });
}

/** What assistive tech reads after an element's name. */
const description = (el: Element): string =>
	(el.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.filter(Boolean)
		.map((id) => document.getElementById(id)?.textContent ?? '')
		.join(' ');

describe('a control under a proposal', () => {
	it('is described as a proposal, by the value it holds now', async () => {
		const r = review(
			(doc) => [{ id: 'accent', field: doc.pathFor('accent'), before: 'rust', after: 'slate' }],
			(doc) => quill().writer(doc).set('accent', 'rust')
		);
		await settle();
		const select = trigger(openField(r.target, main, 'accent'));
		expect(select.textContent?.trim()).toBe('slate');
		expect(description(select)).toContain(words.reviewCurrently('rust'));
	});

	it('describes each segment of a date, at the top level and in a table cell', async () => {
		const r = review(
			(doc) => [
				{ id: 'issued', field: doc.pathFor('issued'), before: '2026-03-01', after: '2026-04-01' },
				{ id: 'since', field: `${doc.pathFor('contributors')}[0].since`, after: '2026-04-01' }
			],
			(doc) => {
				quill().writer(doc).set('issued', '2026-03-01');
				quill()
					.writer(doc)
					.set('contributors', [{ name: 'Ada', role: 'author', since: '2025-11-03' }]);
			}
		);
		await settle();
		for (const [key, held] of [
			['issued', '2026-03-01'],
			['contributors', '2025-11-03']
		]) {
			const segments = [
				...openField(r.target, main, key).querySelectorAll('[data-qm-proposed] [role="spinbutton"]')
			];
			expect(segments.length).toBeGreaterThan(0);
			for (const segment of segments)
				expect(description(segment)).toContain(words.reviewCurrently(held));
		}
	});

	it('loses the description with the proposal', async () => {
		const r = review(
			(doc) => [{ id: 'accent', field: doc.pathFor('accent'), before: 'rust', after: 'slate' }],
			(doc) => quill().writer(doc).set('accent', 'rust')
		);
		await settle();
		r.editor.answerReview(['accent'], 'dismiss');
		await settle();
		const select = trigger(openField(r.target, main, 'accent'));
		expect(description(select)).not.toContain(words.reviewCurrently('rust'));
	});
});

describe('a step through the review', () => {
	it('names the field it lands on beside its place', async () => {
		const r = review((doc) => [
			{
				id: 'sub',
				field: doc.pathFor('subtitle'),
				before: 'A reference document',
				after: 'A revised reference document'
			}
		]);
		await settle();
		const status = r.target.querySelector('.qm-visually-hidden[role="status"]');
		const name = fieldTitle('subtitle', main.fields.subtitle);
		expect(status?.textContent).toBe(words.reviewPosition(1, 1, name));
	});
});
