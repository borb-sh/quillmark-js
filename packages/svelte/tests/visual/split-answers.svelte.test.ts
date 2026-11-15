// @vitest-environment jsdom
// One answer split into several items over one field, each the value as read with its own part
// alone written: a run of lines, a member put into a list, a paragraph. Whatever order they are
// taken in, the parts taken are written and nothing else, and Accept all is the answer.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import { proposalsBetween } from '$lib/visual';
import { core, quillFromYaml } from '../helpers/fixtures.js';
import {
	answerOn,
	mountInner,
	openField,
	press,
	settle,
	unmountAll
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const q = quillFromYaml(`quill:
  name: split
  version: 1.0.0
  backend: typst
  description: A record holding lines, a list of lines and paragraphs.
typst:
  plate_file: plate.typ
main:
  fields:
    header:
      type: object
      properties:
        memo_for:
          type: richtext
          shape: lines
        cc:
          type: array
          items:
            type: text
        details:
          type: richtext
          shape: blocks
`);

interface Header {
	memoFor: string[];
	cc: string[];
	details: string[];
}

const block = (lines: string[], by: string): string[] =>
	lines.flatMap((line, k) => (k ? ['', `${by}${line}`] : [`${by}${line}`]));

const memo = ({ memoFor, cc, details }: Header): Document => {
	const doc = core.Document.parse(
		[
			'~~~',
			'$quill: split@1.0.0',
			'header:',
			'  memo_for: |-',
			...block(memoFor, '    '),
			'  cc:',
			...cc.map((line) => `    - ${line}`),
			'  details: |-',
			...block(details, '    '),
			'~~~',
			''
		].join('\n')
	);
	q.conform(doc);
	return doc;
};

const OFFICES = ['1 OG/CC', '2 MXG/CC', '3 MSG/CC', '4 MDG/CC', '5 CS/CC', '6 FSS/CC', '7 LRS/CC'];
const PARAS = ['Led a team of four.', 'Cut the backlog by half.', 'Ran the audit.'];
const BASE: Header = { memoFor: OFFICES, cc: ['A', 'B', 'C'], details: PARAS };

const CASES: [string, Header][] = [
	[
		'two runs of lines',
		{ ...BASE, memoFor: OFFICES.map((o, k) => (k === 1 ? '2 OSS/CC' : k === 6 ? '7 CES/CC' : o)) }
	],
	['two members put into a list apart', { ...BASE, cc: ['X', 'A', 'B', 'Y', 'C'] }],
	[
		'two paragraphs',
		{ ...BASE, details: ['Led a team of six.', PARAS[1], 'Ran the annual audit.'] }
	]
];

const mounted = async (answer: Header) => {
	const doc = memo(BASE);
	let n = 0;
	const { items } = proposalsBetween(q, doc, memo(answer), () => `p${n++}`);
	const r = mountInner(q, doc, { review: items });
	await settle();
	openField(r.target, q.schema.main, 'header');
	await settle();
	return { doc, items, r };
};

/** The document with only `parts` of the answer's two parts written. */
const partly = (answer: Header, part: 0 | 1): string => {
	const pick = <T>(was: T[], now: T[]): T[] => {
		if (was === now) return was;
		const changed = now
			.map((v, k) => ({ v, k }))
			.filter(({ v, k }) => (was.length === now.length ? v !== was[k] : !was.includes(v)));
		const keep = changed[part];
		if (was.length === now.length) return was.map((v, k) => (k === keep.k ? keep.v : v));
		return now.filter((v) => was.includes(v) || v === keep.v);
	};
	return memo({
		memoFor: pick(BASE.memoFor, answer.memoFor),
		cc: pick(BASE.cc, answer.cc),
		details: pick(BASE.details, answer.details)
	}).toMarkdown();
};

describe.each(CASES)('an answer split into %s', (_, answer) => {
	const whole = memo(answer).toMarkdown();

	it('is two items over one field', async () => {
		const { items } = await mounted(answer);
		expect(items).toHaveLength(2);
		const fields = items.map((item) => (item as { field: string }).field.replace(/\[\d+\]$/, ''));
		expect(fields[0]).toBe(fields[1]);
	});

	it.each([
		['first then second', [0, 1]],
		['second then first', [1, 0]]
	])('takes both, %s, as the answer, neither outdated', async (_, order) => {
		const { doc, items, r } = await mounted(answer);
		for (const k of order) {
			answerOn(r.target, items[k].id, 'accept');
			await settle();
		}
		expect(doc.toMarkdown()).toBe(whole);
	});

	it('takes both by Accept all as the answer, and one undo restores the document', async () => {
		const { doc, items, r } = await mounted(answer);
		const was = doc.toMarkdown();
		expect(r.editor.answerReview('all', 'accept').sort()).toEqual(items.map((i) => i.id).sort());
		flushSync();
		await settle();
		expect(doc.toMarkdown()).toBe(whole);
		press(r.target.querySelector<HTMLElement>('.qm-editor') ?? document.body, 'z', {
			ctrlKey: true
		});
		flushSync();
		await settle();
		expect(doc.toMarkdown()).toBe(was);
	});

	it.each([0, 1] as const)('keeps exactly part %i where the other is dismissed', async (kept) => {
		const { doc, items, r } = await mounted(answer);
		answerOn(r.target, items[1 - kept].id, 'dismiss');
		await settle();
		answerOn(r.target, items[kept].id, 'accept');
		await settle();
		expect(doc.toMarkdown()).toBe(partly(answer, kept));
	});
});
