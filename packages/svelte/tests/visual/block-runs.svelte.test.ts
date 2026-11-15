// @vitest-environment jsdom
// A field of paragraphs inside a record takes one proposal per paragraph an answer changes, as
// the body does: a paragraph rewritten, added or taken out is one proposal, each drawn as words
// in the leaf and taken alone.
import { describe, it, expect, afterEach } from 'vitest';
import type { Document } from '@quillmark/wasm';
import { proposalsBetween } from '$lib/visual';
import { core, quillFromYaml } from '../helpers/fixtures.js';
import { answerOn, mountEditor, openField, settle, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const q = quillFromYaml(`quill:
  name: paragraphs
  version: 1.0.0
  backend: typst
  description: A field of rich text paragraphs inside a record.
typst:
  plate_file: plate.typ
main:
  fields:
    entry:
      type: object
      properties:
        details:
          type: richtext
          shape: blocks
`);

const entry = (paragraphs: string[]): Document => {
	const doc = core.Document.parse(
		[
			'~~~',
			'$quill: paragraphs@1.0.0',
			'entry:',
			'  details: |-',
			...paragraphs.flatMap((p, k) => (k ? ['', `    ${p}`] : [`    ${p}`])),
			'~~~',
			''
		].join('\n')
	);
	q.conform(doc);
	return doc;
};

const PARAS = [
	'Led a team of four.',
	'Cut the backlog by half.',
	'Ran the audit.',
	'Wrote the plan.'
];

const between = (base: Document, answer: Document) => {
	let n = 0;
	return proposalsBetween(q, base, answer, () => `p${n++}`).items;
};

const textOf = (item: unknown): string => (item as { after: { text: string } }).after.text;

const drawnOf = (root: ParentNode, id: string): [string, string] => {
	const words = (selector: string) =>
		[...root.querySelectorAll(`${selector}[data-qm-review~="${id}"]`)]
			.map((el) => el.textContent)
			.join('');
	return [words('.qm-review-del'), words('.qm-review-ins')];
};

describe('a field of paragraphs inside a record', () => {
	it('takes each changed paragraph as a proposal of its own, the value read with that paragraph alone written', () => {
		const changed = [...PARAS];
		changed[0] = 'Led a team of six.';
		changed[1] = 'Cut the backlog by two thirds.';
		const items = between(entry(PARAS), entry(changed));
		expect(items.map(textOf)).toEqual([
			[changed[0], ...PARAS.slice(1)].join('\n'),
			[PARAS[0], changed[1], ...PARAS.slice(2)].join('\n')
		]);
	});

	it('takes a paragraph added at the top as one proposal', () => {
		const items = between(entry(PARAS), entry(['Took command in May.', ...PARAS]));
		expect(items).toHaveLength(1);
	});

	it('draws each paragraph as words in the leaf, and takes each alone', async () => {
		const doc = entry(PARAS);
		const changed = [...PARAS];
		changed[0] = 'Led a team of six.';
		changed[3] = 'Wrote the campaign plan.';
		const answer = entry(changed);
		const items = between(doc, answer);
		expect(items).toHaveLength(2);
		const r = mountEditor(q, doc, { review: items });
		await settle();
		const cell = openField(r.target, q.schema.main, 'entry').querySelector(
			'[data-qm-prop="details"]'
		)!;
		expect(drawnOf(cell, 'p0')).toEqual(['four', 'six']);
		expect(drawnOf(cell, 'p1')).toEqual(['', 'campaign ']);
		answerOn(r.target, 'p1', 'accept');
		await settle();
		answerOn(r.target, 'p0', 'accept');
		expect(doc.toMarkdown()).toBe(answer.toMarkdown());
	});
});
