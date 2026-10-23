// The list toggle: every line of a selection numbered or bulleted as one gesture, or
// every one's marker taken off. Mod-Shift-7 and Mod-Shift-8 bind it, the Docs chords
// (`lists.ts`), and the selection toolbar offers it (`visual/FormatPopover.svelte`).
//
// A line is a textblock the selection touches; a fence is no line here, a list item
// being no place for one to land unasked. A line carries a marker where it opens its
// item. An item's later line, a continuation, goes with its item where the item's
// opening line is selected too, and otherwise carries no marker of its own. Where every
// line carries one of the kind, the toggle takes those markers off, and only those.
// Otherwise each line becomes the kind: a run of plain lines is wrapped, one item a
// line, and a run of continuation lines the same way where it stands, the first items
// of a sub-list under their item, as `- ` or `1. ` at a continuation's head opens one
// (`blocks.ts` §`openingAnItem`); the selected items of a list of the other kind split
// out of it as a list of the kind, a list being one kind (`blocks.ts` §`listAtItem`),
// its tail counting from 1 as `unlist` leaves one; a line already in the kind stays.
// What it wraps or retypes joins the lists of its kind it leaves touching
// (`touching.ts`), so the lines of one selection count as one list.
import { Fragment, NodeRange, Slice } from 'prosemirror-model';
import type { Node as PMNode, NodeType, ResolvedPos } from 'prosemirror-model';
import { wrapRangeInList } from 'prosemirror-schema-list';
import type { Command, Transaction } from 'prosemirror-state';
import { ReplaceAroundStep } from 'prosemirror-transform';
import { withinNesting } from './nesting.js';
import { joinAll } from './touching.js';

/** The textblocks `[from, to]` touches, by position, fences left out. A selection that
 *  ends at the very head of a block has selected nothing in it. */
function linesIn(doc: PMNode, from: number, to: number): number[] {
	const lines: number[] = [];
	doc.nodesBetween(from, to, (node, pos) => {
		if (!node.isTextblock) return true;
		if (!node.type.spec.code && (from === to || pos + 1 < to)) lines.push(pos);
		return false;
	});
	return lines;
}

/** A line, by where it stands: `item` the depth of the item around it, `-1` outside
 *  every item, and `opens` whether it is that item's first line, the one its marker is
 *  drawn on. */
interface Line {
	pos: number;
	$at: ResolvedPos;
	item: number;
	opens: boolean;
}

function lineAt(doc: PMNode, pos: number, itemType: NodeType): Line {
	const $at = doc.resolve(pos + 1);
	let item = -1;
	for (let depth = $at.depth - 1; depth > 0 && item < 0; depth--)
		if ($at.node(depth).type === itemType) item = depth;
	let opens = item > 0;
	for (let depth = item; opens && depth < $at.depth; depth++) opens = $at.index(depth) === 0;
	return { pos, $at, item, opens };
}

/** The selection's lines, each with whether its item's opening line is among them. */
function linesOf(doc: PMNode, from: number, to: number, itemType: NodeType) {
	const lines = linesIn(doc, from, to).map((pos) => lineAt(doc, pos, itemType));
	const opened = new Set(lines.filter((l) => l.opens).map((l) => l.$at.before(l.item)));
	return lines.map((line) => ({
		...line,
		covered: line.item > 0 && !line.opens && opened.has(line.$at.before(line.item))
	}));
}

/**
 * `prosemirror-schema-list`'s `liftOutOfList`, over a transaction, which upstream does
 * not export: the items of `range` out of their list, their blocks standing where the
 * list stood, the list closed around them. In a sub-list the blocks land in the parent
 * item, the continuation lines a marker coming off leaves (`lists.ts` §`markerOff`).
 * Returns where the list's tail stands, `null` where the items were its last, and
 * `false` where the parent cannot hold the items' blocks.
 */
function liftOut(tr: Transaction, range: NodeRange): number | null | false {
	const list = range.parent;
	for (let pos = range.end, i = range.endIndex - 1; i > range.startIndex; i--) {
		pos -= list.child(i).nodeSize;
		tr.delete(pos - 1, pos + 1);
	}
	const $start = tr.doc.resolve(range.start);
	const item = $start.nodeAfter!;
	const atStart = range.startIndex === 0;
	const atEnd = range.endIndex === list.childCount;
	const start = $start.pos;
	const end = start + item.nodeSize;
	const shell = Fragment.from(list.copy(Fragment.empty));
	const step = new ReplaceAroundStep(
		start - (atStart ? 1 : 0),
		end + (atEnd ? 1 : 0),
		start + 1,
		end - 1,
		new Slice(
			(atStart ? Fragment.empty : shell).append(atEnd ? Fragment.empty : shell),
			atStart ? 0 : 1,
			atEnd ? 0 : 1
		),
		atStart ? 0 : 1
	);
	if (tr.maybeStep(step).failed) return false;
	if (atEnd) return null;
	const $list = tr.doc.resolve(range.$from.before(range.depth));
	return $list.posAtIndex($list.index() + (atStart ? 0 : 1) + item.childCount);
}

/** Take every marker the selection's lines carry off, the shallowest list first:
 *  lifting an item brings its sub-lists up a level, where the next pass reaches them. A
 *  list's tail counts from 1 again, a number that names its position in the list it now
 *  is (`lists.ts` §`lineOut`). */
function unlist(tr: Transaction, type: NodeType, itemType: NodeType): boolean {
	for (;;) {
		const { from, to } = tr.selection;
		const marked = linesIn(tr.doc, from, to)
			.map((pos) => lineAt(tr.doc, pos, itemType))
			.filter((l) => l.opens && l.$at.node(l.item - 1).type === type);
		if (!marked.length) return true;
		const depth = Math.min(...marked.map((l) => l.item - 1));
		const listPos = marked.find((l) => l.item - 1 === depth)!.$at.before(depth);
		const indices = marked
			.filter((l) => l.item - 1 === depth && l.$at.before(depth) === listPos)
			.map((l) => l.$at.index(depth));
		const $list = tr.doc.resolve(listPos + 1);
		const range = new NodeRange(
			tr.doc.resolve($list.posAtIndex(Math.min(...indices))),
			tr.doc.resolve($list.posAtIndex(Math.max(...indices) + 1)),
			depth
		);
		const tail = liftOut(tr, range);
		if (tail === false) return false;
		const rest = tail === null ? null : tr.doc.nodeAt(tail);
		if (tail !== null && rest?.attrs.start != null && rest.attrs.start !== 1)
			tr.setNodeMarkup(tail, null, { ...rest.attrs, start: 1 });
	}
}

/** Items `first` to `last` of the list at `pos` split out as a list of their own,
 *  the tail after them counting from 1. Returns where that list stands. */
function splitOut(tr: Transaction, pos: number, first: number, last: number): number {
	const list = tr.doc.nodeAt(pos)!;
	const $inside = tr.doc.resolve(pos + 1);
	if (last + 1 < list.childCount) {
		tr.split($inside.posAtIndex(last + 1));
		const tail = tr.doc.resolve(pos + 1).posAtIndex(last + 1) + 1;
		if (list.attrs.start != null && list.attrs.start !== 1)
			tr.setNodeMarkup(tail, null, { ...list.attrs, start: 1 });
	}
	if (first === 0) return pos;
	tr.split($inside.posAtIndex(first));
	return $inside.posAtIndex(first) + 1;
}

/** Make every line the kind, and join what that leaves touching. */
function relist(
	tr: Transaction,
	lines: ReturnType<typeof linesOf>,
	type: NodeType,
	paragraph: NodeType
): boolean {
	const changed: { pos: number; step: number }[] = [];
	const runs: { from: number; to: number; depth: number }[] = [];
	const others = new Map<number, { first: number; last: number }>();
	for (const line of lines) {
		const { $at, item } = line;
		if (line.covered) continue;
		if (line.opens) {
			if ($at.node(item - 1).type === type) continue;
			const pos = $at.before(item - 1);
			const index = $at.index(item - 1);
			const span = others.get(pos);
			if (span) span.last = index;
			else others.set(pos, { first: index, last: index });
			continue;
		}
		const end = line.pos + $at.parent.nodeSize;
		const run = runs[runs.length - 1];
		if (run && run.to === line.pos && run.depth === $at.depth - 1) run.to = end;
		else runs.push({ from: line.pos, to: end, depth: $at.depth - 1 });
	}
	for (const run of runs.reverse()) {
		tr.setBlockType(run.from, run.to, paragraph);
		const range = new NodeRange(tr.doc.resolve(run.from), tr.doc.resolve(run.to), run.depth);
		if (!wrapRangeInList(tr, range, type)) return false;
		changed.push({ pos: run.from, step: tr.steps.length });
	}
	for (const [pos, span] of [...others].reverse()) {
		const at = splitOut(tr, tr.mapping.map(pos), span.first, span.last);
		tr.setNodeMarkup(at, type, type.name === 'ordered_list' ? { start: 1 } : null);
		changed.push({ pos: at, step: tr.steps.length });
	}
	const seams: number[] = [];
	for (const { pos, step } of changed) {
		const at = tr.mapping.slice(step).map(pos);
		const node = tr.doc.nodeAt(at);
		if (node) seams.push(at, at + node.nodeSize);
	}
	joinAll(tr, seams);
	return withinNesting(tr.doc);
}

/** Number (`ordered`) or bullet every line of the selection, or, where every one already
 *  carries the kind, take those markers off. Declines where the selection holds no line. */
export function toggleList(ordered: boolean): Command {
	return (state, dispatch) => {
		const { list_item: item, paragraph } = state.schema.nodes;
		const type = state.schema.nodes[ordered ? 'ordered_list' : 'bullet_list'];
		if (!item || !paragraph || !type) return false;
		const { from, to } = state.selection;
		const lines = linesOf(state.doc, from, to, item);
		if (!lines.length) return false;
		const tr = state.tr;
		const off = lines.every((l) => l.covered || (l.opens && l.$at.node(l.item - 1).type === type));
		if (!(off ? unlist(tr, type, item) : relist(tr, lines, type, paragraph))) return false;
		dispatch?.(tr.scrollIntoView());
		return true;
	};
}
