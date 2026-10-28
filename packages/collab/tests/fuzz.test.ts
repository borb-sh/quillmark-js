// Convergence under random concurrent edits: three peers edit one body through `applyChange` the
// way the editor commits, exchange Y updates in random order and at random times, and must end
// with one document. The edit mix leans on the two places the content model fights a CRDT: list
// items inserted into one list (positional ordinals) and tables landing next to typing (a slot
// that ends up sharing its line).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ChangeBundle, Content, ContentContainer } from '@quillmark/wasm';
import { body, deliver, edit, peers, settle, yText, type Peer } from './helpers.js';

const START = ['Intro line', '', '1. one', '2. two', '3. three', '', 'Outro'].join('\n');
const SEEDS = 150;
const STEPS = 40;

/** A small seeded PRNG (mulberry32), so a failing seed replays. */
function rng(seed: number) {
	let t = seed >>> 0;
	const next = () => {
		t = (t + 0x6d2b79f5) >>> 0;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
	const int = (n: number) => Math.floor(next() * n);
	return { next, int, pick: <T>(xs: readonly T[]): T => xs[int(xs.length)] };
}
type Rng = ReturnType<typeof rng>;

const WORDS = ['a', 'bc', 'def', ' ', 'xy z', '🎉', 'é'];

function lineStarts(rt: Content): number[] {
	const chars = Array.from(rt.text);
	const starts = [0];
	chars.forEach((c, i) => c === '\n' && starts.push(i + 1));
	return starts;
}
const lineEnd = (rt: Content, line: number): number => {
	const starts = lineStarts(rt);
	return line + 1 < starts.length ? starts[line + 1] - 1 : Array.from(rt.text).length;
};

const table = (text: string) => ({
	header: [{ text, marks: [] }],
	rows: [],
	aligns: ['none' as const]
});

/** One random local edit on `peer`; `undefined` where the pick was not applicable. */
function randomEdit(r: Rng, rt: Content): ChangeBundle | undefined {
	const len = Array.from(rt.text).length;
	const lines = rt.lines.length;
	const line = r.int(lines);
	switch (
		r.pick([
			'type',
			'type',
			'type',
			'delete',
			'enter',
			'item',
			'item',
			'list',
			'quote',
			'heading',
			'bold',
			'table',
			'table',
			'cell',
			'nearTable'
		] as const)
	) {
		case 'type': {
			const at = r.int(len + 1);
			return { delta: { ops: [{ retain: at }, { insert: r.pick(WORDS) }] } };
		}
		case 'delete': {
			if (!len) return undefined;
			const at = r.int(len);
			return { delta: { ops: [{ retain: at }, { delete: 1 + r.int(Math.min(4, len - at)) }] } };
		}
		case 'enter':
			return { delta: { ops: [{ retain: r.int(len + 1) }, { insert: '\n' }] } };
		case 'item': {
			// Enter at the end of a list line: the split, and every line restated with the items
			// after it renumbered, which is what the codec writes.
			const listLines = rt.lines.flatMap((l, i) =>
				l.containers[0]?.container === 'list_item' ? [i] : []
			);
			if (!listLines.length) return undefined;
			const at = r.pick(listLines);
			const restated = [...rt.lines];
			restated.splice(at + 1, 0, rt.lines[at]);
			const containers = restated.map((l, i): ContentContainer[] => {
				const c = l.containers[0];
				if (i <= at || c?.container !== 'list_item') return l.containers;
				return [
					{ ...c, attrs: { ...c.attrs, ordinal: c.attrs.ordinal + 1 } },
					...l.containers.slice(1)
				];
			});
			return {
				delta: { ops: [{ retain: lineEnd(rt, at) }, { insert: `\n${r.pick(WORDS)}` }] },
				lineOps: containers.map((c, i) => ({ op: 'setContainers', line: i, containers: c }))
			};
		}
		case 'list': {
			const ordered = r.next() < 0.5;
			return {
				lineOps: [
					{
						op: 'setContainers',
						line,
						containers: [{ container: 'list_item', attrs: { ordered, start: 1, ordinal: 0 } }]
					}
				]
			};
		}
		case 'quote':
			return {
				lineOps: [
					{
						op: 'setContainers',
						line,
						containers: rt.lines[line].containers.length ? [] : [{ container: 'quote' }]
					}
				]
			};
		case 'heading':
			return {
				lineOps: [{ op: 'setKind', line, kind: 'heading', attrs: { level: 1 + r.int(3) } }]
			};
		case 'bold': {
			const start = lineStarts(rt)[line];
			const end = lineEnd(rt, line);
			if (end <= start) return undefined;
			const a = start + r.int(end - start);
			const b = a + 1 + r.int(end - a);
			return {
				markOps: [{ op: r.next() < 0.7 ? 'add' : 'remove', type: 'strong', start: a, end: b }]
			};
		}
		case 'table': {
			const at = lineEnd(rt, line);
			return {
				delta: { ops: [{ retain: at }, { insert: '\n' }] },
				islandOps: [
					{ op: 'insert', at: at + 1, id: `isl-${r.int(3)}`, type: 'table', props: table('t') }
				]
			};
		}
		case 'cell': {
			const island = rt.islands.length ? r.pick(rt.islands) : undefined;
			if (island?.type !== 'table') return undefined;
			return {
				islandOps: [{ op: 'set', id: island.id, type: 'table', props: table(r.pick(WORDS)) }]
			};
		}
		case 'nearTable': {
			// Type at either edge of a table's line: the slot's own line, which a concurrent
			// table insert is opening.
			const chars = Array.from(rt.text);
			const slots = chars.flatMap((c, i) => (c === '￼' ? [i] : []));
			if (!slots.length) return undefined;
			const s = r.pick(slots);
			const at = r.next() < 0.5 ? Math.max(0, s - 1) : Math.min(len, s + 2);
			return { delta: { ops: [{ retain: at }, { insert: r.pick(WORDS) }] } };
		}
	}
}

function run(seed: number): { all: Peer[]; edits: number } {
	const r = rng(seed);
	const all = peers(3, START);
	let edits = 0;
	for (let step = 0; step < STEPS; step++) {
		const peer = r.pick(all);
		if (r.next() < 0.7) {
			const bundle = randomEdit(r, body(peer));
			if (bundle && edit(peer, bundle)) edits++;
		} else {
			deliver(peer, (n) => r.int(n), 1 + r.int(4));
		}
	}
	settle(all);
	return { all, edits };
}

describe('three peers, random concurrent edits', () => {
	it(`converge over ${SEEDS} seeds`, () => {
		let repairs = 0;
		let edits = 0;
		const failures: string[] = [];
		for (let seed = 1; seed <= SEEDS; seed++) {
			const out = run(seed);
			edits += out.edits;
			const [a, ...rest] = out.all;
			repairs += out.all.reduce((n, p) => n + p.binding.repairs, 0);
			const md = a.doc.toMarkdown();
			for (const p of out.all) {
				if (p.doc.toMarkdown() !== md) failures.push(`seed ${seed}: markdown differs`);
				if (yText(p) !== body(p).text) failures.push(`seed ${seed}: Y text ≠ Document text`);
			}
			for (const p of rest)
				if (!sameState(p.ydoc, a.ydoc)) failures.push(`seed ${seed}: Y states differ`);
		}
		console.log(`fuzz: ${SEEDS} seeds, ${edits} edits landed, ${repairs} table-line repairs`);
		expect(failures).toEqual([]);
	});
});

function sameState(x: Y.Doc, y: Y.Doc): boolean {
	const a = Y.encodeStateVector(x);
	const b = Y.encodeStateVector(y);
	return a.length === b.length && a.every((v, i) => v === b[i]);
}
