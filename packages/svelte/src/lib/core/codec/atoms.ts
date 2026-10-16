// The block-atom link of the body's Backspace/Delete chains: a delete against an
// island or a divider selects it, and the press after that deletes it. A table is the
// exception, having cells a caret can enter: the press steps into it instead, so a
// delete against one edits nothing (§`againstAtom`).
//
// This is the neighbour half of the rule the leaf already holds for a key typed over a
// selection (CODEC §"The table island"): a selection is the subject of the next
// command, never a thing armed for replacement. Without it the base keymap's
// `joinBackward` / `joinForward` reach their "the neighbour is an atom, delete it" arm
// and a table goes in one keystroke, from the paragraph a table insert parks the caret
// in — with nothing drawn first to say what is about to go.
//
// It runs last of the links, after the list ones: a Backspace at the start of a list's
// first item lifts the item, and that stays the item's answer whatever sits above the
// list.
import { NodeSelection, TextSelection, type Command } from 'prosemirror-state';
import type { ResolvedPos, Schema } from 'prosemirror-model';
import { tableAt } from './table-view.js';

/** The caret, when it sits at a textblock edge with an empty selection: the only place
 *  a delete is about a neighbour rather than about a character. `null` everywhere else,
 *  which is where the key keeps its ordinary meaning. */
function atEdge(state: Parameters<Command>[0], side: -1 | 1): ResolvedPos | null {
	const { selection } = state;
	if (!(selection instanceof TextSelection) || !selection.empty) return null;
	const $head = selection.$head;
	const at = side < 0 ? 0 : $head.parent.content.size;
	return $head.parentOffset === at ? $head : null;
}

/**
 * The cut the caret's block sits against on `side`: the shallowest boundary with a
 * sibling beyond it. `prosemirror-commands` walks the same one to find the node a join
 * would reach; this reads it to find the node a delete would take.
 */
function cutAt($pos: ResolvedPos, side: -1 | 1): ResolvedPos | null {
	if ($pos.parent.type.spec.isolating) return null;
	for (let d = $pos.depth - 1; d >= 0; d--) {
		if (side < 0) {
			if ($pos.index(d) > 0) return $pos.doc.resolve($pos.before(d + 1));
		} else if ($pos.index(d) + 1 < $pos.node(d).childCount) {
			return $pos.doc.resolve($pos.after(d + 1));
		}
		if ($pos.node(d).type.spec.isolating) break;
	}
	return null;
}

/** The press against a block atom: select it, rather than deleting it, or step into a
 *  mounted table, its last cell from below and its first from above. An empty line under
 *  a table goes with the step, its Backspace having nothing of its own to edit. Declines
 *  when the neighbour is anything else a caret can enter, so a paragraph, a heading, a
 *  quote and a list all keep the join the base keymap gives them. */
function againstAtom(side: -1 | 1): Command {
	return (state, dispatch, view) => {
		const $head = atEdge(state, side);
		const $cut = $head && cutAt($head, side);
		if (!$head || !$cut) return false;
		const node = side < 0 ? $cut.nodeBefore : $cut.nodeAfter;
		if (!node || !node.isAtom || !node.isBlock || !NodeSelection.isSelectable(node)) return false;
		const at = side < 0 ? $cut.pos - node.nodeSize : $cut.pos;
		const table = view && tableAt(view, at);
		if (!table) {
			dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, at)).scrollIntoView());
			return true;
		}
		if (!dispatch) return true;
		const index = $head.index(-1);
		if (side < 0 && $head.parent.content.size === 0 && $head.node(-1).canReplace(index, index + 1))
			dispatch(state.tr.delete($head.before(), $head.after()));
		table.enter(side);
		return true;
	};
}

/**
 * The block-atom bindings for a block-schema leaf: `{}` for the one-line and plain
 * schemas, which hold no block to be against.
 *
 * Both keys are the same command on opposite sides, because what a delete against an
 * atom means does not depend on which side the caret approached from.
 */
export function atomKeymap(schema: Schema): Record<string, Command> {
	if (!schema.nodes.island_block) return {};
	return {
		Backspace: againstAtom(-1),
		Delete: againstAtom(1)
	};
}
