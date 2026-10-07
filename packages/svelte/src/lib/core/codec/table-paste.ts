// A table on the clipboard lands as a table island (CODEC §"Markdown at the edges"). Two
// spellings carry one: an HTML `<table>`, and the tab-separated text a spreadsheet writes
// beside it, which ProseMirror hands over only where the clipboard holds no HTML. Either
// builds its props through `normalizeTable` and arrives with no id, which the paste's
// island pass mints (`islands.ts`). Nothing the source styled a table with has a reader
// here, so a pasted table takes the document's face.
import { DOMParser, Fragment, Slice } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { EditorProps } from 'prosemirror-view';
import type { TableCell, TableProps } from '@quillmark/wasm';
import { usvLength } from './decode.js';
import { pmToContent } from './encode.js';
import { blockSchema } from './schema.js';
import { emptyCell, normalizeTable } from './table.js';

const schemaRules = DOMParser.fromSchema(blockSchema).rules;

/** What a cell's markup is read with: the schema's rules less the islands', so an island
 *  element inside a cell is the text it holds. */
const cellParser = new DOMParser(
	blockSchema,
	schemaRules.filter((rule) => !('node' in rule && rule.node?.startsWith('island_')))
);

/** A `<td>` or `<th>` as a cell: its blocks are lines and a `<br>` a break, each one `\n`
 *  in the text (`cellContent`), and its marks the ones the schema's rules read. Whitespace
 *  at the cell's edges is dropped, which is where a source's empty paragraph lands. */
function cellFromDOM(el: HTMLElement): TableCell {
	const { text, marks } = pmToContent(cellParser.parse(el));
	// Every whitespace character is in the BMP, so `lead` counts USVs as well.
	const lead = text.length - text.trimStart().length;
	const kept = text.trim();
	const end = usvLength(kept);
	return {
		text: kept,
		marks: marks.flatMap((m) => {
			const start = Math.max(0, m.start - lead);
			const stop = Math.min(end, m.end - lead);
			return start < stop ? [{ ...m, start, end: stop }] : [];
		})
	};
}

/**
 * A `<table>` as table props, or `null` where it holds no cell. Rows run in the order the
 * DOM's `rows` gives them, a `<thead>`'s first, and the first is the header. A merged
 * cell splits: its content in the first slot it covers and an empty cell in each other,
 * so the cells beside and under it keep their columns.
 */
function tableFromDOM(table: HTMLTableElement): TableProps | null {
	const rows = Array.from(table.rows);
	const grid: TableCell[][] = rows.map(() => []);
	rows.forEach((tr, r) => {
		let c = 0;
		for (const td of Array.from(tr.cells)) {
			while (grid[r][c]) c++;
			const across = Math.max(1, td.colSpan);
			const down = Math.min(td.rowSpan || rows.length, rows.length - r);
			for (let dr = 0; dr < down; dr++)
				for (let dc = 0; dc < across; dc++)
					grid[r + dr][c + dc] = dr || dc ? emptyCell() : cellFromDOM(td);
			c += across;
		}
	});
	if (!grid.some((row) => row.length)) return null;
	// A row a merge reached into past its own cells has holes.
	const [header = [], ...body] = grid.map((row) => Array.from(row, (cell) => cell ?? emptyCell()));
	return normalizeTable({ header, rows: body, aligns: [] });
}

const QUOTED = /"((?:[^"]|"")*)"(?=[\t\r\n]|$)/y;
const BARE = /[^\t\r\n]*/y;

/**
 * Tab-separated text as table props, the first line the header, or `null` unless every
 * line holds a tab and some cell holds more than whitespace. A cell in double quotes is
 * one cell whose tabs, line ends and doubled quotes are its text, which is how Excel and
 * Sheets write a cell holding any of the three; a quote not closed that way is literal.
 * The line ends closing the text are the spreadsheet's terminator, not an empty row.
 */
function tableFromText(text: string): TableProps | null {
	const body = text.replace(/[\r\n]+$/, '');
	const lines: string[][] = [[]];
	let at = 0;
	for (;;) {
		QUOTED.lastIndex = BARE.lastIndex = at;
		const quoted = QUOTED.exec(body);
		const cell = quoted
			? quoted[1].replace(/""/g, '"').replace(/\r\n?/g, '\n')
			: BARE.exec(body)![0];
		lines.at(-1)!.push(cell);
		at = quoted ? QUOTED.lastIndex : BARE.lastIndex;
		if (at >= body.length) break;
		if (body[at] === '\t') at += 1;
		else {
			at += body.startsWith('\r\n', at) ? 2 : 1;
			lines.push([]);
		}
	}
	if (!lines.every((cells) => cells.length > 1)) return null;
	if (!lines.some((cells) => cells.some((cell) => cell.trim()))) return null;
	const [header = [], ...rows] = lines.map((cells) => cells.map((t) => ({ text: t, marks: [] })));
	return normalizeTable({ header, rows, aligns: [] });
}

/** The schema's parse with a `<table>` read as an island rather than as its cells' text. */
const clipboardParser = new DOMParser(blockSchema, [
	{
		tag: 'table',
		node: 'island_block',
		getAttrs: (el) => {
			const props = tableFromDOM(el as HTMLTableElement);
			return props ? { islandType: 'table', props } : false;
		}
	},
	...schemaRules
]);

/**
 * A block leaf's table paste: the clipboard's parse for HTML, and for text that is
 * tab-separated. A paste as plain text keeps the text, tabs and all. A cell's own view
 * mounts none of this, so a paste inside a cell is inline.
 */
export function tablePastePlugin(): Plugin {
	return new Plugin({
		props: {
			clipboardParser,
			// A falsy return declines, handing the text to ProseMirror's own split into
			// paragraphs; the prop's type has no spelling for it.
			clipboardTextParser: ((text, _context, plain) => {
				const props = plain ? null : tableFromText(text);
				if (!props) return null;
				const island = blockSchema.nodes.island_block.create({ islandType: 'table', props });
				return new Slice(Fragment.from(island), 0, 0);
			}) as EditorProps['clipboardTextParser']
		}
	});
}
