// Decode: content → PM, a pure function (CODEC §Decode). Fold the flat lines into the tree: group a
// `continues` run into one block (para hard breaks → `hard_break`; a fence's lines → one
// `code_block`), nest by shared `containers` prefix, select the block node by `kind`, apply marks
// over their `[start,end)` USV ranges, and lower island slots to leaf nodes. Anchors are
// decorations (field.ts). Positions are USV; `Array.from` iterates by code point so an astral char
// is one unit.
import { DOMSerializer, type Mark, type Node as PMNode, type Schema } from 'prosemirror-model';
import type { Content, ContentContainer, ContentLine, ContentMark } from '@quillmark/wasm';
import { ISLAND_SLOT, isBlockIsland, isEditedIsland, type IslandNodeAttrs } from './islands.js';
import { descriptorOf, markKey, pmMarkFromContent } from './marks.js';
import { core } from '../lifecycle.js';
import { hasMarks, isBlockSchema, isInlineSchema, takesLineBreak } from './schema.js';

/** Code points of `s` (USV units): the iteration granularity the content speaks. */
export function codePoints(s: string): string[] {
	return Array.from(s);
}
/** USV length of `s` (code points, not UTF-16 units). */
export function usvLength(s: string): number {
	let n = 0;
	for (const _ of s) n++;
	return n;
}

/** One `continues`-joined block, pre-nesting: its container path + per-line segments. */
interface Leaf {
	line: ContentLine;
	containers: ContentContainer[];
	segments: { text: string; startUSV: number }[];
}

/** A live cursor over the island entries, consumed in text (document) order. */
type IslandCursor = { i: number; rt: Content };

/**
 * A `Content` as read-only DOM: decode under `schema`, then the nodes' own `toDOM`, for chrome that
 * must show content in the mark vocabulary a leaf edits it in (the tips card) without a second
 * renderer to drift from `decode`. `DOMSerializer.fromSchema` memoizes on the schema.
 */
export function renderContent(rt: Content, schema: Schema): Node {
	return DOMSerializer.fromSchema(schema).serializeFragment(decode(rt, schema).content);
}

/** Decode a `Content` to a PM document under `schema`. */
export function decode(rt: Content, schema: Schema): PMNode {
	const lineTexts = rt.text.split('\n');
	// Per-line USV start: line i begins after all earlier lines and their `\n`s.
	const starts: number[] = [];
	let acc = 0;
	for (let i = 0; i < lineTexts.length; i++) {
		starts.push(acc);
		acc += usvLength(lineTexts[i]) + 1; // +1 for the `\n` boundary
	}
	// A mark-free schema has nothing to apply marks with, and a `text` field that acquired one
	// anyway (a hand-written document) must open and heal on the next commit, not throw.
	const marks = hasMarks(schema) ? rt.marks.filter((m) => m.type !== 'anchor') : [];
	const cursor: IslandCursor = { i: 0, rt };

	if (isInlineSchema(schema)) {
		return decodeInline(schema, lineTexts, starts, marks, cursor);
	}
	if (!isBlockSchema(schema)) {
		return decodePlain(rt, schema, lineTexts, starts, marks, cursor);
	}

	// Build leaves (fold `continues` runs), then nest by container prefix.
	const leaves: Leaf[] = [];
	for (let i = 0; i < rt.lines.length; i++) {
		const line = rt.lines[i];
		const seg = { text: lineTexts[i] ?? '', startUSV: starts[i] };
		if (line.continues && leaves.length > 0) {
			leaves[leaves.length - 1].segments.push(seg);
		} else {
			leaves.push({ line, containers: line.containers, segments: [seg] });
		}
	}

	const blocks = groupBlocks(schema, leaves, 0, marks, cursor);
	return schema.nodes.doc.create(null, blocks.length ? blocks : schema.nodes.paragraph.create());
}

/**
 * Whether `rt` decodes under an inline schema with nothing but whitespace dropped: upstream's
 * one-line rule, or one plain line and the empty one a trailing `\n` opens (the one a YAML `|`
 * scalar keeps in a `text` value). Marks are the schema's business.
 */
export function fitsInline(rt: Content): boolean {
	if (core().isInline(rt)) return true;
	const plain = (line: ContentLine): boolean =>
		line.kind === 'para' && line.containers.length === 0;
	return (
		rt.islands.length === 0 &&
		rt.lines.length === 2 &&
		rt.lines.every(plain) &&
		!rt.lines[1].continues &&
		rt.text.endsWith('\n')
	);
}

/**
 * Whether `rt` decodes under `plainSchema` losing nothing but its marks, which the next commit
 * heals (CODEC §Inline mode): upstream's `isPlain` with marks set aside.
 */
export function fitsPlain(rt: Content): boolean {
	return core().isPlain({ ...rt, marks: [] });
}

/**
 * Whether a leaf so declared edits `rt` losing nothing: {@link fitsInline} narrowed and {@link
 * fitsPlain} plain, past which the decode drops what the first commit would store. On the block
 * schema, anything but a construct read and not edited (`isEditedIsland`) and an island where the
 * leaf mounts no island view (`islands`), which draws as a placeholder atom a keystroke deletes
 * unseen.
 */
export function fitsLeaf(
	rt: Content,
	leaf: { inline: boolean; plaintext: boolean; islands: boolean }
): boolean {
	if (leaf.inline) return fitsInline(rt);
	if (leaf.plaintext) return fitsPlain(rt);
	if (!leaf.islands && rt.islands.length) return false;
	return rt.islands.every((isl) => isEditedIsland(isl.type));
}

/** Inline decode: one paragraph, containers and islands stripped. */
function decodeInline(
	schema: Schema,
	lineTexts: string[],
	starts: number[],
	marks: ContentMark[],
	cursor: IslandCursor
): PMNode {
	// An inline field is single-line: stray lines join with a space. The empty line a trailing `\n`
	// opens is dropped, so a first edit stores no space nobody typed. Islands are not representable
	// inline: the slot char is dropped and its entry skipped.
	const inline: PMNode[] = [];
	const last = lineTexts.length - 1;
	for (let i = 0; i < lineTexts.length; i++) {
		if (i > 0 && i === last && lineTexts[i] === '') break;
		if (i > 0) inline.push(schema.text(' '));
		inline.push(...buildInline(schema, lineTexts[i], starts[i], marks, cursor, true));
	}
	const para = schema.nodes.paragraph.create(null, inline);
	return schema.nodes.doc.create(null, para);
}

/**
 * Plain decode: a `continues` line is a `hard_break` in the paragraph above and every other line
 * opens one. Line kinds, containers and islands are dropped, so content {@link fitsPlain} refuses
 * opens flattened.
 */
function decodePlain(
	rt: Content,
	schema: Schema,
	lineTexts: string[],
	starts: number[],
	marks: ContentMark[],
	cursor: IslandCursor
): PMNode {
	const paras: PMNode[][] = [];
	for (let i = 0; i < rt.lines.length; i++) {
		const inline = buildInline(schema, lineTexts[i] ?? '', starts[i], marks, cursor, true);
		const open = paras[paras.length - 1];
		if (rt.lines[i].continues && open) open.push(schema.nodes.hard_break.create(), ...inline);
		else paras.push(inline);
	}
	const blocks = paras.map((inline) => schema.nodes.paragraph.create(null, inline));
	return schema.nodes.doc.create(null, blocks.length ? blocks : schema.nodes.paragraph.create());
}

/** Nest a run of leaves that share a `depth`-length container prefix into blocks. */
function groupBlocks(
	schema: Schema,
	leaves: Leaf[],
	depth: number,
	marks: ContentMark[],
	cursor: IslandCursor
): PMNode[] {
	const out: PMNode[] = [];
	let i = 0;
	while (i < leaves.length) {
		const path = leaves[i].containers;
		if (path.length <= depth) {
			out.push(makeLeaf(schema, leaves[i], marks, cursor));
			i++;
			continue;
		}
		const here = path[depth];
		if (here.container === 'list_item') {
			// Gather the maximal run of sibling `list_item` leaves at this depth
			// (same ordered/start), then split it into items by `ordinal`.
			const { ordered, start } = here.attrs;
			const instance = instanceOf(here);
			let j = i + 1;
			while (j < leaves.length) {
				const c = atDepth(leaves[j], depth);
				if (!c || c.container !== 'list_item') break;
				if (c.attrs.ordered !== ordered || c.attrs.start !== start) break;
				// `instance` is the boundary between two adjacent lists; the normalizer
				// numbers a run's `ordinal`s gaplessly from 0, so a reset carries none.
				if (instanceOf(c) !== instance) break;
				j++;
			}
			const run = leaves.slice(i, j);
			const items: PMNode[] = [];
			let k = 0;
			while (k < run.length) {
				const ord = ordinalAt(run[k], depth);
				let l = k + 1;
				while (l < run.length && ordinalAt(run[l], depth) === ord) l++;
				items.push(
					schema.nodes.list_item.create(
						{ checked: checkedAt(run[k], depth) },
						groupBlocks(schema, run.slice(k, l), depth + 1, marks, cursor)
					)
				);
				k = l;
			}
			const listType = ordered ? schema.nodes.ordered_list : schema.nodes.bullet_list;
			out.push(listType.create(ordered ? { start } : null, items));
			i = j;
			continue;
		}
		// The quote, and the whole of what is left: `satisfies` makes a container added upstream a
		// compile error. A wrapper over the run of leaves carrying the identical container
		// (`containerKey`).
		here.container satisfies 'quote';
		const key = containerKey(here);
		let j = i + 1;
		while (j < leaves.length) {
			const c = atDepth(leaves[j], depth);
			if (!c || containerKey(c) !== key) break;
			j++;
		}
		const inner = groupBlocks(schema, leaves.slice(i, j), depth + 1, marks, cursor);
		out.push(schema.nodes.blockquote.create(null, inner));
		i = j;
	}
	return out;
}

function atDepth(leaf: Leaf, depth: number): ContentContainer | undefined {
	return leaf.containers[depth];
}

/**
 * The `ordinal` of a leaf's `list_item` at `depth`, only called inside a run the discriminant
 * established.
 */
function ordinalAt(leaf: Leaf, depth: number): number {
	const c = atDepth(leaf, depth);
	return c?.container === 'list_item' ? c.attrs.ordinal : -1;
}

/** A task item's `checked` at `depth`, `null` on any other item: what the item's lines
 * carry alike, so its first line answers for it. */
function checkedAt(leaf: Leaf, depth: number): boolean | null {
	const c = atDepth(leaf, depth);
	return c?.container === 'list_item' ? (c.attrs.checked ?? null) : null;
}

/**
 * A container's `instance`, absent meaning the zero a canonical read omits. It tells one container
 * from an adjacent sibling of identical shape, so absent and `0` answer alike.
 */
function instanceOf(c: ContentContainer): number {
	return c.instance ?? 0;
}

/** Identity of a container for run gathering: its name and its `instance`, NUL-joined
 * as `markKey` joins a mark's. `list_item` carries its own run rule, so the rest are what
 * key here. */
function containerKey(c: ContentContainer): string {
	return `${c.container}\u0000${instanceOf(c)}`;
}

/**
 * A single leaf block node from its segments, exhaustive over the closed line vocabulary so a kind
 * added upstream is a compile error.
 */
function makeLeaf(schema: Schema, leaf: Leaf, marks: ContentMark[], cursor: IslandCursor): PMNode {
	const line = leaf.line;
	switch (line.kind) {
		case 'rule':
			return schema.nodes.horizontal_rule.create();
		case 'code': {
			// One code_block: the segments' texts joined by literal `\n`, no marks.
			const text = leaf.segments.map((s) => s.text).join('\n');
			const content = text.length ? [schema.text(text)] : [];
			return schema.nodes.code_block.create({ lang: line.attrs?.lang ?? null }, content);
		}
		case 'para':
		case 'heading': {
			if (line.kind !== 'heading' && blockIslandLine(leaf, cursor))
				return schema.nodes.island_block.create(islandAttrs(cursor)!);
			// Inline content: the segment boundary is a `hard_break` in a paragraph and a space in
			// a heading, which takes none (`schema.ts` §`takesLineBreak`). A stored heading carries
			// no continuation, so the space keeps hand-built content decodable.
			const type = line.kind === 'heading' ? schema.nodes.heading : schema.nodes.paragraph;
			const inline: PMNode[] = [];
			leaf.segments.forEach((seg, idx) => {
				if (idx > 0)
					inline.push(takesLineBreak(type) ? schema.nodes.hard_break.create() : schema.text(' '));
				inline.push(...buildInline(schema, seg.text, seg.startUSV, marks, cursor, false));
			});
			return line.kind === 'heading'
				? type.create({ level: line.attrs.level }, inline)
				: type.create(null, inline);
		}
		default: {
			const unreached: never = line;
			return unreached;
		}
	}
}

/**
 * Whether a `para` leaf is one block island: a single line holding its slot alone, backed by an
 * island whose markup is a block.
 */
function blockIslandLine(leaf: Leaf, cursor: IslandCursor): boolean {
	if (leaf.segments.length !== 1 || leaf.segments[0].text !== ISLAND_SLOT) return false;
	const isl = cursor.rt.islands[cursor.i];
	return isl != null && isBlockIsland(isl.type);
}

/**
 * Consume the next island entry as PM node attrs (text-order matched to slots): the whole entry,
 * which an island edit writes back (`islands.ts`). `null` where a slot has no entry (malformed
 * content): the slot draws nothing, keeping the decode total.
 */
function islandAttrs(cursor: IslandCursor): IslandNodeAttrs | null {
	const isl = cursor.rt.islands[cursor.i++];
	return isl ? { id: isl.id, islandType: isl.type, props: isl.props } : null;
}

/**
 * Inline nodes for one segment: split text into maximal runs of a constant mark set, lower each
 * `U+FFFC` to an inline island node. `stripIslands` drops slots. `pos = segStartUSV + k` indexes
 * into the global mark ranges.
 */
function buildInline(
	schema: Schema,
	segText: string,
	segStartUSV: number,
	marks: ContentMark[],
	cursor: IslandCursor,
	stripIslands: boolean
): PMNode[] {
	const cps = codePoints(segText);
	const out: PMNode[] = [];
	let runText = '';
	let runKey = '';
	let runMarks: readonly Mark[] = [];
	const flush = () => {
		if (runText.length) out.push(schema.text(runText, runMarks));
		runText = '';
	};
	// A mark set changes only where a mark starts or ends; `marks` is the whole list, so resolving
	// per code point would cost the text against every mark.
	const segEndUSV = segStartUSV + cps.length;
	const spanning = marks.filter((m) => m.start < segEndUSV && m.end > segStartUSV);
	const edges = new Set<number>();
	for (const m of spanning) {
		if (m.start > segStartUSV) edges.add(m.start);
		if (m.end < segEndUSV) edges.add(m.end);
	}
	let active: ContentMark[] = [];
	let key = '';
	let unresolved = true;
	for (let k = 0; k < cps.length; k++) {
		const cp = cps[k];
		const pos = segStartUSV + k;
		if (cp === ISLAND_SLOT) {
			flush();
			const attrs = islandAttrs(cursor);
			if (attrs && !stripIslands && schema.nodes.island_inline) {
				out.push(schema.nodes.island_inline.create(attrs));
			}
			runKey = '\0slot'; // force a fresh run after a slot
			unresolved = true; // the slot's own position is skipped, edge or not
			continue;
		}
		if (unresolved || edges.has(pos)) {
			active = spanning.filter((m) => m.start <= pos && pos < m.end);
			key = markSetKey(active);
			unresolved = false;
		}
		if (key !== runKey && runText.length) flush();
		if (key !== runKey) {
			runKey = key;
			runMarks = buildMarkSet(schema, active);
		}
		runText += cp;
	}
	flush();
	return out;
}

/** A stable key for a mark set (order-independent) to detect run boundaries. */
function markSetKey(active: ContentMark[]): string {
	if (!active.length) return '';
	// Per-mark keys via the shared descriptor + NUL-delimited `markKey`, the pair the mark diff
	// groups by. JSON-joined so a `link:a|strong` url stays distinct from `{link:a} + {strong}`.
	return JSON.stringify(active.map((m) => markKey(descriptorOf(m))).sort());
}

/** The PM mark array for an active content mark set (anchors already excluded). */
function buildMarkSet(schema: Schema, active: ContentMark[]): readonly Mark[] {
	let set: readonly Mark[] = [];
	for (const m of active) {
		const pm = pmMarkFromContent(schema, m);
		if (pm) set = pm.addToSet(set);
	}
	return set;
}
