// A list's own undo (`ArrayField`). A change to the rows (an insert, a remove, a split, a
// join, a spill, a move) lives in no leaf's history, so the list keeps its steps itself. A
// step is taken back only while the rows stand as the step left them: an edit in a row since
// is the row's to undo first, and once its own undo brings the rows back, the step is next.

/** Where the focus was in the list: the row holding it, and a prose row's caret. */
export interface ListFocus {
	id: string;
	caret?: number;
}

/** The rows at one end of a step: their ids, their values and the focus among them. */
export interface ListRows {
	ids: string[];
	values: unknown[];
	focus?: ListFocus;
}

/** One change to the rows, from `before` to `after`. */
export interface ListStep {
	before: ListRows;
	after: ListRows;
}

export interface ListHistory {
	/** Record a step, dropping every step undone before it. */
	record(step: ListStep): void;
	/** The latest step that can be undone. */
	latest(): ListStep | undefined;
	/** Take the latest step back (`redo` false) or forward again, where `values` still stand
	 *  where it would start from. The rows it leaves, or `undefined` where nothing moved. */
	take(redo: boolean, values: unknown[]): ListRows | undefined;
}

/** How many steps a list keeps each way. */
const DEPTH = 100;

/**
 * A list's history. `same` says whether two value lists are one: a record's blank cells read
 * as absent to it, since a cell typed in and undone back to empty commits its empty answer
 * where the step's row had no key.
 */
export function listHistory(same: (a: unknown[], b: unknown[]) => boolean): ListHistory {
	let done: ListStep[] = [];
	let undone: ListStep[] = [];
	return {
		record(step) {
			done = [...done.slice(1 - DEPTH), step];
			undone = [];
		},
		latest: () => done.at(-1),
		take(redo, values) {
			const step = (redo ? undone : done).at(-1);
			if (!step) return undefined;
			const [from, to] = redo ? [step.before, step.after] : [step.after, step.before];
			if (!same(values, from.values)) return undefined;
			if (redo) {
				undone = undone.slice(0, -1);
				done = [...done, step];
			} else {
				done = done.slice(0, -1);
				undone = [...undone, step];
			}
			return to;
		}
	};
}

/** Whether two value lists are one, compared by JSON after `norm` reads each element. */
export function sameValues(
	a: unknown[],
	b: unknown[],
	norm: (value: unknown) => unknown = (value) => value
): boolean {
	return a === b || JSON.stringify(a.map(norm)) === JSON.stringify(b.map(norm));
}

/** The chord a keydown is, of the two a list answers: ⌘/Ctrl+Z, and ⌘/Ctrl+Shift+Z or
 *  Ctrl+Y. */
export function undoChord(e: KeyboardEvent): 'undo' | 'redo' | undefined {
	if (e.defaultPrevented || e.isComposing || e.altKey || !(e.metaKey || e.ctrlKey)) return;
	const key = e.key.toLowerCase();
	if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey && e.ctrlKey)) return 'redo';
	return key === 'z' && !e.shiftKey ? 'undo' : undefined;
}
