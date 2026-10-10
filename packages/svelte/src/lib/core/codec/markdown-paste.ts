// Markdown on the clipboard as text lands parsed in a block leaf (CODEC §"Markdown at the
// edges"). A line opening a block is the shape a draft written in Notepad or copied out of
// an LLM chat carries, and text holding one runs through `importMarkdown` and `decode`, so
// the paste stores what the source editor stores of the same text. Text holding none stays
// literal: a sentence with a dash in it, or a `**` with no block around it, keeps every
// character.
import { Slice } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { EditorProps } from 'prosemirror-view';
import type { Content } from '@quillmark/wasm';
import { core } from '../lifecycle.js';
import { decode } from './decode.js';
import { blockSchema } from './schema.js';

/** A line opening a block markdown spells and prose does not: a bullet or an ordered item at
 *  any indent, and within CommonMark's three spaces an ATX heading, a quote, a fence, or a
 *  pipe table's delimiter row. */
const BLOCK_HEAD = new RegExp(
	[
		String.raw`^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]`,
		String.raw`^ {0,3}(?:#{1,6}|>)(?:[ \t]|$)`,
		'^ {0,3}(?:```|~~~)',
		String.raw`^ {0,3}(?=[^\n]*\|)\|?(?:[ \t]*:?-+:?[ \t]*\|)*[ \t]*:?-+:?[ \t]*\|?[ \t]*$`
	].join('|'),
	'm'
);

/**
 * A block leaf's markdown paste, consulted after the table paste: ProseMirror hands text
 * over only where the clipboard holds no HTML, whose DOM parse reads the source's own
 * structure, so HTML wins. A paste as plain text keeps the text. An island the parse
 * builds arrives under the id `importMarkdown` minted, which the paste's island pass
 * re-mints where the field holds it (`islands.ts`).
 */
export function markdownPastePlugin(): Plugin {
	return new Plugin({
		props: {
			// A falsy return declines, handing the text to ProseMirror's own split into
			// paragraphs; the prop's type has no spelling for it.
			clipboardTextParser: ((text, _context, plain) => {
				if (plain || !BLOCK_HEAD.test(text)) return null;
				const { importMarkdown } = core();
				let rt: Content;
				try {
					rt = importMarkdown(text);
				} catch {
					// Nesting past the store's depth is refused; the literal text holds it.
					return null;
				}
				return new Slice(decode(rt, blockSchema).content, 0, 0);
			}) as EditorProps['clipboardTextParser']
		}
	});
}
