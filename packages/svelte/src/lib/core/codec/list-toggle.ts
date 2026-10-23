// The list toggle: every line of a selection numbered or bulleted as one gesture, or
// every one's marker taken off. Mod-Shift-7 and Mod-Shift-8 bind it, the Docs chords
// (`lists.ts`), and the selection toolbar offers it (`visual/FormatPopover.svelte`).
//
// A line is a textblock the selection touches; a fence is no line here, a list item
// being no place for one to land unasked. Where every line already stands in a list of
// the kind, the toggle takes them out of it. Otherwise each line becomes the kind: a
// plain run is wrapped, one item a line; a list of the other kind is retyped whole, a
// list being one kind (`blocks.ts` §`listAtItem`); a line already in the kind stays.
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

/** The list holding the nearest item around `$pos`: the list a line's marker is of. */
function listAround($pos: ResolvedPos, item: NodeType): { node: PMNode; depth: number } | null {
	for (let depth = $pos.depth; depth > 0; depth--)
		if ($pos.node(depth).type === item) return { node: $pos.node(depth - 1), depth: depth - 1 };
	return null;
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

/** Take every line's marker off, the shallowest list first: lifting an item brings its
 *  sub-lists up a level, where the next pass reaches them. A list's tail counts from 1
 *  again, a number that names its position in the list it now is (`lists.ts`
 *  §`lineOut`). */
function unlist(tr: Transaction, type: NodeType, item: NodeType): boolean {
	for (;;) {
		const { from, to } = tr.selection;
		let shallowest: { node: PMNode; depth: number; $at: ResolvedPos } | null = null;
		for (const line of linesIn(tr.doc, from, to)) {
			const $at = tr.doc.resolve(line + 1);
			const list = listAround($at, item);
			if (list?.node.type === type && (!shallowest || list.depth < shallowest.depth))
				shallowest = { ...list, $at };
		}
		if (!shallowest) return true;
		const { node: list, depth, $at } = shallowest;
		const listStart = $at.start(depth);
		let first = -1;
		let last = -1;
		list.forEach((child, offset, index) => {
			const start = listStart + offset;
			if (start + 1 <= to && start + child.nodeSize - 1 >= from) {
				if (first < 0) first = index;
				last = index;
			}
		});
		const range = new NodeRange(
			tr.doc.resolve($at.posAtIndex(first, depth)),
			tr.doc.resolve($at.posAtIndex(last + 1, depth)),
			depth
		);
		const tail = liftOut(tr, range);
		if (tail === false) return false;
		const rest = tail === null ? null : tr.doc.nodeAt(tail);
		if (tail !== null && rest?.attrs.start != null && rest.attrs.start !== 1)
			tr.setNodeMarkup(tail, null, { ...rest.attrs, start: 1 });
	}
}

/** Make every line the kind, and join what that leaves touching. */
function relist(
	tr: Transaction,
	lines: number[],
	type: NodeType,
	item: NodeType,
	paragraph: NodeType
): boolean {
	const { doc } = tr;
	const changed: { pos: number; step: number }[] = [];
	const runs: { from: number; to: number; depth: number }[] = [];
	for (const line of lines) {
		const $at = doc.resolve(line + 1);
		const list = listAround($at, item);
		if (list) {
			const pos = $at.before(list.depth);
			if (list.node.type !== type && !changed.some((c) => c.pos === pos)) {
				tr.setNodeMarkup(pos, type, type.name === 'ordered_list' ? { start: 1 } : null);
				changed.push({ pos, step: tr.steps.length });
			}
			continue;
		}
		const end = line + $at.parent.nodeSize;
		const run = runs[runs.length - 1];
		if (run && run.to === line && run.depth === $at.depth - 1) run.to = end;
		else runs.push({ from: line, to: end, depth: $at.depth - 1 });
	}
	for (const run of runs.reverse()) {
		tr.setBlockType(run.from, run.to, paragraph);
		const range = new NodeRange(tr.doc.resolve(run.from), tr.doc.resolve(run.to), run.depth);
		if (!wrapRangeInList(tr, range, type)) return false;
		changed.push({ pos: run.from, step: tr.steps.length });
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
 *  is, take each one's marker off. Declines where the selection holds no line. */
export function toggleList(ordered: boolean): Command {
	return (state, dispatch) => {
		const { list_item: item, paragraph } = state.schema.nodes;
		const type = state.schema.nodes[ordered ? 'ordered_list' : 'bullet_list'];
		if (!item || !paragraph || !type) return false;
		const { from, to } = state.selection;
		const lines = linesIn(state.doc, from, to);
		if (!lines.length) return false;
		const tr = state.tr;
		const off = lines.every(
			(line) => listAround(state.doc.resolve(line + 1), item)?.node.type === type
		);
		if (!(off ? unlist(tr, type, item) : relist(tr, lines, type, item, paragraph))) return false;
		dispatch?.(tr.scrollIntoView());
		return true;
	};
}
