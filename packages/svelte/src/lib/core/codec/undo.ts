// Undo steps. History groups a run of adjacent edits under its delay, so a burst of
// typing with a list change in it would undo as one step. A transaction that moves a
// block (`mayNest`: a split, a join, a wrap, a lift) opens a step of its own, the typing
// after it joining that step. A table cell's keystroke rewrites its island node, which reads
// as a block move, so it carries {@link TYPING} and joins the step the cell's typing is in.
// A gesture that lands as two transactions in one leaf, a drag between a table cell and the
// leaf its island stands in, runs its second under {@link joinStep} and undoes as one step.
import { closeHistory, isHistoryTransaction } from 'prosemirror-history';
import { Plugin } from 'prosemirror-state';
import { mayNest } from './nesting.js';
import { isRemote } from './remote.js';

/** The meta on a transaction that goes on typing in the island cell the last one typed in. */
export const TYPING = 'qmTyping';

let joining = false;

/** Run `dispatch` with every transaction it lands in a leaf joined to that leaf's last
 *  undo step, as one a plugin appended to it is: neither history's delay nor the distance
 *  between the two edits opens a new one. */
export function joinStep(dispatch: () => void): void {
	joining = true;
	try {
		dispatch();
	} finally {
		joining = false;
	}
}

/** Marks each block-moving transaction as the start of an undo step. `filterTransaction`
 *  is the one hook that sees a transaction before history's `apply` does; it passes
 *  every one. A transaction a plugin appended stays in its root's step. */
export function undoStepPlugin(): Plugin {
	return new Plugin({
		filterTransaction: (tr) => {
			// The meta history reads to keep a transaction in the step before it. It names the
			// transaction appended to, of which history asks only whether it was a history
			// step: this one is not.
			if (joining && tr.docChanged && !isHistoryTransaction(tr))
				tr.setMeta('appendedTransaction', tr);
			if (
				!tr.docChanged ||
				isHistoryTransaction(tr) ||
				isRemote(tr) ||
				tr.getMeta('appendedTransaction')
			)
				return true;
			if (mayNest(tr) && !tr.getMeta(TYPING)) closeHistory(tr);
			return true;
		}
	});
}
