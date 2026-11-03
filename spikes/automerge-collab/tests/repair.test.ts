// Probe 6: merges that need repair, inserting repairs above all: who writes the repair back, and
// whether the stored documents still converge.
import { describe, expect, it } from 'vitest';
import type { Content, Document } from '@quillmark/wasm';
import {
	BODY,
	converged,
	core,
	docMd,
	parse,
	peers,
	settle,
	typeAt,
	write,
	type Peer
} from './helpers.js';

const para = (t: string): Content => ({ text: t, blocks: [{ id: 'b0', kind: 'para' }] });
type Props = { columns: string[]; rows: { id: string; cells: Record<string, string> }[] };

/** A then B; then whether another message flows, which a write-back would make. */
function quiet(ps: Peer[]): number {
	return settle(ps, BODY);
}

function rowAgainstColumn(): { ps: Peer[]; island: string } {
	const ps = peers(2, () => parse(docMd('| A |\n| --- |\n| 1 |\n')));
	const [a, b] = ps;
	const isl = a.doc.read(BODY).islands![0];
	const props = isl.props as Props;
	write(a, BODY, {
		steps: [
			{
				island: {
					id: isl.id,
					props: {
						...props,
						rows: [...props.rows, { id: 'pa-r', cells: { [props.columns[0]]: 'pa-s' } }]
					},
					slots: { 'pa-s': para('x') }
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
						columns: [...props.columns, 'pb-k'],
						rows: props.rows.map((r, i) => ({ ...r, cells: { ...r.cells, 'pb-k': `pb-s${i}` } }))
					},
					slots: Object.fromEntries(props.rows.map((_, i) => [`pb-s${i}`, para(`C${i}`)]))
				}
			}
		]
	});
	settle(ps, BODY);
	return { ps, island: isl.id };
}

const cellOf = (d: Document, island: string, row: number, col: string) =>
	(d.read(BODY).islands!.find((i) => i.id === island)!.props as Props).rows[row].cells[col];

describe('inserting repairs', () => {
	it('a row against a column: the missing cell reads as an empty slot on both peers', () => {
		const { ps, island } = rowAgainstColumn();
		const { values } = converged(ps, [BODY]);
		const slot = cellOf(ps[0].doc, island, 2, 'pb-k');
		expect(values[0].islands![0].slots![slot]).toEqual(para(''));
	});

	it('no peer writes the empty-cell repair back: no message flows once settled', () => {
		const { ps } = rowAgainstColumn();
		expect(quiet(ps)).toBe(0);
	});

	it('both peers typing into the repaired cell both land, and the documents converge', () => {
		const { ps, island } = rowAgainstColumn();
		const slot = cellOf(ps[0].doc, island, 2, 'pb-k');
		for (const [p, t] of [
			[ps[0], 'L'],
			[ps[1], 'R']
		] as const)
			write(p, BODY, {
				steps: [{ nested: { island, slot, change: { steps: [{ splice: { at: 0, insert: t } }] } } }]
			});
		settle(ps, BODY);
		const { values } = converged(ps, [BODY]);
		expect(['LR', 'RL']).toContain(values[0].islands![0].slots![slot].text);
	});

	function besideIsland(): Peer[] {
		const ps = peers(2, () => parse(docMd('Intro.\n\nab\n\nAfter.')));
		const [a, b] = ps;
		const at = a.doc.read(BODY).text.indexOf('ab');
		const table = core.importMarkdown('| H |\n| --- |\n| v |\n').content.islands![0];
		write(a, BODY, {
			steps: [{ splice: { at, delete: 'ab', insert: '￼', islands: [{ ...table, id: '?t' }] } }]
		});
		typeAt(b, BODY, at, 'x');
		typeAt(b, BODY, at + 3, 'y');
		settle(ps, BODY);
		return ps;
	}

	it('text typed either side of a table island: the block splits, the documents converge', () => {
		const ps = besideIsland();
		const { values } = converged(ps, [BODY]);
		const lines = values[0].text.split('\n');
		expect(lines).toContain('￼');
		expect(lines.join('')).toContain('x');
		expect(lines.join('')).toContain('y');
		expect(quiet(ps)).toBe(0);
	});

	it('both peers editing the split block afterwards do not land the repair twice', () => {
		const ps = besideIsland();
		const blocks = ps[0].doc.read(BODY).blocks.length;
		typeAt(ps[0], BODY, ps[0].doc.read(BODY).text.indexOf('x'), 'P');
		typeAt(ps[1], BODY, ps[1].doc.read(BODY).text.indexOf('y'), 'Q');
		settle(ps, BODY);
		const { values } = converged(ps, [BODY]);
		expect(values[0].blocks.length).toBe(blocks);
	});

	// GAP: nothing on the live surface says a repair happened. A receipt holds no `repairs`, and no
	// verb reads the merged state (`RawContent`) a live document holds, so a host cannot tell an
	// inserting repair from a write, cannot run `repair` itself, and cannot map through its change.
	it.fails('GAP: the receive receipt names the repair it read the merge through', () => {
		const ps = besideIsland();
		const named = ps[1].receipts.some((r) => 'repairs' in r);
		expect(named).toBe(true);
	});
});

describe('non-inserting repairs', () => {
	it('a list removed against an item added: the path loses the id, both converge', () => {
		const ps = peers(2, () => parse(docMd('Lead.\n\n- one\n- two\n')));
		const [a, b] = ps;
		const c = a.doc.read(BODY);
		const one = c.blocks[1];
		const list = one.path![0];
		write(a, BODY, {
			steps: [
				...c.blocks.slice(1).map((x) => ({ setBlock: { id: x.id, path: [] } })),
				{ container: { id: list, remove: true as const } },
				...c
					.containers!.filter((k) => k.kind === 'item')
					.map((k) => ({ container: { id: k.id, remove: true as const } }))
			]
		});
		const at = c.text.length;
		write(b, BODY, {
			steps: [
				{ container: { id: '?i', kind: 'item' } },
				{
					splice: {
						at,
						insert: '\nthree',
						blocks: [{ id: '?b', kind: 'para', path: [list, '?i'] }]
					}
				}
			]
		});
		settle(ps, BODY);
		converged(ps, [BODY]);
	});
});
