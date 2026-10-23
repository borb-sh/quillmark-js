// Alt+↑/↓ in a list moves the caret's item past the item beside it, its sub-items going
// with it: the twin of an array row's move and a table line's (VISUAL_EDITOR §Chrome).
// A selection across items of one list moves them together. The number an item draws
// is its position, so a move renumbers and writes nothing else. At the list's edge the
// key declines: an item leaving its list is a different edit.
import type { Node as PMNode, Schema } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';

const isList = (node: PMNode): boolean =>
	node.type.name === 'ordered_list' || node.type.name === 'bullet_list';

/** The items the selection stands in, in the innermost list holding all of them, moved
 *  one place up (`-1`) or down (`1`). */
export function moveItems(dir: -1 | 1): Command {
	return (state, dispatch) => {
		const { $from, $to } = state.selection;
		const range = $from.blockRange($to, isList);
		if (!range) return false;
		const index = dir < 0 ? range.startIndex - 1 : range.endIndex;
		if (index < 0 || index >= range.parent.childCount) return false;
		if (!dispatch) return true;
		const sibling = range.parent.child(index);
		const size = sibling.nodeSize;
		const tr = state.tr;
		if (dir < 0) tr.delete(range.start - size, range.start).insert(range.end - size, sibling);
		else tr.delete(range.end, range.end + size).insert(range.start, sibling);
		dispatch(tr.scrollIntoView());
		return true;
	};
}

export function listMoveKeymap(schema: Schema): Record<string, Command> {
	if (!schema.nodes.list_item) return {};
	return { 'Alt-ArrowUp': moveItems(-1), 'Alt-ArrowDown': moveItems(1) };
}
