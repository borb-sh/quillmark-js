// How deep a body nests: the store's bound, the check every nesting command asks, and
// the plugin that holds any other transaction to it.
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, type Transaction } from 'prosemirror-state';
import { ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform';

/** The store's bound on the containers around one line: a commit nesting past it is
 *  refused, and `@quillmark/wasm` exports no constant to read it from. */
export const MAX_NESTING_DEPTH = 12;

/** The most containers any block in `doc` stands inside, counted as the store counts
 *  them: a `list_item` or a `blockquote` is one, the list around an item none, and no
 *  node holds an element (`decode.ts`). */
export function nestingDepth(doc: PMNode): number {
	const walk = (node: PMNode, depth: number): number => {
		let deepest = depth;
		node.forEach((child) => {
			if (child.isTextblock || child.isAtom) return;
			const name = child.type.name;
			const d = depth + (name === 'list_item' || name === 'blockquote' ? 1 : 0);
			deepest = Math.max(deepest, walk(child, d));
		});
		return deepest;
	};
	return walk(doc, 0);
}

/** Whether `doc` nests within {@link MAX_NESTING_DEPTH}: what a command that nests asks
 *  of the doc it would dispatch. */
export function withinNesting(doc: PMNode): boolean {
	return nestingDepth(doc) <= MAX_NESTING_DEPTH;
}

/** Whether a step of `tr` can move a block under another container: any replace but
 *  inline content inside one textblock, which is every keystroke's. Mark and attribute
 *  steps move no node. */
function mayNest(tr: Transaction): boolean {
	return tr.steps.some((step, i) => {
		if (step instanceof ReplaceAroundStep) return true;
		if (!(step instanceof ReplaceStep)) return false;
		const doc = tr.docs[i]!;
		const $from = doc.resolve(step.from);
		if (!$from.parent.isTextblock || !$from.sameParent(doc.resolve(step.to))) return true;
		let block = false;
		step.slice.content.forEach((node) => (block ||= node.isBlock));
		return block;
	});
}

/**
 * Refuses a transaction leaving `doc` past {@link MAX_NESTING_DEPTH}, which the commit
 * would lose: a paste or a drop into a deep item, whose slice the import bounded alone.
 * The nesting commands ask first and keep their key; this is what reaches the rest, and
 * a refused paste lands nothing. Past the bound, a transaction passes where it leaves the
 * deepest level no deeper, so a body that arrived that deep keeps its Enter.
 */
export function nestingPlugin(): Plugin {
	return new Plugin({
		filterTransaction: (tr) => {
			if (!tr.docChanged || !mayNest(tr)) return true;
			const after = nestingDepth(tr.doc);
			return after <= MAX_NESTING_DEPTH || after <= nestingDepth(tr.before);
		}
	});
}
