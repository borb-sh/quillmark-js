// A text drag from one leaf into another moves (INVARIANTS §"Federated, not monolithic").
// ProseMirror moves a drag inside one view and treats a drop from anywhere else as a paste,
// which between two leaves of one editor leaves the dragged text in both. The leaves are
// one surface to the writer, so the leaf a drag started in gives its text up once another
// leaf has taken the drop.
//
// Each leaf keeps its own history, so the move is two steps in two stacks. An undo in either
// leaf that steps back over its half takes the other half back with it, and a redo puts both
// forward again: one gesture is one step to the writer, and half of it undone alone is the
// text in neither leaf or in both. A table cell keeps no history, its edits being steps of
// the leaf its island stands in, so that leaf answers for it, and where that leaf holds both
// halves they are one step of its history (`undo.ts`).
import type { Node } from 'prosemirror-model';
import type { EditorState, NodeSelection } from 'prosemirror-state';
import { Plugin, PluginKey } from 'prosemirror-state';
import { isHistoryTransaction, redo, undo } from 'prosemirror-history';
import type { EditorView } from 'prosemirror-view';
import { joinStep } from './undo.js';

/** The history owner of a view that keeps none, named by the view's own plugin. */
const owners = new WeakMap<EditorView, () => EditorView>();

/** The view the drag in flight started in. One drag runs at a time, across every editor
 *  on the page. */
let source: EditorView | undefined;

/** The latest move: the two leaves whose histories hold its halves, each at the document
 *  its half left or, once undone, restored. Any other edit to either leaf moves it off that
 *  document and the pairing lapses. */
let pair: { a: EditorView; aDoc: Node; b: EditorView; bDoc: Node; undone: boolean } | undefined;

/** Whether the transaction that produced a state was a history step. */
const stepped = new PluginKey<boolean>('qmDragMove');

/** The other half follows a history step over one half. */
function follow(view: EditorView, prev: EditorState): void {
	const held = pair;
	if (!held || !stepped.getState(view.state) || view.state.doc === prev.doc) return;
	const other =
		view === held.a && prev.doc === held.aDoc
			? { view: held.b, doc: held.bDoc }
			: view === held.b && prev.doc === held.bDoc
				? { view: held.a, doc: held.aDoc }
				: undefined;
	if (!other) return;
	// Cleared first: the step below lands in this function again, on the other leaf.
	pair = undefined;
	if (other.view.isDestroyed || other.view.state.doc !== other.doc) return;
	if (!(held.undone ? redo : undo)(other.view.state, other.view.dispatch)) return;
	pair = {
		a: held.a,
		aDoc: held.a.state.doc,
		b: held.b,
		bDoc: held.b.state.doc,
		undone: !held.undone
	};
}

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
 * keeps it always. `owner` is the view whose history holds this view's edits, where that
 * is not the view itself.
 */
export function dragMovePlugin(owner?: () => EditorView): Plugin {
	return new Plugin({
		key: owner ? undefined : stepped,
		state: {
			init: () => false,
			apply: (tr) => isHistoryTransaction(tr)
		},
		view: () => ({ update: follow }),
		props: {
			handleDOMEvents: {
				dragstart(view) {
					if (owner) owners.set(view, owner);
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
					if (!tr.docChanged) return;
					const a = owners.get(from)?.() ?? from;
					const b = owner?.() ?? view;
					// One history holds both halves: the delete joins the drop's step.
					if (a === b) joinStep(() => from.dispatch(tr));
					else from.dispatch(tr);
					pair =
						a === b ? undefined : { a, aDoc: a.state.doc, b, bDoc: b.state.doc, undone: false };
				});
				return false;
			}
		}
	});
}
