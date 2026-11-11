// @vitest-environment jsdom
// A proposal for a place inside a field: drawn in the cell or the row it names, taken alone down
// the lane an edit of that place takes, and taken back alone.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import type { ReviewDrawn, ReviewEvent, ReviewItem } from '$lib/visual';
import { groupLabel } from '$lib/visual/structure';
import { quill, example } from '../helpers/fixtures.js';
import {
	answerOn,
	mountEditor,
	openField,
	press as key,
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

/** The first element drawing item `id`. */
const markOf = (root: ParentNode, id: string): Element | null =>
	root.querySelector(`[data-qm-review~="${id}"]`);
/** What item `id` draws in place: the words it strikes, then the words it writes. */
const drawnOf = (root: ParentNode, id: string): [string, string] => {
	const words = (selector: string) =>
		[...root.querySelectorAll(`${selector}[data-qm-review~="${id}"]`)]
			.map((el) => el.textContent)
			.join('');
	return [words('.qm-review-del'), words('.qm-review-ins')];
};
/** A value with each plain text in it as its words. */
const texts = (value: unknown): unknown =>
	JSON.parse(
		JSON.stringify(value, (_, v: unknown) =>
			v && typeof v === 'object' && (v as { codec?: string }).codec === 'plain'
				? (v as { text: string }).text
				: v
		)
	);
/** ⌘Z from the editor's root, which takes back the newest answer. */
const undoKey = (r: Nested): void => {
	key(r.target.querySelector<HTMLElement>('.qm-editor')!, 'z', { ctrlKey: true });
	flushSync();
};
const press = (r: Nested, id: string, action: 'accept' | 'dismiss'): void =>
	answerOn(r.target, id, action);

describe('a record’s cell', () => {
	const contact = (doc: Document): ReviewItem[] => [
		{
			id: 'name',

			field: `${doc.pathFor('contact')}.name`,
			before: 'Ada',
			after: 'Grace'
		},
		{
			id: 'email',

			field: `${doc.pathFor('contact')}.email`,
			after: 'g@example.org'
		}
	];
	const seed = (doc: Document): void =>
		void quill().writer(doc).set('contact', { name: 'Ada', email: 'a@example.org' });

	it('draws its change in the cell it names', async () => {
		const r = nested(contact, seed);
		await settle();
		const cells = [...openField(r.target, main, 'contact').querySelectorAll('[data-qm-prop]')];
		const cell = (prop: string) => cells.find((c) => c.getAttribute('data-qm-prop') === prop)!;
		expect(drawnOf(cell('name'), 'name')).toEqual(['Ada', 'Grace']);
		expect(drawnOf(cell('email'), 'email')).toEqual(['a', 'g']);
		expect(r.drawn.at(-1)?.outdated).toEqual([]);
		expect(r.drawn.at(-1)?.undrawn).toEqual([]);
	});

	it('is taken alone, and ⌘Z takes the newest back alone', async () => {
		const r = nested(contact, seed);
		await settle();
		press(r, 'name', 'accept');
		press(r, 'email', 'accept');
		expect(texts(r.doc.getStored('contact'))).toEqual({ name: 'Grace', email: 'g@example.org' });
		undoKey(r);
		expect(texts(r.doc.getStored('contact'))).toEqual({ name: 'Grace', email: 'a@example.org' });
		expect(r.events.map((e) => [e.id, e.action])).toEqual([
			['name', 'accept'],
			['email', 'accept'],
			['email', 'reopen']
		]);
	});

	it('is outdated where the cell no longer holds what was read', async () => {
		const r = nested(
			(doc) => [
				{
					id: 'name',

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

				field: `${path}[0]`,
				before: 'A. LOVELACE',
				after: 'ADA LOVELACE'
			},
			{ id: 'drop', field: `${path}[1]`, before: 'Author' },
			{ id: 'add', field: `${path}[3]`, after: 'Countess' }
		];
	};

	it('draws its change in its row, strikes the row it takes out, and previews the row it adds', async () => {
		const r = nested(members, seed);
		await settle();
		const field = openField(r.target, main, 'signature_block');
		const rowOf = (id: string) => markOf(field, id)!.closest('.qm-array-row');
		expect(rowOf('change')?.getAttribute('data-qm-index')).toBe('0');
		expect(drawnOf(field, 'change')).toEqual(['A.', 'ADA']);
		expect(rowOf('drop')?.getAttribute('data-qm-index')).toBe('1');
		expect(field.querySelector('[data-qm-removes]')).toBe(markOf(field, 'drop'));
		const added = markOf(field, 'add')!;
		expect(added.classList.contains('qm-review-added')).toBe(true);
		expect(added.textContent?.trim()).toBe('Countess');
		expect(r.doc.getStored('signature_block')).toHaveLength(3);
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

	it('is put back where it stood by ⌘Z, the newest removal first', async () => {
		const five = ['A', 'B', 'C', 'D', 'E'];
		const r = nested(
			(doc) => {
				const path = doc.pathFor('signature_block');
				return [
					{ id: 'b', field: `${path}[1]`, before: 'B' },
					{ id: 'd', field: `${path}[3]`, before: 'D' }
				];
			},
			(doc) => void quill().writer(doc).set('signature_block', five)
		);
		await settle();
		press(r, 'b', 'accept');
		press(r, 'd', 'accept');
		expect(texts(r.doc.getStored('signature_block'))).toEqual(['A', 'C', 'E']);
		undoKey(r);
		expect(texts(r.doc.getStored('signature_block'))).toEqual(['A', 'C', 'D', 'E']);
		undoKey(r);
		expect(texts(r.doc.getStored('signature_block'))).toEqual(five);
	});

	it('is outdated where no member holds what it read', async () => {
		const r = nested(
			(doc) => [
				{
					id: 'drop',

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
	it('marks that cell of its row, and takes it alone', async () => {
		const r = nested(
			(doc) => [
				{
					id: 'role',

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
		const row = markOf(r.target, 'role')!.closest('.qm-array-row');
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
			{ id: 'name', field: `${doc.pathFor('contact')}.name`, after: 'Grace' }
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
		expect(markOf(r.target, 'name')).not.toBeNull();
	});
});
