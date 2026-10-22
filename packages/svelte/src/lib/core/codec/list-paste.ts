// A pasted list takes the numbering of where it lands (CODEC §"Markdown at the edges").
// An item's number is its position, so a paste counts where it stands: items pasted into
// a list are that list's next items, of its kind and in its count, and items pasted on
// the empty line a list was just left by are the same list's. A list pasted on a line of
// its own keeps the `start` it was copied with, which a writer typed (`lists.ts` writes
// none) — but a run of items copied from inside a list is copied counting from 1: their
// numbers were positions in the list they came out of.
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { Plugin, Selection } from 'prosemirror-state';

const isList = (node: PMNode | null | undefined): node is PMNode =>
	!!node && (node.type.name === 'ordered_list' || node.type.name === 'bullet_list');

/** The one list a slice is, if it is one: whole, or open where a run of its items was
 *  copied. */
function soleList(slice: Slice): PMNode | null {
	return slice.content.childCount === 1 && isList(slice.content.firstChild)
		? slice.content.firstChild
		: null;
}

/** `content` with the node `depth` levels down its leading edge counting from 1. */
function fromOne(content: Fragment, depth: number): Fragment {
	const first = content.firstChild!;
	const node =
		depth === 1
			? first.type.create({ ...first.attrs, start: 1 }, first.content, first.marks)
			: first.copy(fromOne(first.content, depth - 1));
	return content.replaceChild(0, node);
}

export function listPastePlugin(): Plugin {
	return new Plugin({
		props: {
			// A copy whose leading edge stands past an ordered list's first item is a run
			// out of it, and goes out counting from 1; one from the first item keeps the
			// list's `start`, however the selection ends. The copy is the selection's own
			// slice, its leading edge the caret's ancestors from the top, so the list at
			// depth `d` stands `d` levels down it.
			transformCopied(slice, view) {
				const { $from } = view.state.selection;
				let content = slice.content;
				for (let d = 1; d < $from.depth; d++) {
					const list = $from.node(d);
					if (list.type.name === 'ordered_list' && $from.index(d) > 0 && list.attrs.start !== 1)
						content = fromOne(content, d);
				}
				return content === slice.content
					? slice
					: new Slice(content, slice.openStart, slice.openEnd);
			},
			// Into an empty item, a list is its items: they join the list the caret is in,
			// where a whole list would nest under the empty item as its only content.
			transformPasted(slice, view) {
				const list = soleList(slice);
				const { $from, empty } = view.state.selection;
				if (!list || !empty || $from.depth < 2 || $from.parent.content.size !== 0) return slice;
				const item = $from.node(-1);
				if (item.type.name !== 'list_item' || item.childCount !== 1) return slice;
				return new Slice(
					list.content,
					Math.max(slice.openStart - 1, 0),
					Math.max(slice.openEnd - 1, 0)
				);
			},
			// On the empty line right under a list of the same kind, the line Enter on an
			// empty last item leaves, the items are that list's next ones.
			handlePaste(view, _event, slice) {
				const list = soleList(slice);
				const { $from, empty } = view.state.selection;
				if (!list || !empty || !$from.parent.isTextblock || $from.parent.content.size !== 0)
					return false;
				if ($from.parent.type.spec.code) return false;
				const above = view.state.doc.resolve($from.before()).nodeBefore;
				if (!isList(above) || above.type !== list.type) return false;
				const end = $from.before() - 1;
				const tr = view.state.tr.delete($from.before(), $from.after()).insert(end, list.content);
				try {
					tr.doc.check();
				} catch {
					return false;
				}
				tr.setSelection(Selection.near(tr.doc.resolve(end + list.content.size), -1));
				view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
				return true;
			}
		}
	});
}
