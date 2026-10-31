// A pasted list takes the numbering of where it lands (CODEC §"Markdown at the edges").
// An item's number is its position, so a paste counts where it stands: items pasted into
// a list are that list's next items, of its kind and in its count, and items pasted on
// the empty line a list was just left by are the same list's. A list pasted on a line of
// its own keeps the `start` it was copied with, which a writer typed (`lists.ts` writes
// none) — but a run of items copied from inside a list is copied counting from 1: their
// numbers were positions in the list they came out of.
//
// A line's shape travels with its end, as a word processor's paragraph mark carries its
// style: text copied from inside one line pastes as text, whatever block it was copied
// out of, and paragraphs pasted into a numbered line are numbered lines.
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { Plugin, Selection } from 'prosemirror-state';
import { isList } from './list-node.js';

/** The one list a slice is, if it is one: whole, or open where a run of its items was
 *  copied. */
function soleList(slice: Slice): PMNode | null {
	return slice.content.childCount === 1 && isList(slice.content.firstChild)
		? slice.content.firstChild
		: null;
}

/** The textblock a slice is the inside of: text copied from within one line, the slice
 *  open to that line at both ends down a chain of only children. */
function lineInside(slice: Slice): PMNode | null {
	if (slice.openStart === 0 || slice.openStart !== slice.openEnd) return null;
	let node: PMNode | null = null;
	for (let d = 0, content = slice.content; d < slice.openStart; d++, content = node.content) {
		if (content.childCount !== 1) return null;
		node = content.firstChild!;
	}
	return node!.isTextblock ? node : null;
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

/** A new item beside `item`: a task's sibling is a task, and unchecked. */
const itemAttrs = (item: PMNode) => ({ checked: item.attrs.checked === null ? null : false });

/** HTML a ProseMirror view wrote, which states how deep the copy was open at each end. */
const PM_SLICE = /\sdata-pm-slice="\d+ \d+/;

export function listPastePlugin(): Plugin {
	// Whether the paste in flight states its own open depths: a ProseMirror copy does, and
	// a drag inside the view carries its slice whole. Any other source is parsed open as
	// deep as it goes, so a whole item copied off a web page reads as the inside of one
	// line, and only a slice that says so is taken for one. Read once, by the transform.
	let exact = false;
	return new Plugin({
		props: {
			handleDOMEvents: {
				drop: (view) => {
					exact = !!view.dragging;
					return false;
				}
			},
			transformPastedHTML(html) {
				exact = PM_SLICE.test(html);
				return html;
			},
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
			// The caret's line keeps its shape under text from inside another line: no
			// list, heading or fence comes along to wrap it. Into a line of an item, a list
			// is its items, which join the list the caret is in where a whole list would
			// nest under that line's item. Paragraphs into an item's first line are items
			// beside it, as a word processor numbers each pasted paragraph; a later line of
			// an item is unnumbered, and so are the paragraphs pasted into it.
			transformPasted(slice, view) {
				const line = exact && lineInside(slice);
				exact = false;
				if (line) return new Slice(line.content, 0, 0);
				const { $from, $to } = view.state.selection;
				if (!$from.sameParent($to) || !$from.parent.isTextblock || $from.depth < 2) return slice;
				if ($from.parent.type.spec.code) return slice;
				const item = $from.node(-1);
				if (item.type.name !== 'list_item') return slice;
				const list = soleList(slice);
				if (list)
					return new Slice(
						list.content,
						Math.max(slice.openStart - 1, 0),
						Math.max(slice.openEnd - 1, 0)
					);
				const { content } = slice;
				if ($from.index(-1) !== 0 || content.childCount < 2) return slice;
				const items: PMNode[] = [];
				for (let i = 0; i < content.childCount; i++) {
					const block = content.child(i);
					if (block.type.name !== 'paragraph') return slice;
					items.push(item.type.create(itemAttrs(item), block));
				}
				return new Slice(
					Fragment.from(items),
					slice.openStart && slice.openStart + 1,
					slice.openEnd && slice.openEnd + 1
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
