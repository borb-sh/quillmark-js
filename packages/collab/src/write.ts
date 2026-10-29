// The writer: a content field's `Content` → the fewest Y ops that make its Y state project to it.
//
// Island slots the edit kept are fixed points: the text between two of them is diffed on its own,
// one splice per stretch (common prefix and suffix over USV characters), so a slot whose island
// survived is never deleted and re-inserted. Re-inserting one would leave two slots holding its id
// when two clients do it at once, and would drop a concurrent edit to its props. After the splices,
// attributes are written only where Y differs: formatting runs, and line metadata on the lines whose
// metadata changed. The codec restates every line's containers with renumbered ordinals on a
// structural edit, so containers go through `assignIds` first, which gives a line the identities
// its old line held wherever its run is the same run.
import * as Y from 'yjs';
import type { Content, ContentContainer, ContentIsland } from '@quillmark/wasm';
import {
	LINE_KEYS,
	MARK_KEYS,
	SLOT,
	attrsEqual,
	lineAttrs,
	markAttrs,
	readField,
	units,
	utf16,
	type Attrs,
	type ContentTypes,
	type YContainer,
	type YLine
} from './shape.js';

export type Mint = () => string;

/**
 * Write `next` into the field. Call inside a transaction. Returns the island ids the write
 * replaced: an id the store minted by position (`isl-0`), or one that names an island the field
 * held before, is not unique across clients, so the new island takes a minted id and the Document
 * has to take it too.
 */
export function writeContent(types: ContentTypes, next: Content, mint: Mint): Map<string, string> {
	const renamed = new Map<string, string>();
	const { text, meta } = types;
	const cur = readField(types);
	const a = cur.chars;
	const b = Array.from(next.text);

	const aSlots = slotsOf(a);
	const bSlots = slotsOf(b);
	const pairs = commonIds(
		cur.islands.map((m) => m.get('id') as string),
		next.islands.map((i) => i.id)
	);

	// Each stretch between kept slots, and where its splice falls.
	const bToA: (number | undefined)[] = new Array(b.length);
	const splices: { at: number; end: number; from: number; to: number }[] = [];
	let a0 = 0;
	let b0 = 0;
	const stretch = (a1: number, b1: number) => {
		let p = 0;
		while (a0 + p < a1 && b0 + p < b1 && a[a0 + p] === b[b0 + p] && a[a0 + p] !== SLOT) p++;
		let s = 0;
		while (
			s < a1 - a0 - p &&
			s < b1 - b0 - p &&
			a[a1 - 1 - s] === b[b1 - 1 - s] &&
			a[a1 - 1 - s] !== SLOT
		)
			s++;
		for (let i = 0; i < p; i++) bToA[b0 + i] = a0 + i;
		for (let i = 0; i < s; i++) bToA[b1 - 1 - i] = a1 - 1 - i;
		splices.push({ at: a0 + p, end: a1 - s, from: b0 + p, to: b1 - s });
	};
	for (const [ka, kb] of pairs) {
		stretch(aSlots[ka], bSlots[kb]);
		bToA[bSlots[kb]] = aSlots[ka];
		a0 = aSlots[ka] + 1;
		b0 = bSlots[kb] + 1;
	}
	stretch(a.length, b.length);

	const ylines = assignIds(next, cur.lines, oldLines(a, b, bToA), mint);
	const marks = markAttrs(next.marks, b.length);
	const opens: Attrs[] = [];
	let line = 0;
	b.forEach((ch, i) => {
		if (ch === '\n') opens[i] = lineAttrs(ylines[++line]);
	});
	const desired = (i: number): Attrs => (b[i] === '\n' ? opens[i] : marks[i]);

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
				const island = next.islands[slotIndex.get(i)!];
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
		const island = next.islands[kb];
		if (map.get('type') !== island.type) map.set('type', island.type);
		if (JSON.stringify(map.get('props')) !== JSON.stringify(island.props))
			map.set('props', structuredClone(island.props));
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

	// Line 0 lives in the map.
	const first = lineAttrs(ylines[0]);
	for (const key of LINE_KEYS) {
		const v = first[key] ?? null;
		if ((meta.get(key) ?? null) === v) continue;
		if (v === null) meta.delete(key);
		else meta.set(key, v);
	}
	return renamed;
}

function slotsOf(chars: string[]): number[] {
	const out: number[] = [];
	chars.forEach((ch, i) => {
		if (ch === SLOT) out.push(i);
	});
	return out;
}

/** The longest run of ids the two sequences share in order, as index pairs. */
function commonIds(a: string[], b: string[]): [number, number][] {
	const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
	const out: [number, number][] = [];
	for (let i = 0, j = 0; i < a.length && j < b.length;) {
		if (a[i] === b[j]) out.push([i++, j++]);
		else if (t[i + 1][j] >= t[i][j + 1]) i++;
		else j++;
	}
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
	return map;
}

/** For each line of the new text, the old line that opens with the same `\n` (line 0 with line
 *  0), or `undefined` for a line whose `\n` a splice inserted. */
function oldLines(a: string[], b: string[], bToA: (number | undefined)[]): (number | undefined)[] {
	const lineAt = new Map<number, number>();
	let n = 0;
	a.forEach((ch, i) => {
		if (ch === '\n') lineAt.set(i, ++n);
	});
	const out: (number | undefined)[] = [0];
	b.forEach((ch, i) => {
		if (ch !== '\n') return;
		const from = bToA[i];
		out.push(from === undefined ? undefined : lineAt.get(from));
	});
	return out;
}

type Run = { id?: string };

/**
 * The Y form of every line's containers. A run of lines is one container: a list is lines whose
 * outer path matches and whose `list_item` at this depth has one shape and instance, an item is
 * the lines of one list sharing an ordinal, and any other container is lines whose container at
 * this depth is equal. Each run takes the first identity one of its lines held before the edit
 * that no earlier run has taken, and a run with none is minted one.
 */
function assignIds(
	next: Content,
	old: YLine[],
	oldOf: (number | undefined)[],
	mint: Mint
): YLine[] {
	const claimed = new Set<string>();
	const adopt = (run: Run, id: string) => {
		if (run.id !== undefined || claimed.has(id)) return;
		run.id = id;
		claimed.add(id);
	};
	const runs: { outer: Run; item?: Run; node: ContentContainer }[][] = [];
	next.lines.forEach((line, i) => {
		const here: (typeof runs)[number] = [];
		let samePrefix = i > 0;
		line.containers.forEach((c, d) => {
			const prev = samePrefix ? runs[i - 1][d] : undefined;
			const was = oldOf[i] === undefined ? undefined : old[oldOf[i]!]?.containers[d];
			let outer: Run;
			let item: Run | undefined;
			if (c.container === 'list_item') {
				const pc = prev?.node;
				const sameList =
					pc?.container === 'list_item' &&
					pc.attrs.ordered === c.attrs.ordered &&
					(pc.instance ?? 0) === (c.instance ?? 0);
				outer = sameList ? prev!.outer : {};
				item = sameList && pc.attrs.ordinal === c.attrs.ordinal ? prev!.item! : {};
				if (was?.c === 'list_item') {
					adopt(outer, was.list);
					adopt(item, was.item);
				}
			} else {
				outer = prev && JSON.stringify(prev.node) === JSON.stringify(c) ? prev.outer : {};
				if (was?.c === 'quote') adopt(outer, was.id);
			}
			here.push({ outer, item, node: c });
			samePrefix = !!prev && prev.outer === outer && prev.item === item;
		});
		runs.push(here);
	});

	return next.lines.map((line, i) => ({
		kind: JSON.stringify(
			'attrs' in line && line.attrs !== undefined
				? { kind: line.kind, attrs: line.attrs }
				: { kind: line.kind }
		),
		containers: runs[i].map(({ outer, item, node }) => yContainer(node, outer, item, mint)),
		continues: !!line.continues
	}));
}

function yContainer(
	c: ContentContainer,
	outer: Run,
	item: Run | undefined,
	mint: Mint
): YContainer {
	outer.id ??= mint();
	if (c.container !== 'list_item') return { c: 'quote', id: outer.id };
	item!.id ??= mint();
	return {
		c: 'list_item',
		list: outer.id,
		item: item!.id,
		ordered: c.attrs.ordered,
		start: c.attrs.start,
		...(c.attrs.checked === undefined ? {} : { checked: c.attrs.checked })
	};
}

/** `attrs` with every key of `keys` it does not set written as `null`, and the other family
 *  cleared too, so an insert inherits nothing: a `\n` typed inside bold text is not bold. */
function nulled(attrs: Attrs, keys: readonly string[]): Attrs {
	const out: Attrs = {};
	for (const k of keys) out[k] = attrs[k] ?? null;
	for (const k of keys === LINE_KEYS ? MARK_KEYS : LINE_KEYS) out[k] = null;
	return out;
}
