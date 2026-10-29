// Convergence under random concurrent edits. Three peers edit one Document the way the editor
// commits (`applyChange` on content, the typed writer on fields, the card verbs on the list), push
// after each, exchange Y updates at random times and in random order, and must end holding one
// Document. The mix leans on where the content model fights a CRDT: items inserted into one list
// (positional ordinals), tables edited and typed around (slots), and cards moved and edited at once.
import { describe, expect, it } from 'vitest';
import type { Addr, ChangeBundle, Content, ContentContainer, Quill } from '@quillmark/wasm';
import type { CardOp } from '../src/index.js';
import { project } from '../src/project.js';
import { contentRoot, contentTypes, readField } from '../src/shape.js';
import { core, deliver, peers, quill, settle, snapshot, canonical, type Peer } from './helpers.js';

const SEEDS = 120;
const STEPS = 40;

/** A seeded PRNG (mulberry32), so a failing seed replays. */
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
const SLOT = '￼';

const lineStarts = (rt: Content): number[] => {
	const starts = [0];
	Array.from(rt.text).forEach((c, i) => c === '\n' && starts.push(i + 1));
	return starts;
};
const lineEnd = (rt: Content, line: number): number => {
	const starts = lineStarts(rt);
	return line + 1 < starts.length ? starts[line + 1] - 1 : Array.from(rt.text).length;
};
const table = (text: string) => ({
	header: [{ text, marks: [] }],
	rows: [],
	aligns: ['none' as const]
});

/** One random content edit over `rt`; `undefined` where the pick does not apply. */
function contentEdit(r: Rng, rt: Content): ChangeBundle | undefined {
	const len = Array.from(rt.text).length;
	const line = r.int(rt.lines.length);
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
			'nest',
			'heading',
			'bold',
			'table',
			'cell',
			'cell',
			'nearTable',
			'nearTable',
			'cut'
		] as const)
	) {
		case 'type':
			return { delta: { ops: [{ retain: r.int(len + 1) }, { insert: r.pick(WORDS) }] } };
		case 'delete': {
			if (!len) return undefined;
			const at = r.int(len);
			return { delta: { ops: [{ retain: at }, { delete: 1 + r.int(Math.min(4, len - at)) }] } };
		}
		case 'enter':
			return { delta: { ops: [{ retain: r.int(len + 1) }, { insert: '\n' }] } };
		case 'item': {
			// Enter at the end of a list line, with every later item restated renumbered, as the
			// codec writes it.
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
		case 'list':
			return {
				lineOps: [
					{
						op: 'setContainers',
						line,
						containers: [
							{ container: 'list_item', attrs: { ordered: r.next() < 0.5, start: 1, ordinal: 0 } }
						]
					}
				]
			};
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
		case 'nest': {
			// A line one level into the container its line above holds, the deepest a `Tab` reaches.
			if (line === 0) return undefined;
			const above = rt.lines[line - 1].containers;
			const inner: ContentContainer =
				r.next() < 0.7
					? { container: 'list_item', attrs: { ordered: r.next() < 0.5, start: 1, ordinal: 0 } }
					: { container: 'quote' };
			return {
				lineOps: [{ op: 'setContainers', line, containers: [...above.slice(0, 2), inner] }]
			};
		}
		case 'heading':
			return {
				lineOps: [{ op: 'setKind', line, kind: 'heading', attrs: { level: 1 + r.int(3) } }]
			};
		case 'bold': {
			const start = lineStarts(rt)[line];
			const end = lineEnd(rt, line);
			if (end <= start) return undefined;
			const a = start + r.int(end - start);
			return {
				markOps: [
					{
						op: r.next() < 0.7 ? 'add' : 'remove',
						type: 'strong',
						start: a,
						end: a + 1 + r.int(end - a)
					}
				]
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
			const slots = Array.from(rt.text).flatMap((c, i) => (c === SLOT ? [i] : []));
			if (!slots.length) return undefined;
			const s = r.pick(slots);
			const at = r.next() < 0.5 ? Math.max(0, s - 1) : Math.min(len, s + 2);
			return { delta: { ops: [{ retain: at }, { insert: r.pick(WORDS) }] } };
		}
		case 'cut': {
			// A deletion that spans a table's slot, the edit that deletes an island.
			const slots = Array.from(rt.text).flatMap((c, i) => (c === SLOT ? [i] : []));
			if (!slots.length) return undefined;
			const s = r.pick(slots);
			const at = Math.max(0, s - r.int(3));
			return {
				delta: { ops: [{ retain: at }, { delete: Math.min(len - at, s - at + 1 + r.int(2)) }] }
			};
		}
	}
}

/** Every content field a peer's Document holds: bodies, and the declared `richtext` fields. */
function contentAddrs(q: Quill, p: Peer): Addr[] {
	const out: Addr[] = [{}];
	for (const [name, f] of Object.entries(q.schema.main.fields))
		if (f.type === 'richtext') out.push({ field: name });
	p.doc.cards.forEach((c, i) => {
		out.push({ card: i });
		for (const [name, f] of Object.entries(q.schema.card_kinds?.[c.kind]?.fields ?? {}))
			if (f.type === 'richtext') out.push({ card: i, field: name });
	});
	return out;
}

/** One random local edit on `p`, pushed; whether anything landed. */
function edit(r: Rng, q: Quill, p: Peer): boolean {
	const doc = p.doc;
	const kinds = Object.keys(q.schema.card_kinds ?? {});
	let op: CardOp | undefined;
	try {
		switch (
			r.pick([
				'content',
				'content',
				'content',
				'content',
				'content',
				'text',
				'value',
				'value',
				'clear',
				'insert',
				'remove',
				'move',
				'move',
				'retype',
				'rename'
			] as const)
		) {
			case 'content': {
				const addr = r.pick(contentAddrs(q, p));
				const rt = (doc.getStored(addr) as Content | undefined) ?? {
					text: '',
					lines: [{ kind: 'para', containers: [] }],
					marks: [],
					islands: []
				};
				const bundle = contentEdit(r, rt);
				if (!bundle) return false;
				if (doc.getStored(addr) == null) return false;
				doc.applyChange(addr, bundle);
				break;
			}
			case 'text':
				q.writer(doc).set('subtitle', `${r.pick(WORDS)}${r.pick(WORDS)}`);
				break;
			case 'value': {
				const w = q.writer(doc);
				if (r.next() < 0.5) w.set('columns', 1 + r.int(3));
				else
					w.set(
						'keywords',
						[r.pick(WORDS), r.pick(WORDS)].map((s) => s.trim() || 'k')
					);
				break;
			}
			case 'clear':
				doc.removeField(r.pick(['columns', 'keywords', 'subtitle', 'abstract']));
				break;
			case 'insert': {
				const kind = r.pick(kinds);
				const card = q.seedCard(kind, doc.seedOverlay(kind));
				if (!card) return false;
				const at = r.int(doc.cardCount + 1);
				doc.insertCard(card, at);
				op = { op: 'insert', at };
				break;
			}
			case 'remove': {
				if (!doc.cardCount) return false;
				const at = r.int(doc.cardCount);
				doc.removeCard(at);
				op = { op: 'remove', at };
				break;
			}
			case 'move': {
				if (doc.cardCount < 2) return false;
				const from = r.int(doc.cardCount);
				const to = Math.min(doc.cardCount - 1, Math.max(0, from + (r.next() < 0.5 ? -1 : 1)));
				if (from === to) return false;
				doc.moveCard(from, to);
				op = { op: 'move', from, to };
				break;
			}
			case 'retype': {
				if (!doc.cardCount) return false;
				const at = r.int(doc.cardCount);
				doc.insertCard({ ...doc.card(at), kind: r.pick(kinds) }, at);
				doc.removeCard(at + 1);
				break;
			}
			case 'rename': {
				if (!doc.cardCount) return false;
				doc.storeExt({ card: r.int(doc.cardCount) }, { editor: { title: r.pick(WORDS) } });
				break;
			}
		}
	} catch {
		return false;
	}
	p.binding.push(op);
	return true;
}

function run(seed: number, q: Quill): { all: Peer[]; edits: number } {
	const r = rng(seed);
	const all = peers(3, () => q.exampleDocument()!, q);
	let edits = 0;
	for (let step = 0; step < STEPS; step++) {
		const p = r.pick(all);
		if (r.next() < 0.65) edits += edit(r, q, p) ? 1 : 0;
		else deliver(p, (n) => r.int(n), 1 + r.int(4));
	}
	settle(all);
	return { all, edits };
}

describe('three peers, random concurrent edits', () => {
	it(`converge over ${SEEDS} seeds`, () => {
		const q = quill();
		const failures: string[] = [];
		let edits = 0;
		for (let seed = 1; seed <= SEEDS; seed++) {
			const out = run(seed, q);
			edits += out.edits;
			const [a, ...rest] = out.all;
			const want = snapshot(a.doc);
			for (const p of rest)
				if (snapshot(p.doc) !== want) failures.push(`seed ${seed}: documents differ`);
			for (const p of out.all) {
				if (p.errors.length) failures.push(`seed ${seed}: ${String(p.errors[0])}`);
				const names = ['main', ...p.binding.ids];
				contentAddrs(q, p).forEach((addr) => {
					const card = addr.card === undefined ? 'main' : names[addr.card + 1];
					const stored = p.doc.getStored(addr) as Content | undefined;
					if (!stored) return;
					const projected = project(
						readField(contentTypes(p.ydoc, contentRoot(card, addr.field)))
					).content;
					if (projected.text !== stored.text)
						failures.push(`seed ${seed}: ${card}/${addr.field ?? '$body'} Y text differs`);
					if (canonical(core.normalize(projected)) !== canonical(projected))
						failures.push(
							`seed ${seed}: ${card}/${addr.field ?? '$body'} projection is not canonical`
						);
				});
			}
		}
		console.log(`fuzz: ${SEEDS} seeds, ${edits} edits landed`);
		expect(failures.slice(0, 10)).toEqual([]);
	});
});
