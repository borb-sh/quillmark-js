// A table leaves the editor as the two spellings a table arrives in (`table-paste.ts`):
// an HTML `<table>` and tab-separated text, what Word, Docs, Excel and Sheets each read.
// Two copies write them: a held rectangle's cells (`table-view.ts`), and a selection
// holding a whole island, whose markup keeps the island's own element around the table
// so a paste inside the editor reads the island back whole.
import { DOMSerializer, type Node as PMNode, type Slice } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { TableCell, TableProps } from '@quillmark/wasm';
import { decode } from './decode.js';
import { tablePropsOfNode } from './islands.js';
import { blockSchema, cellSchema } from './schema.js';
import {
	anchorAt,
	cellAt,
	cellContent,
	columnCount,
	headRows,
	rowCount,
	spanGrid
} from './table.js';

/** A block of cells, both corners inclusive, in the row space `table.ts` names. */
export interface CellRange {
	r0: number;
	c0: number;
	r1: number;
	c1: number;
}

const whole = (props: TableProps): CellRange => ({
	r0: 0,
	c0: 0,
	r1: rowCount(props) - 1,
	c1: columnCount(props) - 1
});

const cellSerializer = DOMSerializer.fromSchema(cellSchema);

function cellDOM(tag: 'th' | 'td', cell: TableCell): HTMLElement {
	const dom = document.createElement(tag);
	const paragraph = decode(cellContent(cell), cellSchema).firstChild;
	if (paragraph) dom.append(cellSerializer.serializeFragment(paragraph.content));
	return dom;
}

/** The cells of `range` as a `<table>`, the header rows in a `<thead>` where the range
 *  holds them. The cells carry their marks, breaks and spans, a span cut to the range,
 *  and nothing else of the table's layout. A slot a merged cell in the range covers
 *  draws nothing; one whose cell starts outside the range draws empty. */
export function tableElement(props: TableProps, range = whole(props)): HTMLTableElement {
	const table = document.createElement('table');
	const grid = spanGrid(props);
	let body: HTMLTableSectionElement | undefined;
	for (let r = range.r0; r <= range.r1; r++) {
		const head = r < headRows(props);
		const section = head ? table.createTHead() : (body ??= table.createTBody());
		const tr = section.insertRow();
		for (let c = range.c0; c <= range.c1; c++) {
			const tag = head ? 'th' : 'td';
			const at = anchorAt(grid, r, c);
			if (at.r < range.r0 || at.c < range.c0) {
				tr.append(cellDOM(tag, { text: '', marks: [] }));
				continue;
			}
			if (at.r !== r || at.c !== c) continue;
			const dom = cellDOM(tag, cellAt(props, r, c));
			const colspan = Math.min(at.span.colspan, range.c1 - c + 1);
			const rowspan = Math.min(at.span.rowspan, range.r1 - r + 1);
			if (colspan > 1) dom.setAttribute('colspan', String(colspan));
			if (rowspan > 1) dom.setAttribute('rowspan', String(rowspan));
			tr.append(dom);
		}
	}
	return table;
}

/** A cell holding a tab, a line end or a quote goes in quotes with its quotes doubled,
 *  as Excel and Sheets write one. */
function tsvCell(text: string): string {
	return /[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The cells of `range` as tab-separated text, a line a row. */
export function tableText(props: TableProps, range = whole(props)): string {
	const lines: string[] = [];
	for (let r = range.r0; r <= range.r1; r++) {
		const cells: string[] = [];
		for (let c = range.c0; c <= range.c1; c++) cells.push(tsvCell(cellAt(props, r, c).text));
		lines.push(cells.join('\t'));
	}
	return lines.join('\n');
}

const base = DOMSerializer.fromSchema(blockSchema);

/** The island's own element with the table inside it: a paste in the editor matches the
 *  element and reads `props`, and every other reader finds the table. */
const islandSerializer = new DOMSerializer(
	{
		...base.nodes,
		island_block: (node) => {
			const props = tablePropsOfNode(node);
			const dom = DOMSerializer.renderSpec(
				document,
				blockSchema.nodes.island_block.spec.toDOM!(node)
			).dom;
			if (props) dom.replaceChildren(tableElement(props));
			return dom;
		}
	},
	base.marks
);

function leafText(node: PMNode): string {
	const props = node.type === blockSchema.nodes.island_block ? tablePropsOfNode(node) : undefined;
	if (props) return tableText(props);
	return node.type.spec.leafText?.(node) ?? '';
}

/** A block leaf's copy: a table in the slice writes as a table in both spellings. */
export function tableCopyPlugin(): Plugin {
	return new Plugin({
		props: {
			clipboardSerializer: islandSerializer,
			clipboardTextSerializer: (slice: Slice) =>
				slice.content.textBetween(0, slice.content.size, '\n\n', leafText)
		}
	});
}
