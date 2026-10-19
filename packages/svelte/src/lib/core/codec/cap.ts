// A content field's `max:`, the character count past which its value overflows its box
// or its record (quillmark canon `SCHEMAS.md` §"Cardinality"): held as a bound no edit
// crosses, so an over-length value is never authored rather than authored and warned of.
import type { Node as PMNode, Slice } from 'prosemirror-model';
import { isHistoryTransaction } from 'prosemirror-history';
import { Plugin } from 'prosemirror-state';
import { usvLength } from './decode.js';
import { scanDoc } from './encode.js';
import { ISLAND_SLOT } from './islands.js';

/** A leaf's character cap: the schema's `max:`, and whether the count drops trailing
 *  whitespace, which a one-line `text` does and nothing else. */
export interface TextCap {
	max: number;
	trimEnd?: boolean;
	/** The count, at mount and after every change to the document. */
	onCount?: (count: number) => void;
}

/** The characters `doc` holds as `FieldSchema::char_count` counts them: Unicode scalar
 *  values of the plain projection, islands counting nothing and trailing line breaks
 *  none. */
export function capCount(doc: PMNode, trimEnd = false): number {
	const text = scanDoc(doc).text.replaceAll(ISLAND_SLOT, '');
	return usvLength(trimEnd ? text.trimEnd() : text.replace(/[\n\r]+$/, ''));
}

/**
 * Refuses a transaction leaving the leaf past `max`, so a keystroke at the cap lands
 * nothing, and cuts a paste to what fits. Past the cap, a transaction passes where it
 * leaves the count no higher, so a value stored over the cap still edits down; undo and
 * redo pass, each restoring a state the leaf already held.
 */
export function capPlugin(cap: TextCap): Plugin {
	const count = (doc: PMNode): number => capCount(doc, cap.trimEnd);
	return new Plugin({
		filterTransaction: (tr) => {
			if (!tr.docChanged || isHistoryTransaction(tr)) return true;
			const after = count(tr.doc);
			return after <= cap.max || after <= count(tr.before);
		},
		props: {
			handlePaste: (view, _event, slice: Slice) => {
				const { state } = view;
				const pasted = () => state.tr.replaceSelection(slice);
				if (count(pasted().doc) <= cap.max) return false;
				const tr = pasted();
				const start = tr.mapping.map(state.selection.from, -1);
				const end = tr.mapping.map(state.selection.to, 1);
				const fits = (cut: number): boolean => count(pasted().delete(cut, end).doc) <= cap.max;
				if (!fits(start)) return true;
				let lo = start;
				let hi = end;
				while (hi - lo > 1) {
					const mid = (lo + hi) >> 1;
					if (fits(mid)) lo = mid;
					else hi = mid;
				}
				view.dispatch(tr.delete(lo, end).scrollIntoView().setMeta('uiEvent', 'paste'));
				return true;
			}
		},
		view: (v) => {
			cap.onCount?.(count(v.state.doc));
			return {
				update: (next, prev) => {
					if (next.state.doc !== prev.doc) cap.onCount?.(count(next.state.doc));
				}
			};
		}
	});
}
