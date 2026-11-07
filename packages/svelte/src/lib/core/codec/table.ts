// The table island's model: the grid every row and column op works (`TableGrid`, a header row and
// body rows of cells), its two crossings to the island the store holds (`gridOf`, `islandOf`), the
// cell codec (a `GridCell` ↔ one inline-schema PM doc), and the rectangularizing constructors
// (INVARIANTS §Islands, §"The table island").
//
// The store's table is `columns` and `rows` of ids, each cell naming the slot holding its content,
// and layout keyed by column and slot id. The grid holds it by place: each cell carries the row,
// column and slot ids it arrived under, so a move carries them with the cells, and `islandOf` reads
// each rank's id off the first cell holding an unclaimed one, minting past the table's highest.
//
// The grid normalizes to one column count shared by `header`, every row, `aligns` and `widths`. The
// editor keeps its optimistic PM and re-hydrates only on an external change (INVARIANTS
// §Reconciliation), so an op that emitted a ragged table would leave the store rectangularized and
// PM ragged with no repair. Every constructor therefore ends in {@link normalizeTable}, and a
// caller reaches the shape only through them.
//
// A cell is its own content unit: `marks` and `anchors` are UTF-16 offsets into that cell's
// `text`, a `U+2028` in it a hard break, so it decodes and projects through the machinery a field
// does (`cellSchema`).
import type { Content, ContentAnchor, ContentMark, TableProps } from '@quillmark/wasm';
import type { Node as PMNode } from 'prosemirror-model';
import { pmToContent } from './encode.js';
import { HARD_BREAK, isTableProps, type IslandNodeAttrs } from './islands.js';
import { valueEqual } from './reconcile.js';

/** One column's alignment, `none` where the store keys none. */
export type TableAlign = 'none' | NonNullable<TableProps['align']>;

/** The alignments a column can take: the four the content declares, `none` first
 *  because it is what a column arrives at and what a set is cleared back to. */
export const ALIGNS: readonly TableAlign[] = ['none', 'left', 'center', 'right'];

/** A cell's own layout, as the store keys it by slot. */
type CellAttrs = NonNullable<TableProps['cell_attrs']>[string];

/** The ids a cell arrived under. */
export interface CellIds {
	row: string;
	column: string;
	slot: string;
	block: string;
}

/** One cell of the grid: its slot's text, marks and anchors, its own layout, its ids. */
export interface GridCell extends CellAttrs {
	text: string;
	marks: ContentMark[];
	anchors?: ContentAnchor[];
	ids?: CellIds;
}

/** A table by place: row 0 the header, `aligns` and `widths` one per column. */
export interface TableGrid {
	header: GridCell[];
	rows: GridCell[][];
	aligns: TableAlign[];
	widths?: (number | null)[];
	align?: TableProps['align'];
	head?: number;
	/** The props keys the table names none of, riding through. */
	extra?: Record<string, unknown>;
}

const TABLE_KEYS = new Set(['columns', 'rows', 'head', 'aligns', 'widths', 'align', 'cell_attrs']);

/** The grid a table island spells, each cell its slot's content and its ids. */
export function gridOf(props: TableProps, slots: Record<string, Content> | null): TableGrid {
	const attrs = props.cell_attrs ?? {};
	const cells = props.rows.map((row) =>
		props.columns.map((column): GridCell => {
			const slot = row.cells[column] ?? '';
			const content = slots?.[slot];
			return {
				...attrs[slot],
				text: content?.text ?? '',
				marks: content?.marks ?? [],
				...(content?.anchors?.length && { anchors: content.anchors }),
				ids: { row: row.id, column, slot, block: content?.blocks[0]?.id ?? 'b0' }
			};
		})
	);
	const extra = Object.fromEntries(Object.entries(props).filter(([k]) => !TABLE_KEYS.has(k)));
	const [header = [], ...rows] = cells;
	return normalizeTable({
		header,
		rows,
		aligns: props.columns.map((c) => props.aligns?.[c] ?? 'none'),
		...(props.widths && {
			widths: props.widths && props.columns.map((c) => props.widths?.[c] ?? null)
		}),
		...(props.align && { align: props.align }),
		...(props.head !== undefined && { head: props.head }),
		...(Object.keys(extra).length && { extra })
	});
}

/** A node's grid, or `undefined` for any other island and for a payload of the wrong shape. */
export function tableOfNode(node: PMNode): TableGrid | undefined {
	const attrs = node.attrs as IslandNodeAttrs;
	return attrs.islandType === 'table' && isTableProps(attrs.props)
		? gridOf(attrs.props, attrs.slots)
		: undefined;
}

/** A minter for one id space: `{prefix}{n}` past the highest `held` names under `prefix`. */
function minter(held: Iterable<string>, prefix: string): (want?: string) => string {
	const taken = new Set<string>();
	let next = 0;
	for (const id of held) {
		const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
		if (m) next = Math.max(next, Number(m[1]) + 1);
	}
	return (want) => {
		if (want && !taken.has(want)) {
			taken.add(want);
			return want;
		}
		let id = `${prefix}${next++}`;
		while (taken.has(id)) id = `${prefix}${next++}`;
		taken.add(id);
		return id;
	};
}

/** The island a grid spells: its props and slots, each rank's id the first its cells carry. */
export function islandOf(grid: TableGrid): { props: TableProps; slots: Record<string, Content> } {
	const g = normalizeTable(grid);
	const rows = allRows(g);
	const every = rows.flat().flatMap((cell) => (cell.ids ? [cell.ids] : []));
	const rowId = minter(
		every.map((i) => i.row),
		'r'
	);
	const columnId = minter(
		every.map((i) => i.column),
		'k'
	);
	const slotId = minter(
		every.map((i) => i.slot),
		's'
	);
	const columns = g.aligns.map((_, c) =>
		columnId(rows.map((row) => row[c]?.ids?.column).find((id) => id !== undefined))
	);
	const slots: Record<string, Content> = {};
	const cellAttrs: Record<string, CellAttrs> = {};
	const out = rows.map((row) => ({
		id: rowId(row.map((cell) => cell.ids?.row).find((id) => id !== undefined)),
		cells: Object.fromEntries(
			row.map((cell, c) => {
				const slot = slotId(cell.ids?.slot);
				slots[slot] = cellContent(cell);
				const own = cellAttrsOf(cell);
				if (Object.keys(own).length) cellAttrs[slot] = own;
				return [columns[c]!, slot];
			})
		)
	}));
	const keyed = <T>(
		xs: readonly T[] | undefined,
		skip: (x: T) => boolean
	): Record<string, T> | undefined => {
		const entries = (xs ?? []).flatMap((x, c) => (skip(x) ? [] : [[columns[c]!, x] as const]));
		return entries.length ? Object.fromEntries(entries) : undefined;
	};
	const aligns = keyed(g.aligns, (a) => a === 'none') as TableProps['aligns'];
	const widths = keyed(g.widths, (w) => w === null) as TableProps['widths'];
	return {
		props: {
			...g.extra,
			columns,
			rows: out,
			...(g.head !== undefined && g.head !== 1 && { head: g.head }),
			...(aligns && { aligns }),
			...(widths && { widths }),
			...(g.align && { align: g.align }),
			...(Object.keys(cellAttrs).length && { cell_attrs: cellAttrs })
		},
		slots
	};
}

/** A cell's own layout: every key beside its text, marks, anchors and ids. */
function cellAttrsOf(cell: GridCell): CellAttrs {
	const { text: _t, marks: _m, anchors: _a, ids: _i, ...layout } = cell;
	return layout;
}

/** The zero cell: empty text, no marks. */
export function emptyCell(): GridCell {
	return { text: '', marks: [] };
}

/**
 * The row index space the chrome and the ops share: **0 is the header**, 1…n the body rows. A row
 * op works {@link allRows}, and whichever row lands at index 0 is the header afterwards. The one
 * row the model refuses is the last, there being no table under it.
 */
export function rowCount(props: TableGrid): number {
	return props.rows.length + 1;
}

/** The cells of row `r` in that space. */
export function rowCells(props: TableGrid, r: number): GridCell[] {
	return r === 0 ? props.header : (props.rows[r - 1] ?? []);
}

/**
 * Whether a row holds no text, telling a row on offer from one taken up (`table-view.ts` §`step`).
 * Text alone: a mark over none is invisible.
 */
export function rowEmpty(props: TableGrid, r: number): boolean {
	return rowCells(props, r).every((cell) => cell.text === '');
}

/** The cell at `(row, column)`, or the zero cell where the rectangle does not reach. */
export function cellAt(props: TableGrid, r: number, c: number): GridCell {
	return rowCells(props, r)[c] ?? emptyCell();
}

/** The table's column count: the one number `header`, every row and `aligns` share. */
export function columnCount(props: TableGrid): number {
	return props.aligns.length;
}

/**
 * The rectangularizing constructor: one column count (the widest thing present, at least one)
 * across `header`, every row, `aligns` and `widths`, padding with empty cells, `none` and auto-fit.
 * The layout keys ride through, each absent at its default as the store writes it.
 */
export function normalizeTable(props: TableGrid): TableGrid {
	const cols = Math.max(
		1,
		props.header.length,
		props.aligns.length,
		...props.rows.map((row) => row.length)
	);
	const fit = (cells: GridCell[]): GridCell[] =>
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
		...(props.head !== undefined && props.head !== 1 && { head: props.head }),
		...(props.extra && { extra: props.extra })
	};
}

/** How many rows from the top draw as header rows, absent being one. */
export function headRows(props: TableGrid): number {
	return props.head ?? 1;
}

/** The columns and rows a drawn cell spans. */
export interface Span {
	colspan: number;
	rowspan: number;
}

const SPAN_KEYS = ['colspan', 'rowspan'] as const;

/** A span key as the cell holds it: a whole number from 1, else 1. */
function spanKey(cell: GridCell, key: (typeof SPAN_KEYS)[number]): number {
	const n = cell[key];
	return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Per row of {@link allRows} and per cell, the extent a drawn cell spans, or `null` for a slot
 * another's span covers: the rule upstream draws and stores by. Cells claim slots in reading order,
 * so an earlier span wins. A span takes the columns to its right, then the rows below, while each
 * slot it would cover holds a cell with no text and no mark that no other span covers, stopping at
 * the grid's edge and at the end of its own section (header rows or body).
 */
function spansOf(rows: GridCell[][], head: number): (Span | null)[][] {
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
export function spanGrid(props: TableGrid): (Span | null)[][] {
	return spansOf(allRows(props), headRows(props));
}

/**
 * The drawn cell whose span covers `(r, c)`; the slot itself where nothing covers it or it lies
 * outside the grid.
 */
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
function withSpan(cell: GridCell, span: Span): GridCell {
	const { colspan: _colspan, rowspan: _rowspan, ...rest } = cell;
	return {
		...rest,
		...(span.colspan > 1 && { colspan: span.colspan }),
		...(span.rowspan > 1 && { rowspan: span.rowspan })
	};
}

/**
 * Each span written as the cell can cover it, absent at 1, and a covered cell's span keys dropped,
 * its alignment kept: what the store settles a table to. A key holding no whole number from 1 stays
 * as written and reads as 1.
 */
function settleSpans(rows: GridCell[][], head = 1): GridCell[][] {
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
function spanList(props: TableGrid): { r: number; c: number; span: Span }[] {
	return spanGrid(props).flatMap((row, r) =>
		row.flatMap((span, c) =>
			span && (span.colspan > 1 || span.rowspan > 1) ? [{ r, c, span }] : []
		)
	);
}

/** `rows` with the span of the cell at `(r, c)` set to `span`. */
function respan(rows: GridCell[][], r: number, c: number, span: Span): GridCell[][] {
	return rows.map((row, y) =>
		y === r ? row.map((cell, x) => (x === c ? withSpan(cell, span) : cell)) : row
	);
}

/**
 * The rows as one list, header first: the space a row op works in, so move and delete treat every
 * row alike. `header` is a separate field because a table always has one; {@link fromRows} splits
 * it back.
 */
function allRows(props: TableGrid): GridCell[][] {
	return [props.header, ...props.rows];
}

/**
 * A flat list back into the stored shape: whatever sits at index 0 is the header. No caller passes
 * an empty list; every op that could reach one refuses the last row first.
 */
function fromRows(props: TableGrid, rows: GridCell[][]): TableGrid {
	const [header = [], ...rest] = rows;
	return normalizeTable({ ...props, header, rows: rest });
}

/** A fresh table: a header plus `bodyRows` empty rows, every column unaligned. */
export function newTable(cols = 3, bodyRows = 2): TableGrid {
	return normalizeTable({
		header: Array.from({ length: cols }, emptyCell),
		rows: Array.from({ length: bodyRows }, () => Array.from({ length: cols }, emptyCell)),
		aligns: Array.from({ length: cols }, () => 'none' as TableAlign)
	});
}

/** `props` with the cell at `(r, c)` replaced. */
export function withCell(props: TableGrid, r: number, c: number, cell: GridCell): TableGrid {
	const replace = (cells: GridCell[]) => cells.map((old, i) => (i === c ? cell : old));
	return normalizeTable({
		...props,
		header: r === 0 ? replace(props.header) : props.header,
		rows: props.rows.map((row, i) => (i === r - 1 ? replace(row) : row))
	});
}

/** A new empty body row below row `r` (row 0, the header, opens the first body row). */
export function insertRow(props: TableGrid, r: number): TableGrid {
	const at = Math.max(0, Math.min(r, props.rows.length));
	const fresh = Array.from({ length: columnCount(props) }, emptyCell);
	let rows = allRows(props);
	for (const { r: y, c, span } of spanList(props))
		if (y <= at && y + span.rowspan - 1 > at)
			rows = respan(rows, y, c, { ...span, rowspan: span.rowspan + 1 });
	return fromRows(props, [...rows.slice(0, at + 1), fresh, ...rows.slice(at + 1)]);
}

/**
 * Drop row `r`, the header included: the row left at index 0 becomes the header. A no-op at the
 * last row, which is the removal of the table and the island's to answer.
 */
export function deleteRow(props: TableGrid, r: number): TableGrid {
	let rows = allRows(props);
	if (rows.length <= 1 || r < 0 || r >= rows.length) return normalizeTable(props);
	for (const { r: y, c, span } of spanList(props)) {
		if (y > r || y + span.rowspan <= r) continue;
		const shorter = { ...span, rowspan: span.rowspan - 1 };
		if (y < r) rows = respan(rows, y, c, shorter);
		else if (span.rowspan > 1) {
			// The drawn cell goes with its row, so the one under it takes its text and the rest of
			// the span.
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
export function insertColumn(props: TableGrid, c: number): TableGrid {
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
export function deleteColumn(props: TableGrid, c: number): TableGrid {
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
 * `lines` with a span released wherever moving line `from` to `to` would leave the lines it covers
 * out of order or apart. Each span names its drawn cell by `line` and its place `at` along it, and
 * the `length` it runs across the lines under `key`; a span whose lines keep their order and stay
 * together keeps it.
 */
function unspan(
	lines: GridCell[][],
	spans: { line: number; at: number; length: number }[],
	key: (typeof SPAN_KEYS)[number],
	from: number,
	to: number
): GridCell[][] {
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

/**
 * One element moved within an array, out of place: the whole of what both move ops do to their
 * axis.
 */
function move<T>(xs: T[], from: number, to: number): T[] {
	const next = [...xs];
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved!);
	return next;
}

/**
 * Row `r` moved by `by` places, clamped: a drag past the rectangle is a no-op, not an error. The
 * header travels like any other row; being the header is holding index 0.
 */
export function moveRow(props: TableGrid, r: number, by: number): TableGrid {
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

/**
 * Column `c` moved by `by` places, clamped. `aligns` and `widths` travel with the column, being its
 * properties.
 */
export function moveColumn(props: TableGrid, c: number, by: number): TableGrid {
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
 * Every cell in the inclusive rectangle emptied, alignment kept (a cell its own, a column its
 * alignment and width): a delete over a block covering no whole rank. A rectangle spanning one axis
 * deletes ranks and one spanning both is the table, so what reaches here is a proper sub-rectangle.
 */
export function clearCells(
	props: TableGrid,
	r0: number,
	c0: number,
	r1: number,
	c1: number
): TableGrid {
	const blank = (cells: GridCell[], r: number): GridCell[] =>
		cells.map((cell, c) =>
			r >= r0 && r <= r1 && c >= c0 && c <= c1 ? { ...cell, text: '', marks: [] } : cell
		);
	return normalizeTable({
		...props,
		header: blank(props.header, 0),
		rows: props.rows.map((row, i) => blank(row, i + 1))
	});
}

/**
 * Set column `c`'s alignment and clear its cells' own `align`, which would outrank it
 * (`table-view.ts`).
 */
export function setAlign(props: TableGrid, c: number, align: TableAlign): TableGrid {
	const release = (cells: GridCell[]): GridCell[] =>
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

/** Draw the top `head` rows as header rows (`table-view.ts`). */
export function setHead(props: TableGrid, head: number): TableGrid {
	return normalizeTable({ ...props, head });
}

/** An inclusive block of cells, in the row space {@link rowCount} names. */
export interface CellBlock {
	r0: number;
	c0: number;
	r1: number;
	c1: number;
}

/** `block` grown until every drawn cell it touches lies wholly inside it. */
export function closeBlock(props: TableGrid, block: CellBlock): CellBlock {
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

/**
 * Whether `block` can be one cell: more than one drawn cell, inside the header rows or the body.
 */
export function canMerge(props: TableGrid, block: CellBlock): boolean {
	const { r0, c0, r1, c1 } = closeBlock(props, block);
	const head = headRows(props);
	const across = r0 < head && r1 >= head;
	const { span } = anchorAt(spanGrid(props), r0, c0);
	return !across && span.colspan * span.rowspan < (r1 - r0 + 1) * (c1 - c0 + 1);
}

/**
 * The block's cells as one, at its top-left: the text of each drawn cell holding any, in reading
 * order, a line apiece, every other slot an empty one the span covers, alignment kept. The top-left
 * cell's alignment is the merged cell's. A block {@link canMerge} refuses comes back as it was.
 */
export function mergeCells(props: TableGrid, block: CellBlock): TableGrid {
	if (!canMerge(props, block)) return normalizeTable(props);
	const { r0, c0, r1, c1 } = closeBlock(props, block);
	const grid = spanGrid(props);
	const rows = allRows(props);
	let text = '';
	const marks: GridCell['marks'] = [];
	for (let r = r0; r <= r1; r++)
		for (let c = c0; c <= c1; c++) {
			const cell = rows[r]![c]!;
			if (!grid[r]![c] || cell.text === '') continue;
			if (text) text += HARD_BREAK;
			const at = text.length;
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

/**
 * The merged cell covering `(r, c)` back to the cells under it: its text stays top-left, the rest
 * are the empty cells it covered.
 */
export function splitCell(props: TableGrid, r: number, c: number): TableGrid {
	const a = anchorAt(spanGrid(props), r, c);
	return fromRows(props, respan(allRows(props), a.r, a.c, { colspan: 1, rowspan: 1 }));
}

/**
 * Set or clear the column weights (`table-view.ts`); `undefined` returns every column to auto-fit.
 */
export function setWidths(props: TableGrid, widths: (number | null)[] | undefined): TableGrid {
	return normalizeTable({ ...props, widths });
}

/**
 * Each column's share of the table's width, summing to 1, or `undefined` for a table that auto-fits
 * throughout. An auto-fit column beside weighted ones takes the mean weight, since the editor's
 * fixed-layout grid cannot size it to content as the page does.
 */
export function columnShares(props: TableGrid): number[] | undefined {
	const set = props.widths?.filter((w): w is number => w !== null);
	if (!props.widths || !set?.length) return undefined;
	const mean = set.reduce((a, b) => a + b, 0) / set.length;
	const weights = props.widths.map((w) => w ?? mean);
	const total = weights.reduce((a, b) => a + b, 0);
	return weights.map((w) => w / total);
}

// ── The cell codec ──────────────────────────────────────────────────────────

/** A cell as its slot: one paragraph, for `decode` under `cellSchema`. */
export function cellContent(cell: GridCell): Content {
	return {
		text: cell.text,
		blocks: [{ id: cell.ids?.block ?? 'b0', kind: 'para' }],
		...(cell.marks.length && { marks: cell.marks }),
		...(cell.anchors?.length && { anchors: cell.anchors })
	};
}

/**
 * Where `pos` in `before` lands in `after`, reading the edit between them as the one replaced run
 * their common prefix and suffix leave: what a keystroke in a cell is. `assoc` says which side of
 * the replaced run a position at its edge or inside it takes.
 */
function mapThrough(before: string, after: string, pos: number, assoc: 'before' | 'after'): number {
	const most = Math.min(before.length, after.length);
	let head = 0;
	while (head < most && before[head] === after[head]) head++;
	let tail = 0;
	while (tail < most - head && before[before.length - 1 - tail] === after[after.length - 1 - tail])
		tail++;
	const oldEnd = before.length - tail;
	const newEnd = after.length - tail;
	if (pos < head || (pos === head && assoc === 'before')) return pos;
	if (pos > oldEnd || (pos === oldEnd && assoc === 'after')) return pos + newEnd - oldEnd;
	return assoc === 'before' ? head : newEnd;
}

/**
 * The cell a nested PM doc projects, carrying `prior`'s layout, ids and anchors through.
 *
 * Anchors inside a cell are preserved, never minted: they are not in the field plugin's coordinate
 * space (its position map holds one `atom` run for the whole table), so the popover withholds its
 * `anchor` button in a cell. Preserving still means rebasing: each held anchor maps through the
 * edit by the store's rule, a range's start after it and its end before, a point before, and a
 * range the edit closes is dropped.
 */
export function cellFromDoc(doc: PMNode, prior: GridCell): GridCell {
	const projected = pmToContent(doc);
	const { anchors: held, ...rest } = prior;
	const next: GridCell = { ...rest, text: projected.text, marks: projected.marks ?? [] };
	if (!held?.length) return next;
	const at = (pos: number, assoc: 'before' | 'after') =>
		mapThrough(prior.text, next.text, pos, assoc);
	const anchors = held.flatMap((a) => {
		if (a.start === a.end) {
			const p = at(a.start, 'before');
			return [{ ...a, start: p, end: p }];
		}
		const start = at(a.start, 'after');
		const end = at(a.end, 'before');
		return start < end ? [{ ...a, start, end }] : [];
	});
	return anchors.length ? { ...next, anchors } : next;
}

/**
 * Whether two cells are the same value, telling an own edit from an external one (an undo, a
 * re-hydrate) without a flag. Marks compare structurally, as `reconcile.ts` states.
 */
export function cellEqual(a: GridCell, b: GridCell): boolean {
	return a.text === b.text && valueEqual(a.marks, b.marks) && valueEqual(a.anchors, b.anchors);
}

/** Whether two tables have the same rectangle, alignment, header and widths: the
 *  change that forces a rebuild rather than a per-cell reseed. */
export function shapeEqual(a: TableGrid, b: TableGrid): boolean {
	return (
		a.rows.length === b.rows.length &&
		a.aligns.length === b.aligns.length &&
		a.aligns.every((x, i) => x === b.aligns[i]) &&
		headRows(a) === headRows(b) &&
		valueEqual(spanGrid(a), spanGrid(b)) &&
		valueEqual(a.widths, b.widths)
	);
}
