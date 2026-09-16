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
import type { Node as PMNode, Schema } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
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
