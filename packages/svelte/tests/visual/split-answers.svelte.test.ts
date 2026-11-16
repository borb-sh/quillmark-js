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
    distribution:
      type: richtext
      shape: lines
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
	distribution: string[];
	memoFor: string[];
	cc: string[];
	details: string[];
}

const block = (lines: string[], by: string): string[] =>
	lines.flatMap((line, k) => (k ? ['', `${by}${line}`] : [`${by}${line}`]));

const memo = ({ distribution, memoFor, cc, details }: Header): Document => {
	const doc = core.Document.parse(
		[
			'~~~',
			'$quill: split@1.0.0',
			'distribution: |-',
			...block(distribution, '  '),
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
const BASE: Header = {
	distribution: OFFICES,
	memoFor: OFFICES,
	cc: ['A', 'B', 'C'],
	details: PARAS
};

/** Each case: the answer, then the document with only its first part written, then its second. */
const CASES: [string, Header, Header, Header][] = (
	[
		['distribution', OFFICES, ['2 OSS/CC', '7 CES/CC'], [1, 6]],
		['memoFor', OFFICES, ['2 OSS/CC', '7 CES/CC'], [1, 6]],
		['details', PARAS, ['Led a team of six.', 'Ran the annual audit.'], [0, 2]]
	] as [keyof Header, string[], string[], number[]][]
)
	.map(([key, was, words, at]): [string, Header, Header, Header] => {
		const put = (ks: number[]) => was.map((v, k) => (ks.includes(k) ? words[at.indexOf(k)] : v));
		return [
			`two rewrites of ${key}`,
			{ ...BASE, [key]: put(at) },
			{ ...BASE, [key]: put([at[0]]) },
			{ ...BASE, [key]: put([at[1]]) }
		];
	})
	.concat([
		[
			'a line added at the top of memoFor and one rewritten far below',
			{ ...BASE, memoFor: ['HQ USAF/CC', ...OFFICES.slice(0, 6), '7 CES/CC'] },
			{ ...BASE, memoFor: ['HQ USAF/CC', ...OFFICES] },
			{ ...BASE, memoFor: [...OFFICES.slice(0, 6), '7 CES/CC'] }
		],
		[
			'a paragraph added at the top of details and one rewritten below',
			{ ...BASE, details: ['Took command in May.', ...PARAS.slice(0, 2), 'Ran the annual audit.'] },
			{ ...BASE, details: ['Took command in May.', ...PARAS] },
			{ ...BASE, details: [...PARAS.slice(0, 2), 'Ran the annual audit.'] }
		],
		[
			'two members put into cc apart',
			{ ...BASE, cc: ['X', 'A', 'B', 'Y', 'C'] },
			{ ...BASE, cc: ['X', 'A', 'B', 'C'] },
			{ ...BASE, cc: ['A', 'B', 'Y', 'C'] }
		]
	]);

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

/** Whether every value of words the document holds names each of its blocks once. */
const idsApart = (doc: Document): boolean => {
	const values = [
		doc.getStored({ field: 'distribution' }),
		...['memo_for', 'details'].map((k) => q.reader(doc).getContentAt({ field: 'header' }, [k]))
	] as { blocks?: { id: string | null }[] }[];
	return values.every((v) => {
		const ids = (v?.blocks ?? []).map((b) => b.id).filter((id) => id != null);
		return new Set(ids).size === ids.length;
	});
};

describe.each(CASES)('an answer split into %s', (_, answer, ...parts) => {
	const whole = memo(answer).toMarkdown();

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
		expect(idsApart(doc)).toBe(true);
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
		expect(doc.toMarkdown()).toBe(memo(parts[kept]).toMarkdown());
		expect(idsApart(doc)).toBe(true);
	});
});
