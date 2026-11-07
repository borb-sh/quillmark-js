// Encode: PM → a `Change` for `apply` (INVARIANTS §Encode). Content is truth and PM its projection, so
// an edit is the change from the stored value to the projection of the doc the leaf holds:
// `pmToContent` is decode's pure inverse, and `lower` asks the store's own word-aligned `diff` for
// the change between the two. The projection carries every id the doc's nodes do and the anchors
// the leaf holds, so the change lands the projection exactly and moves nothing it does not name.
import type { Mark, Node as PMNode } from 'prosemirror-model';
import type {
	Change,
	Content,
	ContentAnchor,
	ContentBlock,
	ContentBlockKind,
	ContentContainer,
	ContentIsland,
	ContentMark,
	ContentMarkKind,
	Step
} from '@quillmark/wasm';
import { core } from '../lifecycle.js';
import { HARD_BREAK, ISLAND_SLOT, islandEntryFromNode, type IslandNodeAttrs } from './islands.js';
import { contentDescriptorFromPM, markKey } from './marks.js';

// ── Position-map runs (consumed by positions.ts) ────────────────────────────
// A run is one segment of exact PM↔content correspondence, in document order. Offsets are UTF-16
// code units, as PM's are inside a text node.
export type PosRun =
	| { kind: 'text'; pmStart: number; at: number; s: string }
	| { kind: 'nl'; pmStart: number; pmEnd: number; at: number }
	| { kind: 'atom'; pmStart: number; at: number };

export interface Scan {
	text: string;
	blocks: ContentBlock[];
	containers: ContentContainer[];
	marks: ContentMark[];
	islands: ContentIsland[];
	runs: PosRun[];
}

/** A working accumulator threaded through the walk. */
interface Acc extends Scan {
	rawMarks: ContentMark[]; // per-text-node marks, merged into `marks` at the end
	lastContentEndPm: number; // PM position after the previous block's content
	ids: Ids;
}

/**
 * The ids the projection gives its blocks and containers: a node's own where no earlier node holds
 * it, so the text a split leaves keeps its block's id and a pasted copy takes a fresh one, and else
 * `{prefix}{n}` past the highest the doc holds.
 */
interface Ids {
	blocks: Set<string>;
	containers: Set<string>;
	next: Map<string, number>;
}

function idsOf(doc: PMNode): Ids {
	const next = new Map<string, number>();
	doc.descendants((node) => {
		const id = (node.attrs.block ?? node.attrs.id) as unknown;
		if (typeof id !== 'string') return true;
		const m = /^([a-z]+)(\d+)$/.exec(id);
		if (m) next.set(m[1], Math.max(next.get(m[1]) ?? 0, Number(m[2]) + 1));
		return true;
	});
	return { blocks: new Set(), containers: new Set(), next };
}

function claim(ids: Ids, held: Set<string>, want: unknown, prefix: string): string {
	if (typeof want === 'string' && want && !held.has(want)) {
		held.add(want);
		return want;
	}
	let n = ids.next.get(prefix) ?? 0;
	let id = `${prefix}${n}`;
	while (held.has(id)) id = `${prefix}${++n}`;
	ids.next.set(prefix, n + 1);
	held.add(id);
	return id;
}

/** Append `s` to the accumulated text. */
function appendText(acc: Acc, s: string): void {
	acc.text += s;
}

/**
 * Walk a PM document once, producing the content projection and the position-map runs; sharing the
 * traversal means they cannot disagree.
 */
export function scanDoc(doc: PMNode): Scan {
	const acc: Acc = {
		text: '',
		blocks: [],
		containers: [],
		marks: [],
		islands: [],
		runs: [],
		rawMarks: [],
		lastContentEndPm: 0,
		ids: idsOf(doc)
	};
	scanBlocks(acc, doc, 0, []);
	if (!acc.blocks.length)
		acc.blocks.push({ id: claim(acc.ids, acc.ids.blocks, null, 'b'), kind: 'para' });
	acc.marks = mergeMarks(acc.rawMarks);
	return acc;
}

/**
 * The content projection a scan carries, with `anchors`, for a caller holding a `Scan` that would
 * otherwise walk again. An empty part is left out, as a read leaves it.
 */
export function scanContent(s: Scan, anchors: ContentAnchor[] = []): Content {
	const out: Content = { text: s.text, blocks: s.blocks };
	if (s.containers.length) out.containers = s.containers;
	if (s.marks.length) out.marks = s.marks;
	if (anchors.length)
		out.anchors = [...anchors].sort(
			(a, b) => a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
		);
	if (s.islands.length) out.islands = s.islands;
	return out;
}

/** `pmToContent`: the pure inverse of decode (drops the position runs). */
export function pmToContent(doc: PMNode, anchors: ContentAnchor[] = []): Content {
	return scanContent(scanDoc(doc), anchors);
}

/** Walk a block-content fragment; `contentStart` is the PM pos before its first child. */
function scanBlocks(acc: Acc, parent: PMNode, contentStart: number, path: string[]): void {
	let pm = contentStart;
	parent.forEach((child) => {
		scanBlock(acc, child, pm, path);
		pm += child.nodeSize;
	});
}

/** A container's record less its id. */
type ContainerKind = ContentContainer extends infer C
	? C extends unknown
		? Omit<C, 'id'>
		: never
	: never;

/** A container the walk opens: its record, named once, and the path under it. */
function open(
	acc: Acc,
	node: PMNode,
	path: string[],
	record: ContainerKind,
	prefix: string
): string[] {
	const id = claim(acc.ids, acc.ids.containers, node.attrs.id, prefix);
	acc.containers.push({ id, ...record } as ContentContainer);
	return [...path, id];
}

function scanBlock(acc: Acc, node: PMNode, nodePos: number, path: string[]): void {
	const name = node.type.name;
	const contentStart = nodePos + 1;
	switch (name) {
		case 'paragraph':
		case 'heading':
			beginBlock(acc, node, contentStart, path, textblockKind(node));
			scanInline(acc, node, contentStart);
			acc.lastContentEndPm = contentStart + node.content.size;
			break;
		case 'code_block': {
			const lang = node.attrs.lang as string | null;
			beginBlock(
				acc,
				node,
				contentStart,
				path,
				lang ? { kind: 'code', attrs: { lang } } : { kind: 'code' }
			);
			const codeText = node.textContent.replaceAll('\n', HARD_BREAK);
			if (codeText.length) emitText(acc, codeText, contentStart, []);
			acc.lastContentEndPm = contentStart + node.content.size;
			break;
		}
		case 'horizontal_rule':
			beginBlock(acc, node, nodePos, path, { kind: 'rule' });
			acc.lastContentEndPm = nodePos + 1;
			break;
		case 'island_block':
			beginBlock(acc, node, nodePos, path, { kind: 'para' }, node.attrs.block);
			acc.runs.push({ kind: 'atom', pmStart: nodePos, at: acc.text.length });
			appendText(acc, ISLAND_SLOT);
			acc.islands.push(islandEntryFromNode(node.attrs as IslandNodeAttrs));
			acc.lastContentEndPm = nodePos + 1;
			break;
		case 'blockquote':
			scanBlocks(acc, node, contentStart, open(acc, node, path, { kind: 'quote' }, 'q'));
			break;
		case 'bullet_list':
		case 'ordered_list': {
			const ordered = name === 'ordered_list';
			const start = ordered ? (node.attrs.start as number) : 1;
			const list = open(acc, node, path, { kind: 'list', attrs: { ordered, start } }, 'l');
			let itemPos = contentStart;
			node.forEach((item) => {
				const checked = item.attrs.checked as boolean | null;
				const record: ContainerKind =
					checked === null ? { kind: 'item' } : { kind: 'item', attrs: { checked } };
				scanBlocks(acc, item, itemPos + 1, open(acc, item, list, record, 'i'));
				itemPos += item.nodeSize;
			});
			break;
		}
		default:
			// Unknown block type: an empty paragraph (defensive).
			beginBlock(acc, node, contentStart, path, { kind: 'para' });
			acc.lastContentEndPm = contentStart;
	}
}

/** A textblock's kind: a heading's `level`, a paragraph's `x-` kind where it holds one, or `para`. */
function textblockKind(node: PMNode): ContentBlockKind {
	if (node.type.name === 'heading')
		return { kind: 'heading', attrs: { level: node.attrs.level as number } };
	const ext = node.attrs.ext as { kind: `x-${string}`; attrs: Record<string, unknown> } | null;
	if (ext)
		return Object.keys(ext.attrs).length
			? { kind: ext.kind, attrs: ext.attrs }
			: { kind: ext.kind };
	return { kind: 'para' };
}

/** Open a new block: emit the boundary `\n` (except before the first) and its record. */
function beginBlock(
	acc: Acc,
	node: PMNode,
	thisContentStart: number,
	path: string[],
	kind: ContentBlockKind,
	want: unknown = node.attrs.id
): void {
	if (acc.blocks.length > 0) {
		acc.runs.push({
			kind: 'nl',
			pmStart: acc.lastContentEndPm,
			pmEnd: thisContentStart,
			at: acc.text.length
		});
		appendText(acc, '\n');
	}
	const id = claim(acc.ids, acc.ids.blocks, want, 'b');
	acc.blocks.push({ id, ...(path.length ? { path } : {}), ...kind } as ContentBlock);
}

/** Walk a textblock's inline content; emit text/atom/hard-break runs + marks. */
function scanInline(acc: Acc, block: PMNode, contentStart: number): void {
	let pm = contentStart;
	block.forEach((child) => {
		if (child.isText) {
			// A `\n` in a textblock that is not `whitespace: 'pre'` is the break a hard break is:
			// `joinTextblocksAround` (a bare `replaceStep`) leaves one.
			emitText(acc, (child.text ?? '').replaceAll('\n', HARD_BREAK), pm, child.marks);
		} else if (child.type.name === 'hard_break') {
			acc.runs.push({ kind: 'nl', pmStart: pm, pmEnd: pm + 1, at: acc.text.length });
			appendText(acc, HARD_BREAK);
		} else if (child.type.name === 'island_inline') {
			acc.runs.push({ kind: 'atom', pmStart: pm, at: acc.text.length });
			appendText(acc, ISLAND_SLOT);
			acc.islands.push(islandEntryFromNode(child.attrs as IslandNodeAttrs));
		}
		pm += child.nodeSize;
	});
}

/** Append a text node's chars: one position run + a content mark per formatting mark. */
function emitText(acc: Acc, s: string, pmStart: number, marks: readonly Mark[]): void {
	if (!s.length) return;
	const at = acc.text.length;
	acc.runs.push({ kind: 'text', pmStart, at, s });
	appendText(acc, s);
	for (const mark of marks)
		acc.rawMarks.push({ start: at, end: acc.text.length, ...contentDescriptorFromPM(mark) });
}

/** Merge adjacent/overlapping same-descriptor marks into maximal ranges. */
function mergeMarks(raw: ContentMark[]): ContentMark[] {
	const groups = new Map<
		string,
		{ descriptor: ContentMarkKind; intervals: { start: number; end: number }[] }
	>();
	for (const m of raw) {
		const { start, end, ...descriptor } = m;
		const key = markKey(descriptor as ContentMarkKind);
		let g = groups.get(key);
		if (!g) groups.set(key, (g = { descriptor: descriptor as ContentMarkKind, intervals: [] }));
		g.intervals.push({ start, end });
	}
	const out: ContentMark[] = [];
	for (const g of groups.values()) {
		const sorted = [...g.intervals].sort((a, b) => a.start - b.start);
		let cur: { start: number; end: number } | null = null;
		for (const iv of sorted) {
			if (cur && iv.start <= cur.end) cur.end = Math.max(cur.end, iv.end);
			else {
				if (cur) out.push({ ...cur, ...g.descriptor } as ContentMark);
				cur = { ...iv };
			}
		}
		if (cur) out.push({ ...cur, ...g.descriptor } as ContentMark);
	}
	return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

// ── Lowering ────────────────────────────────────────────────────────────────

/**
 * The change taking `oldRt` to `newRt`, or `null` where the two are one value: the store's own
 * `diff`, so what lands is the projection, ids and anchors and all.
 */
export function lower(oldRt: Content, newRt: Content): Change | null {
	const change = core().diff(oldRt, newRt);
	return change.steps.length ? change : null;
}
