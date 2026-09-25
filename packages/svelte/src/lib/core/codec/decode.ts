// Decode: content → PM, a pure function (CODEC §Decode). Fold the flat lines into
// the tree: group a `continues` run into one block (para hard breaks → `hard_break`
// nodes; a code fence's lines → one `code_block`), nest by shared `containers`
// prefix (`list_item`/`quote` → lists/blockquote), select the block node by
// `kind`, apply marks over their `[start,end)` USV ranges (PM splits inline nodes
// at mark boundaries), and lower island slots to leaf nodes (block where a block
// island's slot stands alone on its line, inline otherwise). Anchors are not
// applied here; they are decorations (field.ts). Positions throughout are USV; `Array.from` iterates by
// code point so an astral char is one unit, never a surrogate half.
import { DOMSerializer, type Mark, type Node as PMNode, type Schema } from 'prosemirror-model';
import type { Content, ContentContainer, ContentLine, ContentMark } from '@quillmark/wasm';
import { ISLAND_SLOT, isBlockIsland, type IslandNodeAttrs } from './islands.js';
import { descriptorOf, markKey, pmMarkFromContent } from './marks.js';
import { hasMarks, isInlineSchema, takesLineBreak } from './schema.js';

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
 * A `Content` as read-only DOM: decode under `schema`, then the nodes' own `toDOM`.
 * The rendering half of the codec's job with no editing attached (no PM view, no
 * plugins, no `contenteditable`) for chrome that must show content in the same
 * mark vocabulary a leaf edits it in (the tips card). A second renderer over the
 * same content would drift from `decode`; this cannot.
 *
 * `DOMSerializer.fromSchema` memoizes on the schema, so repeat calls build no
 * serializer.
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
	// A mark-free schema (`plaintextSchema`) has nothing to apply them with, and a
	// plaintext field that acquired one anyway — an older build's popover, a hand-
	// written document — is exactly the content that must open and then heal on the
	// next commit, not throw here.
	const marks = hasMarks(schema) ? rt.marks.filter((m) => m.type !== 'anchor') : [];
	const cursor: IslandCursor = { i: 0, rt };

	if (isInlineSchema(schema)) {
		return decodeInline(rt, schema, lineTexts, starts, marks, cursor);
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

/** Whether `rt` decodes under an inline schema with nothing dropped: upstream's
 *  `Content::is_inline`, one plain paragraph line with no container and no island.
 *  A trailing newline is a second line, since `plaintext` is verbatim. Marks are the
 *  schema's own business (`plaintextSchema` declares none). */
export function fitsInline(rt: Content): boolean {
	if (rt.islands.length > 0 || rt.lines.length > 1) return false;
	const line = rt.lines[0];
	return !line || (line.kind === 'para' && line.containers.length === 0);
}

/** Inline / plaintext decode: one paragraph, containers and islands stripped. */
function decodeInline(
	rt: Content,
	schema: Schema,
	lineTexts: string[],
	starts: number[],
	marks: ContentMark[],
	cursor: IslandCursor
): PMNode {
	// An inline field is single-line; join any stray lines with a space (no
	// hard_break node exists in this schema). Islands are not representable inline:
	// the slot char is dropped and its entry skipped.
	const inline: PMNode[] = [];
	for (let i = 0; i < lineTexts.length; i++) {
		if (i > 0) inline.push(schema.text(' '));
		inline.push(...buildInline(schema, lineTexts[i], starts[i], marks, cursor, true));
	}
	const para = schema.nodes.paragraph.create(null, inline);
	return schema.nodes.doc.create(null, para);
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
						null,
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
		// The quote, and the whole of what is left: `satisfies` is the exhaustiveness
		// check, so a container added upstream is a compile error here rather than a
		// blockquote it is not. A wrapper over the run of leaves carrying the identical
		// container here, identity by `containerKey`.
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

/** The `ordinal` of a leaf's `list_item` at `depth`: only called inside a run the
 * discriminant has already established, so a miss is unreachable. */
function ordinalAt(leaf: Leaf, depth: number): number {
	const c = atDepth(leaf, depth);
	return c?.container === 'list_item' ? c.attrs.ordinal : -1;
}

/** A container's `instance`, absent meaning the zero a canonical read omits. It is what
 * tells one container from an adjacent sibling of identical shape, which contiguity
 * alone reads as one, so absent and `0` have to answer alike. */
function instanceOf(c: ContentContainer): number {
	return c.instance ?? 0;
}

/** Identity of a container for run gathering: its name and its `instance`, NUL-joined
 * as `markKey` joins a mark's. `list_item` carries its own run rule, so the quote is
 * what keys here. */
function containerKey(c: ContentContainer): string {
	return `${c.container}\u0000${instanceOf(c)}`;
}

/** A single leaf block node from its segments. Exhaustive over the closed line
 *  vocabulary, so a kind added upstream is a compile error rather than a silent
 *  flattening to `para` that the next commit would store. */
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
			if (line.kind === 'para' && blockIslandLine(leaf, cursor))
				return schema.nodes.island_block.create(islandAttrs(cursor)!);
			// Inline content, the segment boundary a `hard_break` in a paragraph and a space
			// in a heading, which takes none (`schema.ts` §`takesLineBreak`). A stored heading
			// carries no continuation — the store clears one after a block of a single line —
			// so the space is what keeps a hand-built content decodable.
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

/** Whether a `para` leaf is one block island: a single line holding its slot alone,
 *  backed by an island whose markup is a block. The island is the one fact; the line
 *  carries no kind of its own for it. */
function blockIslandLine(leaf: Leaf, cursor: IslandCursor): boolean {
	if (leaf.segments.length !== 1 || leaf.segments[0].text !== ISLAND_SLOT) return false;
	const isl = cursor.rt.islands[cursor.i];
	return isl != null && isBlockIsland(isl.type);
}

/** Consume the next island entry as PM node attrs (text-order matched to slots): the
 *  whole entry, which an island edit has to write back (`islands.ts`). `null` where a
 *  slot has no entry behind it, which is a malformed content: the slot draws nothing
 *  and its line an empty paragraph, so the decode stays total without minting a node
 *  whose `type` the vocabulary would refuse on the way back. */
function islandAttrs(cursor: IslandCursor): IslandNodeAttrs | null {
	const isl = cursor.rt.islands[cursor.i++];
	return isl ? { id: isl.id, islandType: isl.type, props: isl.props } : null;
}

/**
 * Inline nodes for one segment: split text into maximal runs of a constant mark
 * set, lower each `U+FFFC` to an inline island node. `stripIslands` drops slots
 * (inline-field mode). Offsets are USV; `pos = segStartUSV + k` indexes into the
 * global mark ranges.
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
	// A mark set changes only where a mark starts or ends. `marks` is the field's whole
	// list, so resolving one per code point costs the text against every mark in the
	// document.
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
	// Per-mark keys via the shared descriptor + NUL-delimited `markKey`: the same
	// pair the mark diff groups families by, so a run boundary and a mark family are
	// one rule. The set is JSON-joined so no url/attrs content collides with a
	// delimiter: a `link:a|strong` url stays distinct from `{link:a} + {strong}`.
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
