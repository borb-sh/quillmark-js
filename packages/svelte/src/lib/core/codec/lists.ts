// List editing: the body leaf's structural commands, over
// `prosemirror-schema-list` primitives. Indent/outdent on Tab, and the three
// structural keys lists redefine: Enter (split, exit an empty item, open a
// paragraph where nothing above the list takes a caret), Backspace (lift an item a
// level, or join a block onto the list above it) and Delete (Backspace at the seam
// below).
//
// Cleanup is command-local, never a global pass: `liftToOuterList` joins the
// boundary it opens and `sinkListItem` reuses the previous item's nested list, so
// no mutation strands a node. A whole-doc normalizer would instead fuse adjacent
// same-type lists, and that boundary is load-bearing: `Container.instance` is how
// `Content` marks one, the upstream normalizer keeps it
// (`tests/codec/list-shapes.test.ts`), and fusing renumbers an imported `1, 2, 1`
// in a region no edit touched. Reads preserve it; only an edit normalizes.
import type { Node as PMNode, NodeType, ResolvedPos, Schema } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { EditorState, Selection, TextSelection } from 'prosemirror-state';
import type { Command, Transaction } from 'prosemirror-state';
import { chainCommands, joinTextblockBackward, joinTextblockForward } from 'prosemirror-commands';

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

/**
 * Backspace at the start of an item → lift it: one level out for a nested item, out of
 * the list to a paragraph at the top, whichever item it is. The first press takes off
 * the item's own shape and joins nothing; the press after is the join
 * ({@link joinOntoList}).
 *
 * Lifting a later item out splits its list, and an ordered list's items past the cut
 * keep their numbers: the list after what the item held starts where they were, where a
 * fresh `ordered_list` would count from 1 again.
 */
function liftAtItemStart(itemType: NodeType): Command {
	return (state, dispatch) => {
		const at = atItemStart(state, itemType);
		if (!at) return false;
		const list = state.doc.nodeAt(at.listPos);
		const cut =
			list?.type.name === 'ordered_list' && !at.nested && at.itemIndex < list.childCount - 1;
		const listEnd = at.listPos + (list?.nodeSize ?? 0);
		return liftListItem(itemType)(
			state,
			dispatch &&
				((tr) => {
					if (cut)
						renumberEndingAt(
							tr,
							tr.mapping.map(listEnd, -1),
							(list.attrs.start as number) + at.itemIndex + 1
						);
					dispatch(tr);
				})
		);
	};
}

/** Start the ordered list ending at `end` at `start`: the items a lift cut off, which
 *  end where the whole list did, past whatever the lifted item held. */
function renumberEndingAt(tr: Transaction, end: number, start: number): void {
	const list = tr.doc.resolve(end).nodeBefore;
	if (list?.type.name === 'ordered_list' && list.attrs.start !== start)
		tr.setNodeMarkup(end - list.nodeSize, undefined, { ...list.attrs, start });
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
 * Delete at the very end of a block inside an item → `press`, the Backspace chain, at
 * the head of the block below: one seam, one edit, whichever side a writer approaches
 * it from. Not the base keymap's `joinForward`, which merges the blocks and leaves the
 * `list_item(paragraph, paragraph)` above.
 *
 * The reflection carries the edit and not the caret, which stays where the key was
 * pressed: a lift moves the item below, and Delete does not follow it.
 *
 * An empty item is the exception: its line is the whole of what Delete edits, so the
 * item below moves up into it rather than being lifted, and the empty item is spent. A
 * fence below takes no prose line (`joinOntoList`), so there the empty line goes alone.
 *
 * Declining wherever the chain does is what keeps this to the list's own seams: a
 * boundary inside one item, and the list's outer edge, stay the base keymap's, where
 * the two keys already answer alike.
 */
function backspaceBelow(itemType: NodeType, press: Command): Command {
	return (state, dispatch) => {
		const { $from, empty } = state.selection;
		if (!empty || $from.parentOffset !== $from.parent.content.size) return false;
		if (!inItem($from, itemType)) return false;
		const below = Selection.near(state.doc.resolve($from.after()), 1);
		if (below.from <= $from.pos) return false;
		if ($from.parent.content.size === 0) {
			if (!!below.$from.parent.type.spec.code === !!$from.parent.type.spec.code)
				return joinTextblockForward(state, dispatch);
			if (dispatch) {
				const tr = state.tr.deleteRange($from.before(), $from.after());
				dispatch(tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(below.from)), 1)));
			}
			return true;
		}
		const pressed = $from.pos;
		const keepCaret = (tr: Transaction): void =>
			dispatch?.(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(pressed))));
		return press(EditorState.create({ doc: state.doc, selection: below }), dispatch && keepCaret);
	};
}

/**
 * The list bindings for a block-schema leaf: `{}` for the inline/plaintext
 * schemas, which declare no list nodes.
 *
 * `Tab` / `Shift-Tab` hold the list link of the body's Tab chain. Surfaces that own
 * Tab more locally under the same rule (`prose/canon/VISUAL_EDITOR.md` §Chrome)
 * prepend a link ahead of these in `keymap.ts`: a `code_block` takes literal
 * indentation (`code.ts`), an island takes cell traversal once added. Outside all
 * of them every link returns false and the key is not swallowed: Tab keeps its
 * default meaning, which is the body's only keyboard exit and the open seam for a
 * shell structural keymap (VISUAL_EDITOR §Settled and open).
 *
 * `Enter` is a chain in precedence order: the escape-above gesture, then
 * `splitListItem`, then `liftListItem`. The middle link carries two behaviors of
 * its own: it splits a non-empty item, and on an empty item it either splits the
 * wrapping item (a nested empty item, so Enter lifts exactly one level) or bails
 * so the third link lifts a top-level empty item out to a paragraph. `Backspace` lifts
 * an item at its start, and joins a block onto the list it stands after. `Delete` is
 * that same chain at the seam below rather than a second table of cases beside it, so
 * the two keys cannot come to differ over a seam this link reaches. An empty line is
 * not one: the block link takes it ahead of this chain (`blocks.ts`), the caret's own
 * line being a nearer fact than the boundary under it.
 */
export function listKeymap(schema: Schema): Record<string, Command> {
	const itemType = schema.nodes.list_item;
	const paragraph = schema.nodes.paragraph;
	if (!itemType || !paragraph) return {};
	const backspace = chainCommands(liftAtItemStart(itemType), joinOntoList(itemType));
	return {
		Tab: sinkListItem(itemType),
		'Shift-Tab': liftListItem(itemType),
		Enter: chainCommands(
			paragraphAboveList(itemType, paragraph),
			splitListItem(itemType),
			liftListItem(itemType)
		),
		Backspace: backspace,
		Delete: backspaceBelow(itemType, backspace)
	};
}
