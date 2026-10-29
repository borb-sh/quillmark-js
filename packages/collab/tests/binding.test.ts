import { describe, expect, it } from 'vitest';
import type { Content } from '@quillmark/wasm';
import { bindField } from '../src/index.js';
import { body, core, deliver, edit, markdown, peers, settle, yText } from './helpers.js';

const SAMPLE = [
	'# Title',
	'',
	'Some **bold** and _emph_ and [a link](https://example.com) text 🎉.',
	'',
	'1. one',
	'2. two',
	'',
	'   continued',
	'3. three',
	'',
	'- x',
	'  - nested',
	'- y',
	'',
	'> quoted',
	'',
	'> another quote',
	'',
	'| a | b |',
	'|---|---|',
	'| 1 | 2 |',
	'',
	'after'
].join('\n');

const lineOf = (rt: Content, needle: string): number => rt.text.split('\n').indexOf(needle);
const endOfLine = (rt: Content, line: number): number =>
	Array.from(
		rt.text
			.split('\n')
			.slice(0, line + 1)
			.join('\n')
	).length;

describe('the Y projection', () => {
	it('seeds a document and projects it back unchanged', () => {
		const [a] = peers(1, SAMPLE);
		const original = core.Document.fromMarkdown(markdown(SAMPLE));
		expect(a.doc.toMarkdown()).toBe(original.toMarkdown());
		expect(yText(a)).toBe(body(a).text);
	});

	it('carries a local edit to another peer', () => {
		const [a, b] = peers(2, SAMPLE);
		expect(edit(a, { delta: { ops: [{ retain: 2 }, { insert: 'Big ' }] } })).toBe(true);
		deliver(b);
		expect(b.doc.toMarkdown()).toBe(a.doc.toMarkdown());
		expect(b.doc.toMarkdown()).toContain('# TiBig tle');
		expect(b.remotes).toBe(1);
	});

	it('keeps two items inserted at once into one list as two items', () => {
		const [a, b] = peers(2, SAMPLE);
		for (const [peer, after, text] of [
			[a, 'one', 'A'],
			[b, 'two', 'B']
		] as const) {
			const rt = body(peer);
			const line = lineOf(rt, after);
			const at = endOfLine(rt, line);
			// What Enter in a list writes: the split, then every line restated with the items
			// after the new one renumbered.
			const renumbered = [...rt.lines];
			renumbered.splice(line + 1, 0, rt.lines[line]);
			const ops = renumbered.map((l, i) => {
				const c = l.containers[0];
				if (i <= line || c?.container !== 'list_item' || c.attrs.ordered !== true)
					return l.containers;
				return [
					{ ...c, attrs: { ...c.attrs, ordinal: c.attrs.ordinal + 1 } },
					...l.containers.slice(1)
				];
			});
			expect(
				edit(peer, {
					delta: { ops: [{ retain: at }, { insert: `\n${text}` }] },
					lineOps: ops.map((containers, i) => ({ op: 'setContainers', line: i, containers }))
				})
			).toBe(true);
		}
		settle([a, b]);
		expect(a.doc.toMarkdown()).toBe(b.doc.toMarkdown());
		const md = a.doc.toMarkdown();
		expect(md).toMatch(/1\. one\n+2\. A\n+3\. two\n+4\. B\n/);
	});

	it('converges when a table lands on a line another peer is typing on', () => {
		const [a, b] = peers(2, 'first\n\nsecond');
		const rt = body(a);
		const at = endOfLine(rt, 0);
		expect(
			edit(a, {
				delta: { ops: [{ retain: at }, { insert: '\n' }] },
				islandOps: [
					{
						op: 'insert',
						at: at + 1,
						id: 'isl-0',
						type: 'table',
						props: { header: [{ text: 'h', marks: [] }], rows: [], aligns: ['none'] }
					}
				]
			})
		).toBe(true);
		// b types where a's new line opens: the end of the first line.
		expect(edit(b, { delta: { ops: [{ retain: at }, { insert: ' typed' }] } })).toBe(true);
		settle([a, b]);
		expect(a.doc.toMarkdown()).toBe(b.doc.toMarkdown());
		expect(yText(a)).toBe(body(a).text);
		expect(yText(b)).toBe(body(b).text);
		expect(a.doc.toMarkdown()).toContain('| h |');
		expect(a.doc.toMarkdown()).toContain('typed');
	});

	const revises = 'reviseContent' in core.Document.prototype;

	it.runIf(revises)("keeps a peer's own anchor through a remote edit", () => {
		const [a, b] = peers(2, 'hello world');
		const at = Array.from(body(a).text).indexOf('w');
		expect(
			edit(a, {
				markOps: [{ op: 'add', type: 'anchor', attrs: { id: 'c1' }, start: at, end: at + 5 }]
			})
		).toBe(true);
		expect(edit(b, { delta: { ops: [{ insert: 'Oh, ' }] } })).toBe(true);
		settle([a, b]);
		const anchor = body(a).marks.find((m) => m.type === 'anchor');
		expect(anchor && Array.from(body(a).text).slice(anchor.start, anchor.end).join('')).toBe(
			'world'
		);
		expect(a.doc.toMarkdown()).toBe(b.doc.toMarkdown());
	});

	it('hands the host the delta the Y change made, not one diffed after it', () => {
		const deltas: unknown[] = [];
		const [a, b] = peers(2, 'aa');
		a.binding.destroy();
		a.binding = bindField({ doc: a.doc, ydoc: a.ydoc, onRemote: (d) => deltas.push(d) });
		// A third `a` at the start: a diff of `aa` → `aaa` would place it at the end.
		b.ydoc.getText('main.body').insert(0, 'a');
		settle([a, b]);
		expect(deltas).toEqual([{ ops: [{ insert: 'a' }] }]);
	});
});
