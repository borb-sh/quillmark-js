// List editing: the body leaf's structural commands, over
// `prosemirror-schema-list` primitives. Indent/outdent on Tab, and the three
// structural keys lists redefine: Enter (split, take the marker off an empty middle
// item, give an empty continuation line one, open a paragraph where nothing above the
// list takes a caret), Backspace (take an item's marker off, or join a block onto the
// list above it) and Delete (the marker off at the seam below, and the two lines
// joined).
//
// An item's number is its position: no edit writes `start`. Taking a marker off keeps
// the text where it stands, a continuation of the item above, so the items below close
// up by position. `start` is what a writer typed (`N. `, `blocks.ts`) or what arrived
// with a whole list. The one split left is Backspace at the head of a top-level
// continuation line, which takes the line out to full width; the tail counts from 1.
//
// Cleanup is command-local, never a global pass: a command joins the boundary it opens
// and `sinkListItem` reuses the previous item's nested list, so no mutation strands a
// node. A whole-doc normalizer would instead fuse adjacent same-type lists, and that
// boundary is load-bearing: `Container.instance` is how `Content` marks one, the
// upstream normalizer keeps it (`tests/codec/list-shapes.test.ts`), and fusing
// renumbers an imported `1, 2, 1` in a region no edit touched. Reads preserve it; only
// an edit normalizes.
import { NodeRange } from 'prosemirror-model';
import type { Node as PMNode, NodeType, ResolvedPos, Schema } from 'prosemirror-model';
import { liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { EditorState, Selection, TextSelection } from 'prosemirror-state';
import type { Command, Transaction } from 'prosemirror-state';
import { canJoin, liftTarget } from 'prosemirror-transform';
import { chainCommands, joinTextblockBackward, joinTextblockForward } from 'prosemirror-commands';
import { withinNesting } from './nesting.js';
import { splitTaskItem } from './tasks.js';

/** The caret's enclosing `list_item` when it sits at the very start of that item's
 * first block: the position both structural keys branch on. `null` otherwise
 * (mid-text, a non-first block of a multi-paragraph item, a non-empty selection),
 * which is where the key keeps its ordinary meaning. */
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
 * The textblock at the end of `node`: `node` itself where it is one, else its last
 * descendant that is — the block a caret above a boundary lands in, and the block a
 * join across one reaches, `joinTextblockBackward` walking to the same one. `null` on
 * an atom (an island, a rule), which `prosemirror-gapcursor` declines to sit beside
 * too, its `closedBefore` asking this question from the other side.
 */
function lastBlockIn(node: PMNode | null | undefined): PMNode | null {
	let last = node ?? null;
	while (last && !last.isTextblock && !last.isAtom) last = last.lastChild;
	return last?.isTextblock ? last : null;
}

/**
 * Whether a caret already fits immediately above the list at `pos`. The node ending
 * there answers for its last child, so a quote counts through its final paragraph; a
 * list opening its parent has no node there at all.
 */
function writableAbove(doc: PMNode, pos: number): boolean {
	return !!lastBlockIn(doc.resolve(pos).nodeBefore);
}

/**
 * Enter at the very start of a top-level list's first item, where nothing above the
 * list takes a caret → an empty paragraph above it, caret staying with the text it
 * pushed down. A list under an island or a rule has nowhere above to write and
 * nothing else that opens one; a list that opens the body is the block link's, which
 * answers the same fact for every block ahead of this chain (`blocks.ts`). Where a
 * caret already fits above, the key is the conventional split instead, at every item
 * alike: an escape a writer reaches by pressing Up needs no key of its own.
 *
 * Also only where the list itself is not inside an item: in a nested list this
 * pushes an empty paragraph into the parent item (`list_item` is `block+`, so the
 * shape is representable and wrong), where the conventional split (an empty item
 * above) is what the next link does. An empty first item falls through to that same
 * link, which exits the list instead.
 */
function paragraphAboveList(itemType: NodeType, paragraph: NodeType): Command {
	return (state, dispatch) => {
		const at = atItemStart(state, itemType);
		if (!at || at.nested || at.itemIndex !== 0) return false;
		if (state.selection.$from.parent.content.size === 0) return false;
		if (writableAbove(state.doc, at.listPos)) return false;
		if (dispatch) dispatch(state.tr.insert(at.listPos, paragraph.create()).scrollIntoView());
		return true;
	};
}

/** Whether `item` holds nothing but one empty textblock: a line with no text and no
 *  structure under it. */
function emptyItem(item: PMNode): boolean {
	return (
		item.childCount === 1 && !!item.firstChild?.isTextblock && item.firstChild.content.size === 0
	);
}

/**
 * Take the marker off the item whose first block holds the caret's head, the text
 * staying where it stands: a later item's blocks become continuation blocks of the
 * item above, and a nested first item's become the parent item's, ahead of the rest of
 * its list. Nothing splits, so the items below close up by position. A top-level first
 * item has no item above to continue and lifts out over the list instead.
 *
 * An empty item is spent rather than kept as an empty continuation line, the caret
 * going to the end of what stood above it: the line held nothing, and the second press
 * that would join it away is the one a writer meant. `keepEmpty` is Enter's reading,
 * where the empty line is the one about to be typed in.
 *
 * Declines where the item has nothing above it in an item and is the first block of
 * one besides (`list_item(ordered_list(…))`, a pasted shape): there the content would
 * stand ahead of no line.
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
 * Backspace at the head of a continuation line in a top-level item → the line out of
 * the list to full width, with the item's blocks after it: the second rung of the
 * marker coming off, the line losing its indent as it lost its number. The list splits
 * there and the tail counts from 1, a number that names its position in the list it now
 * is. The press after is the ordinary join onto the list's last line
 * ({@link joinOntoList}).
 *
 * Declines where a sub-list stands below the line in its item, which the line cannot
 * leave without orphaning, and in a nested item, whose continuation lines keep the
 * ordinary join: there the next rung out is still inside the list.
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
 * Shift-Tab → `liftListItem` in a nested list, the item up one level. A top-level item
 * has no level above it inside the list: the key is claimed and does nothing, as Tab is
 * on a first item, so a press too many while backing out of a sub-list renumbers
 * nothing. Leaving the list is Backspace's, one rung a press. Outside every item the
 * key declines.
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
 * Enter on an empty item that has items after it → the marker off, the empty line kept
 * as a continuation of the item above: the unnumbered line a writer opens between two
 * numbered ones. An empty last item still leaves the list (`liftListItem`, the chain's
 * last link), and a first item has no item above to continue.
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
 * Enter on an empty continuation line, the last block of an item past its first → the
 * marker back on: the line becomes an item of its own after the one it continued. In
 * the last item of a list it leaves the list instead, standing after it in the list's
 * parent, the exit an empty last item takes. Never `liftListItem`, which would lift the
 * whole item the line continues and take that item's marker with it.
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
 * Backspace at the head of a block that stands right after a list → join its text into
 * the list's last line, as two paragraphs join. The base keymap's answer there wraps the
 * block into a fresh item instead, which undoes the lift that just took it out of the
 * list ({@link liftAtItemStart}) and leaves the key toggling.
 *
 * Between a fence and prose the text does not join: a fence is not a line to put another
 * line on, and the join would retype one side's whole text as the other's (`code.ts`,
 * which refuses the same join between siblings). The block moves into the list's last
 * item whole instead, a block of that item under its first.
 */
function joinOntoList(itemType: NodeType): Command {
	return (state, dispatch, view) => {
		const { $from, empty } = state.selection;
		if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false;
		const before = state.doc.resolve($from.before()).nodeBefore;
		if (before?.firstChild?.type !== itemType) return false;
		const into = lastBlockIn(before);
		if (!into) return false;
		if (!!into.type.spec.code === !!$from.parent.type.spec.code)
			return joinTextblockBackward(state, dispatch, view);
		if (dispatch) {
			const at = $from.before() - 2;
			const tr = state.tr.delete($from.before(), $from.after()).insert(at, $from.parent);
			dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
		}
		return true;
	};
}

/** Whether the caret sits inside a `list_item` at any depth: a quote's paragraph
 * inside an item is still an item's, and a caret outside every list is at no seam of
 * one. */
function inItem($pos: ResolvedPos, itemType: NodeType): boolean {
	for (let depth = $pos.depth; depth > 0; depth--) {
		if ($pos.node(depth).type === itemType) return true;
	}
	return false;
}

/**
 * Delete at the very end of a block inside an item → the item below's marker off and
 * its first line joined onto the caret's, as every editor merges two lines on a forward
 * delete: one keystroke, one line. The marker comes off by the Backspace chain's own
 * link (`markerOff`), so the item's other blocks, a nested list among them, stay where
 * they stood under the joined line; the join is `joinTextblockForward`'s. Backspace at
 * the same seam stops at the marker, the one place the two keys differ: Backspace edits
 * the block it is pressed in, and Delete the line after the caret.
 *
 * The caret stays where the key was pressed.
 *
 * An empty item below is spent, and nothing after it joins. An empty item at the caret
 * is the other way round: its line is the whole of what Delete edits, so the item below
 * moves up into it. A fence takes no prose line (`joinOntoList`): across one only the
 * marker comes off, and an empty line above one goes alone.
 *
 * A line above a list is the same seam from outside it: the first item's marker comes
 * off and its line joins the caret's. Below that, declining wherever the Backspace chain
 * does keeps this to the list's own seams: a boundary inside one item stays the base
 * keymap's.
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

/** A dispatch that keeps the caret where the key was pressed, through whatever edit a
 *  command made at a seam below it. */
function keepCaret(
	state: EditorState,
	dispatch: (tr: Transaction) => void
): (tr: Transaction) => void {
	const pressed = state.selection.from;
	return (tr) => dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(pressed))));
}

/** Tab → `sinkListItem`, declined where the sink would nest past `MAX_NESTING_DEPTH`
 *  (`nesting.ts`). On a first item, with nothing above to sink under, the key is claimed
 *  and does nothing: a writer indenting a list's first line is still writing the list. */
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
 * Tab on a block standing right after a list, outside every item → the block moves into
 * the list's last item, after what that item holds: one step in, under the item above,
 * as Tab nests an item. The block keeps its kind, so a paragraph lands as the item's
 * unnumbered line. Declined past `MAX_NESTING_DEPTH`, and over a selection that leaves
 * the block.
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
 * The list bindings for a block-schema leaf: `{}` for the one-line and plain
 * schemas, which declare no list nodes.
 *
 * `Tab` / `Shift-Tab` hold the list link of the body's Tab chain. Surfaces that own
 * Tab more locally under the same rule (`prose/canon/VISUAL_EDITOR.md` §Chrome)
 * prepend a link ahead of these in `keymap.ts`: a `code_block` takes literal
 * indentation (`code.ts`). Where every link declines, the body holds the key
 * (`keymap.ts`).
 *
 * `Enter` is a chain in precedence order: the escape-above gesture, the marker off an
 * empty middle item and back on an empty continuation line, then `splitListItem`
 * (`splitTaskItem`, which leaves a task item's new half an open task), then
 * `liftListItem`. The split link carries two behaviors of its own: it splits a
 * non-empty item, and on an empty last item it either splits the wrapping item (a
 * nested one, so Enter lifts exactly one level) or bails so the last link lifts a
 * top-level one out to a paragraph. `Backspace` takes an item's marker off at its
 * start, a top-level continuation line out to full width, and joins a block onto the
 * list it stands after. `Delete` is the marker off at the seam below with the two lines
 * joined, never the line out: a forward delete edits the line after the caret, not its
 * indent. An empty line is neither key's here:
 * the block link takes it ahead of this chain (`blocks.ts`), the caret's own line
 * being a nearer fact than the boundary under it.
 */
export function listKeymap(schema: Schema): Record<string, Command> {
	const itemType = schema.nodes.list_item;
	const paragraph = schema.nodes.paragraph;
	if (!itemType || !paragraph) return {};
	const backspace = chainCommands(markerOff(itemType), joinOntoList(itemType));
	return {
		Tab: chainCommands(sinkWithin(itemType), sinkIntoList(itemType)),
		'Shift-Tab': outdent(itemType),
		Enter: chainCommands(
			paragraphAboveList(itemType, paragraph),
			continueAbove(itemType),
			markerOn(itemType),
			splitTaskItem(itemType),
			liftListItem(itemType)
		),
		Backspace: chainCommands(markerOff(itemType), lineOut(itemType), joinOntoList(itemType)),
		Delete: deleteBelow(itemType, backspace)
	};
}
