// @vitest-environment jsdom
// Members a proposal puts into a list before its end: drawn as new rows where they would stand,
// and taken alone, so the members around them stay as they are whatever else is answered.
import { describe, it, expect, afterEach } from 'vitest';
import type { Document } from '@quillmark/wasm';
import { proposalsBetween } from '$lib/visual';
import { core, quillFromYaml } from '../helpers/fixtures.js';
import { answerOn, mountEditor, openField, settle, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const q = quillFromYaml(`quill:
  name: lists
  version: 1.0.0
  backend: typst
  description: A record holding a list of lines and a list of records.
typst:
  plate_file: plate.typ
main:
  fields:
    header:
      type: object
      properties:
        memo_for:
          type: array
          items:
            type: text
        signers:
          type: array
          items:
            type: object
            properties:
              name:
                type: text
`);

const memo = (memoFor: string[], signers: string[] = ['ADA']): Document => {
	const doc = core.Document.parse(
		[
			'~~~',
			'$quill: lists@1.0.0',
			'header:',
			'  memo_for:',
			...memoFor.map((line) => `    - ${line}`),
			'  signers:',
			...signers.map((name) => `    - name: ${name}`),
			'~~~',
			''
		].join('\n')
	);
	q.conform(doc);
	return doc;
};

const review = async (doc: Document, answer: Document) => {
	let n = 0;
	const { items } = proposalsBetween(q, doc, answer, () => `p${n++}`);
	const r = mountEditor(q, doc, { review: items });
	await settle();
	return { items, r, group: openField(r.target, q.schema.main, 'header') };
};

/** A list's rows as they stand on the page, each with whether a review adds it. */
const rows = (root: Element, prop: string): string[] => {
	const list = root.querySelector(`[data-qm-prop="${prop}"] .qm-array-rows`)!;
	return [...list.children]
		.filter((el) => el.classList.contains('qm-array-row'))
		.sort((a, b) => Number((a as HTMLElement).style.order) - Number((b as HTMLElement).style.order))
		.map((el) => `${el.classList.contains('qm-review-added') ? '+' : ''}${el.textContent!.trim()}`);
};

describe('a member put in before the end of a list', () => {
	it('draws as a new row in front of the member it precedes, and is taken alone', async () => {
		const doc = memo(['123 OG/CC', '123 MXG/CC', '123 MSG/CC']);
		const answer = memo(['HQ USAF/CC', '123 OG/CC', '123 MXG/CC', '123 MSG/CC']);
		const { items, r, group } = await review(doc, answer);
		expect(items).toHaveLength(1);
		expect(rows(group, 'memo_for')).toEqual([
			'+HQ USAF/CC',
			'123 OG/CC',
			'123 MXG/CC',
			'123 MSG/CC'
		]);
		answerOn(r.target, 'p0', 'accept');
		expect(doc.toMarkdown()).toBe(answer.toMarkdown());
	});

	it('leaves every member it does not add as it was when the reader answers another item first', async () => {
		const doc = memo(['123 OG/CC', '123 MXG/CC', '123 MSG/CC']);
		const answer = memo(['HQ USAF/CC', '123 OG/CC', '123 MSG/CC']);
		const { items, r } = await review(doc, answer);
		const removal = items.find((item) => !('ahead' in item))!;
		const insert = items.find((item) => 'ahead' in item)!;
		answerOn(r.target, removal.id, 'accept');
		answerOn(r.target, insert.id, 'dismiss');
		expect(q.toAuthoring(doc).fields?.header).toMatchObject({
			memo_for: ['123 OG/CC', '123 MSG/CC']
		});
	});

	it('takes the members it adds in order, after the rest of the list moved under it', async () => {
		const doc = memo(['123 OG/CC', '123 MXG/CC', '123 MSG/CC']);
		const answer = memo(['HQ USAF/CC', 'HQ AMC/CC', '123 OG/CC', '123 MSG/CC']);
		const { items, r } = await review(doc, answer);
		for (const item of [...items].reverse()) answerOn(r.target, item.id, 'accept');
		expect(doc.toMarkdown()).toBe(answer.toMarkdown());
	});

	it('draws a record put in before the end of a list of records where it would stand', async () => {
		const doc = memo(['123 OG/CC'], ['ADA', 'GRACE']);
		const answer = memo(['123 OG/CC'], ['MARY', 'ADA', 'GRACE']);
		const { r, group } = await review(doc, answer);
		expect(rows(group, 'signers').map((row) => row.startsWith('+'))).toEqual([true, false, false]);
		answerOn(r.target, 'p0', 'accept');
		expect(doc.toMarkdown()).toBe(answer.toMarkdown());
	});
});
