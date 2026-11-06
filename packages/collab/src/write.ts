// The writer: a content field's `Content` → the fewest Y ops that make its Y state project to it.
//
// Island slots the edit kept are fixed points: the text between two of them is diffed on its own,
// by line and then by character, the lines both sides hold whole kept and each run of changed lines
// one splice (common prefix and suffix over USV characters), or, for a write from a revision, one
// splice per run of whole words that differs (`words.ts`). Two changes far apart in a field are
// two splices, so an edit made meanwhile between them stays where it was typed; and a slot whose island
// survived is never deleted and re-inserted. Re-inserting one would leave two slots holding its id
// when two clients do it at once, and would drop a concurrent edit to its props. After the splices,
// attributes are written only where Y differs: formatting runs, and the record of each block whose
// record changed. Containers are records by id, each written where it differs.
import * as Y from 'yjs';
import type { Content, ContentIsland } from '@quillmark/wasm';
import {
	BLOCK_ID,
	CODEC,
	LINE_KEYS,
	MARK_KEYS,
	SLOT,
	SLOT_PREFIX,
	attrsEqual,
	canonical,
	lineAttrs,
	markAttrs,
	readField,
	slotKey,
	units,
	utf16,
	yBlock,
	type Attrs,
	type ContentTypes
} from './shape.js';
import { commonRun } from './lines.js';
import { wordSplices, type Grain } from './words.js';

export type Mint = () => string;

/**
 * Write `next` into the field. Call inside a transaction. Returns the island ids the write
 * replaced: an id the store minted by position (`isl-0`), or one that names an island the field
 * held before, is not unique across clients, so the new island takes a minted id and the Document
 * has to take it too.
 */
export function writeContent(
	types: ContentTypes,
	next: Content,
	mint: Mint,
	grain: Grain = 'char'
): Map<string, string> {
	const renamed = new Map<string, string>();
	const { text, meta, containers } = types;
	const cur = readField(types);
	const islands = next.islands ?? [];
	const a = cur.chars;
	const b = Array.from(next.text);

	const aSlots = slotsOf(a);
	const bSlots = slotsOf(b);
	const pairs = commonRun(
		cur.islands.map((m) => m.get('id') as string),
		islands.map((i) => i.id)
	);

	const ylines = next.blocks.map(yBlock);
	const marks = markAttrs(next.marks ?? [], b);
	const opens: Attrs[] = [];
	let line = 0;
	b.forEach((ch, i) => {
		if (ch === '\n') opens[i] = lineAttrs(ylines[++line]);
	});
	const desired = (i: number): Attrs => (b[i] === '\n' ? opens[i] : marks[i]);
	// A `\n` is the same character only where it opens the same block, so a new block's `\n` is
	// never written onto the one another client is editing.
	const same = (i: number, j: number): boolean =>
		a[i] === b[j] &&
		a[i] !== SLOT &&
		(a[i] !== '\n' || cur.attrs[i][BLOCK_ID] === opens[j][BLOCK_ID]);
	const sameB = (i: number, j: number): boolean =>
		b[i] === b[j] && b[i] !== SLOT && (b[i] !== '\n' || opens[i][BLOCK_ID] === opens[j][BLOCK_ID]);

	// Each stretch between kept slots, and where its splices fall.
	const splices: { at: number; end: number; from: number; to: number }[] = [];
	const splice = (a0: number, a1: number, b0: number, b1: number) => {
		let p = 0;
		while (a0 + p < a1 && b0 + p < b1 && same(a0 + p, b0 + p)) p++;
		let s = 0;
		while (s < a1 - a0 - p && s < b1 - b0 - p && same(a1 - 1 - s, b1 - 1 - s)) s++;
		// An insertion alone sits as far left as the text allows: a word typed before a repeat of
		// itself is written before the repeat, where it was typed, and not after it.
		if (a1 - s === a0 + p) {
			const len = b1 - s - (b0 + p);
			while (p > 0 && sameB(b0 + p - 1, b0 + p - 1 + len)) p--;
			s = a1 - a0 - p;
		}
		if (a1 - s > a0 + p || b1 - s > b0 + p)
			splices.push({ at: a0 + p, end: a1 - s, from: b0 + p, to: b1 - s });
	};
	const keyA = (s: number, e: number): string =>
		a[s] === '\n' ? `\n${idA(s)}` : a[s] === SLOT ? `${SLOT}a${s}` : a.slice(s, e).join('');
	const keyB = (s: number, e: number): string =>
		b[s] === '\n' ? `\n${idB(s)}` : b[s] === SLOT ? `${SLOT}b${s}` : b.slice(s, e).join('');
	const change =
		grain === 'char'
			? splice
			: (a0: number, a1: number, b0: number, b1: number) =>
					splices.push(...wordSplices(a, a0, a1, keyA, b, b0, b1, keyB));
	const idA = (i: number): string => String(cur.attrs[i][BLOCK_ID] ?? '');
	const idB = (i: number): string => String(opens[i][BLOCK_ID] ?? '');
	const stretch = (a0: number, a1: number, b0: number, b1: number) => {
		for (const [[x0, x1], [y0, y1]] of sameLines(a, a0, a1, idA, b, b0, b1, idB)) {
			change(a0, x0, b0, y0);
			[a0, b0] = [x1, y1];
		}
		change(a0, a1, b0, b1);
	};
	let a0 = 0;
	let b0 = 0;
	for (const [ka, kb] of pairs) {
		stretch(a0, aSlots[ka], b0, bSlots[kb]);
		a0 = aSlots[ka] + 1;
		b0 = bSlots[kb] + 1;
	}
	stretch(a0, a.length, b0, b.length);

	// The island behind each new slot: a kept one keeps its map.
	const used = new Set(cur.islands.map((m) => m.get('id') as string));
	const keptMap = new Map<number, Y.Map<unknown>>();
	for (const [ka, kb] of pairs) keptMap.set(kb, cur.islands[ka]);
	const slotIndex = new Map<number, number>();
	bSlots.forEach((pos, k) => slotIndex.set(pos, k));

	// Last stretch first, so every earlier offset into `a` still holds.
	for (let n = splices.length - 1; n >= 0; n--) {
		const { at, end, from, to } = splices[n];
		const y = utf16(a, at);
		const removed = utf16(a, end) - y;
		if (removed) text.delete(y, removed);
		let pos = y;
		let i = from;
		while (i < to) {
			if (b[i] === SLOT) {
				const island = islands[slotIndex.get(i)!];
				text.insertEmbed(pos, islandMap(island, used, mint, renamed), desired(i));
				pos += 1;
				i += 1;
				continue;
			}
			const nl = b[i] === '\n';
			const keys = nl ? LINE_KEYS : MARK_KEYS;
			const want = desired(i);
			let chunk = '';
			let j = i;
			while (
				j < to &&
				b[j] !== SLOT &&
				(b[j] === '\n') === nl &&
				attrsEqual(desired(j), want, keys)
			) {
				chunk += b[j++];
				if (nl) break;
			}
			text.insert(pos, chunk, nulled(want, keys));
			pos += chunk.length;
			i = j;
		}
	}

	// Kept islands whose payload changed.
	for (const [kb, map] of keptMap) {
		const island = islands[kb];
		if (map.get('type') !== island.type) map.set('type', island.type);
		if (canonical(map.get('props')) !== canonical(island.props))
			map.set('props', structuredClone(island.props));
		writeSlots(map, island);
	}

	// Attributes, where they differ.
	const after = readField(types).attrs;
	let y16 = 0;
	for (let k = 0; k < b.length;) {
		const nl = b[k] === '\n';
		const keys = nl ? LINE_KEYS : MARK_KEYS;
		const want = desired(k);
		if (attrsEqual(after[k], want, keys)) {
			y16 += units(b[k++]);
			continue;
		}
		let j = k;
		let len = 0;
		while (
			j < b.length &&
			(b[j] === '\n') === nl &&
			!attrsEqual(after[j], desired(j), keys) &&
			attrsEqual(desired(j), want, keys)
		) {
			len += units(b[j++]);
			if (nl) break;
		}
		text.format(y16, len, nulled(want, keys));
		y16 += len;
		k = j;
	}

	// Containers, by id.
	const named = new Set<string>();
	for (const { id, ...record } of next.containers ?? []) {
		named.add(id);
		if (canonical(containers.get(id)) !== canonical(record)) containers.set(id, record);
	}
	for (const id of [...containers.keys()]) if (!named.has(id)) containers.delete(id);

	// Block 0's record lives in the map.
	const first = lineAttrs(ylines[0]);
	for (const key of LINE_KEYS) {
		const v = first[key] ?? null;
		if ((meta.get(key) ?? null) === v) continue;
		if (v === null) meta.delete(key);
		else meta.set(key, v);
	}
	if ((meta.get(CODEC) ?? null) !== (next.codec ?? null)) {
		if (next.codec) meta.set(CODEC, next.codec);
		else meta.delete(CODEC);
	}
	return renamed;
}

/**
 * The lines of `a[a0, a1)` and `b[b0, b1)` that both keep whole, as `[[from, to], [from, to]]`
 * ranges in order: the longest common run of lines, a line holding a slot never counting as
 * kept. A line is its characters up to and including its `\n`, and the id of the block that
 * `\n` opens (`idOf`), so a line is kept only where its block is.
 */
function sameLines(
	a: string[],
	a0: number,
	a1: number,
	idA: (i: number) => string,
	b: string[],
	b0: number,
	b1: number,
	idB: (i: number) => string
): [[number, number], [number, number]][] {
	const split = (
		chars: string[],
		from: number,
		to: number,
		side: string,
		idOf: (i: number) => string
	) => {
		const out: { key: string; from: number; to: number }[] = [];
		for (let i = from; i < to;) {
			let j = i;
			while (j < to && chars[j] !== '\n') j++;
			const id = j < to ? `${SLOT}${idOf(j)}` : '';
			if (j < to) j++;
			const line = chars.slice(i, j);
			out.push({
				key: line.includes(SLOT) ? `${side}${SLOT}${i}` : `${line.join('')}${id}`,
				from: i,
				to: j
			});
			i = j;
		}
		return out;
	};
	const x = split(a, a0, a1, 'a', idA);
	const y = split(b, b0, b1, 'b', idB);
	const pairs = commonRun(
		x.map((l) => l.key),
		y.map((l) => l.key)
	);
	return pairs.map(([i, j]) => [
		[x[i].from, x[i].to],
		[y[j].from, y[j].to]
	]);
}

function slotsOf(chars: string[]): number[] {
	const out: number[] = [];
	chars.forEach((ch, i) => {
		if (ch === SLOT) out.push(i);
	});
	return out;
}

/** The island's map. An id the store minted by position, or one the field already used, is
 *  replaced by a minted one. */
function islandMap(
	island: ContentIsland,
	used: Set<string>,
	mint: Mint,
	renamed: Map<string, string>
): Y.Map<unknown> {
	let id = island.id;
	if (/^isl-\d+$/.test(id) || used.has(id)) {
		id = mint();
		renamed.set(island.id, id);
	}
	used.add(id);
	const map = new Y.Map<unknown>();
	map.set('id', id);
	map.set('type', island.type);
	map.set('props', structuredClone(island.props));
	writeSlots(map, island);
	return map;
}

/** The island's slots, each under its own key, written where it differs; anchors are the
 *  Document's own and have no Y form. */
function writeSlots(map: Y.Map<unknown>, island: ContentIsland): void {
	const slots = island.slots ?? {};
	for (const [id, content] of Object.entries(slots)) {
		const value = withoutAnchors(content);
		if (canonical(map.get(slotKey(id))) !== canonical(value)) map.set(slotKey(id), value);
	}
	for (const key of [...map.keys()])
		if (key.startsWith(SLOT_PREFIX) && !Object.hasOwn(slots, key.slice(SLOT_PREFIX.length)))
			map.delete(key);
}

/** `content` with its anchors and its slots' anchors dropped, as Y carries it. */
export function withoutAnchors(content: Content): Content {
	const { anchors: _, islands, ...rest } = content;
	const out: Content = structuredClone(rest);
	if (islands) out.islands = islands.map(islandWithoutAnchors);
	return out;
}

export function islandWithoutAnchors(island: ContentIsland): ContentIsland {
	if (!island.slots) return structuredClone(island);
	const slots = Object.fromEntries(
		Object.entries(island.slots).map(([k, v]) => [k, withoutAnchors(v)])
	);
	return { ...structuredClone(island), slots };
}

/** `attrs` with every key of `keys` it does not set written as `null`, and the other family
 *  cleared too, so an insert inherits nothing: a `\n` typed inside bold text is not bold. */
function nulled(attrs: Attrs, keys: readonly string[]): Attrs {
	const out: Attrs = {};
	for (const k of keys) out[k] = attrs[k] ?? null;
	for (const k of keys === LINE_KEYS ? MARK_KEYS : LINE_KEYS) out[k] = null;
	return out;
}
