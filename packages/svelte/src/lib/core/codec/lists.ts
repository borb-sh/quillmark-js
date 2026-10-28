// List editing: the body leaf's structural commands over `prosemirror-schema-list`: Tab
// indent/outdent and the structural keys Enter, Backspace and Delete.
//
// An item's number is its position: no edit writes `start`, which is what a writer typed (`N. `,
// `blocks.ts`) or what arrived with a whole list. Taking a marker off keeps the text where it
// stands as a continuation of the item above, so the items below close up by position. The one
// split is Backspace at the head of a top-level continuation line, which takes the line out to full
// width; the tail counts from 1.
//
// Cleanup is command-local, never a global pass: a command joins the boundary it opens, and two
// lists of a kind a command leaves touching join (`touching.ts`). A whole-doc normalizer would fuse
// every adjacent same-type pair, but that boundary is load-bearing: `Container.instance` is how
// `Content` marks one (`tests/codec/list-shapes.test.ts`), and fusing renumbers an imported `1, 2,
// 1` in a region no edit touched.
import { NodeRange } from 'prosemirror-model';
import type { Node as PMNode, NodeType, ResolvedPos, Schema } from 'prosemirror-model';
import { liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { EditorState, Selection, TextSelection } from 'prosemirror-state';
import type { Command, Transaction } from 'prosemirror-state';
import { canJoin, findWrapping, liftTarget } from 'prosemirror-transform';
import { chainCommands, joinTextblockBackward, joinTextblockForward } from 'prosemirror-commands';
import { withinNesting } from './nesting.js';
import { toggleList } from './list-toggle.js';
import { splitTaskItem, toggleTask } from './tasks.js';
import { joinAll, joinLists, touching } from './touching.js';

/**
 * The caret's enclosing `list_item` when it sits at the very start of that item's first block,
 * where both structural keys branch; `null` otherwise.
 */
function atItemStart(
	state: Parameters<Command>[0],
	itemType: NodeType
): { itemIndex: number; nested: boolean; listPos: number } | null {
	const { $from, empty } = state.selection;
	if (!empty || $from.parentOffset !== 0) return null;
	if ($from.depth < 3) return null; // doc > list > item > block is the shallowest
	if ($from.node(-1).type !== itemType) return null;
	if ($from.index(-1) !== 0) return null; // a later block of the item
	return {
		itemIndex: $from.index(-2),
		nested: $from.node(-3).type === itemType,
		listPos: $from.before(-2)
	};
}

/**
 * The textblock at the end of `node`: itself, else its last descendant that is one. `null` on an
 * atom, which holds no line to join onto.
 */
function lastBlockIn(node: PMNode | null | undefined): PMNode | null {
	let last = node ?? null;
	while (last && !last.isTextblock && !last.isAtom) last = last.lastChild;
	return last?.isTextblock ? last : null;
}

/**
 * Enter at the head of an unnumbered line that holds text → an empty unnumbered line above it, the
 * caret staying with the text. `splitListItem` would instead turn the text into the next item.
 */
function lineAbove(itemType: NodeType, paragraph: NodeType): Command {
	return (state, dispatch) => {
		const { $from, empty } = state.selection;
		if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false;
		if ($from.depth < 2 || $from.parent.content.size === 0) return false;
		const index = $from.index(-1);
		if ($from.node(-1).type !== itemType || index === 0) return false;
		if (!$from.node(-1).canReplaceWith(index, index, paragraph)) return false;
		dispatch?.(state.tr.insert($from.before(), paragraph.create()).scrollIntoView());
		return true;
	};
}

/** Whether `item` holds nothing but one empty textblock. */
function emptyItem(item: PMNode): boolean {
	return (
		item.childCount === 1 && !!item.firstChild?.isTextblock && item.firstChild.content.size === 0
	);
}

/**
 * Take the marker off the item whose first block holds the caret's head, the text staying where it
 * stands: a later item's blocks become continuation blocks of the item above, a nested first item's
 * become the parent item's. Nothing splits, so the items below close up by position. A top-level
 * first item lifts out over the list instead.
 *
 * An empty item is spent rather than kept as an empty continuation line, the caret going to the end
 * of what stood above it. `keepEmpty` is Enter's reading, where the empty line is the one about to
 * be typed in.
 *
 * Declines where the item is the first block of one with nothing above it in an item
 * (`list_item(ordered_list(…))`, a pasted shape).
 */
function markerOff(itemType: NodeType, keepEmpty = false): Command {
	return (state, dispatch) => {
		const at = atItemStart(state, itemType);
		if (!at) return false;
		const { $from } = state.selection;
		if (at.itemIndex === 0 && !at.nested) return liftListItem(itemType)(state, dispatch);
		const item = $from.node(-1);
		const list = $from.node(-2);
		const itemStart = $from.before(-1);
		const itemEnd = itemStart + item.nodeSize;
		const spend = !keepEmpty && emptyItem(item);
		const tr = state.tr;
		let into: number;
		if (at.itemIndex > 0) {
			into = itemStart - 1;
			tr.delete(itemStart, itemEnd);
		} else {
			if ($from.index(-3) === 0) return false;
			into = at.listPos;
			if (list.childCount === 1) tr.delete(at.listPos, at.listPos + list.nodeSize);
			else tr.delete(itemStart, itemEnd);
		}
		if (spend) {
			tr.setSelection(Selection.near(tr.doc.resolve(into), -1));
		} else {
			tr.insert(into, item.content);
			const seam = into + item.content.size;
			const after = tr.doc.resolve(seam).nodeAfter;
			if (after && after.type === item.content.lastChild?.type && canJoin(tr.doc, seam))
				tr.join(seam);
			tr.setSelection(TextSelection.create(tr.doc, into + 1));
		}
		dispatch?.(tr.scrollIntoView());
		return true;
	};
}

/**
 * Backspace at the head of a continuation line in a top-level item → the line out of the list to
 * full width, the item's blocks after it: the second rung of the marker coming off. The list splits
 * there and the tail counts from 1. The press after is the ordinary join onto the list's last line
 * ({@link joinOntoList}).
 *
 * Declines where a sub-list stands below the line in its item, and in a nested item, whose
 * continuation lines keep the ordinary join.
 */
function lineOut(itemType: NodeType): Command {
	return (state, dispatch) => {
		const { $from, empty } = state.selection;
		if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false;
		if ($from.depth < 3) return false;
		const item = $from.node(-1);
		if (item.type !== itemType || $from.index(-1) === 0) return false;
		if ($from.node(-3).type === itemType) return false;
		for (let i = $from.index(-1) + 1; i < item.childCount; i++)
			if (item.child(i).firstChild?.type === itemType) return false;
		const range = new NodeRange(
			$from.doc.resolve($from.before()),
			$from.doc.resolve($from.end(-1)),
			$from.depth - 1
		);
		const target = liftTarget(range);
		if (target == null) return false;
		if (!dispatch) return true;
		const tr = state.tr.lift(range, target);
		const $at = tr.doc.resolve(tr.mapping.map($from.before()));
		const tail = $at.parent.maybeChild($at.index() + item.childCount - $from.index(-1));
		if (tail?.firstChild?.type === itemType && tail.attrs.start != null && tail.attrs.start !== 1)
			tr.setNodeMarkup($at.posAtIndex($at.index() + item.childCount - $from.index(-1)), null, {
				...tail.attrs,
				start: 1
			});
		dispatch(tr.scrollIntoView());
		return true;
	};
}

/**
 * Shift-Tab → `liftListItem` in a nested list. A top-level item has no level above it inside the
 * list: the key is claimed and does nothing, so a press too many while backing out of a sub-list
 * renumbers nothing. Leaving the list is Backspace's. Outside every item the key declines.
 */
function outdent(itemType: NodeType): Command {
	const lift = liftListItem(itemType);
	return (state, dispatch) => {
		const { $from, $to } = state.selection;
		const range = $from.blockRange(
			$to,
			(node) => node.childCount > 0 && node.firstChild!.type === itemType
		);
		if (!range) return false;
		if (range.$from.node(range.depth - 1).type === itemType) return lift(state, dispatch);
		return true;
	};
}

/**
 * Enter on an empty item that has items after it → the marker off, the empty line kept as a
 * continuation of the item above. An empty last item still leaves the list (`liftListItem`), and a
 * first item has no item above to continue.
 */
function continueAbove(itemType: NodeType): Command {
	const off = markerOff(itemType, true);
	return (state, dispatch) => {
		const at = atItemStart(state, itemType);
		const { $from } = state.selection;
		if (!at || at.itemIndex === 0 || !emptyItem($from.node(-1))) return false;
		if (at.itemIndex === $from.node(-2).childCount - 1) return false;
		return off(state, dispatch);
	};
}

/**
 * Enter on an empty continuation line, the last block of an item past its first → the marker back
 * on: the line becomes an item after the one it continued. In the last item of a list it leaves the
 * list instead. Never `liftListItem`, which would lift the whole item and take its marker.
 */
function markerOn(itemType: NodeType): Command {
	return (state, dispatch) => {
		const { $from, empty } = state.selection;
		if (!empty || $from.depth < 3 || $from.parent.content.size !== 0) return false;
		const item = $from.node(-1);
		if (item.type !== itemType || $from.index(-1) === 0) return false;
		if ($from.index(-1) !== item.childCount - 1) return false;
		const list = $from.node(-2);
		const block = $from.parent;
		const tr = state.tr.delete($from.before(), $from.after());
		let at: number;
		if ($from.index(-2) === list.childCount - 1) {
			at = tr.mapping.map($from.after(-2));
			tr.insert(at, block);
		} else {
			at = tr.mapping.map($from.after(-1));
			tr.insert(at, itemType.create(null, block));
			at += 1;
		}
		dispatch?.(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
		return true;
	};
}

/**
 * Backspace at the head of a block right after a list → join its text into the list's last line.
 * The base keymap would wrap the block into a fresh item, undoing the lift ({@link
 * liftAtItemStart}) and leaving the key toggling.
 *
 * Between a fence and prose the text does not join (`code.ts` refuses the same join between
 * siblings): the block moves into the list's last item whole instead.
 *
 * Either way two lists of a kind it leaves touching join (`touching.ts`).
 */
function joinOntoList(itemType: NodeType): Command {
	return (state, dispatch, view) => {
		const { $from, empty } = state.selection;
		if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false;
		const before = state.doc.resolve($from.before()).nodeBefore;
		if (before?.firstChild?.type !== itemType) return false;
		const into = lastBlockIn(before);
		if (!into) return false;
		const listPos = $from.before() - before.nodeSize;
		const joinBelow = (tr: Transaction): Transaction => {
			joinLists(tr, listPos + tr.doc.nodeAt(listPos)!.nodeSize);
			return tr;
		};
		if (!!into.type.spec.code === !!$from.parent.type.spec.code)
			return joinTextblockBackward(state, dispatch && ((tr) => dispatch(joinBelow(tr))), view);
		if (dispatch) {
			const at = $from.before() - 2;
			const tr = state.tr.delete($from.before(), $from.after()).insert(at, $from.parent);
			tr.setSelection(TextSelection.create(tr.doc, at + 1));
			dispatch(joinBelow(tr).scrollIntoView());
		}
		return true;
	};
}

/**
 * Backspace or Delete over a selection that spans blocks → the base keymap's delete, and the two
 * lists of a kind it leaves touching joined. A seam that touched before the delete is one no edit
 * opened, and stays. Declines wherever the delete opens no seam.
 */
const deleteAcross: Command = (state, dispatch) => {
	const { $from, $to, empty } = state.selection;
	if (empty || $from.sameParent($to)) return false;
	const tr = state.tr.deleteSelection();
	const kept = new Set<number>();
	for (const $end of [$from, $to])
		for (const seam of seamsAround($end))
			if (touching(state.doc, seam)) kept.add(tr.mapping.map(seam));
	const opened = seamsAround(tr.doc.resolve(tr.mapping.map($from.pos))).filter(
		(seam) => !kept.has(seam) && touching(tr.doc, seam)
	);
	if (!opened.length) return false;
	joinAll(tr, opened);
	dispatch?.(tr.scrollIntoView());
	return true;
};

/** The boundaries of every node around `$pos`, and `$pos` itself. */
function seamsAround($pos: ResolvedPos): number[] {
	const seams = [$pos.pos];
	for (let depth = $pos.depth; depth > 0; depth--)
		seams.push($pos.before(depth), $pos.after(depth));
	return seams;
}

/** Whether the caret sits inside a `list_item` at any depth. */
function inItem($pos: ResolvedPos, itemType: NodeType): boolean {
	for (let depth = $pos.depth; depth > 0; depth--) {
		if ($pos.node(depth).type === itemType) return true;
	}
	return false;
}

/**
 * Delete at the very end of a block inside an item → the item below's marker off and its first line
 * joined onto the caret's. The marker comes off by the Backspace chain's own link (`markerOff`), so
 * the item's other blocks stay under the joined line; the join is `joinTextblockForward`'s.
 * Backspace at the same seam stops at the marker: Backspace edits the block it is pressed in,
 * Delete the line after the caret. The caret stays where the key was pressed.
 *
 * An empty item below is spent, nothing after it joining. An empty item at the caret is the other
 * way round: the item below moves up into it. A fence takes no prose line (`joinOntoList`): across
 * one only the marker comes off.
 *
 * A line above a list is the same seam from outside: the first item's marker comes off and its line
 * joins the caret's. Declining wherever the Backspace chain does keeps this to the list's own
 * seams.
 */
function deleteBelow(itemType: NodeType, press: Command): Command {
	const off = markerOff(itemType);
	return (state, dispatch) => {
		const { $from, empty } = state.selection;
		if (!empty || !$from.parent.isTextblock || $from.depth === 0) return false;
		if ($from.parentOffset !== $from.parent.content.size) return false;
		const below = Selection.near(state.doc.resolve($from.after()), 1);
		if (below.from <= $from.pos) return false;
		const at = EditorState.create({ doc: state.doc, selection: below });
		const head = atItemStart(at, itemType);
		if (!head && !inItem($from, itemType)) return false;
		const code = !!$from.parent.type.spec.code;
		if ($from.parent.content.size === 0) {
			if (!!below.$from.parent.type.spec.code === code)
				return joinTextblockForward(state, dispatch);
			if (dispatch) {
				const tr = state.tr.deleteRange($from.before(), $from.after());
				dispatch(tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(below.from)), 1)));
			}
			return true;
		}
		if (!head) return press(at, dispatch && keepCaret(state, dispatch));
		const spent = emptyItem(below.$from.node(-1));
		let lifted: Transaction | undefined;
		if (!off(at, (tr) => (lifted = tr)) || !lifted) return false;
		if (!dispatch) return true;
		const tr = state.tr;
		for (const step of lifted.steps) tr.step(step);
		if (!spent && !!below.$from.parent.type.spec.code === code) {
			const caret = TextSelection.create(tr.doc, tr.mapping.map($from.pos));
			joinTextblockForward(EditorState.create({ doc: tr.doc, selection: caret }), (join) => {
				for (const step of join.steps) tr.step(step);
			});
		}
		dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map($from.pos, -1))));
		return true;
	};
}

/**
 * A dispatch that keeps the caret where the key was pressed through an edit made at a seam below
 * it.
 */
function keepCaret(
	state: EditorState,
	dispatch: (tr: Transaction) => void
): (tr: Transaction) => void {
	const pressed = state.selection.from;
	return (tr) => dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(pressed))));
}

/**
 * Tab on an unnumbered line, a block of an item past its first → that line alone the first item of
 * a sub-list of its list's kind, as `- ` or `1. ` typed at its head makes it. A sub-list of that
 * kind right above or below takes it in, joining the boundaries the wrap opens. Declined past
 * `MAX_NESTING_DEPTH`.
 */
function sinkLine(itemType: NodeType): Command {
	return (state, dispatch) => {
		const { $from, $to } = state.selection;
		if (!$from.sameParent($to) || !$from.parent.isTextblock || $from.depth < 3) return false;
		if ($from.node(-1).type !== itemType || $from.index(-1) === 0) return false;
		const list = $from.node(-2).type;
		const range = $from.blockRange($to);
		const wrapping = range && findWrapping(range, list);
		if (!range || !wrapping) return false;
		const at = $from.before();
		const tr = state.tr.wrap(range, wrapping);
		const end = at + $from.parent.nodeSize + 4;
		if (tr.doc.resolve(end).nodeAfter?.type === list && canJoin(tr.doc, end)) tr.join(end);
		if (tr.doc.resolve(at).nodeBefore?.type === list && canJoin(tr.doc, at)) tr.join(at);
		if (!withinNesting(tr.doc)) return false;
		dispatch?.(tr.scrollIntoView());
		return true;
	};
}

/**
 * Tab → `sinkListItem`, declined past `MAX_NESTING_DEPTH` (`nesting.ts`). On a first item the key
 * is claimed and does nothing.
 */
function sinkWithin(itemType: NodeType): Command {
	const sink = sinkListItem(itemType);
	return (state, dispatch) => {
		let sunk: Transaction | undefined;
		if (!sink(state, (tr) => (sunk = tr)) || !sunk) {
			const { $from } = state.selection;
			return $from.depth >= 2 && $from.node(-1).type === itemType && $from.index(-2) === 0;
		}
		if (!withinNesting(sunk.doc)) return false;
		dispatch?.(sunk);
		return true;
	};
}

/**
 * Tab on a block right after a list, outside every item → the block moves into the list's last
 * item, keeping its kind. Declined past `MAX_NESTING_DEPTH`, and over a selection that leaves the
 * block.
 */
function sinkIntoList(itemType: NodeType): Command {
	return (state, dispatch) => {
		const { $from, $to } = state.selection;
		if (!$from.parent.isTextblock || !$from.sameParent($to) || $from.depth < 1) return false;
		if ($from.node(-1).type === itemType) return false;
		const list = $from.index(-1) > 0 ? $from.node(-1).child($from.index(-1) - 1) : null;
		if (!list || list.firstChild?.type !== itemType) return false;
		const block = $from.parent;
		const start = $from.before();
		const into = start - 2;
		const tr = state.tr.delete(start, start + block.nodeSize).insert(into, block);
		if (!withinNesting(tr.doc)) return false;
		const shift = into - start;
		tr.setSelection(
			TextSelection.create(tr.doc, state.selection.anchor + shift, state.selection.head + shift)
		);
		dispatch?.(tr.scrollIntoView());
		return true;
	};
}

/**
 * The list bindings for a block-schema leaf: `{}` for the one-line and plain schemas, which declare
 * no list nodes.
 *
 * `Tab` / `Shift-Tab` hold the list link of the body's Tab chain; surfaces owning Tab more locally
 * prepend a link in `keymap.ts` (`prose/canon/VISUAL_EDITOR.md` §Chrome). `Tab` sinks an unnumbered
 * line alone into a sub-list, any other line its whole item, and a block right after a list into
 * the list's last item. `Mod-Shift-7` / `Mod-Shift-8` are the list toggle (`list-toggle.ts`).
 * `Mod-Enter` ticks the task item around the caret (`toggleTask`).
 *
 * `Enter` is a chain in precedence order: the empty line above an unnumbered one, the marker off an
 * empty middle item and back on an empty continuation line, `splitListItem` (`splitTaskItem` for
 * tasks), then `liftListItem`. The split link splits a non-empty item, and on an empty last item
 * either splits the wrapping item (a nested one, so Enter lifts one level) or bails so the last
 * link lifts a top-level one to a paragraph.
 *
 * `Backspace` takes an item's marker off at its start, a top-level continuation line out to full
 * width, and joins a block onto the list it follows; over a selection spanning blocks both keys
 * join the lists the delete leaves touching. `Delete` is the marker off at the seam below with the
 * two lines joined, never the line out. An empty line is neither key's here: the block link takes
 * it first (`blocks.ts`).
 */
export function listKeymap(schema: Schema): Record<string, Command> {
	const itemType = schema.nodes.list_item;
	const paragraph = schema.nodes.paragraph;
	if (!itemType || !paragraph) return {};
	const backspace = chainCommands(markerOff(itemType), joinOntoList(itemType));
	return {
		'Mod-Shift-7': toggleList(true),
		'Mod-Shift-8': toggleList(false),
		Tab: chainCommands(sinkLine(itemType), sinkWithin(itemType), sinkIntoList(itemType)),
		'Shift-Tab': outdent(itemType),
		'Mod-Enter': toggleTask(itemType),
		Enter: chainCommands(
			lineAbove(itemType, paragraph),
			continueAbove(itemType),
			markerOn(itemType),
			splitTaskItem(itemType),
			liftListItem(itemType)
		),
		Backspace: chainCommands(
			deleteAcross,
			markerOff(itemType),
			lineOut(itemType),
			joinOntoList(itemType)
		),
		Delete: chainCommands(deleteAcross, deleteBelow(itemType, backspace))
	};
}
