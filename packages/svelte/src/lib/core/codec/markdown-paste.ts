// Markdown on the clipboard as text lands parsed in a block leaf (CODEC §"Markdown at the
// edges"). A line opening a block is the shape a draft written in Notepad or copied out of
// an LLM chat carries, and text holding one runs through `importMarkdown` and `decode`, so
// the paste stores what the source editor stores of the same text. Text holding none stays
// literal: a sentence with a dash in it, or a `**` with no block around it, keeps every
// character.
//
// A list typed in an email or a memo draft marks its items with what markdown does not
// spell: a bullet character, a letter, a number in parentheses. Those lines are items too,
// nested by the outline the memo writes them in (`1.`, `a.`, `(1)`, `(a)`): each kind of
// marker is a level, the first line of a kind opening one under the level above.
import { Slice } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { EditorProps } from 'prosemirror-view';
import type { Content } from '@quillmark/wasm';
import { core } from '../lifecycle.js';
import { decode, fitsLeaf } from './decode.js';
import { blockSchema } from './schema.js';

/** A line opening an item: its indent, then the marker as markdown spells one (`-`, `*`,
 *  `+`, `1.`, `1)`), or as a plain-text list does (`•` and the bullet characters word
 *  processors write as text, a lowercase letter closed by `.` or `)`, and a number or a
 *  lowercase letter in parentheses). A capital is a name's initial as often as a marker,
 *  so `J. Doe` is not an item. */
const ITEM =
	/^([ \t]*)(?:([-*+])|(\d{1,9})[.)]|([•◦▪▫‣⁃●○■□·])|([a-z])[.)]|\((\d{1,9})\)|\(([a-z])\))[ \t]+(?=\S)/;

/** The markers plain text writes and markdown does not. */
const LOOSE_ITEM = /^[ \t]*(?:[•◦▪▫‣⁃●○■□·]|[a-z][.)]|\((?:\d{1,9}|[a-z])\))[ \t]+\S/m;

/** A line opening a block markdown spells and prose does not: a bullet or an ordered item at
 *  any indent, and within CommonMark's three spaces an ATX heading, a quote, a fence, or a
 *  pipe table's delimiter row; or an item a plain-text list marks. */
const BLOCK_HEAD = new RegExp(
	[
		String.raw`^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]`,
		LOOSE_ITEM.source,
		String.raw`^ {0,3}(?:#{1,6}|>)(?:[ \t]|$)`,
		'^ {0,3}(?:```|~~~)',
		String.raw`^ {0,3}(?=[^\n]*\|)\|?(?:[ \t]*:?-+:?[ \t]*\|)*[ \t]*:?-+:?[ \t]*\|?[ \t]*$`
	].join('|'),
	'm'
);

/** An item line's level: the kind of marker it opens with (a bullet's own character, or
 *  which group of `ITEM` matched), at the indent it stands. */
type Level = { kind: string; indent: number; width: number };

/**
 * `text` with every item line spelled as markdown, where some line marks its item as
 * markdown does not; otherwise `text` as it stands. A line's level is the open one of its
 * kind at its indent, give or take a column, the levels below it closing; a marker no open
 * level holds opens one beneath the deepest. Markdown nests by indent alone, so each line
 * is indented past the markers of the levels above it. A letter's ordinal is its place in
 * the alphabet. Lines in a fence and lines opening no item stand as they are.
 */
export function plainTextList(text: string): string {
	if (!LOOSE_ITEM.test(text)) return text;
	const levels: Level[] = [];
	let fence = false;
	let prev = '';
	return text
		.split(/\r\n?|\n/)
		.map((line) => {
			const above = prev;
			prev = line;
			if (/^ {0,3}(?:```|~~~)/.test(line)) fence = !fence;
			const m = fence ? null : ITEM.exec(line);
			if (!m) return line;
			const [head, lead, dash, num, bullet, alpha, pnum, palpha] = m;
			const indent = lead!.replace(/\t/g, '    ').length;
			const kind = dash ?? bullet ?? String(m.slice(2).findIndex(Boolean));
			const letter = alpha ?? palpha;
			const ordinal = letter ? letter.charCodeAt(0) - 96 : Number(num ?? pnum);
			const marker = dash || bullet ? '- ' : `${ordinal}. `;
			let depth = levels.findLastIndex((l) => l.kind === kind && Math.abs(l.indent - indent) <= 1);
			const opens = depth < 0;
			if (opens) {
				while (levels.length && levels.at(-1)!.indent > indent + 1) levels.pop();
				depth = levels.length;
			}
			levels.length = depth;
			levels.push({ kind, indent, width: marker.length });
			const pad = levels.slice(0, depth).reduce((sum, l) => sum + l.width, 0);
			// Only a list counting from 1 interrupts the line above it; a blank line lets
			// any other open where it stands.
			const gap = opens && ordinal !== 1 && marker !== '- ' && above.trim() ? '\n' : '';
			return gap + ' '.repeat(pad) + marker + line.slice(head.length);
		})
		.join('\n');
}

/**
 * A block leaf's markdown paste, consulted after the table paste: ProseMirror hands text
 * over only where the clipboard holds no HTML, whose DOM parse reads the source's own
 * structure, so HTML wins. A paste as plain text keeps the text, and so does a parse
 * building a construct no leaf edits (`fitsLeaf`). An island the parse builds arrives
 * under the id `importMarkdown` minted, which the paste's island pass re-mints where the
 * field holds it (`islands.ts`).
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
					rt = importMarkdown(plainTextList(text)).content;
				} catch {
					// Nesting past the store's depth is refused; the literal text holds it.
					return null;
				}
				if (!fitsLeaf(rt, { inline: false, plaintext: false, islands: true })) return null;
				return new Slice(decode(rt, blockSchema).content, 0, 0);
			}) as EditorProps['clipboardTextParser']
		}
	});
}
