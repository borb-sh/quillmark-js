// Convergence under random concurrent edits. Three peers edit one Document the way the editor
// commits (`apply` on content, the typed writer on fields, the card verbs on the list), push
// after each, exchange Y updates at random times and in random order, and must end holding one
// Document. The mix leans on where the content model fights a CRDT: items inserted into one list
// (container runs), tables edited and typed around (slots), and cards moved and edited at once.
// Some edits are made from a revision the peer held earlier (`writeFrom`), as a slow writer's are.
import { describe, expect, it } from 'vitest';
import type { Addr, Change, Content, Document, Quill } from '@quillmark/wasm';
import { writeFrom, type CardOp } from '../src/index.js';
import * as Y from 'yjs';
import { project } from '../src/project.js';
import { contentRoot, contentTypes, readField } from '../src/shape.js';
import { withoutAnchors } from '../src/write.js';
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

/** The UTF-16 offset of USV position `k` of `text`. */
const unit = (text: string, k: number): number => Array.from(text).slice(0, k).join('').length;
/** Each block's id with its USV range, `\n` excluded. */
const blockRanges = (rt: Content) => {
	const chars = Array.from(rt.text);
	let start = 0;
	return rt.blocks.map((b) => {
		let end = start;
		while (end < chars.length && chars[end] !== '\n') end++;
		const range = { block: b, start, end };
		start = end + 1;
		return range;
	});
};
const fresh = (r: Rng) => `f${r.int(2 ** 30).toString(36)}`;

type Write = (doc: Document, at: Addr) => unknown;

/** One random content edit over `rt`: a change, or a structural edit the Document makes at an
 *  address; `undefined` where the pick does not apply. */
function contentEdit(r: Rng, rt: Content): Change | Write | undefined {
	const { importMarkdown } = core;
	const deleteRange =
		(s: number, e: number): Write =>
		(d, a) =>
			d.deleteRange(a, s, e);
	const splitBlock =
		(at: number, id: string): Write =>
		(d, a) =>
			d.splitBlock(a, at, { id });
	const len = Array.from(rt.text).length;
	const u = (k: number) => unit(rt.text, k);
	const ranges = blockRanges(rt);
	const { block, start, end } = r.pick(ranges);
	const slots = Array.from(rt.text).flatMap((c, i) => (c === SLOT ? [i] : []));
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
			return { steps: [{ splice: { at: u(r.int(len + 1)), insert: r.pick(WORDS) } }] };
		case 'delete': {
			if (!len) return undefined;
			const at = r.int(len);
			return deleteRange(u(at), u(at + 1 + r.int(Math.min(4, len - at))));
		}
		case 'enter':
			return splitBlock(u(r.int(len + 1)), fresh(r));
		case 'item': {
			// Enter at the end of a block inside a list.
			const listed = ranges.filter((x) => x.block.path?.length);
			if (!listed.length) return undefined;
			return splitBlock(u(r.pick(listed).end), fresh(r));
		}
		case 'list':
			return (d, a) => d.wrap(a, block.id, block.id, { kind: 'list', ordered: r.next() < 0.5 });
		case 'quote':
			return block.path?.length
				? (d, a) => d.outdent(a, block.id, block.id)
				: (d, a) => d.wrap(a, block.id, block.id, { kind: 'quote' });
		case 'nest':
			return (d, a) => d.indent(a, block.id, block.id);
		case 'heading':
			return {
				steps: [{ setBlock: { id: block.id, kind: 'heading', attrs: { level: 1 + r.int(3) } } }]
			};
		case 'bold': {
			if (end <= start) return undefined;
			const a = start + r.int(end - start);
			const b = a + 1 + r.int(end - a);
			return { steps: [{ mark: { start: u(a), end: u(b), add: r.next() < 0.7, type: 'strong' } }] };
		}
		case 'table': {
			const island = {
				...importMarkdown('| t |\n| - |').content.islands![0],
				id: `isl-${r.int(3)}`
			};
			return {
				steps: [
					{
						splice: {
							at: u(end),
							insert: `\n${SLOT}`,
							blocks: [{ id: fresh(r), kind: 'para' }],
							islands: [island]
						}
					}
				]
			};
		}
		case 'cell': {
			const island = rt.islands?.length ? r.pick(rt.islands) : undefined;
			if (island?.type !== 'table' || !island.slots) return undefined;
			const slot = r.pick(Object.keys(island.slots));
			return {
				steps: [
					{
						nested: {
							island: island.id,
							slot,
							change: { steps: [{ splice: { at: 0, insert: r.pick(WORDS) } }] }
						}
					}
				]
			};
		}
		case 'nearTable': {
			if (!slots.length) return undefined;
			const s = r.pick(slots);
			const at = r.next() < 0.5 ? Math.max(0, s - 1) : Math.min(len, s + 2);
			return { steps: [{ splice: { at: u(at), insert: r.pick(WORDS) } }] };
		}
		case 'cut': {
			// A deletion that spans a table's slot, the edit that deletes an island.
			if (!slots.length) return undefined;
			const s = r.pick(slots);
			const at = Math.max(0, s - r.int(3));
			return deleteRange(u(at), u(Math.min(len, s + 1 + r.int(2))));
		}
	}
}

/** Every content field a peer's Document holds: bodies, and the declared `richtext` fields. */
/** The content fields `p`'s cards declare, where a random edit lands. */
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

/** Every content root Y holds for `p`: each card's body, and each field its map marks `@f`
 *  as content, whatever the card's kind declares. */
function contentRoots(p: Peer): { addr: Addr; card: string; root: string }[] {
	const names = ['main', ...p.binding.ids];
	return names.flatMap((card, k) => {
		const at: Addr = k ? { card: k - 1 } : {};
		const out = [{ addr: at, card, root: contentRoot(card) }];
		for (const [key, form] of p.ydoc.getMap<unknown>(card).entries())
			if (key.startsWith('@') && form === 'content')
				out.push({
					addr: { ...at, field: key.slice(1) },
					card,
					root: contentRoot(card, key.slice(1))
				});
		return out;
	});
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
				if (doc.getStored(addr) == null) return false;
				const at = typeof addr.card === 'number' ? { ...addr, card: doc.card(addr.card).id } : addr;
				const change = contentEdit(r, doc.read(at));
				if (!change) return false;
				if (typeof change === 'function') change(doc, at);
				else doc.apply(at, change);
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
				doc.unchecked.insertCard(card, at);
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
				const was = doc.card(at);
				doc.removeCard(at);
				try {
					doc.unchecked.insertCard({ ...was, kind: r.pick(kinds) }, at);
				} catch (e) {
					doc.unchecked.insertCard(was, at);
					throw e;
				}
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

/** One random edit made from a revision `p` held earlier, applied to `p`; whether it landed. */
function staleEdit(r: Rng, q: Quill, p: Peer, base: Uint8Array): boolean {
	let landed = false;
	const { update } = writeFrom({
		history: p.ydoc,
		base,
		quill: q,
		doc: p.doc,
		edit(doc) {
			let op: CardOp | undefined;
			const scratch = { doc, binding: { push: (o?: CardOp) => void (op = o) } } as unknown as Peer;
			landed = edit(r, q, scratch);
			return op;
		}
	});
	Y.applyUpdate(p.ydoc, update, 'writer');
	return landed;
}

function run(seed: number, q: Quill): { all: Peer[]; edits: number; errors: string[] } {
	const r = rng(seed);
	const all = peers(3, () => q.exampleDocument()!, q);
	const bases = new Map<Peer, Uint8Array>();
	const errors: string[] = [];
	let edits = 0;
	for (let step = 0; step < STEPS; step++) {
		const p = r.pick(all);
		const roll = r.next();
		if (roll < 0.1) bases.set(p, Y.encodeSnapshot(Y.snapshot(p.ydoc)));
		else if (roll < 0.2 && bases.has(p)) {
			try {
				edits += staleEdit(r, q, p, bases.get(p)!) ? 1 : 0;
			} catch (e) {
				errors.push(`seed ${seed}: writeFrom threw ${String(e)}`);
			}
		} else if (roll < 0.7) edits += edit(r, q, p) ? 1 : 0;
		else deliver(p, (n) => r.int(n), 1 + r.int(4));
	}
	settle(all);
	return { all, edits, errors };
}

describe('three peers, random concurrent edits', () => {
	it(`converge over ${SEEDS} seeds`, () => {
		const q = quill();
		const failures: string[] = [];
		let edits = 0;
		for (let seed = 1; seed <= SEEDS; seed++) {
			const out = run(seed, q);
			edits += out.edits;
			failures.push(...out.errors);
			const [a, ...rest] = out.all;
			const want = snapshot(a.doc);
			for (const p of rest)
				if (snapshot(p.doc) !== want) failures.push(`seed ${seed}: documents differ`);
			for (const p of out.all) {
				if (p.errors.length) failures.push(`seed ${seed}: ${String(p.errors[0])}`);
				contentRoots(p).forEach(({ addr, card, root }) => {
					const stored = p.doc.getStored(addr);
					const field = addr.field ?? '$body';
					if (typeof stored !== 'object' || stored === null)
						return failures.push(`seed ${seed}: ${card}/${field} holds no content`);
					const projected = project(readField(contentTypes(p.ydoc, root))).content;
					if (canonical(withoutAnchors(stored as Content)) !== canonical(projected))
						failures.push(`seed ${seed}: ${card}/${field} differs from its root`);
					if (canonical(core.normalize(projected)) !== canonical(projected))
						failures.push(`seed ${seed}: ${card}/${field} projection is not canonical`);
				});
			}
		}
		console.log(`fuzz: ${SEEDS} seeds, ${edits} edits landed`);
		expect(failures.slice(0, 10)).toEqual([]);
	});
});
