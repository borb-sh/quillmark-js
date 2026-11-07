// Decode: content → PM, a pure function (INVARIANTS §Decode). Each `\n`-separated segment is one
// block, its record's `kind` selecting the node; blocks nest by the containers their paths name,
// a run of blocks sharing a container id being that container; a `U+2028` is a break inside a
// block; marks apply over their `[start,end)` ranges; island slots lower to leaf nodes. Anchors are
// decorations (field.ts). Offsets are UTF-16 code units, JavaScript string indices, so a PM text
// run and its content span advance together.
import { DOMSerializer, type Mark, type Node as PMNode, type Schema } from 'prosemirror-model';
import type { Content, ContentBlock, ContentContainer, ContentMark } from '@quillmark/wasm';
import {
	HARD_BREAK,
	ISLAND_SLOT,
	isBlockIsland,
	isEditedIsland,
	type IslandNodeAttrs
} from './islands.js';
import { descriptorOf, markKey, pmMarkFromContent } from './marks.js';
import { core } from '../lifecycle.js';
import { hasMarks, isBlockSchema, isInlineSchema, takesLineBreak } from './schema.js';

/** USV length of `s` (code points, not UTF-16 units): what a character cap counts. */
export function usvLength(s: string): number {
	let n = 0;
	for (const _ of s) n++;
	return n;
}

/** One block's text and where it starts in the field's text. */
interface Segment {
	block: ContentBlock;
	text: string;
	start: number;
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

/** Each block of `rt` with its text and start. */
function segmentsOf(rt: Content): Segment[] {
	const texts = rt.text.split('\n');
	const out: Segment[] = [];
	let at = 0;
	texts.forEach((text, i) => {
		out.push({ block: rt.blocks[i] ?? { id: '', kind: 'para' }, text, start: at });
		at += text.length + 1;
	});
	return out;
}

/** Decode a `Content` to a PM document under `schema`. */
export function decode(rt: Content, schema: Schema): PMNode {
	const segments = segmentsOf(rt);
	// A mark-free schema has nothing to apply marks with, and a `text` field that acquired one
	// anyway (a hand-written document) must open and heal on the next commit, not throw.
	const marks = hasMarks(schema) ? (rt.marks ?? []) : [];
	const cursor: IslandCursor = { i: 0, rt };

	if (isInlineSchema(schema)) return decodeInline(schema, segments, marks, cursor);
	if (!isBlockSchema(schema)) return decodePlain(schema, segments, marks, cursor);

	const containers = new Map((rt.containers ?? []).map((c) => [c.id, c]));
	const blocks = groupBlocks(schema, segments, 0, containers, marks, cursor);
	return schema.nodes.doc.create(null, blocks.length ? blocks : schema.nodes.paragraph.create());
}

/**
 * Whether `rt` decodes under an inline schema with nothing but whitespace dropped: upstream's
 * one-line rule, or one plain line and the break a trailing `\n` spells (the one a YAML `|`
 * scalar keeps in a `text` value), or the empty line a trailing blank line opens. Marks are the
 * schema's business.
 */
export function fitsInline(rt: Content): boolean {
	if (core().isInline(rt)) return true;
	const plain = (b: ContentBlock): boolean => b.kind === 'para' && !b.path?.length;
	if (rt.islands?.length || !rt.blocks.every(plain)) return false;
	const breaks = rt.text.split(HARD_BREAK).length - 1;
	if (rt.blocks.length === 1) return breaks === 1 && rt.text.endsWith(HARD_BREAK);
	return rt.blocks.length === 2 && rt.text.endsWith('\n') && breaks === 0;
}

/**
 * Whether `rt` decodes under `plainSchema` losing nothing but its marks, which the next commit
 * heals (INVARIANTS §"Inline mode"): upstream's `isPlain` with marks set aside.
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
	const islands = rt.islands ?? [];
	if (!leaf.islands && islands.length) return false;
	return islands.every((isl) => isEditedIsland(isl.type));
}

/** Inline decode: one paragraph, containers and islands stripped. */
function decodeInline(
	schema: Schema,
	segments: Segment[],
	marks: ContentMark[],
	cursor: IslandCursor
): PMNode {
	// An inline field is single-line: stray blocks and breaks join with a space. The break a
	// trailing `\n` spells, and the empty block a trailing blank line opens, are dropped, so a first
	// edit stores no space nobody typed. Islands are not representable inline: the slot char is
	// dropped and its entry skipped.
	const inline: PMNode[] = [];
	const last = segments.length - 1;
	segments.forEach((at, i) => {
		const seg =
			i === last && at.text.endsWith(HARD_BREAK) ? { ...at, text: at.text.slice(0, -1) } : at;
		if (i > 0 && i === last && seg.text === '') return;
		if (i > 0) inline.push(schema.text(' '));
		inline.push(...buildInline(schema, seg, marks, cursor, 'inline'));
	});
	const para = schema.nodes.paragraph.create(null, inline);
	return schema.nodes.doc.create(null, para);
}

/**
 * Plain decode: every block a paragraph, a break a `hard_break` in it. Block kinds, containers and
 * islands are dropped, so content {@link fitsPlain} refuses opens flattened.
 */
function decodePlain(
	schema: Schema,
	segments: Segment[],
	marks: ContentMark[],
	cursor: IslandCursor
): PMNode {
	const blocks = segments.map((seg) =>
		schema.nodes.paragraph.create(null, buildInline(schema, seg, marks, cursor, 'plain'))
	);
	return schema.nodes.doc.create(null, blocks.length ? blocks : schema.nodes.paragraph.create());
}

/** Nest the blocks whose paths agree to `depth` into nodes, one per child of that prefix. */
function groupBlocks(
	schema: Schema,
	segments: Segment[],
	depth: number,
	containers: Map<string, ContentContainer>,
	marks: ContentMark[],
	cursor: IslandCursor
): PMNode[] {
	const out: PMNode[] = [];
	let i = 0;
	while (i < segments.length) {
		const path = segments[i].block.path ?? [];
		if (path.length <= depth) {
			out.push(makeLeaf(schema, segments[i], marks, cursor));
			i++;
			continue;
		}
		const id = path[depth];
		let j = i + 1;
		while (j < segments.length && segments[j].block.path?.[depth] === id) j++;
		const run = segments.slice(i, j);
		const container = containers.get(id);
		const inner = (d: number) => groupBlocks(schema, run, d, containers, marks, cursor);
		switch (container?.kind) {
			case 'list': {
				const items = groupItems(schema, run, depth + 1, containers, marks, cursor);
				out.push(
					container.attrs.ordered
						? schema.nodes.ordered_list.create({ id, start: container.attrs.start }, items)
						: schema.nodes.bullet_list.create({ id }, items)
				);
				break;
			}
			case 'quote':
				out.push(schema.nodes.blockquote.create({ id }, inner(depth + 1)));
				break;
			default:
				// An item outside a list or a container no record names: a value nothing renders, so its
				// blocks decode in place and the projection settles it.
				out.push(...inner(depth + 1));
		}
		i = j;
	}
	return out;
}

/** The items of one list: a `list_item` per run of blocks sharing the item id at `depth`. */
function groupItems(
	schema: Schema,
	run: Segment[],
	depth: number,
	containers: Map<string, ContentContainer>,
	marks: ContentMark[],
	cursor: IslandCursor
): PMNode[] {
	const items: PMNode[] = [];
	let i = 0;
	while (i < run.length) {
		const id = run[i].block.path?.[depth];
		let j = i + 1;
		while (j < run.length && run[j].block.path?.[depth] === id) j++;
		const item = id === undefined ? undefined : containers.get(id);
		const checked = item?.kind === 'item' ? (item.attrs?.checked ?? null) : null;
		const body = groupBlocks(schema, run.slice(i, j), depth + 1, containers, marks, cursor);
		items.push(schema.nodes.list_item.create({ id: id ?? null, checked }, body));
		i = j;
	}
	return items;
}

/**
 * A single leaf block node from its record, exhaustive over the closed block vocabulary so a kind
 * added upstream is a compile error. A kind spelled `x-` reads as a paragraph that holds its kind.
 */
function makeLeaf(
	schema: Schema,
	seg: Segment,
	marks: ContentMark[],
	cursor: IslandCursor
): PMNode {
	const block = seg.block;
	const id = block.id || null;
	switch (block.kind) {
		case 'rule':
			return schema.nodes.horizontal_rule.create({ id });
		case 'code': {
			const text = seg.text.replaceAll(HARD_BREAK, '\n');
			const content = text.length ? [schema.text(text)] : [];
			return schema.nodes.code_block.create({ id, lang: block.attrs?.lang ?? null }, content);
		}
		case 'heading':
			return schema.nodes.heading.create(
				{ id, level: block.attrs.level },
				buildInline(schema, seg, marks, cursor, 'heading')
			);
		case 'para': {
			if (blockIslandSegment(seg, cursor))
				return schema.nodes.island_block.create({ ...islandAttrs(cursor)!, block: id });
			return schema.nodes.paragraph.create(
				{ id },
				buildInline(schema, seg, marks, cursor, 'paragraph')
			);
		}
		default: {
			const ext = { kind: block.kind, attrs: block.attrs ?? {} };
			return schema.nodes.paragraph.create(
				{ id, ext },
				buildInline(schema, seg, marks, cursor, 'paragraph')
			);
		}
	}
}

/**
 * Whether a `para` block is one block island: its slot alone, backed by an island whose markup is a
 * block.
 */
function blockIslandSegment(seg: Segment, cursor: IslandCursor): boolean {
	if (seg.text !== ISLAND_SLOT) return false;
	const isl = cursor.rt.islands?.[cursor.i];
	return isl != null && isBlockIsland(isl.type);
}

/**
 * Consume the next island entry as PM node attrs (text-order matched to slots): the whole entry,
 * which an island edit writes back (`islands.ts`). `null` where a slot has no entry (malformed
 * content): the slot draws nothing, keeping the decode total.
 */
function islandAttrs(cursor: IslandCursor): IslandNodeAttrs | null {
	const isl = cursor.rt.islands?.[cursor.i++];
	return isl
		? { id: isl.id, islandType: isl.type, props: isl.props, slots: isl.slots ?? null }
		: null;
}

/** Where a segment's inline nodes go, which decides what a break and a slot become. */
type InlineHost = 'paragraph' | 'heading' | 'inline' | 'plain';

/**
 * Inline nodes for one segment: split text into maximal runs of a constant mark set, lower each
 * `U+FFFC` to an inline island node and each `U+2028` to a `hard_break`, or to a space in a host
 * that takes none (`schema.ts` §`takesLineBreak`). An inline host drops slots, keeping the island
 * cursor in step.
 */
function buildInline(
	schema: Schema,
	seg: Segment,
	marks: ContentMark[],
	cursor: IslandCursor,
	host: InlineHost
): PMNode[] {
	const out: PMNode[] = [];
	const breaks =
		host !== 'inline' &&
		takesLineBreak(host === 'heading' ? schema.nodes.heading : schema.nodes.paragraph);
	let runText = '';
	let runKey = '';
	let runMarks: readonly Mark[] = [];
	const flush = () => {
		if (runText.length) out.push(schema.text(runText, runMarks));
		runText = '';
	};
	// A mark set changes only where a mark starts or ends; `marks` is the whole list, so resolving
	// per character would cost the text against every mark.
	const segStart = seg.start;
	const segEnd = segStart + seg.text.length;
	const spanning = marks.filter((m) => m.start < segEnd && m.end > segStart);
	const edges = new Set<number>();
	for (const m of spanning) {
		if (m.start > segStart) edges.add(m.start);
		if (m.end < segEnd) edges.add(m.end);
	}
	let active: ContentMark[] = [];
	let key = '';
	let unresolved = true;
	for (let k = 0; k < seg.text.length; k++) {
		const ch = seg.text[k];
		const pos = segStart + k;
		if (ch === ISLAND_SLOT) {
			flush();
			const attrs = islandAttrs(cursor);
			if (attrs && host !== 'inline' && host !== 'plain' && schema.nodes.island_inline)
				out.push(schema.nodes.island_inline.create(attrs));
			runKey = '\0slot';
			unresolved = true;
			continue;
		}
		if (ch === HARD_BREAK && breaks) {
			flush();
			out.push(schema.nodes.hard_break.create());
			runKey = '\0break';
			unresolved = true;
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
		runText += ch === HARD_BREAK ? ' ' : ch;
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

/** The PM mark array for an active content mark set. */
function buildMarkSet(schema: Schema, active: ContentMark[]): readonly Mark[] {
	let set: readonly Mark[] = [];
	for (const m of active) {
		const pm = pmMarkFromContent(schema, m);
		if (pm) set = pm.addToSet(set);
	}
	return set;
}
