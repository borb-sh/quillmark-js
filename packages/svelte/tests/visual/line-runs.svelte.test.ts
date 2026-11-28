// @vitest-environment jsdom
// A field of lines takes one proposal per run of lines an answer changes, at the top of a card
// and inside a record alike: a line added or taken out is one run, runs a line or two apart are
// one, and each run is drawn as words in the leaf and taken alone.
import { describe, it, expect, afterEach } from 'vitest';
import type { Document } from '@quillmark/wasm';
import { core, quillFromYaml } from '../helpers/fixtures.js';
import {
	answerOn,
	between,
	drawnOf,
	field,
	mountEditor,
	openField,
	settle,
	unmountAll
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const q = quillFromYaml(`quill:
  name: lines
  version: 1.0.0
  backend: typst
  description: A field of rich text lines at the top and inside a record.
typst:
  plate_file: plate.typ
schema:
  main:
    fields:
      distribution:
        type: richtext
        shape: lines
      header:
        type: object
        properties:
          memo_for:
            type: richtext
            shape: lines
`);

const indent = (lines: string[], by: string): string[] =>
	lines.flatMap((line, k) => (k ? ['', `${by}${line}`] : [`${by}${line}`]));

const memo = (distribution: string[], memoFor: string[]): Document => {
	const doc = core.Document.parse(
		[
			'~~~',
			'$quill: lines@1.0.0',
			'distribution: |-',
			...indent(distribution, '  '),
			'header:',
			'  memo_for: |-',
			...indent(memoFor, '    '),
			'~~~',
			''
		].join('\n')
	);
	q.conform(doc);
	return doc;
};

const OFFICES = ['1 OG/CC', '2 MXG/CC', '3 MSG/CC', '4 MDG/CC', '5 CS/CC', '6 FSS/CC', '7 LRS/CC'];

describe('a field of lines', () => {
	it('takes a line added above the rest as one proposal, wherever the field sits', () => {
		const items = between(
			q,
			memo(OFFICES.slice(0, 3), OFFICES.slice(0, 3)),
			memo(['HQ USAF/CC', ...OFFICES.slice(0, 3)], ['HQ USAF/CC', ...OFFICES.slice(0, 3)])
		);
		expect(items.map((item) => (item as { field: string }).field)).toEqual([
			'main.distribution',
			'main.header.memo_for'
		]);
	});

	it('takes runs more than two lines apart as proposals of their own, each the value read with that run alone written', () => {
		const changed = [...OFFICES];
		changed[1] = '2 OSS/CC';
		changed[6] = '7 CES/CC';
		const items = between(q, memo(OFFICES, OFFICES), memo(changed, OFFICES));
		expect(items).toHaveLength(2);
		const text = (item: (typeof items)[number]) => (item as { after: { text: string } }).after.text;
		expect(text(items[0]).split('\n')).toEqual([
			...OFFICES.slice(0, 1),
			'2 OSS/CC',
			...OFFICES.slice(2)
		]);
		expect(text(items[1]).split('\n')).toEqual([...OFFICES.slice(0, 6), '7 CES/CC']);
	});

	it('takes runs at most two lines apart as one proposal', () => {
		const changed = [...OFFICES];
		changed[1] = '2 OSS/CC';
		changed[4] = '5 CES/CC';
		expect(between(q, memo(OFFICES, OFFICES), memo(changed, OFFICES))).toHaveLength(1);
	});

	it('draws each run as words in the leaf, and takes each alone', async () => {
		const doc = memo(OFFICES, OFFICES);
		const changed = [...OFFICES];
		changed[1] = '2 OSS/CC';
		changed[6] = '7 CES/CC';
		const answer = memo(OFFICES, changed);
		const items = between(q, doc, answer);
		const r = mountEditor(q, doc, { review: items });
		await settle();
		const cell = openField(r.target, q.schema.main, 'header').querySelector(
			'[data-qm-prop="memo_for"]'
		)!;
		expect(drawnOf(cell, 'p0')).toEqual(['MXG', 'OSS']);
		expect(drawnOf(cell, 'p1')).toEqual(['LRS', 'CES']);
		answerOn(r.target, 'p1', 'accept');
		await settle();
		const memoFor = () =>
			(q.reader(doc).getContentAt({ field: 'header' }, ['memo_for']) as { text: string }).text;
		expect(memoFor().split('\n')).toEqual([...OFFICES.slice(0, 6), '7 CES/CC']);
		answerOn(r.target, 'p0', 'accept');
		expect(doc.toMarkdown()).toBe(answer.toMarkdown());
	});

	it('draws a line added at the top of a top-level field as words, and takes it as the field', async () => {
		const doc = memo(OFFICES.slice(0, 3), OFFICES.slice(0, 1));
		const answer = memo(['HQ USAF/CC', ...OFFICES.slice(0, 3)], OFFICES.slice(0, 1));
		const items = between(q, doc, answer);
		const r = mountEditor(q, doc, { review: items });
		await settle();
		expect(drawnOf(field(r.target, 'Distribution'), 'p0')).toEqual(['', 'HQ USAF/CC\n']);
		answerOn(r.target, 'p0', 'accept');
		expect(doc.toMarkdown()).toBe(answer.toMarkdown());
	});
});
