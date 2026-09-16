// Code-block editing: the `code_block` link of the body's key chains.
// Tab takes literal indentation here rather than a structural edit, and Enter takes
// a newline, because a code block is text the author controls to the character:
// `whitespace: 'pre'`, `marks: ''` (`schema.ts`).
//
// Backspace and Delete are here for the edge rather than for the inside: a press that
// would join a fence with the prose block it stands against retypes the fence to a
// paragraph and joins nothing, from either side. They are the two keys this link binds
// from outside a code block, and they sit ahead of the list link like the rest, so a
// fence inside an item is answered by its own edge rather than by the item's merge.
//
// A code block's lines are not `Content` lines the codec addresses one by one: a
// fence decodes to one `code_block` whose text carries literal `\n`s, and encode
// spells it back as one `kind: 'code'` line plus a `continues: true` line per extra
// newline (`decode.ts`, `encode.ts`). So indent/outdent works on offsets inside a
// single text node, and the whole multi-line edit is one transaction: one undo step.
//
// The indent unit is a free choice: a literal tab and leading spaces both survive
// `importMarkdown` → the upstream normalizer → `decode` → `pmToContent` byte for
// byte, so nothing downstream re-indents either form. Spaces, because the stored
// text is what the preview typesets and a space's advance is renderer-independent;
// two of them, because a memo's typeset column is narrow. Outdent accepts both
// forms regardless: imported content carries whatever its author wrote.
import type { Node as PMNode, Schema } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { newlineInCode } from 'prosemirror-commands';

/** One indent level. */
const UNIT = '  ';

/** The enclosing code block's content start and text, or `null` when the selection
 * is not wholly inside one: a selection that escapes the block is a document-level
 * range, where the structural links keep their meaning. */
function codeBlockAt(state: EditorState): { start: number; text: string } | null {
	const { $from, $to } = state.selection;
	if (!$from.parent.type.spec.code) return null;
	if ($from.parent !== $to.parent) return null;
	return { start: $from.start(), text: $from.parent.textContent };
}

/**
 * Start offsets of the lines the range `[f, t)` covers, in document order.
 *
 * A line whose start is `t` is excluded on a non-empty range: a selection ending at
 * a line start does not reach into that line, the editor convention (else selecting
 * whole lines by dragging to the next line's start indents one line too many).
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

/** Width of the indent one outdent removes at line offset `s`: a leading tab, else
 * up to one unit of leading spaces (both forms, whatever Tab inserts). `0` when the
 * line carries no indent. */
function outdentWidth(text: string, s: number): number {
	if (text[s] === '\t') return 1;
	let n = 0;
	while (n < UNIT.length && text[s + n] === ' ') n++;
	return n;
}

/**
 * Tab in a code block: insert one indent unit, or indent every covered line when the
 * selection spans a newline. A single-line selection is replaced by the unit: Tab
 * types, the way any other key does.
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
 * Shift-Tab in a code block: remove one indent level from every covered line.
 *
 * Declines when no covered line carries an indent, so the key is not swallowed: it
 * falls through to the list link and, outside a list, on out of the leaf — the
 * body's keyboard exit from inside a code block (VISUAL_EDITOR §Chrome). Inside
 * a `list_item > code_block` the list link claims it and lifts the item out
 * (`tests/codec/code-keys.test.ts`), so a fence in an item has no keyboard exit in
 * either direction — Tab is a code block's whole point and takes the key
 * unconditionally. What a body's keyboard exit should be settles in the shell keymap
 * (VISUAL_EDITOR §Settled and open), not here.
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
 * The textblock the caret's own block stands directly against on `side`: its sibling
 * under one parent, which is the only neighbour a press joins the text of. `null` at a
 * container's edge, where the base keymap moves the whole block in or out rather than
 * joining anything, and so retypes nothing.
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
 * Backspace at a fence's head or Delete at its end, and the same two presses from the
 * block on the other side: retype the code block to a paragraph, and join nothing. The
 * press after that is an ordinary join between two prose blocks.
 *
 * The join itself retypes one side's whole text as the other's kind on one keystroke —
 * a fence's lines as prose, or a typed line as code — which is the destruction
 * `atoms.ts` refuses for a neighbouring island, with nothing drawn first to say what is
 * about to go. This is `toCodeBlock`'s inverse in its place (`blocks.ts`), and it takes
 * no text with it: `linebreakReplacement` carries the fence's newlines across as breaks
 * (`schema.ts`). The caret stays in the block it was in.
 *
 * Declines where both sides are code and where neither is: those joins retype nothing.
 * An empty block on either side never reaches this at all: the block link takes the
 * empty line ahead of the chain (`blocks.ts`), and there is no text to retype.
 */
function retypeAtProseEdge(side: -1 | 1): Command {
	return (state, dispatch) => {
		const paragraph = state.schema.nodes.paragraph;
		const edge = blockAgainst(state, side);
		if (!paragraph || !edge) return false;
		const { $from } = state.selection;
		const inside = !!$from.parent.type.spec.code;
		if (inside === !!edge.node.type.spec.code) return false;
		const at = inside ? $from.pos : edge.pos + 1;
		dispatch?.(state.tr.setBlockType(at, at, paragraph).scrollIntoView());
		return true;
	};
}

/**
 * The `code_block` link of the body's key chains: `{}` for the inline/plaintext
 * schemas, which declare no code node.
 *
 * `Enter` is upstream's `newlineInCode`, and it is load-bearing rather than
 * cosmetic: inside a `list_item > code_block` the list link's `splitListItem`
 * otherwise splits the item in two, each half holding a code block. `Shift-Enter` is
 * the same command because it is the same edit: the line break the key means
 * everywhere else (`breaks.ts`) is, inside a fence, the newline Enter already takes.
 * Every command here declines away from a code block — inside one for the four keys
 * about its text, against one for the two about its edge — so the list links keep the
 * keys elsewhere.
 */
export function codeKeymap(schema: Schema): Record<string, Command> {
	if (!schema.nodes.code_block) return {};
	return {
		Tab: indentInCode,
		'Shift-Tab': outdentInCode,
		Enter: newlineInCode,
		'Shift-Enter': newlineInCode,
		Backspace: retypeAtProseEdge(-1),
		Delete: retypeAtProseEdge(1)
	};
}
