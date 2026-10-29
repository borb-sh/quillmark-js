// Undo steps. History groups a run of adjacent edits under its delay, so a burst of
// typing with a list change in it would undo as one step. A transaction that moves a
// block (`mayNest`: a split, a join, a wrap, a lift) opens a step of its own, the typing
// after it joining that step.
import { closeHistory, isHistoryTransaction } from 'prosemirror-history';
import { Plugin } from 'prosemirror-state';
import { mayNest } from './nesting.js';
import { isRemote } from './remote.js';

/** Marks each block-moving transaction as the start of an undo step. `filterTransaction`
 *  is the one hook that sees a transaction before history's `apply` does; it passes
 *  every one. A transaction a plugin appended stays in its root's step. */
export function undoStepPlugin(): Plugin {
	return new Plugin({
		filterTransaction: (tr) => {
			if (
				!tr.docChanged ||
				isHistoryTransaction(tr) ||
				isRemote(tr) ||
				tr.getMeta('appendedTransaction')
			)
				return true;
			if (mayNest(tr)) closeHistory(tr);
			return true;
		}
	});
}
