// A within-block line break is a `hard_break`, in every document the leaf holds — and a
// space in a block that holds none.
//
// `paragraph` is `inline*` (`schema.ts`), so the schema admits a text node carrying a
// `\n`, and a range spanning a fence's edge leaves one: the fit that merges the two
// textblocks runs no `clearIncompatible` pass, so the fence's text arrives above with
// its newlines intact. The store reads one as the line boundary it is (`encode.ts`
// §`scanInline`) and the preview draws it, while the leaf's own DOM collapses it to a
// space and the next re-hydrate swaps in the break `decode` produces. A heading takes
// no break (`schema.ts` §`takesLineBreak`), and the space is what its own DOM was
// already drawing.
//
// One spelling, held over the document rather than at each command that can open one,
// so a paste and a drop are covered alongside the keys.
//
// Shift-Enter is the one gesture that is *about* opening a break, and it binds here
// rather than beside the block shapes: a break is inline, and the key that mints one
// belongs with the pass that normalizes every other route to one.
import type { Node as PMNode, Schema } from 'prosemirror-model';
import { Plugin, TextSelection, type Command } from 'prosemirror-state';
import { takesLineBreak } from './schema.js';

/**
 * Rewrite every `\n` a transaction leaves in a non-`code` textblock: to a `hard_break`
 * where the block takes one, to a space where it does not.
 *
 * Reads the schema rather than a flag: the inline schemas declare neither node, and
 * nothing puts a `\n` in one — a paste parses its whitespace away and the keys type
 * characters.
 */
export function linebreakPlugin(schema: Schema): Plugin {
	const br = schema.nodes.hard_break;
	return new Plugin({
		appendTransaction(trs, _before, state) {
			if (!br || !trs.some((tr) => tr.docChanged)) return null;
			const at: { pos: number; fill: PMNode }[] = [];
			state.doc.descendants((node, pos, parent) => {
				// A code block's newlines are its content (`whitespace: 'pre'`).
				if (node.type.spec.code) return false;
				if (!node.isText || !parent) return true;
				// A space carries the marks the `\n` it stands in for was under, the way
				// PM's own `clearIncompatible` fills one: without them a bolded break
				// leaves an unbolded space, and one mark becomes two in the store.
				const fill = takesLineBreak(parent.type)
					? br.create()
					: schema.text(' ', parent.type.allowedMarks(node.marks));
				const text = node.text ?? '';
				for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1))
					at.push({ pos: pos + i, fill });
				return true;
			});
			if (!at.length) return null;
			// A break, a space and the `\n` either replaces are all one position wide, so
			// an earlier replacement leaves every later one addressed.
			const tr = state.tr;
			for (const it of at) tr.replaceWith(it.pos, it.pos + 1, it.fill);
			return tr;
		}
	});
}

/**
 * Shift-Enter: a line break inside the caret's own block — the `continues` line a hard
 * break is, never a second block.
 *
 * A selection that is not a text range is swallowed outright: an island is the subject of
 * the next command, never a thing armed for replacement (`atoms.ts`). Otherwise the
 * caret's own block decides. It **declines** in a code block, where the newline Enter
 * takes already *is* that line and the code link binds the key one surface in
 * (`code.ts`); it **swallows** the key where the block holds no break (`takesLineBreak`),
 * a heading being the one of those; everywhere else it inserts the break.
 *
 * **Swallowing is the guard, not a spelling of declining.** A key the leaf declines is
 * the browser's, a contenteditable answers this one with a `<br>`, and a heading that
 * merely declined would take the space a `<br>` parses to.
 *
 * The break takes no marks and the caret keeps them: `decode` mints an unmarked break,
 * so an inherited mark would leave the leaf holding a shape a re-hydrate swaps out
 * (CODEC §Encode, one spelling of each shape), while dropping the marks from the
 * *caret* would end a bold run at a line break the author only meant to wrap at.
 */
function insertBreak(schema: Schema): Command {
	const br = schema.nodes.hard_break;
	return (state, dispatch) => {
		if (!(state.selection instanceof TextSelection)) return true;
		const { parent } = state.selection.$from;
		if (parent.type.spec.code) return false;
		if (!takesLineBreak(parent.type)) return true;
		if (dispatch) {
			const marks = state.storedMarks ?? state.selection.$from.marks();
			dispatch(
				state.tr.replaceSelectionWith(br.create(), false).setStoredMarks(marks).scrollIntoView()
			);
		}
		return true;
	};
}

/**
 * The line-break link of the body's key chains: `{}` for the inline schemas, which
 * declare no break node. A `richtext(inline)` field is one line by construction
 * (`Content::is_inline`), so there the key is swallowed beside Enter (`field.ts`)
 * rather than answered here.
 */
export function breakKeymap(schema: Schema): Record<string, Command> {
	if (!schema.nodes.hard_break) return {};
	return { 'Shift-Enter': insertBreak(schema) };
}
