// The table island's model: the cell codec (a `TableCell` ↔ one inline-schema PM
// doc) and the rectangularizing constructors every row and column op goes through
// (CODEC §Islands, §"The table island").
//
// `TableProps` normalizes to one column count shared by `header`, every row, `aligns`
// and `widths`, so a ragged table is not a state the content can hold. The editor keeps
// its optimistic PM and re-hydrates only on an external change (CODEC
// §Reconciliation), so an op that emitted a ragged table would leave the store
// rectangularized and PM ragged with no error channel and no repair. Every
// constructor here therefore ends in {@link normalizeTable}, and a caller reaches
// the shape only through them.
//
// A cell is its own content unit: `marks` are USV offsets into that cell's `text`,
// not into `Content.text`. That is the second coordinate space, and a cell is one
// paragraph with no containers and no islands, a `\n` in its text being a hard break,
// so it decodes and projects through the machinery a field does (`cellSchema`).
import type { Content, TableCell, TableProps } from '@quillmark/wasm';
import type { Node as PMNode } from 'prosemirror-model';
import { core } from '../lifecycle.js';
import { usvLength } from './decode.js';
import { contentEdit, pmToContent } from './encode.js';
import { valueEqual } from './reconcile.js';

/** One column's alignment, read off the boundary rather than restated. */
export type TableAlign = TableProps['aligns'][number];

/** The alignments a column can take: the four the content declares, `none` first
 *  because it is what a column arrives at and what a set is cleared back to. */
export const ALIGNS: readonly TableAlign[] = ['none', 'left', 'center', 'right'];

/** The zero cell: empty text, no marks. */
export function emptyCell(): TableCell {
	return { text: '', marks: [] };
}

/**
 * The row index space the chrome and the ops share: **0 is the header**, 1…n the body
 * rows. The split is how a table is stored, not a rank the ops answer to: a row op
 * works {@link allRows} and whichever row lands at index 0 is the header afterwards,
 * so index 0 moves and deletes like any other. The one row the model refuses is the
 * last, there being no table under it.
 */
export function rowCount(props: TableProps): number {
	return props.rows.length + 1;
}

/** The cells of row `r` in that space. */
export function rowCells(props: TableProps, r: number): TableCell[] {
	return r === 0 ? props.header : (props.rows[r - 1] ?? []);
}

/** Whether a row holds no text, which is what tells a row on offer from one taken up
 *  (`table-view.ts` §`step`). Text alone: a mark over none is nothing a writer can see. */
export function rowEmpty(props: TableProps, r: number): boolean {
	return rowCells(props, r).every((cell) => cell.text === '');
}

/** The cell at `(row, column)`, or the zero cell where the rectangle does not reach. */
export function cellAt(props: TableProps, r: number, c: number): TableCell {
	return rowCells(props, r)[c] ?? emptyCell();
}

/** The table's column count: the one number `header`, every row and `aligns` share. */
export function columnCount(props: TableProps): number {
	return props.aligns.length;
}

/**
 * The rectangularizing constructor: one column count across `header`, every row,
 * `aligns` and `widths`, padding with empty cells, `none` and auto-fit. The column
 * count is the widest thing present, so a caller that appended to one axis alone still
 * gets a rectangle back, and a table is never narrower than one column. The layout
 * keys ride through, each absent at its default as the store writes it.
 */
export function normalizeTable(props: TableProps): TableProps {
	const cols = Math.max(
		1,
		props.header.length,
		props.aligns.length,
		...props.rows.map((row) => row.length)
	);
	const fit = (cells: TableCell[]): TableCell[] =>
		Array.from({ length: cols }, (_, c) => cells[c] ?? emptyCell());
	const widths = Array.from({ length: cols }, (_, c) => props.widths?.[c] ?? null);
	const [header = [], ...rows] = settleSpans(
		[fit(props.header), ...props.rows.map(fit)],
		props.head
	);
	return {
		header,
		rows,
		aligns: Array.from({ length: cols }, (_, c) => props.aligns[c] ?? 'none'),
		...(widths.some((w) => w !== null) && { widths }),
		...(props.align && { align: props.align }),
		...(props.head !== undefined && props.head !== 1 && { head: props.head })
	};
}

/** How many rows from the top draw as header rows, absent being one. */
export function headRows(props: TableProps): number {
	return props.head ?? 1;
}

/** The columns and rows a drawn cell spans. */
export interface Span {
	colspan: number;
	rowspan: number;
}

const SPAN_KEYS = ['colspan', 'rowspan'] as const;

/** A span key as the cell holds it: a whole number from 1, else 1. */
function spanKey(cell: TableCell, key: (typeof SPAN_KEYS)[number]): number {
	const n = cell[key];
	return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Per row of {@link allRows} and per cell, the extent a drawn cell spans, or `null` for
 * a slot another's span covers: the rule upstream draws and stores by. Cells claim slots
 * in reading order, so an earlier span wins. A span takes the columns to its right, then
 * the rows below, while each slot it would cover holds a cell with no text and no mark
 * that no other span covers, stopping at the grid's edge and at the end of its own
 * section, the header rows or the body.
 */
function spansOf(rows: TableCell[][], head: number): (Span | null)[][] {
	const top = Math.min(head, rows.length);
	const covered = rows.map((row) => row.map(() => false));
	const spans: (Span | null)[][] = rows.map((row) => row.map(() => null));
	const free = (r: number, c: number): boolean => {
		const cell = rows[r]?.[c];
		return !!cell && cell.text === '' && cell.marks.length === 0 && !covered[r]![c];
	};
	for (let r = 0; r < rows.length; r++) {
		const end = r < top ? top : rows.length;
		for (let c = 0; c < rows[r]!.length; c++) {
			if (covered[r]![c]) continue;
			const cell = rows[r]![c]!;
			let w = 1;
			while (w < spanKey(cell, 'colspan') && free(r, c + w)) w++;
			let h = 1;
			const rowFree = (y: number) =>
				Array.from({ length: w }, (_, x) => c + x).every((x) => free(y, x));
			while (h < spanKey(cell, 'rowspan') && r + h < end && rowFree(r + h)) h++;
			for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) covered[y]![x] = true;
			spans[r]![c] = { colspan: w, rowspan: h };
		}
	}
	return spans;
}

/** {@link spansOf} over a table's rows, header first. */
export function spanGrid(props: TableProps): (Span | null)[][] {
	return spansOf(allRows(props), headRows(props));
}

/** The drawn cell whose span covers `(r, c)`, which is the slot itself where nothing
 *  covers it; the slot itself outside the grid. */
export function anchorAt(
	grid: (Span | null)[][],
	r: number,
	c: number
): { r: number; c: number; span: Span } {
	for (let y = r; y >= 0; y--)
		for (let x = c; x >= 0; x--) {
			const span = grid[y]?.[x];
			if (span && y + span.rowspan > r && x + span.colspan > c) return { r: y, c: x, span };
		}
	return { r, c, span: { colspan: 1, rowspan: 1 } };
}

/** `cell` holding `span`, each key absent at 1. */
function withSpan(cell: TableCell, span: Span): TableCell {
	const { colspan: _colspan, rowspan: _rowspan, ...rest } = cell;
	return {
		...rest,
		...(span.colspan > 1 && { colspan: span.colspan }),
		...(span.rowspan > 1 && { rowspan: span.rowspan })
	};
}

/** Each span written as the cell can cover it, absent at 1, and a covered cell's span keys
 *  dropped, its alignment kept: what the store settles a table to. A key holding no whole
 *  number from 1 stays as written and reads as 1. */
function settleSpans(rows: TableCell[][], head = 1): TableCell[][] {
	const spans = spansOf(rows, head);
	return rows.map((row, r) =>
		row.map((cell, c) => {
			const span = spans[r]![c];
			if (!span) return withSpan(cell, { colspan: 1, rowspan: 1 });
			const settled = { ...cell };
			for (const key of SPAN_KEYS) {
				if (spanKey(cell, key) === 1 && cell[key] !== 1) continue;
				if (span[key] > 1) settled[key] = span[key];
				else delete settled[key];
			}
			return settled;
		})
	);
}

/** Every span in the grid, by its drawn cell. */
function spanList(props: TableProps): { r: number; c: number; span: Span }[] {
	return spanGrid(props).flatMap((row, r) =>
		row.flatMap((span, c) =>
			span && (span.colspan > 1 || span.rowspan > 1) ? [{ r, c, span }] : []
		)
	);
}

/** `rows` with the span of the cell at `(r, c)` set to `span`. */
function respan(rows: TableCell[][], r: number, c: number, span: Span): TableCell[][] {
	return rows.map((row, y) =>
		y === r ? row.map((cell, x) => (x === c ? withSpan(cell, span) : cell)) : row
	);
}

/**
 * The rows as one list, header first: the space a row op works in. `header` is a
 * separate field because a table always has one and `header: []` is not a table — a
 * storage shape, not a rank a row op has to know about. Reading it as one list is what
 * lets move and delete treat every row alike, and {@link fromRows} splits it back.
 */
export function allRows(props: TableProps): TableCell[][] {
	return [props.header, ...props.rows];
}

/** A flat list back into the stored shape: whatever sits at index 0 is the header, by
 *  position rather than by having been one. No caller passes an empty list — every op
 *  that could reach one refuses the last row first. */
function fromRows(props: TableProps, rows: TableCell[][]): TableProps {
	const [header = [], ...rest] = rows;
	return normalizeTable({ ...props, header, rows: rest });
}

/** A fresh table: a header plus `bodyRows` empty rows, every column unaligned.
 *  Growth is cheap (Tab at the last cell appends a row), so the default is small. */
export function newTable(cols = 3, bodyRows = 2): TableProps {
	return normalizeTable({
		header: Array.from({ length: cols }, emptyCell),
		rows: Array.from({ length: bodyRows }, () => Array.from({ length: cols }, emptyCell)),
		aligns: Array.from({ length: cols }, () => 'none' as TableAlign)
	});
}

/** `props` with the cell at `(r, c)` replaced. */
export function withCell(props: TableProps, r: number, c: number, cell: TableCell): TableProps {
	const replace = (cells: TableCell[]) => cells.map((old, i) => (i === c ? cell : old));
	return normalizeTable({
		...props,
		header: r === 0 ? replace(props.header) : props.header,
		rows: props.rows.map((row, i) => (i === r - 1 ? replace(row) : row))
	});
}

/** A new empty body row below row `r` (row 0, the header, opens the first body row). */
export function insertRow(props: TableProps, r: number): TableProps {
	const at = Math.max(0, Math.min(r, props.rows.length));
	const fresh = Array.from({ length: columnCount(props) }, emptyCell);
	let rows = allRows(props);
	for (const { r: y, c, span } of spanList(props))
		if (y <= at && y + span.rowspan - 1 > at)
			rows = respan(rows, y, c, { ...span, rowspan: span.rowspan + 1 });
	return fromRows(props, [...rows.slice(0, at + 1), fresh, ...rows.slice(at + 1)]);
}

/** Drop row `r`, the header included: the row left at index 0 is the header, which is
 *  how a table whose first row went still has one. A no-op at the last row, that being
 *  the removal of the table rather than of a row, and the island's own to answer. */
export function deleteRow(props: TableProps, r: number): TableProps {
	let rows = allRows(props);
	if (rows.length <= 1 || r < 0 || r >= rows.length) return normalizeTable(props);
	for (const { r: y, c, span } of spanList(props)) {
		if (y > r || y + span.rowspan <= r) continue;
		const shorter = { ...span, rowspan: span.rowspan - 1 };
		if (y < r) rows = respan(rows, y, c, shorter);
		else if (span.rowspan > 1) {
			// The drawn cell goes with its row, so the one under it takes its text and the
			// rest of the span.
			const moved = withSpan(rows[y]![c]!, shorter);
			rows = rows.map((row, i) =>
				i === y + 1 ? row.map((cell, x) => (x === c ? moved : cell)) : row
			);
		}
	}
	return fromRows(
		props,
		rows.filter((_, i) => i !== r)
	);
}

/** A new empty column after column `c`. */
export function insertColumn(props: TableProps, c: number): TableProps {
	const at = Math.max(0, Math.min(c + 1, columnCount(props)));
	const splice = <T>(xs: T[], fresh: T): T[] => [...xs.slice(0, at), fresh, ...xs.slice(at)];
	let rows = allRows(props);
	for (const { r, c: x, span } of spanList(props))
		if (x < at && x + span.colspan > at)
			rows = respan(rows, r, x, { ...span, colspan: span.colspan + 1 });
	const [header = [], ...body] = rows;
	return normalizeTable({
		...props,
		header: splice(header, emptyCell()),
		rows: body.map((row) => splice(row, emptyCell())),
		aligns: splice(props.aligns, 'none'),
		widths: props.widths && splice(props.widths, null)
	});
}

/** Drop column `c`; a no-op at one column (a table has at least one). */
export function deleteColumn(props: TableProps, c: number): TableProps {
	if (columnCount(props) <= 1) return normalizeTable(props);
	const drop = <T>(xs: T[]) => xs.filter((_, i) => i !== c);
	let rows = allRows(props);
	for (const { r, c: x, span } of spanList(props)) {
		if (x > c || x + span.colspan <= c) continue;
		const narrower = { ...span, colspan: span.colspan - 1 };
		if (x < c) rows = respan(rows, r, x, narrower);
		else if (span.colspan > 1) {
			const moved = withSpan(rows[r]![x]!, narrower);
			rows = rows.map((row, i) =>
				i === r ? row.map((cell, y) => (y === x + 1 ? moved : cell)) : row
			);
		}
	}
	const [header = [], ...body] = rows;
	return normalizeTable({
		...props,
		header: drop(header),
		rows: body.map(drop),
		aligns: drop(props.aligns),
		widths: props.widths && drop(props.widths)
	});
}

/** `xs` read down its columns. */
function transpose<T>(xs: T[][]): T[][] {
	return Array.from({ length: xs[0]?.length ?? 0 }, (_, c) => xs.map((row) => row[c]!));
}

/**
 * `lines` with a span released wherever moving line `from` to `to` would leave the lines
 * it covers out of order or apart. `lines` are rows or columns, and each span names its
 * drawn cell by `line` and its place `at` along it, and the `length` it runs across the
 * lines under `key`. A span whose lines keep their order and stay together keeps it, its
 * covered cells travelling with their lines.
 */
function unspan(
	lines: TableCell[][],
	spans: { line: number; at: number; length: number }[],
	key: (typeof SPAN_KEYS)[number],
	from: number,
	to: number
): TableCell[][] {
	const order = move(
		lines.map((_, i) => i),
		from,
		to
	);
	const place = (i: number) => order.indexOf(i);
	let out = lines;
	for (const { line, at, length } of spans) {
		const together = Array.from({ length: length - 1 }, (_, k) => line + k).every(
			(i) => place(i + 1) === place(i) + 1
		);
		if (together) continue;
		out = out.map((cells, i) =>
			i === line
				? cells.map((cell, x) => {
						if (x !== at) return cell;
						const { [key]: _span, ...rest } = cell;
						return rest;
					})
				: cells
		);
	}
	return out;
}

/** One element moved within an array, out of place. The whole of what both move ops
 *  do to their axis, which is why they can only disagree about the index. */
function move<T>(xs: T[], from: number, to: number): T[] {
	const next = [...xs];
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved!);
	return next;
}

/** Row `r` moved by `by` places, clamped: a drag that leaves the rectangle is a no-op
 *  rather than an error, since the drop target is geometry and geometry runs past the
 *  last row. The header travels like any other row, and so does the row that displaces
 *  it: being the header is holding index 0, which a move is free to hand over. */
export function moveRow(props: TableProps, r: number, by: number): TableProps {
	const rows = allRows(props);
	const to = Math.max(0, Math.min(r + by, rows.length - 1));
	if (r === to || r < 0 || r >= rows.length) return normalizeTable(props);
	const spans = spanList(props).map(({ r: line, c: at, span }) => ({
		line,
		at,
		length: span.rowspan
	}));
	return fromRows(props, move(unspan(rows, spans, 'rowspan', r, to), r, to));
}

/** Column `c` moved by `by` places, clamped. `aligns` and `widths` travel with the
 *  column: each is the column's property, so a move that left it behind would retint
 *  or resize the column that took the index. */
export function moveColumn(props: TableProps, c: number, by: number): TableProps {
	const to = Math.max(0, Math.min(c + by, columnCount(props) - 1));
	if (c === to || c < 0 || c >= columnCount(props)) return normalizeTable(props);
	const shift = <T>(xs: T[]): T[] => move(xs, c, to);
	const spans = spanList(props).map(({ r: at, c: line, span }) => ({
		line,
		at,
		length: span.colspan
	}));
	const [header = [], ...body] = transpose(
		unspan(transpose(allRows(props)), spans, 'colspan', c, to)
	);
	return normalizeTable({
		...props,
		header: shift(header),
		rows: body.map(shift),
		aligns: shift(props.aligns),
		widths: props.widths && shift(props.widths)
	});
}

/**
 * Every cell in the inclusive rectangle emptied, alignment kept: what a delete gesture
 * means over a block of cells that covers no whole rank. A rectangle spanning one axis
 * covers ranks and deletes them, and one spanning both is the table itself, so what
 * reaches here is a proper sub-rectangle and the shape it leaves is the shape it found.
 *
 * A cell keeps its own alignment, and a column its alignment and width: what a clear
 * empties is text.
 */
export function clearCells(
	props: TableProps,
	r0: number,
	c0: number,
	r1: number,
	c1: number
): TableProps {
	const blank = (cells: TableCell[], r: number): TableCell[] =>
		cells.map((cell, c) =>
			r >= r0 && r <= r1 && c >= c0 && c <= c1 ? { ...cell, text: '', marks: [] } : cell
		);
	return normalizeTable({
		...props,
		header: blank(props.header, 0),
		rows: props.rows.map((row, i) => blank(row, i + 1))
	});
}

/** Set column `c`'s alignment and clear its cells' own `align`, which would outrank it:
 *  what the held column's cluster and Shift+arrow write (`table-view.ts`). */
export function setAlign(props: TableProps, c: number, align: TableAlign): TableProps {
	const release = (cells: TableCell[]): TableCell[] =>
		cells.map((cell, i) => {
			if (i !== c || cell.align === undefined) return cell;
			const { align: _align, ...rest } = cell;
			return rest;
		});
	return normalizeTable({
		...props,
		header: release(props.header),
		rows: props.rows.map(release),
		aligns: props.aligns.map((a, i) => (i === c ? align : a))
	});
}

/** Draw the top `head` rows as header rows: what the header toggle writes
 *  (`table-view.ts`). */
export function setHead(props: TableProps, head: number): TableProps {
	return normalizeTable({ ...props, head });
}

/** An inclusive block of cells, in the row space {@link rowCount} names. */
export interface CellBlock {
	r0: number;
	c0: number;
	r1: number;
	c1: number;
}

/** `block` grown until every drawn cell it touches lies wholly inside it: the block a
 *  selection over merged cells holds. */
export function closeBlock(props: TableProps, block: CellBlock): CellBlock {
	const grid = spanGrid(props);
	let { r0, c0, r1, c1 } = block;
	for (let grown = true; grown;) {
		grown = false;
		for (let r = r0; r <= r1; r++)
			for (let c = c0; c <= c1; c++) {
				const a = anchorAt(grid, r, c);
				const next = {
					r0: Math.min(r0, a.r),
					c0: Math.min(c0, a.c),
					r1: Math.max(r1, a.r + a.span.rowspan - 1),
					c1: Math.max(c1, a.c + a.span.colspan - 1)
				};
				if (next.r0 !== r0 || next.c0 !== c0 || next.r1 !== r1 || next.c1 !== c1) {
					({ r0, c0, r1, c1 } = next);
					grown = true;
				}
			}
	}
	return { r0, c0, r1, c1 };
}

/** Whether `block` can be one cell: it holds more than one drawn cell and stays inside
 *  the header rows or the body, a span ending at the section's edge. */
export function canMerge(props: TableProps, block: CellBlock): boolean {
	const { r0, c0, r1, c1 } = closeBlock(props, block);
	const head = headRows(props);
	const across = r0 < head && r1 >= head;
	const { span } = anchorAt(spanGrid(props), r0, c0);
	return !across && span.colspan * span.rowspan < (r1 - r0 + 1) * (c1 - c0 + 1);
}

/**
 * The block's cells as one, at its top-left: the text of each drawn cell holding any, in
 * reading order, a line apiece, and every other slot an empty one the span covers, its
 * alignment kept. The top-left cell's own alignment is the merged cell's. A block
 * {@link canMerge} refuses comes back as it was.
 */
export function mergeCells(props: TableProps, block: CellBlock): TableProps {
	if (!canMerge(props, block)) return normalizeTable(props);
	const { r0, c0, r1, c1 } = closeBlock(props, block);
	const grid = spanGrid(props);
	const rows = allRows(props);
	let text = '';
	const marks: TableCell['marks'] = [];
	for (let r = r0; r <= r1; r++)
		for (let c = c0; c <= c1; c++) {
			const cell = rows[r]![c]!;
			if (!grid[r]![c] || cell.text === '') continue;
			if (text) text += '\n';
			const at = usvLength(text);
			text += cell.text;
			for (const m of cell.marks) marks.push({ ...m, start: m.start + at, end: m.end + at });
		}
	const merged = rows.map((row, r) =>
		row.map((cell, c) => {
			if (r < r0 || r > r1 || c < c0 || c > c1) return cell;
			const layout = withSpan({ ...cell, text: '', marks: [] }, { colspan: 1, rowspan: 1 });
			if (r !== r0 || c !== c0) return layout;
			return withSpan({ ...layout, text, marks }, { colspan: c1 - c0 + 1, rowspan: r1 - r0 + 1 });
		})
	);
	return fromRows(props, merged);
}

/** The merged cell covering `(r, c)` back to the cells under it: its text stays in the
 *  top-left one, and the rest are the empty cells the span covered. */
export function splitCell(props: TableProps, r: number, c: number): TableProps {
	const a = anchorAt(spanGrid(props), r, c);
	return fromRows(props, respan(allRows(props), a.r, a.c, { colspan: 1, rowspan: 1 }));
}

/** Set or clear the column weights: what a border drag and its double-click write
 *  (`table-view.ts`). `undefined` returns every column to auto-fit. */
export function setWidths(props: TableProps, widths: (number | null)[] | undefined): TableProps {
	return normalizeTable({ ...props, widths });
}

/**
 * Each column's share of the table's width, summing to 1, or `undefined` for a table
 * that auto-fits throughout. An auto-fit column beside weighted ones takes the mean
 * weight: the page sizes it to its content, which the editor's grid, laid out fixed so
 * the weights hold, cannot ask.
 */
export function columnShares(props: TableProps): number[] | undefined {
	const set = props.widths?.filter((w): w is number => w !== null);
	if (!props.widths || !set?.length) return undefined;
	const mean = set.reduce((a, b) => a + b, 0) / set.length;
	const weights = props.widths.map((w) => w ?? mean);
	const total = weights.reduce((a, b) => a + b, 0);
	return weights.map((w) => w / total);
}

// ── The cell codec ──────────────────────────────────────────────────────────

/**
 * A cell as a one-paragraph `Content`: what `decode` takes under `cellSchema`. Each
 * `\n` in the text opens a `continues` line, which is the hard break it decodes to and
 * the one USV `pmToContent` projects a break back to. The cell's marks are that
 * content's marks, both being offsets into the same text.
 */
export function cellContent(cell: TableCell): Content {
	const breaks = cell.text.split('\n').length - 1;
	return {
		text: cell.text,
		lines: [
			{ containers: [], kind: 'para' },
			...Array.from({ length: breaks }, () => ({
				containers: [],
				kind: 'para' as const,
				continues: true
			}))
		],
		marks: cell.marks,
		islands: []
	};
}

/**
 * The cell a nested PM doc projects, carrying `prior`'s identity anchors through.
 *
 * Anchors inside a cell are **preserved verbatim, never minted**: they are not in
 * the field plugin's coordinate space (the field's position map holds one `atom`
 * run for the whole table), so nothing here can mint one and the popover withholds
 * its `anchor` button while the caret is in a cell. Preserving them still means
 * rebasing: a cell edit is a splice like any other, so `mapMarks` carries each held
 * anchor through the cell's own delta by the rule the store applies to a field's,
 * and a mark the splice deleted through lands where the splice left it rather than
 * pointing past the text.
 */
export function cellFromDoc(doc: PMNode, prior: TableCell): TableCell {
	const projected = pmToContent(doc);
	const text = projected.text;
	const layout = cellLayout(prior);
	const anchors = prior.marks.filter((m) => m.type === 'anchor');
	if (!anchors.length) return { ...layout, text, marks: projected.marks };
	const before = cellContent(prior);
	const delta = contentEdit(before, cellContent({ text, marks: [] })).delta;
	const rebased = core()
		.mapMarks(before, delta ? { delta } : {})
		.filter((m) => m.type === 'anchor');
	return {
		...layout,
		text,
		marks: [...projected.marks, ...rebased].sort((a, b) => a.start - b.start || a.end - b.end)
	};
}

/** A cell's keys beside its text and marks: what no edit of the text touches. */
function cellLayout(cell: TableCell): Omit<TableCell, 'text' | 'marks'> {
	const { text: _text, marks: _marks, ...layout } = cell;
	return layout;
}

/** Whether two cells are the same value: what tells an own edit (the projection the
 *  view just produced) from an external one (an undo, a re-hydrate) without a flag.
 *  The marks structurally, for the reason `reconcile.ts` states. */
export function cellEqual(a: TableCell, b: TableCell): boolean {
	return a.text === b.text && valueEqual(a.marks, b.marks);
}

/** Whether two tables have the same rectangle, alignment, header and widths: the
 *  change that forces a rebuild rather than a per-cell reseed. */
export function shapeEqual(a: TableProps, b: TableProps): boolean {
	return (
		a.rows.length === b.rows.length &&
		a.aligns.length === b.aligns.length &&
		a.aligns.every((x, i) => x === b.aligns[i]) &&
		headRows(a) === headRows(b) &&
		valueEqual(spanGrid(a), spanGrid(b)) &&
		valueEqual(a.widths, b.widths)
	);
}
