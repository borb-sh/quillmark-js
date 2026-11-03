// Probe 2, at random: three peers make random local edits (typing, deletes, splits, joins,
// indents, marks, anchors, cell edits, table rows) and exchange sync messages in a random order.
// Every receive must succeed, the peers must end on one stored document, and the value must read
// and be canonical.
import { describe, expect, it } from 'vitest';
import type { Content } from '@quillmark/wasm';
import { BODY, converged, docMd, parse, peers, step, settle, write, type Peer } from './helpers.js';

const SEEDS = Number(process.env.SEEDS ?? 40);
const START = docMd(
	'Opening paragraph with some words.\n\n- alpha item\n- beta item\n  - nested gamma\n- delta item\n\n| H1 | H2 |\n| --- | --- |\n| c1 | c2 |\n\n> A quoted line.\n\nClosing words here.'
);

function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Op = (p: Peer, r: () => number, n: number) => void;
const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];
const textOffsets = (c: Content) =>
	[...c.text].map((_, i) => i).filter((i) => c.text[i] !== '￼' && c.text[i - 1] !== '￼');
const opts = (p: Peer) => ({ base: p.doc.hash(BODY), actor: p.actor });

const OPS: Op[] = [
	(p, r) => {
		const c = p.doc.read(BODY);
		const at = pick(r, [...textOffsets(c), c.text.length]);
		write(p, BODY, { steps: [{ splice: { at, insert: pick(r, ['x', 'yy ', ' zed', 'Q']) } }] });
	},
	(p, r) => {
		const c = p.doc.read(BODY);
		const at = pick(r, textOffsets(c));
		const end = Math.min(c.text.length, at + 1 + Math.floor(r() * 4));
		const del = c.text.slice(at, end);
		if (del.includes('￼')) return;
		write(p, BODY, { steps: [{ splice: { at, delete: del, insert: '' } }] });
	},
	(p, r) => {
		const c = p.doc.read(BODY);
		p.doc.splitBlock(BODY, pick(r, textOffsets(c)), opts(p));
	},
	(p, r) => {
		const c = p.doc.read(BODY);
		p.doc.joinBlocks(BODY, pick(r, c.blocks.slice(1)).id, opts(p));
	},
	(p, r) => {
		const c = p.doc.read(BODY);
		const listed = c.blocks.filter((b) => b.path?.length);
		if (!listed.length) return;
		const b = pick(r, listed).id;
		if (r() < 0.5) p.doc.indent(BODY, b, undefined, opts(p));
		else p.doc.outdent(BODY, b, undefined, opts(p));
	},
	(p, r) => {
		const c = p.doc.read(BODY);
		const at = pick(r, textOffsets(c));
		const end = Math.min(c.text.length, at + 1 + Math.floor(r() * 6));
		write(p, BODY, {
			steps: [
				{ mark: { start: at, end, type: pick(r, ['strong', 'emph'] as const), add: r() < 0.8 } }
			]
		});
	},
	(p, r, n) => {
		const c = p.doc.read(BODY);
		const at = pick(r, textOffsets(c));
		const end = Math.min(c.text.length, at + Math.floor(r() * 6));
		write(p, BODY, { steps: [{ anchor: { id: `c-${p.name}-${n}`, start: at, end } }] });
	},
	(p, r) => {
		const c = p.doc.read(BODY);
		const isl = c.islands?.find((i) => i.type === 'table');
		if (!isl) return;
		const slot = pick(r, Object.keys(isl.slots ?? {}));
		const at = Math.floor(r() * ((isl.slots![slot].text.length ?? 0) + 1));
		write(p, BODY, {
			steps: [
				{ nested: { island: isl.id, slot, change: { steps: [{ splice: { at, insert: 'k' } }] } } }
			]
		});
	},
	(p, r, n) => {
		const c = p.doc.read(BODY);
		const isl = c.islands?.find((i) => i.type === 'table');
		if (!isl) return;
		const props = isl.props as {
			columns: string[];
			rows: { id: string; cells: Record<string, string> }[];
		};
		const id = `${p.actor}-${n}`;
		const cells = Object.fromEntries(props.columns.map((k, i) => [k, `${id}-s${i}`]));
		const slots = Object.fromEntries(
			Object.values(cells).map((s) => [
				s,
				{ text: '', blocks: [{ id: 'b0', kind: 'para' as const }] }
			])
		);
		write(p, BODY, {
			steps: [
				{
					island: {
						id: isl.id,
						props: { ...props, rows: [...props.rows, { id: `${id}-r`, cells }] },
						slots
					}
				}
			]
		});
	}
];

/** One seed's session: the refusals its local edits met, and the error that stopped it, if any. */
function run(seed: number): { refused: string[]; error?: string } {
	const r = rng(seed);
	const ps = peers(3, () => parse(START));
	const refused: string[] = [];
	try {
		for (let n = 0; n < 60; n++) {
			if (r() < 0.55) {
				const p = pick(r, ps);
				try {
					pick(r, OPS)(p, r, n);
				} catch (e) {
					refused.push(
						(e as { diagnostics?: { code: string }[] }).diagnostics?.[0]?.code ?? 'untyped'
					);
				}
			} else {
				const a = pick(r, ps);
				step(
					a,
					pick(
						r,
						ps.filter((x) => x !== a)
					),
					BODY
				);
			}
		}
		settle(ps, BODY);
		converged(ps, [BODY]);
	} catch (e) {
		return { refused, error: (e as Error).message };
	}
	return { refused };
}

// A non-inserting repair (here `split_run`, a list over two runs) is written back on receive under
// the shared no-actor id. Two peers that write it back from different heads make two different
// changes under one sequence number, and every peer holding one refuses the other for good.
const WRITE_BACK_COLLISION = /duplicate seq \d+ found for actor 7e$/;

describe('three peers, random concurrent edits and delivery', () => {
	it(`converge over ${SEEDS} seeds, but for repair write-back collisions`, () => {
		const failed: string[] = [];
		for (let seed = 1; seed <= SEEDS; seed++) {
			const { refused, error } = run(seed);
			expect(refused.every((c) => c === 'edit::content_apply')).toBe(true);
			if (error) {
				expect(error).toMatch(WRITE_BACK_COLLISION);
				failed.push(String(seed));
			}
		}
		expect(failed.length).toBeLessThan(SEEDS / 10);
	});

	it.fails('GAP: seed 34 converges (two peers write one repair back under the no-actor id)', () => {
		expect(run(34).error).toBeUndefined();
	});
});
