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
	return settleSpans({
		header: fit(props.header),
		rows: props.rows.map(fit),
		aligns: Array.from({ length: cols }, (_, c) => props.aligns[c] ?? 'none'),
		...(widths.some((w) => w !== null) && { widths }),
		...(props.align && { align: props.align }),
		...(props.headless && { headless: true })
	});
}

// ── Merged cells ────────────────────────────────────────────────────────────

/** A cell as the span keys see it. */
type Spanned = TableCell & { colspan?: number; rowspan?: number };

/** The span keys. */
const SPANS = ['colspan', 'rowspan'] as const;

/** A block of cells, both corners inclusive, in the row space {@link rowCount} names. */
export interface CellBlock {
	r0: number;
	c0: number;
	r1: number;
	c1: number;
}

/** A span key's value where it is in its set, a whole number from 2. */
function spanOf(cell: TableCell, key: (typeof SPANS)[number]): number | undefined {
	const n = (cell as Spanned)[key];
	return Number.isSafeInteger(n) && n! >= 2 ? n : undefined;
}

/** `cell` without the span keys in their set: what a cell keeps when it stops being a
 *  span's top-left corner. */
function unspanned(cell: TableCell): TableCell {
	const out: Spanned = { ...cell };
	for (const key of SPANS) if (spanOf(cell, key) !== undefined) delete out[key];
	return out;
}

/** `cell` drawn over `colspan` columns and `rowspan` rows, each key absent at 1. */
export function spanning(cell: TableCell, colspan: number, rowspan: number): TableCell {
	return {
		...unspanned(cell),
		...(colspan > 1 && { colspan }),
		...(rowspan > 1 && { rowspan })
	} as TableCell;
}

/**
 * The block each position draws in, by row then column: its own cell's for a cell no
 * span covers, the span's for every cell a span covers, its top-left corner included.
 * The engine's rule (`island::cell_slots`): a span reaches as far as every cell it would
 * cover holds no text and no earlier span covers it, stopping at the grid's edge and,
 * unless the table is `headless`, at the header row's foot, so a span never hides text.
 */
export function cellBlocks(props: TableProps): CellBlock[][] {
	const rows = allRows(props);
	const blocks: (CellBlock | undefined)[][] = rows.map((row) => row.map(() => undefined));
	const free = (r: number, c: number) => !blocks[r]?.[c] && rows[r]?.[c]?.text === '';
	rows.forEach((row, r) =>
		row.forEach((cell, c) => {
			if (blocks[r]![c]) return;
			let c1 = c;
			while (c1 - c + 1 < (spanOf(cell, 'colspan') ?? 1) && c1 + 1 < row.length && free(r, c1 + 1))
				c1++;
			const last = r === 0 && !props.headless ? 0 : rows.length - 1;
			let r1 = r;
			const open = (at: number) => {
				for (let x = c; x <= c1; x++) if (!free(at, x)) return false;
				return true;
			};
			while (r1 - r + 1 < (spanOf(cell, 'rowspan') ?? 1) && r1 < last && open(r1 + 1)) r1++;
			const block = { r0: r, c0: c, r1, c1 };
			for (let y = r; y <= r1; y++) for (let x = c; x <= c1; x++) blocks[y]![x] = block;
		})
	);
	return blocks as CellBlock[][];
}

/** Each span key set to what its cell draws: a corner's to its block, a covered cell's
 *  and a single cell's absent. A key outside its set rides untouched. */
function settleSpans(props: TableProps): TableProps {
	const blocks = cellBlocks(props);
	const settle = (cells: TableCell[], r: number) =>
		cells.map((cell, c) => {
			const block = blocks[r]![c]!;
			const corner = block.r0 === r && block.c0 === c;
			const colspan = corner ? block.c1 - block.c0 + 1 : 1;
			const rowspan = corner ? block.r1 - block.r0 + 1 : 1;
			const held = (key: (typeof SPANS)[number]) => spanOf(cell, key) ?? 1;
			return held('colspan') === colspan && held('rowspan') === rowspan
				? cell
				: spanning(cell, colspan, rowspan);
		});
	return {
		...props,
		header: settle(props.header, 0),
		rows: props.rows.map((row, i) => settle(row, i + 1))
	};
}

/** The block a position draws in. */
export function blockAt(props: TableProps, r: number, c: number): CellBlock {
	return cellBlocks(props)[r]?.[c] ?? { r0: r, c0: c, r1: r, c1: c };
}

/** `block` grown until every span it reaches into lies inside it: what a sweep holds
 *  and a merge acts on, a span being one cell. */
export function wholeBlock(props: TableProps, block: CellBlock): CellBlock {
	const blocks = cellBlocks(props);
	let out = { ...block };
	for (let grew = true; grew;) {
		grew = false;
		for (let r = out.r0; r <= out.r1; r++)
			for (let c = out.c0; c <= out.c1; c++) {
				const b = blocks[r]?.[c];
				if (!b || (b.r0 >= out.r0 && b.c0 >= out.c0 && b.r1 <= out.r1 && b.c1 <= out.c1)) continue;
				out = {
					r0: Math.min(out.r0, b.r0),
					c0: Math.min(out.c0, b.c0),
					r1: Math.max(out.r1, b.r1),
					c1: Math.max(out.c1, b.c1)
				};
				grew = true;
			}
	}
	return out;
}

/** The top-left corners of the cells `block` holds, in reading order. */
function cornersIn(props: TableProps, block: CellBlock): CellBlock[] {
	const out: CellBlock[] = [];
	const blocks = cellBlocks(props);
	for (let r = block.r0; r <= block.r1; r++)
		for (let c = block.c0; c <= block.c1; c++) {
			const b = blocks[r]?.[c];
			if (b && b.r0 === r && b.c0 === c) out.push(b);
		}
	return out;
}

/** Whether `block` can become one cell: it holds two cells or more, and it keeps to one
 *  side of the header row's foot, a header row spanning no rows. */
export function canMerge(props: TableProps, block: CellBlock): boolean {
	const whole = wholeBlock(props, block);
	if (!props.headless && whole.r0 === 0 && whole.r1 > 0) return false;
	return cornersIn(props, whole).length > 1;
}

/** Whether `block` holds a merged cell, which a split returns to single cells. */
export function holdsMerge(props: TableProps, block: CellBlock): boolean {
	return cornersIn(props, wholeBlock(props, block)).some((b) => b.r1 > b.r0 || b.c1 > b.c0);
}

/**
 * The cells of `block`, grown to the spans it reaches into, as one cell: its top-left
 * corner, holding every cell's text in reading order a line each, their marks with it,
 * and spanning the block. Each other cell empties, so the span covers it. A no-op where
 * {@link canMerge} refuses.
 */
export function mergeCells(props: TableProps, block: CellBlock): TableProps {
	if (!canMerge(props, block)) return normalizeTable(props);
	const whole = wholeBlock(props, block);
	let text = '';
	const marks: TableCell['marks'] = [];
	for (const b of cornersIn(props, whole)) {
		const cell = cellAt(props, b.r0, b.c0);
		if (cell.text === '') continue;
		if (text !== '') text += '\n';
		const at = [...text].length;
		text += cell.text;
		for (const m of cell.marks) marks.push({ ...m, start: m.start + at, end: m.end + at });
	}
	const corner = cellAt(props, whole.r0, whole.c0);
	const merged = spanning(
		{ ...corner, text, marks },
		whole.c1 - whole.c0 + 1,
		whole.r1 - whole.r0 + 1
	);
	const rows = allRows(props).map((row, r) =>
		row.map((cell, c) => {
			if (r < whole.r0 || r > whole.r1 || c < whole.c0 || c > whole.c1) return cell;
			return r === whole.r0 && c === whole.c0 ? merged : emptyCell();
		})
	);
	return fromRows(props, rows);
}

/** Every merged cell `block` holds back to single cells: the text stays in the top-left
 *  one and the cells the span covered come back empty. */
export function splitCells(props: TableProps, block: CellBlock): TableProps {
	const corners = cornersIn(props, wholeBlock(props, block));
	const rows = allRows(props).map((row, r) =>
		row.map((cell, c) => (corners.some((b) => b.r0 === r && b.c0 === c) ? unspanned(cell) : cell))
	);
	return fromRows(props, rows);
}

/**
 * `after`'s spans carried from `before` across a line op. `rows[i]` is the row of
 * `before` that row `i` of `after` holds, `-1` for a fresh one, and `cols` the same for
 * columns. A span keeps the lines of its own that survive, and takes in a fresh line
 * opened between two of them, so a row inserted inside a merged cell joins it; its text
 * lands in the top-left of what is left, a deleted corner's included. A span whose
 * lines a move has parted no longer covers one block, and returns to single cells.
 */
function carrySpans(
	before: TableProps,
	after: TableProps,
	rows: number[],
	cols: number[]
): TableProps {
	const grid = allRows(after).map((row) => row.map(unspanned));
	const blocks = cellBlocks(before);
	const reach = (map: number[], lo: number, hi: number) => {
		const held = map.flatMap((was, i) => (was >= lo && was <= hi ? [i] : []));
		if (!held.length) return undefined;
		const from = held[0]!;
		const to = held[held.length - 1]!;
		for (let i = from; i <= to; i++) if (map[i] !== -1 && (map[i]! < lo || map[i]! > hi)) return;
		return { from, to };
	};
	blocks.forEach((line, r) =>
		line.forEach((b, c) => {
			if (b.r0 !== r || b.c0 !== c || (b.r1 === r && b.c1 === c)) return;
			const down = reach(rows, b.r0, b.r1);
			const across = reach(cols, b.c0, b.c1);
			if (!down || !across) return;
			const at = { r: rows.indexOf(r), c: cols.indexOf(c) };
			const kept = at.r >= 0 && at.c >= 0;
			const corner = kept ? grid[at.r]![at.c]! : unspanned(cellAt(before, r, c));
			if (kept) grid[at.r]![at.c] = emptyCell();
			grid[down.from]![across.from] = spanning(
				corner,
				across.to - across.from + 1,
				down.to - down.from + 1
			);
		})
	);
	return fromRows(after, grid);
}

/** The identity line map over `n` lines. */
const lines = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

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
	const next = normalizeTable({
		...props,
		rows: [...props.rows.slice(0, at), fresh, ...props.rows.slice(at)]
	});
	const map = lines(rowCount(props));
	map.splice(at + 1, 0, -1);
	return carrySpans(props, next, map, lines(columnCount(props)));
}

/** Drop row `r`, the header included: the row left at index 0 is the header, which is
 *  how a table whose first row went still has one. A no-op at the last row, that being
 *  the removal of the table rather than of a row, and the island's own to answer. */
export function deleteRow(props: TableProps, r: number): TableProps {
	const rows = allRows(props);
	if (rows.length <= 1 || r < 0 || r >= rows.length) return normalizeTable(props);
	const map = lines(rows.length).filter((i) => i !== r);
	return carrySpans(
		props,
		fromRows(
			props,
			rows.filter((_, i) => i !== r)
		),
		map,
		lines(columnCount(props))
	);
}

/** A new empty column after column `c`. */
export function insertColumn(props: TableProps, c: number): TableProps {
	const at = Math.max(0, Math.min(c + 1, columnCount(props)));
	const splice = <T>(xs: T[], fresh: T): T[] => [...xs.slice(0, at), fresh, ...xs.slice(at)];
	const next = normalizeTable({
		...props,
		header: splice(props.header, emptyCell()),
		rows: props.rows.map((row) => splice(row, emptyCell())),
		aligns: splice(props.aligns, 'none'),
		widths: props.widths && splice(props.widths, null)
	});
	return carrySpans(props, next, lines(rowCount(props)), splice(lines(columnCount(props)), -1));
}

/** Drop column `c`; a no-op at one column (a table has at least one). */
export function deleteColumn(props: TableProps, c: number): TableProps {
	if (columnCount(props) <= 1) return normalizeTable(props);
	const drop = <T>(xs: T[]) => xs.filter((_, i) => i !== c);
	const next = normalizeTable({
		...props,
		header: drop(props.header),
		rows: props.rows.map(drop),
		aligns: drop(props.aligns),
		widths: props.widths && drop(props.widths)
	});
	return carrySpans(props, next, lines(rowCount(props)), drop(lines(columnCount(props))));
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
	return carrySpans(
		props,
		fromRows(props, move(rows, r, to)),
		move(lines(rows.length), r, to),
		lines(columnCount(props))
	);
}

/** Column `c` moved by `by` places, clamped. `aligns` and `widths` travel with the
 *  column: each is the column's property, so a move that left it behind would retint
 *  or resize the column that took the index. */
export function moveColumn(props: TableProps, c: number, by: number): TableProps {
	const to = Math.max(0, Math.min(c + by, columnCount(props) - 1));
	if (c === to || c < 0 || c >= columnCount(props)) return normalizeTable(props);
	const shift = <T>(xs: T[]): T[] => move(xs, c, to);
	const next = normalizeTable({
		...props,
		header: shift(props.header),
		rows: props.rows.map(shift),
		aligns: shift(props.aligns),
		widths: props.widths && shift(props.widths)
	});
	return carrySpans(props, next, lines(rowCount(props)), shift(lines(columnCount(props))));
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

/** Draw the first row as a header or as a body row: what the header toggle writes
 *  (`table-view.ts`). */
export function setHeadless(props: TableProps, headless: boolean): TableProps {
	return normalizeTable({ ...props, headless: headless || undefined });
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

/** Whether two tables have the same rectangle, alignment, header, widths and merged
 *  cells: the change that forces a rebuild rather than a per-cell reseed. */
export function shapeEqual(a: TableProps, b: TableProps): boolean {
	return (
		a.rows.length === b.rows.length &&
		a.aligns.length === b.aligns.length &&
		a.aligns.every((x, i) => x === b.aligns[i]) &&
		!a.headless === !b.headless &&
		valueEqual(a.widths, b.widths) &&
		valueEqual(cellBlocks(a), cellBlocks(b))
	);
}
