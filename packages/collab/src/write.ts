// The diff writer: a field's `Content` → the fewest Y ops that make its Y state project to it.
//
// One text splice (common prefix and suffix over USV characters), then a pass that writes an
// attribute only where the Y side differs: formatting runs, and line metadata only on lines whose
// metadata changed. The codec restates every line's containers on a structural edit, with
// renumbered ordinals; written as-is that would be a last-writer-wins over the whole field. So
// containers go through `assignIds` first, which gives a line the identities its old line held
// wherever its run is the same run, and then they compare equal.
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
	type Attrs,
	type FieldTypes,
	type YContainer,
	type YLine
} from './shape.js';

export type Mint = () => string;

/** Write `next` into the field, in one transaction under `origin`. Returns the island ids the
 *  write replaced: an id the store minted positionally (`isl-0`) is not unique across clients,
 *  so a new island gets a minted one, and the Document has to take it. */
export function writeField(
	types: FieldTypes,
	next: Content,
	mint: Mint,
	origin: unknown
): Map<string, string> {
	const renamed = new Map<string, string>();
	const doc = types.text.doc;
	const run = () => write(types, next, mint, renamed);
	if (doc) doc.transact(run, origin);
	else run();
	return renamed;
}

function write(
	{ text, meta }: FieldTypes,
	next: Content,
	mint: Mint,
	renamed: Map<string, string>
): void {
	const cur = readField({ text, meta });
	const a = cur.chars;
	const b = Array.from(next.text);

	let p = 0;
	while (p < a.length && p < b.length && a[p] === b[p]) p++;
	let s = 0;
	while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;

	const ylines = assignIds(next, cur.lines, oldLineMap(a, b, p, s), mint);
	const marks = markAttrs(next.marks, b.length);
	const opens: Attrs[] = [];
	let line = 0;
	b.forEach((ch, i) => {
		if (ch === '\n') opens[i] = lineAttrs(ylines[++line]);
	});
	const desired = (i: number): Attrs => (b[i] === '\n' ? opens[i] : marks[i]);

	// Islands in slot order, split at the splice: the kept ones keep their maps.
	const slotsBefore = count(a.slice(0, p), SLOT);
	const slotsKeptAfter = count(a.slice(a.length - s), SLOT);
	const keptIds = new Set<string>();
	cur.islands.forEach((m, k) => {
		if (k < slotsBefore || k >= cur.islands.length - slotsKeptAfter)
			keptIds.add(m.get('id') as string);
	});

	// The splice.
	const at = utf16(a, p);
	const removed = utf16(a, a.length - s) - at;
	if (removed) text.delete(at, removed);
	let y = at;
	let slot = slotsBefore;
	let i = p;
	while (i < b.length - s) {
		if (b[i] === SLOT) {
			const island = next.islands[slot++];
			text.insertEmbed(y, islandMap(island, keptIds, mint, renamed), desired(i));
			keptIds.add(renamed.get(island.id) ?? island.id);
			y += 1;
			i += 1;
			continue;
		}
		let j = i;
		let chunk = '';
		const want = desired(i);
		const keys = b[i] === '\n' ? LINE_KEYS : MARK_KEYS;
		while (j < b.length - s && b[j] !== SLOT && (b[j] === '\n') === (b[i] === '\n')) {
			if (!attrsEqual(desired(j), want, keys)) break;
			chunk += b[j];
			j++;
			if (b[i] === '\n') break;
		}
		text.insert(y, chunk, nulled(want, keys));
		y += chunk.length;
		i = j;
	}

	// Kept islands whose payload changed.
	next.islands.forEach((island, k) => {
		const map = k < slotsBefore ? cur.islands[k] : undefined;
		const tail = next.islands.length - k;
		const kept =
			map ?? (tail <= slotsKeptAfter ? cur.islands[cur.islands.length - tail] : undefined);
		if (!kept) return;
		if (kept.get('type') !== island.type) kept.set('type', island.type);
		if (JSON.stringify(kept.get('props')) !== JSON.stringify(island.props))
			kept.set('props', structuredClone(island.props));
		const id = kept.get('id') as string;
		if (id !== island.id) renamed.set(island.id, id);
	});

	// Attributes, where they differ.
	const after = readField({ text, meta });
	let y16 = 0;
	for (let k = 0; k < b.length;) {
		const isNl = b[k] === '\n';
		const keys = isNl ? LINE_KEYS : MARK_KEYS;
		const want = desired(k);
		if (attrsEqual(after.attrs[k], want, keys)) {
			y16 += units(b[k]);
			k++;
			continue;
		}
		let j = k;
		let len = 0;
		while (
			j < b.length &&
			(b[j] === '\n') === isNl &&
			!attrsEqual(after.attrs[j], desired(j), keys) &&
			attrsEqual(desired(j), want, keys)
		) {
			len += units(b[j]);
			j++;
			if (isNl) break;
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
}

/** The island's map. A kept id stays; an id the store minted positionally, or one another
 *  island in the field already holds, is replaced by a minted one. */
function islandMap(
	island: ContentIsland,
	kept: Set<string>,
	mint: Mint,
	renamed: Map<string, string>
): Y.Map<unknown> {
	let id = island.id;
	if (/^isl-\d+$/.test(id) || kept.has(id)) {
		id = mint();
		renamed.set(island.id, id);
	}
	const map = new Y.Map<unknown>();
	map.set('id', id);
	map.set('type', island.type);
	map.set('props', structuredClone(island.props));
	return map;
}

/** For each line of the new text, the line of the old text that opens with the same `\n` (line
 *  0 with line 0), or `undefined` for a line whose `\n` the splice inserted. */
function oldLineMap(a: string[], b: string[], p: number, s: number): (number | undefined)[] {
	const map: (number | undefined)[] = [0];
	let oldLine = 0;
	let newLine = 0;
	for (let i = 0; i < p; i++) if (b[i] === '\n') map[++newLine] = ++oldLine;
	for (let i = p; i < b.length - s; i++) if (b[i] === '\n') map[++newLine] = undefined;
	oldLine += count(a.slice(p, a.length - s), '\n');
	for (let i = b.length - s; i < b.length; i++) if (b[i] === '\n') map[++newLine] = ++oldLine;
	return map;
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
	const runs: { outer: Run; item?: Run; node: ContentContainer }[][] = [];
	next.lines.forEach((line, i) => {
		const here: (typeof runs)[number] = [];
		let prefixSame = i > 0;
		line.containers.forEach((c, d) => {
			const prev = prefixSame ? runs[i - 1][d] : undefined;
			const o = oldOf[i] === undefined ? undefined : old[oldOf[i]!]?.containers[d];
			let outer: Run;
			let item: Run | undefined;
			if (c.container === 'list_item') {
				const pc = prev?.node;
				const sameList =
					pc?.container === 'list_item' &&
					pc.attrs.ordered === c.attrs.ordered &&
					(pc.instance ?? 0) === (c.instance ?? 0);
				outer = sameList ? prev!.outer : {};
				item = sameList && pc.attrs.ordinal === c.attrs.ordinal ? prev!.item! : ({} as Run);
				if (o?.c === 'list_item') {
					adopt(outer, o.list, claimed);
					adopt(item, o.item, claimed);
				}
			} else {
				const same = prev && JSON.stringify(prev.node) === JSON.stringify(c);
				outer = same ? prev!.outer : {};
				if (o?.c === 'quote') adopt(outer, o.id, claimed);
			}
			here.push({ outer, item, node: c });
			prefixSame = !!prev && prev.outer === outer && prev.item === item;
		});
		runs.push(here);
	});

	return next.lines.map((line, i) => ({
		kind: JSON.stringify(line.kind === 'para' ? { kind: 'para' } : kindOf(line)),
		containers: runs[i].map(({ outer, item, node }) => yContainer(node, outer, item, mint)),
		continues: !!line.continues
	}));
}

function adopt(run: Run, id: string, claimed: Set<string>): void {
	if (run.id !== undefined || claimed.has(id)) return;
	run.id = id;
	claimed.add(id);
}

function kindOf(line: Content['lines'][number]): object {
	return 'attrs' in line && line.attrs !== undefined
		? { kind: line.kind, attrs: line.attrs }
		: { kind: line.kind };
}

function yContainer(
	c: ContentContainer,
	outer: Run,
	item: Run | undefined,
	mint: Mint
): YContainer {
	outer.id ??= mint();
	if (c.container === 'list_item') {
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
	return { c: 'quote', id: outer.id };
}

/** `attrs` with every key of `keys` it does not set written as `null`, so a Y insert or format
 *  clears what it would otherwise inherit. */
function nulled(attrs: Attrs, keys: readonly string[]): Attrs {
	const out: Attrs = {};
	for (const k of keys) out[k] = attrs[k] ?? null;
	// An insert must also clear the other family, or a `\n` typed inside bold text inherits it.
	for (const k of keys === LINE_KEYS ? MARK_KEYS : LINE_KEYS) out[k] = null;
	return out;
}

function count(chars: string[], ch: string): number {
	let n = 0;
	for (const c of chars) if (c === ch) n++;
	return n;
}

const units = (ch: string): number => (ch.codePointAt(0)! > 0xffff ? 2 : 1);

function utf16(chars: string[], end: number): number {
	let n = 0;
	for (let i = 0; i < end; i++) n += units(chars[i]);
	return n;
}
