// Probe 2, the named cases: concurrent edits on one block, a list indent against an item insert,
// a table row insert against a column insert, and a mark against a concurrent type at its edge.
// Each asserts convergence and that the value validates.
import { describe, expect, it } from 'vitest';
import type { Content } from '@quillmark/wasm';
import {
	BODY,
	converged,
	deleteAt,
	docMd,
	parse,
	peers,
	settle,
	typeAt,
	write
} from './helpers.js';

const TABLE = 'Intro para.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n';
const LIST = 'Lead.\n\n- one\n- two\n- three\n';

const blockId = (c: Content, text: string): string => {
	const i = c.text.split('\n').indexOf(text);
	if (i < 0) throw new Error(`no block ${text}`);
	return c.blocks[i].id;
};

describe('three peers, named concurrent cases', () => {
	it('concurrent edits on one block: two inserts and a delete over the same word', () => {
		const ps = peers(3, () => parse(docMd('Hello wonderful world.')));
		typeAt(ps[0], BODY, 6, 'very ');
		typeAt(ps[1], BODY, 10, 'X');
		deleteAt(ps[2], BODY, 6, 16);
		settle(ps, BODY);
		const { values } = converged(ps, [BODY]);
		expect(values[0].text).toBe('Hello very Xworld.');
	});

	it('a list indent against an item insert', () => {
		const ps = peers(2, () => parse(docMd(LIST)));
		const [a, b] = ps;
		const c = a.doc.read(BODY);
		const two = blockId(c, 'two');
		const list = c.blocks.find((x) => x.id === two)!.path![0];
		a.doc.indent(BODY, two, undefined, { base: a.doc.hash(BODY), actor: a.actor });
		const at = c.text.indexOf('two') + 3;
		write(b, BODY, {
			steps: [
				{ container: { id: '?item', kind: 'item' } },
				{
					splice: {
						at,
						insert: '\nnew',
						blocks: [{ id: '?b', kind: 'para', path: [list, '?item'] }]
					}
				}
			]
		});
		settle(ps, BODY);
		const { values } = converged(ps, [BODY]);
		expect(values[0].text).toBe('Lead.\none\ntwo\nnew\nthree');
	});

	it('a table row insert against a column insert', () => {
		const ps = peers(2, () => parse(docMd(TABLE)));
		const [a, b] = ps;
		const c = a.doc.read(BODY);
		const isl = c.islands![0];
		const props = isl.props as {
			columns: string[];
			rows: { id: string; cells: Record<string, string> }[];
		};
		const para = (t: string): Content => ({ text: t, blocks: [{ id: 'b0', kind: 'para' }] });
		write(a, BODY, {
			steps: [
				{
					island: {
						id: isl.id,
						props: {
							...props,
							rows: [
								...props.rows,
								{
									id: 'peer0-r9',
									cells: { [props.columns[0]]: 'peer0-s1', [props.columns[1]]: 'peer0-s2' }
								}
							]
						},
						slots: { 'peer0-s1': para('x'), 'peer0-s2': para('y') }
					}
				}
			]
		});
		write(b, BODY, {
			steps: [
				{
					island: {
						id: isl.id,
						props: {
							...props,
							columns: [...props.columns, 'peer1-k9'],
							rows: props.rows.map((r, i) => ({
								...r,
								cells: { ...r.cells, 'peer1-k9': `peer1-s${i}` }
							}))
						},
						slots: Object.fromEntries(props.rows.map((_, i) => [`peer1-s${i}`, para(`C${i}`)]))
					}
				}
			]
		});
		settle(ps, BODY);
		const { values } = converged(ps, [BODY]);
		const merged = values[0].islands![0].props as typeof props;
		// Both edits land: three rows, three columns, every cell backed by a slot.
		expect({ rows: merged.rows.length, columns: merged.columns.length }).toEqual({
			rows: 3,
			columns: 3
		});
	});

	it('a mark against a concurrent type at its end edge and at its start edge', () => {
		const ps = peers(2, () => parse(docMd('Hello world.')));
		const [a, b] = ps;
		write(a, BODY, { steps: [{ mark: { start: 6, end: 11, type: 'strong', add: true } }] });
		typeAt(b, BODY, 11, 'X');
		typeAt(b, BODY, 6, 'Y');
		settle(ps, BODY);
		const { values } = converged(ps, [BODY]);
		expect(values[0].text).toBe('Hello Yworld X.'.replace(' X', 'X'));
		// Automerge marks grow at neither edge: neither typed character takes the mark.
		expect(values[0].marks).toEqual([{ start: 7, end: 12, type: 'strong' }]);
	});
});
