// A text drag from one leaf into another moves (INVARIANTS §"Federated, not monolithic").
// ProseMirror moves a drag inside one view and treats a drop from anywhere else as a paste,
// which between two leaves of one editor leaves the dragged text in both. The leaves are
// one surface to the writer, so the leaf a drag started in gives its text up once another
// leaf has taken the drop.
import type { NodeSelection } from 'prosemirror-state';
import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/** The view the drag in flight started in. One drag runs at a time, across every editor
 *  on the page. */
let source: EditorView | undefined;

/** ProseMirror's own modifier for a drag that copies. */
const copies = (event: DragEvent): boolean =>
	/Mac|iP(hone|[oa]d)/.test(typeof navigator === 'undefined' ? '' : navigator.platform)
		? event.altKey
		: event.ctrlKey;

/**
 * Deletes what a drag took from its own leaf when a different leaf accepts the drop. The
 * receiving view parses the drop through its own schema, as it does a paste, and the
 * delete follows only a drop that changed it, so text a leaf refused stays where it was.
 * The copy modifier keeps the source, as it does inside one view, and a read-only source
 * keeps it always.
 */
export function dragMovePlugin(): Plugin {
	return new Plugin({
		props: {
			handleDOMEvents: {
				dragstart(view) {
					source = view;
					return false;
				},
				dragend(view) {
					if (source === view) source = undefined;
					return false;
				}
			},
			handleDrop(view, event, _slice, moved) {
				const from = source;
				const dragging = from?.dragging as
					(NonNullable<EditorView['dragging']> & { node?: NodeSelection }) | null | undefined;
				if (moved || !from || from === view || !dragging || !from.editable || copies(event))
					return false;
				const before = view.state.doc;
				// After the drop this handler is part of: the default inserts synchronously.
				queueMicrotask(() => {
					if (from.isDestroyed || view.isDestroyed || view.state.doc === before) return;
					const tr = from.state.tr;
					if (dragging.node) dragging.node.replace(tr);
					else tr.deleteSelection();
					if (tr.docChanged) from.dispatch(tr);
				});
				return false;
			}
		}
	});
}
