// @vitest-environment jsdom
// A proposal for a place inside a field: drawn under the cell or the row it names, taken alone
// down the lane an edit of that place takes, and taken back alone.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import type { ReviewDrawn, ReviewEvent, ReviewItem } from '$lib/visual';
import { groupLabel } from '$lib/visual/structure';
import { quill, example } from '../helpers/fixtures.js';
import {
	mountEditor,
	openField,
	settle,
	unmountAll,
	type EditorRef,
	type Mounted
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const main = quill().schema.main;

interface Nested extends Mounted<EditorRef> {
	doc: Document;
	events: ReviewEvent[];
	drawn: ReviewDrawn[];
}

function nested(items: (doc: Document) => ReviewItem[], seed?: (doc: Document) => void): Nested {
	const doc = example();
	seed?.(doc);
	const events: ReviewEvent[] = [];
	const drawn: ReviewDrawn[] = [];
	const mounted = mountEditor(quill(), doc, {
		review: items(doc),
		onReview: (e) => events.push(e),
		onReviewDrawn: (d) => drawn.push(d)
	});
	return { ...mounted, doc, events, drawn };
}

/** The proposal rows under field `name`, each as the words it shows. */
const rows = (r: Nested, name: string): string[] =>
	[...openField(r.target, main, name).querySelectorAll('.qm-review-proposal')].map((row) =>
		(row.querySelector('.qm-review-value')?.textContent ?? '').trim()
	);
/** A value with each plain text in it as its words. */
const texts = (value: unknown): unknown =>
	JSON.parse(
		JSON.stringify(value, (_, v: unknown) =>
			v && typeof v === 'object' && (v as { codec?: string }).codec === 'plain'
				? (v as { text: string }).text
				: v
		)
	);
const press = (r: Nested, id: string, action: 'accept' | 'dismiss'): void => {
	const row = r.target.querySelector(`.qm-review-proposal[data-qm-review="${id}"]`)!;
	row.querySelector<HTMLButtonElement>(`.qm-review-${action}`)!.click();
	flushSync();
};

describe('a record’s cell', () => {
	const contact = (doc: Document): ReviewItem[] => [
		{
			id: 'name',
			state: 'proposed',
			field: `${doc.pathFor('contact')}.name`,
			before: 'Ada',
			after: 'Grace'
		},
		{
			id: 'email',
			state: 'proposed',
			field: `${doc.pathFor('contact')}.email`,
			after: 'g@example.org'
		}
	];
	const seed = (doc: Document): void =>
		void quill().writer(doc).set('contact', { name: 'Ada', email: 'a@example.org' });

	it('is drawn under the cell it names, one row each', async () => {
		const r = nested(contact, seed);
		await settle();
		const cells = [...openField(r.target, main, 'contact').querySelectorAll('[data-qm-prop]')];
		const under = (prop: string) =>
			cells
				.find((c) => c.getAttribute('data-qm-prop') === prop)!
				.querySelector('.qm-review-proposal');
		expect(under('name')?.getAttribute('data-qm-review')).toBe('name');
		expect(under('email')?.getAttribute('data-qm-review')).toBe('email');
		expect(rows(r, 'contact')).toEqual(['AdaGrace', 'ag@example.org']);
		expect(r.drawn.at(-1)?.outdated).toEqual([]);
		expect(r.drawn.at(-1)?.undrawn).toEqual([]);
	});

	it('is taken alone, and taken back alone', async () => {
		const r = nested(contact, seed);
		await settle();
		press(r, 'name', 'accept');
		press(r, 'email', 'accept');
		expect(texts(r.doc.getStored('contact'))).toEqual({ name: 'Grace', email: 'g@example.org' });
		expect(r.editor.answerReview(['name'], 'reopen')).toEqual(['name']);
		flushSync();
		expect(texts(r.doc.getStored('contact'))).toEqual({ name: 'Ada', email: 'g@example.org' });
		expect(r.events.map((e) => [e.id, e.action])).toEqual([
			['name', 'accept'],
			['email', 'accept'],
			['name', 'reopen']
		]);
	});

	it('is outdated where the cell no longer holds what was read', async () => {
		const r = nested(
			(doc) => [
				{
					id: 'name',
					state: 'proposed',
					field: `${doc.pathFor('contact')}.name`,
					before: 'Someone',
					after: 'Grace'
				}
			],
			seed
		);
		await settle();
		expect(r.drawn.at(-1)?.outdated).toEqual(['name']);
	});
});

describe('a list’s member', () => {
	const seed = (doc: Document): void =>
		void quill().writer(doc).set('signature_block', ['A. LOVELACE', 'Author', 'Analyst']);
	const members = (doc: Document): ReviewItem[] => {
		const path = doc.pathFor('signature_block');
		return [
			{
				id: 'change',
				state: 'proposed',
				field: `${path}[0]`,
				before: 'A. LOVELACE',
				after: 'ADA LOVELACE'
			},
			{ id: 'drop', state: 'proposed', field: `${path}[1]`, before: 'Author' },
			{ id: 'add', state: 'proposed', field: `${path}[3]`, after: 'Countess' }
		];
	};

	it('is drawn under its row, and one past the last at the list’s foot', async () => {
		const r = nested(members, seed);
		await settle();
		const field = openField(r.target, main, 'signature_block');
		const rowOf = (id: string) =>
			field.querySelector(`.qm-review-proposal[data-qm-review="${id}"]`)!.closest('.qm-array-row');
		expect(rowOf('change')?.getAttribute('data-qm-index')).toBe('0');
		expect(rowOf('drop')?.getAttribute('data-qm-index')).toBe('1');
		expect(rowOf('add')).toBeNull();
		expect(rows(r, 'signature_block')).toEqual(['A.ADA LOVELACE', 'Author', 'Item 4: Countess']);
	});

	it('is taken on the member it read, though another taken first moved it', async () => {
		const r = nested(members, seed);
		await settle();
		press(r, 'drop', 'accept');
		press(r, 'add', 'accept');
		press(r, 'change', 'accept');
		expect(texts(r.doc.getStored('signature_block'))).toEqual([
			'ADA LOVELACE',
			'Analyst',
			'Countess'
		]);
		expect(r.drawn.at(-1)?.outdated).toEqual([]);
	});

	it('is outdated where no member holds what it read', async () => {
		const r = nested(
			(doc) => [
				{
					id: 'drop',
					state: 'proposed',
					field: `${doc.pathFor('signature_block')}[1]`,
					before: 'Editor'
				}
			],
			seed
		);
		await settle();
		expect(r.drawn.at(-1)?.outdated).toEqual(['drop']);
	});
});

describe('a record in a table', () => {
	it('draws a cell’s proposal under that cell of its row, and takes it alone', async () => {
		const r = nested(
			(doc) => [
				{
					id: 'role',
					state: 'proposed',
					field: `${doc.pathFor('contributors')}[1].role`,
					before: 'author',
					after: 'editor'
				}
			],
			(doc) =>
				void quill()
					.writer(doc)
					.set('contributors', [
						{ name: 'Ada', role: 'author' },
						{ name: 'Grace', role: 'author' }
					])
		);
		await settle();
		const row = r.target
			.querySelector('.qm-review-proposal[data-qm-review="role"]')!
			.closest('.qm-array-row');
		expect(row?.getAttribute('data-qm-index')).toBe('1');
		press(r, 'role', 'accept');
		expect(texts(r.doc.getStored('contributors'))).toMatchObject([
			{ name: 'Ada', role: 'author' },
			{ name: 'Grace', role: 'editor' }
		]);
	});
});

describe('a place inside a closed group', () => {
	it('marks the header that opens it, and is brought to the reader by its id', async () => {
		const r = nested((doc) => [
			{ id: 'name', state: 'proposed', field: `${doc.pathFor('contact')}.name`, after: 'Grace' }
		]);
		const title = groupLabel(main, main.fields.contact.ui!.group!);
		const header = [...r.target.querySelectorAll<HTMLElement>('.qm-group-header')].find((h) =>
			h.textContent?.includes(title)
		)!;
		expect(header.getAttribute('aria-expanded')).toBe('true');
		header.click();
		flushSync();
		const marked = () =>
			[...r.target.querySelectorAll('.qm-group-reviewed')].map((flag) =>
				flag.closest('.qm-group-header')!.getAttribute('aria-expanded')
			);
		expect(marked()).toEqual(['false']);
		expect(await r.editor.revealReview('name')).toBe(true);
		flushSync();
		expect(marked()).toEqual([]);
		expect(r.target.querySelector('.qm-review-proposal[data-qm-review="name"]')).not.toBeNull();
	});
});
