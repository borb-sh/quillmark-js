// Code-block editing: the `code_block` link of the body's key chains. Tab takes literal indentation
// and Enter a newline, because a code block is text the author controls to the character:
// `whitespace: 'pre'`, `marks: ''` (`schema.ts`).
//
// Backspace and Delete are here for the edge: a press that would join a fence with the prose block
// it stands against edits only the block the caret is in. From inside the fence it retypes the
// fence to a paragraph; from the prose side the caret steps into the fence. They sit ahead of the
// list link, so a fence inside an item is answered by its own edge.
//
// A fence decodes to one `code_block` whose text carries literal `\n`s (`decode.ts`, `encode.ts`),
// so indent/outdent works on offsets inside a single text node, and the whole multi-line edit is
// one transaction and one undo step.
//
// The indent unit is two spaces: a tab and leading spaces both survive the round-trip byte for
// byte, a space's advance is renderer-independent in the preview, and a memo's typeset column is
// narrow. Outdent accepts both forms, since imported content carries whatever its author wrote.
import type { Node as PMNode, Schema } from 'prosemirror-model';
import { Selection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { newlineInCode } from 'prosemirror-commands';

/** One indent level. */
const UNIT = '  ';

/**
 * The enclosing code block's content start and text, or `null` when the selection is not wholly
 * inside one: a selection that escapes is a document-level range, where the structural links keep
 * their meaning.
 */
function codeBlockAt(state: EditorState): { start: number; text: string } | null {
	const { $from, $to } = state.selection;
	if (!$from.parent.type.spec.code) return null;
	if ($from.parent !== $to.parent) return null;
	return { start: $from.start(), text: $from.parent.textContent };
}

/**
 * Start offsets of the lines the range `[f, t)` covers. A line whose start is `t` is excluded on a
 * non-empty range, so dragging to the next line's start does not indent one line too many.
 */
function coveredLineStarts(text: string, f: number, t: number): number[] {
	const last = t > f ? t - 1 : t;
	const starts: number[] = [];
	let s = 0;
	for (const line of text.split('\n')) {
		if (s <= last && s + line.length >= f) starts.push(s);
		s += line.length + 1;
	}
	return starts;
}

/**
 * Width of the indent one outdent removes at line offset `s`: a leading tab, else up to one unit of
 * leading spaces; `0` if none.
 */
function outdentWidth(text: string, s: number): number {
	if (text[s] === '\t') return 1;
	let n = 0;
	while (n < UNIT.length && text[s + n] === ' ') n++;
	return n;
}

/**
 * Tab in a code block: insert one indent unit, or indent every covered line when the selection
 * spans a newline. A single-line selection is replaced by the unit, as any key types.
 */
const indentInCode: Command = (state, dispatch) => {
	const block = codeBlockAt(state);
	if (!block) return false;
	const { from, to } = state.selection;
	const f = from - block.start;
	const t = to - block.start;
	if (!dispatch) return true;
	const tr = state.tr;
	if (!block.text.slice(f, t).includes('\n')) {
		tr.insertText(UNIT, from, to);
	} else {
		const starts = coveredLineStarts(block.text, f, t);
		// Back to front: an earlier insert would shift every later offset.
		for (const s of [...starts].reverse()) tr.insertText(UNIT, block.start + s);
		// Keep the covered lines covered. Mapping alone would push the head past
		// the indent it just inserted at the first line's start.
		tr.setSelection(TextSelection.create(tr.doc, block.start + starts[0], tr.mapping.map(to)));
	}
	dispatch(tr.scrollIntoView());
	return true;
};

/**
 * Shift-Tab in a code block: remove one indent level from every covered line. Declines when none
 * carries an indent, so the key falls through to the list link (lifting a `list_item > code_block`
 * out of the item; `tests/codec/code-keys.test.ts`) or the body (`keymap.ts`).
 */
const outdentInCode: Command = (state, dispatch) => {
	const block = codeBlockAt(state);
	if (!block) return false;
	const { from, to } = state.selection;
	const cuts = coveredLineStarts(block.text, from - block.start, to - block.start)
		.map((s) => ({ s, width: outdentWidth(block.text, s) }))
		.filter((c) => c.width > 0);
	if (!cuts.length) return false;
	if (dispatch) {
		const tr = state.tr;
		for (const c of cuts.reverse()) {
			tr.delete(block.start + c.s, block.start + c.s + c.width);
		}
		dispatch(tr.scrollIntoView());
	}
	return true;
};

/**
 * The textblock the caret's block stands directly against on `side`: its sibling under one parent,
 * the only neighbour a press joins text with. `null` at a container's edge, where the base keymap
 * moves the whole block instead.
 */
function blockAgainst(state: EditorState, side: -1 | 1): { node: PMNode; pos: number } | null {
	const { $from, empty } = state.selection;
	if (!empty || !$from.parent.isTextblock) return null;
	if ($from.parentOffset !== (side < 0 ? 0 : $from.parent.content.size)) return null;
	const $edge = state.doc.resolve(side < 0 ? $from.before() : $from.after());
	const node = side < 0 ? $edge.nodeBefore : $edge.nodeAfter;
	if (!node?.isTextblock) return null;
	return { node, pos: side < 0 ? $edge.pos - node.nodeSize : $edge.pos };
}

/**
 * Backspace or Delete at a fence's edge, from either side, edits only the block the caret is in.
 *
 * Inside the fence, a press at its head or end retypes it to a paragraph and joins nothing
 * (`toCodeBlock`'s inverse, `blocks.ts`); `linebreakReplacement` carries the newlines across as
 * breaks (`schema.ts`). The press after is an ordinary prose join.
 *
 * From the prose block against it, the caret steps into the fence at the end it faces and the fence
 * is left as it is: a join would retype one side's text as the other's kind. An empty line under a
 * fence goes with the step.
 *
 * Declines where both sides are code and where neither is: those joins retype nothing.
 */
function atProseEdge(side: -1 | 1): Command {
	return (state, dispatch) => {
		const paragraph = state.schema.nodes.paragraph;
		const edge = blockAgainst(state, side);
		if (!paragraph || !edge) return false;
		const { $from } = state.selection;
		const inside = !!$from.parent.type.spec.code;
		if (inside === !!edge.node.type.spec.code) return false;
		if (inside) {
			dispatch?.(state.tr.setBlockType($from.pos, $from.pos, paragraph).scrollIntoView());
			return true;
		}
		const tr = state.tr;
		const index = $from.index(-1);
		if (side < 0 && $from.parent.content.size === 0 && $from.node(-1).canReplace(index, index + 1))
			tr.delete($from.before(), $from.after());
		const into = side < 0 ? edge.pos + edge.node.nodeSize - 1 : edge.pos + 1;
		dispatch?.(tr.setSelection(TextSelection.create(tr.doc, into)).scrollIntoView());
		return true;
	};
}

/**
 * ↓ on the last line of a fence nothing follows → a paragraph after it, the caret there: a gap
 * cursor will not sit beside a fence.
 */
const belowFinalFence: Command = (state, dispatch) => {
	const paragraph = state.schema.nodes.paragraph;
	const { $from, empty } = state.selection;
	if (!paragraph || !empty || !$from.parent.type.spec.code) return false;
	if ($from.parent.textBetween($from.parentOffset, $from.parent.content.size).includes('\n'))
		return false;
	const $after = state.doc.resolve($from.after());
	if (Selection.findFrom($after, 1)) return false;
	if (!$after.parent.canReplaceWith($after.index(), $after.index(), paragraph)) return false;
	if (dispatch) {
		const tr = state.tr.insert($after.pos, paragraph.create());
		dispatch(tr.setSelection(TextSelection.create(tr.doc, $after.pos + 1)).scrollIntoView());
	}
	return true;
};

/**
 * The `code_block` link of the body's key chains: `{}` for the one-line and plain schemas, which
 * declare no code node.
 *
 * `Enter` is upstream's `newlineInCode`, load-bearing: inside a `list_item > code_block` the list
 * link's `splitListItem` would otherwise split the item in two. `Shift-Enter` is the same command:
 * the line break the key means elsewhere (`breaks.ts`) is, inside a fence, the newline Enter takes.
 * Every command here declines away from a code block (inside it for the text and last-line keys,
 * against it for the two edge keys), leaving the list links the keys elsewhere.
 */
export function codeKeymap(schema: Schema): Record<string, Command> {
	if (!schema.nodes.code_block) return {};
	return {
		Tab: indentInCode,
		'Shift-Tab': outdentInCode,
		Enter: newlineInCode,
		'Shift-Enter': newlineInCode,
		Backspace: atProseEdge(-1),
		Delete: atProseEdge(1),
		ArrowDown: belowFinalFence
	};
}
