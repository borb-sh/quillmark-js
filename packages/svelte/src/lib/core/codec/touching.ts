// Two lists of one kind that an edit leaves touching are one list. Each command that
// opens such a seam joins it in its own transaction (`lists.ts` §cleanup), so the items
// below count on from the items above. A seam no edit opened, two lists that arrived
// touching, is the boundary `Content` marks, and stays.
import type { Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { canJoin } from 'prosemirror-transform';

function isList(node: PMNode): boolean {
	return node.firstChild?.type === node.type.schema.nodes.list_item;
}

/** Whether two lists of one kind meet at `pos`. */
export function touching(doc: PMNode, pos: number): boolean {
	const $pos = doc.resolve(pos);
	const before = $pos.nodeBefore;
	const after = $pos.nodeAfter;
	return !!before && !!after && before.type === after.type && isList(before);
}

/** Join the two lists of one kind meeting at `pos`, the first's `start` counting for
 *  both. */
export function joinLists(tr: Transaction, pos: number): boolean {
	if (!touching(tr.doc, pos) || !canJoin(tr.doc, pos)) return false;
	tr.join(pos);
	return true;
}

/** Join the list at `pos` to a list of its kind touching it on either side. */
export function joinAround(tr: Transaction, pos: number): void {
	const node = tr.doc.nodeAt(pos);
	if (!node) return;
	joinLists(tr, pos + node.nodeSize);
	joinLists(tr, pos);
}

/** Join at every seam of `seams` that two lists of one kind meet at, the last first so
 *  each join leaves the positions before it standing. */
export function joinAll(tr: Transaction, seams: Iterable<number>): void {
	for (const seam of [...new Set(seams)].sort((a, b) => b - a)) joinLists(tr, seam);
}
