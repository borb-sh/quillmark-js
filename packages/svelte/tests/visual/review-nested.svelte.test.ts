// @vitest-environment jsdom
// A proposal for a place inside a field: drawn in the cell or the row it names, taken alone down
// the lane an edit of that place takes, and taken back alone.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import type { ReviewDrawn, ReviewEvent, ReviewItem } from '$lib/visual';
import { proposalsBetween } from '$lib/visual';
import { groupLabel } from '$lib/visual/structure';
import { core, quill, example, quillFromYaml } from '../helpers/fixtures.js';
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

	it('takes the focus to its own cell when brought to the reader with it', async () => {
		const r = nested((doc) => contact(doc).filter((item) => item.id === 'email'), seed);
		await settle();
		expect(await r.editor.revealReview('email', { focus: true })).toBe(true);
		flushSync();
		const cell = openField(r.target, main, 'contact').querySelector('[data-qm-prop="email"]')!;
		expect(cell.contains(document.activeElement)).toBe(true);
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

	it('draws its change in its row, marks the row it takes out, and shows the row it adds in its own control', async () => {
		const r = nested(members, seed);
		await settle();
		const field = openField(r.target, main, 'signature_block');
		const rowOf = (id: string) => markOf(field, id)!.closest('.qm-array-row');
		expect(rowOf('change')?.getAttribute('data-qm-index')).toBe('0');
		expect(drawnOf(field, 'change')).toEqual(['A.', 'ADA']);
		expect(rowOf('drop')?.getAttribute('data-qm-index')).toBe('1');
		expect(field.querySelector('[data-qm-removed]')).toBe(rowOf('drop'));
		const added = markOf(field, 'add')!;
		expect(added.classList.contains('qm-review-added')).toBe(true);
		expect(added.querySelector('.qm-review-added-box')?.hasAttribute('inert')).toBe(true);
		expect(added.querySelector('.ProseMirror')?.textContent).toBe('Countess');
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
	it('is made current by the focus arriving anywhere in its row', async () => {
		const lit: (string | undefined)[] = [];
		const doc = example();
		seed(doc);
		const path = doc.pathFor('signature_block');
		const r = mountEditor(quill(), doc, {
			review: [
				{ id: 'first', field: `${path}[0]`, before: 'A. LOVELACE', after: 'ADA LOVELACE' },
				{ id: 'last', field: `${path}[2]`, before: 'Analyst', after: 'Engineer' }
			],
			onReviewFocus: (id) => lit.push(id)
		});
		await settle();
		expect(await r.editor.revealReview('first')).toBe(true);
		flushSync();
		const row = openField(r.target, main, 'signature_block').querySelector<HTMLElement>(
			'[data-qm-index="2"] .ProseMirror'
		)!;
		const from = document.createElement('button');
		document.body.append(from);
		row.focus();
		row.dispatchEvent(new FocusEvent('focus', { relatedTarget: from }));
		from.remove();
		flushSync();
		expect(lit.at(-1)).toBe('last');
	});
});

describe('a place that holds nothing it read', () => {
	it.each([
		['a cell', 'contact', '.name', 'Someone', { name: 'Ada', email: 'a@example.org' }],
		['a member', 'signature_block', '[1]', 'Editor', ['A. LOVELACE', 'Author', 'Analyst']]
	])('is outdated where %s no longer holds what was read', async (_, name, at, before, value) => {
		const r = nested(
			(doc) => [{ id: 'p', field: `${doc.pathFor(name)}${at}`, before }],
			(doc) => void quill().writer(doc).set(name, value)
		);
		await settle();
		expect(r.drawn.at(-1)?.outdated).toEqual(['p']);
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

	it('shows a row it adds as the row would stand, each cell in its own control, none of them taking input', async () => {
		const r = nested(
			(doc) => [
				{
					id: 'add',
					field: `${doc.pathFor('contributors')}[1]`,
					after: { name: 'Alan', role: 'reviewer' }
				}
			],
			(doc) =>
				void quill()
					.writer(doc)
					.set('contributors', [{ name: 'Ada', role: 'author' }])
		);
		await settle();
		const added = markOf(openField(r.target, main, 'contributors'), 'add')!;
		expect(added.classList.contains('qm-array-table-row')).toBe(true);
		const box = added.querySelector('.qm-review-added-box')!;
		expect(box.hasAttribute('inert')).toBe(true);
		expect(box.querySelector('.ProseMirror')?.textContent).toBe('Alan');
		expect(box.querySelector('.qm-select')?.textContent?.trim()).toBe('reviewer');
		expect(r.doc.getStored('contributors')).toHaveLength(1);
	});

	it.each([
		['a table', 'contributors', { name: 'Alan', role: 'reviewer' }],
		['a list of records', 'revisions', { note: 'Fig. 3 relabelled', pages: 1 }]
	])('draws a row it adds to %s that holds none', async (_, name, after) => {
		const r = nested(
			(doc) => [{ id: 'add', field: `${doc.pathFor(name)}[0]`, after }],
			(doc) => void quill().writer(doc).set(name, [])
		);
		await settle();
		const field = openField(r.target, main, name);
		const rows = markOf(field, 'add')!.closest('.qm-array-rows')!;
		expect(rows.classList.contains('empty')).toBe(false);
		expect(r.drawn.at(-1)?.open).toContain('add');
	});
});

describe('a record’s text cell, whatever its kind', () => {
	const kinds = [
		['text', 'line'],
		['text', 'lines'],
		['richtext', 'line'],
		['richtext', 'lines'],
		['richtext', 'blocks']
	] as const;
	const yaml = (type: string, shape: string) => `quill:
  name: header
  version: 1.0.0
  backend: typst
  description: A record holding a text cell.
typst:
  plate_file: plate.typ
main:
  fields:
    header:
      type: object
      properties:
        recipient:
          type: ${type}${shape === 'line' ? '' : `\n          shape: ${shape}`}
`;
	const memo = (recipient: string[]): Document =>
		core.Document.parse(
			['~~~', '$quill: header@1.0.0', 'header:', '  recipient: |-']
				.concat(
					recipient.map((line) => (line ? `    ${line}` : '')),
					['~~~', '']
				)
				.join('\n')
		);
	const lines = (shape: string, last: string): string[] =>
		shape === 'line' ? [`ORG/SYM ${last}`] : ['ORG/SYM', '', last];

	it.each(kinds)(
		'draws a %s of %s proposal as words in the cell, and is taken as the field',
		async (type, shape) => {
			const q = quillFromYaml(yaml(type, shape));
			const doc = memo(lines(shape, '123 MXG/CC'));
			const answer = memo(lines(shape, '123 OG/CC'));
			q.conform(doc);
			q.conform(answer);
			const { items } = proposalsBetween(q, doc, answer, () => 'recipient');
			const drawn: ReviewDrawn[] = [];
			const r = mountEditor(q, doc, { review: items, onReviewDrawn: (d) => drawn.push(d) });
			await settle();
			const cell = openField(r.target, q.schema.main, 'header').querySelector(
				'[data-qm-prop="recipient"]'
			)!;
			expect(drawnOf(cell, 'recipient')).toEqual(['MXG', 'OG']);
			expect(drawn.at(-1)?.open).toEqual(['recipient']);
			answerOn(r.target, 'recipient', 'accept');
			expect(doc.toMarkdown()).toBe(answer.toMarkdown());
		}
	);
	it('draws a change inside a list of a block cell as words, and is taken as the field', async () => {
		const q = quillFromYaml(yaml('richtext', 'blocks'));
		const doc = memo(['Intro.', '', '- one', '- two']);
		const answer = memo(['Intro.', '', '- one', '- three']);
		q.conform(doc);
		q.conform(answer);
		const { items } = proposalsBetween(q, doc, answer, () => 'recipient');
		const r = mountEditor(q, doc, { review: items });
		await settle();
		const cell = openField(r.target, q.schema.main, 'header').querySelector(
			'[data-qm-prop="recipient"]'
		)!;
		expect(drawnOf(cell, 'recipient')).toEqual(['two', 'three']);
		answerOn(r.target, 'recipient', 'accept');
		expect(doc.toMarkdown()).toBe(answer.toMarkdown());
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

describe('a cell of an unticked matrix member', () => {
	const severity = (doc: Document): ReviewItem[] => [
		{ id: 'severity', field: `${doc.pathFor('checks')}.figures.severity`, after: 'major' }
	];

	it('shows the member as Accept would leave it, ticked, and marks the cell', async () => {
		const r = nested(severity);
		await settle();
		expect(r.drawn.at(-1)?.open).toEqual(['severity']);
		const field = openField(r.target, main, 'checks');
		const member = field.querySelector<HTMLElement>('[data-qm-prop="figures"]')!;
		expect(member.querySelector<HTMLInputElement>('.qm-tick-input')!.checked).toBe(true);
		const mark = markOf(member, 'severity');
		expect(mark?.closest('[data-qm-prop="severity"]')).not.toBeNull();
		expect(r.doc.getStored('checks')).not.toHaveProperty('figures');
		press(r, 'severity', 'accept');
		expect(texts(r.doc.getStored('checks'))).toMatchObject({ figures: { severity: 'major' } });
	});

	it('turns the proposal down where the reader unticks the member, writing nothing', async () => {
		const r = nested(severity);
		await settle();
		const field = openField(r.target, main, 'checks');
		const tick = field.querySelector<HTMLInputElement>('[data-qm-prop="figures"] .qm-tick-input')!;
		tick.click();
		flushSync();
		await settle();
		expect(r.events.map((e) => [e.id, e.action])).toEqual([['severity', 'dismiss']]);
		expect(r.doc.getStored('checks')).not.toHaveProperty('figures');
		expect(tick.checked).toBe(false);
		expect(r.drawn.at(-1)?.open).toEqual([]);
	});
});
