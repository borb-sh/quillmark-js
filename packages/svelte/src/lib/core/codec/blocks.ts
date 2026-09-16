// The block shapes, as commands. A markdown shorthand and a slash pick are two doors
// onto one construct, with one implementation behind them: `inputrules.ts` runs these
// under a regexp, `slash.ts` under a name.
//
// A shorthand's `^` anchors it to the head of a textblock, so every command here
// declines anywhere else, and a pick does what the shorthand would have done there —
// the run consumed, the caret at the block's head. The menu asks each command whether
// it would run rather than restating its guards (§`slashItems`).
//
// `blockKeymap` is the other half of the file and answers to no door: the Enter cases
// that are about the body rather than about any block in it, and the Delete that is
// about the caret's own line, outermost of the leaf's key chains (`keymap.ts`).
import type { Attrs, Node as PMNode, NodeType, ResolvedPos, Schema } from 'prosemirror-model';
import { Selection } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { chainCommands, splitBlock } from 'prosemirror-commands';
import { canJoin, findWrapping } from 'prosemirror-transform';
import { takesLineBreak } from './schema.js';

/** The head of a textblock: where a shorthand fires, and where a pick lands once its
 *  run is consumed. */
function atHead(state: EditorState): boolean {
	const { $from, empty } = state.selection;
	return empty && $from.parent.isTextblock && $from.parentOffset === 0;
}

/** Whether the caret's parent holds `type` in its block's place. `setBlockType` and
 *  `replaceWith` both mint the shape without asking. */
function fits($from: ResolvedPos, type: NodeType): boolean {
	return $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), type);
}

/**
 * The head of an item that already exists: where a list shorthand is the text an author
 * typed rather than a shorthand at all.
 *
 * Firing there wraps the item's own paragraph in a fresh list, minting an item whose
 * only content is another item — a level with nothing on it. Tab is the indent gesture
 * and lands the shape a nesting is supposed to have, under the previous sibling. A
 * later block of the item is not this case: wrapping a continuation paragraph is how a
 * sub-list opens under text.
 */
function openingAnItem($from: ResolvedPos, item: NodeType | undefined): boolean {
	if (!item || $from.depth < 2) return false;
	return $from.node(-1).type === item && $from.index(-1) === 0;
}

function retype(name: string, attrs?: Attrs): Command {
	return (state, dispatch) => {
		const type = state.schema.nodes[name];
		const { $from } = state.selection;
		if (!type || !atHead(state) || !fits($from, type)) return false;
		const tr = state.tr;
		spaceBreaks(tr, $from, type);
		dispatch?.(tr.setBlockType($from.pos, $from.pos, type, attrs));
		return true;
	};
}

/** Replace every `hard_break` in the caret's block with a space, ahead of a retype into
 *  a type that holds none. `setBlockType` clears what the new type cannot hold by
 *  deleting it, which joins the text either side with nothing and glues the words; a
 *  space is what the break becomes at every other door (`breaks.ts`, `decode.ts`). A
 *  break and a space are both one position wide, so an earlier replacement leaves every
 *  later one addressed. */
function spaceBreaks(tr: Transaction, $from: ResolvedPos, type: NodeType): void {
	const br = tr.doc.type.schema.nodes.hard_break;
	if (!br || takesLineBreak(type)) return;
	let at = $from.start();
	$from.parent.forEach((child) => {
		if (child.type === br)
			tr.replaceWith(
				at,
				at + child.nodeSize,
				type.schema.text(' ', type.allowedMarks(child.marks))
			);
		at += child.nodeSize;
	});
}

/** `wrappingInputRule`'s body: wrap the block range at `pos`, then join a preceding
 *  sibling of the same type — the one boundary the wrap itself opens (`lists.ts`
 *  §cleanup: command-local, never a global pass). */
function wrapAt(
	tr: Transaction,
	pos: number,
	type: NodeType,
	attrs: Attrs | null,
	joinBefore?: (node: PMNode) => boolean
): boolean {
	const range = tr.doc.resolve(pos).blockRange();
	const wrapping = range && findWrapping(range, type, attrs);
	if (!range || !wrapping) return false;
	tr.wrap(range, wrapping);
	const before = tr.doc.resolve(pos - 1).nodeBefore;
	if (
		before &&
		before.type === type &&
		canJoin(tr.doc, pos - 1) &&
		(!joinBefore || joinBefore(before))
	) {
		tr.join(pos - 1);
	}
	return true;
}

/** `# `: the heading `level` deep. `list_item` is `block+`, so one inside an item is a
 *  shape the content holds and `importMarkdown` produces from `- # title`. */
export function toHeading(level: number): Command {
	return retype('heading', { level });
}

/** A fence. The exit paragraph after it is the one a block island mints for the same
 *  reason, sharpened: a code block is the one block a gap cursor will not sit beside
 *  either, so a fence at the end of a body leaves the caret nowhere to go. The caret
 *  stays in the fence, not in the exit it minted. */
export function toCodeBlock(): Command {
	return (state, dispatch) => {
		const { code_block: code, paragraph } = state.schema.nodes;
		const { $from } = state.selection;
		if (!code || !paragraph || !atHead(state) || !fits($from, code)) return false;
		const tr = state.tr.setBlockType($from.pos, $from.pos, code);
		const at = tr.doc.resolve($from.pos).after();
		if (!tr.doc.nodeAt(at)) tr.insert(at, paragraph.create());
		dispatch?.(tr);
		return true;
	};
}

/** `---`. A divider is a whole block, so this replaces its textblock rather than
 *  retyping one: `horizontal_rule` holds no content to retype into, and an empty block
 *  is the whole of what it may replace — anything else in one is a paragraph being
 *  edited, which a replace would eat. */
export function insertDivider(): Command {
	return (state, dispatch) => {
		const { horizontal_rule: rule, paragraph } = state.schema.nodes;
		const { $from } = state.selection;
		if (!rule || !paragraph || !atHead(state) || !fits($from, rule)) return false;
		if ($from.parent.content.size !== 0) return false;
		const from = $from.before();
		const tr = state.tr.replaceWith(from, $from.after(), rule.create());
		const at = from + 1;
		if (!tr.doc.nodeAt(at)) tr.insert(at, paragraph.create());
		tr.setSelection(Selection.near(tr.doc.resolve(at), 1));
		dispatch?.(tr);
		return true;
	};
}

/** `> `. No item guard: what this wraps an item's first block in is a container the
 *  content holds, where a list wrapping one mints an item whose only content is an
 *  item. */
export function wrapInQuote(): Command {
	return (state, dispatch) => {
		const quote = state.schema.nodes.blockquote;
		const { $from } = state.selection;
		if (!quote || !atHead(state)) return false;
		const tr = state.tr;
		if (!wrapAt(tr, $from.pos, quote, null)) return false;
		dispatch?.(tr);
		return true;
	};
}

/** `- ` / `1. `. `joinBefore` is the shorthand's ordinal test: `2. ` continues the list
 *  above where `7. ` opens one. A pick passes none and continues whatever list is
 *  above it. */
export function wrapInList(
	ordered: boolean,
	attrs: Attrs | null = null,
	joinBefore?: (node: PMNode) => boolean
): Command {
	return (state, dispatch) => {
		const { paragraph, list_item: item } = state.schema.nodes;
		const list = state.schema.nodes[ordered ? 'ordered_list' : 'bullet_list'];
		const { $from } = state.selection;
		if (!list || !paragraph || !atHead(state) || openingAnItem($from, item)) return false;
		const pos = $from.pos;
		const tr = state.tr;
		// A paragraph item wherever this fires: `# ` inside the item is the gesture that
		// mints `list_item > heading`, and a wrap keeping the heading is a second door onto
		// that shape. Positions survive the retype — same content, same size.
		if ($from.parent.type !== paragraph) tr.setBlockType(pos, pos, paragraph);
		if (!wrapAt(tr, pos, list, attrs, joinBefore)) return false;
		dispatch?.(tr);
		return true;
	};
}

/**
 * Run `command` in place of the text at `[from, to)`: one transaction carrying the
 * delete and the command's own steps. One rather than two because two would be two
 * commits, two undo steps and two recompiles for one gesture; the command is built
 * against the state the delete leaves, which is exactly what its steps were computed
 * for.
 *
 * `null` is a command that declined, and nothing is consumed: the shorthand stays the
 * text it was typed as.
 */
export function consuming(
	state: EditorState,
	from: number,
	to: number,
	command: Command
): { tr: Transaction; produced: Transaction } | null {
	const tr = state.tr.delete(from, to);
	let produced: Transaction | undefined;
	command(state.apply(tr), (t) => {
		produced = t;
	});
	if (!produced) return null;
	for (const step of produced.steps) tr.step(step);
	tr.setSelection(Selection.fromJSON(tr.doc, produced.selection.toJSON()));
	return { tr, produced };
}

/** The head of the body's first block: one position per open token above the caret,
 *  and nothing before it. */
function atBodyStart($from: ResolvedPos): boolean {
	return $from.pos === $from.depth;
}

/**
 * Enter at the very start of a body whose first block takes no caret above it → an
 * empty paragraph there, the caret staying with the text it pushed down.
 *
 * A code block, a quote and a list are the blocks `prosemirror-gapcursor` declines
 * to sit beside, and nothing else mints a block above one: three keystrokes on an
 * empty body (` ``` `, `> `, `- `) put one first, and a document carrying one there
 * can never be given a title. The argument is `paragraphAboveList`'s, about the
 * block rather than about lists, so this link comes first and that one holds the
 * position it alone reaches, a list under an island or a rule.
 *
 * Declines wherever the first block is a plain textblock, whose Enter-split already
 * leaves a paragraph above, and on an empty one, which the links after it answer.
 */
const paragraphAtBodyStart: Command = (state, dispatch) => {
	const paragraph = state.schema.nodes.paragraph;
	const { $from, empty } = state.selection;
	if (!paragraph || !empty || !atBodyStart($from)) return false;
	if ($from.parent.content.size === 0) return false;
	if ($from.depth === 1 && $from.parent.isTextblock && !$from.parent.type.spec.code) return false;
	dispatch?.(state.tr.insert(0, paragraph.create()).scrollIntoView());
	return true;
};

/**
 * Enter in an empty fence that opens the body → the fence, retyped to a paragraph.
 *
 * An empty first item exits its list and an empty first quoted paragraph lifts out of
 * the quote, each leaving the one paragraph a caret above needs. A fence answers with
 * `newlineInCode` instead — a line inside the block, in the direction already open —
 * so the empty fence a body's first ` ``` ` mints holds a caret with nothing above it
 * and no key that mints one.
 *
 * Retyping rather than inserting above, for the reason those exits leave one paragraph
 * and not two: an empty fence carries nothing to keep.
 */
const paragraphFromEmptyFence: Command = (state, dispatch) => {
	const paragraph = state.schema.nodes.paragraph;
	const { $from, empty } = state.selection;
	if (!paragraph || !empty || !atBodyStart($from)) return false;
	if (!$from.parent.type.spec.code || $from.parent.content.size !== 0) return false;
	if (!fits($from, paragraph)) return false;
	dispatch?.(state.tr.setBlockType($from.pos, $from.pos, paragraph).scrollIntoView());
	return true;
};

/**
 * Enter over a selection spanning two textblocks: take the selection, then split
 * what is left, both in one transaction.
 *
 * The edit upstream's `splitBlock` means, computed against a document that exists.
 * It deletes the selection inside its own transaction and then reads the default
 * block's fit off the *pre-delete* document — `$from.node(splitDepth - 1)` against an
 * index resolved in the new one — so where the range starts at the head of a
 * `defining` block and ends inside a list, it retypes a `list_item` to a paragraph
 * and throws `RangeError` out of the keystroke.
 */
const splitAcrossBlocks: Command = (state, dispatch) => {
	const { $from, $to, empty } = state.selection;
	if (empty || $from.parent === $to.parent) return false;
	if (!dispatch) return true;
	const tr = state.tr.deleteSelection();
	splitBlock(state.apply(tr), (split) => {
		for (const step of split.steps) tr.step(step);
		tr.setSelection(Selection.fromJSON(tr.doc, split.selection.toJSON()));
	});
	dispatch(tr.scrollIntoView());
	return true;
};

/**
 * Delete on an empty textblock → take the line, whatever stands below moving up
 * whole and keeping what it is.
 *
 * The links below it leave the line standing: the base keymap joins the block below
 * into it — a list's first item lifted out to fill it, its marker gone — and the atom
 * link arms an island for the press after. Upstream takes the line only where the
 * sibling holds the same kind of content, so a heading below keeps its level where a
 * bullet loses its marker.
 *
 * Declines where the parent cannot spare the block: an empty item and an empty quote
 * are the whole of what holds them, and the key is whichever link answers a construct
 * with nothing in it. An empty fence is not that case — the doc spares it, and it
 * carries no text to lose. Declines with nothing after it too: a line with no next
 * line is Backspace's.
 */
const takeEmptyLine: Command = (state, dispatch) => {
	const { $from, empty } = state.selection;
	if (!empty || !$from.parent.isTextblock || $from.parent.content.size !== 0) return false;
	const index = $from.index(-1);
	if (!$from.node(-1).canReplace(index, index + 1)) return false;
	if (!Selection.findFrom(state.doc.resolve($from.after()), 1)) return false;
	dispatch?.(state.tr.delete($from.before(), $from.after()).scrollIntoView());
	return true;
};

/** The body-wide link of the leaf's key chains: `{}` for a schema with no paragraph
 *  to mint. Outermost of the structural links, being about the body, or about the
 *  caret's own line, rather than about the surface either stands in. */
export function blockKeymap(schema: Schema): Record<string, Command> {
	if (!schema.nodes.paragraph) return {};
	return {
		Enter: chainCommands(paragraphAtBodyStart, paragraphFromEmptyFence, splitAcrossBlocks),
		Delete: takeEmptyLine
	};
}
