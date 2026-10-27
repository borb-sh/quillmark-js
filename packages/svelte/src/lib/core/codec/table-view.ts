// The table island's NodeView: the surface a `table` island is edited through
// (CODEC §"The table island"). Vanilla DOM rather than Svelte chrome, because what
// it renders is PM's own: a leaf node's substitute DOM, holding one nested
// `EditorView` per cell.
//
// A cell is a second content unit inside the first, so it gets its own schema (one
// paragraph with hard breaks, no containers, no islands, marks and input rules intact);
// `table.ts` owns that translation. A cell edit does not touch the field's text:
// the projection goes back onto the node's `props` attribute with `setNodeMarkup`,
// and the field's own `dispatchTransaction` lowers that to an `islandOps` `set`
// (CODEC §Encode), which is what keeps every anchor in the field.
//
// The nested views are not the field's: they carry no history (Mod-z routes to the
// field's, so one undo stack covers the leaf), no anchor plugin (an anchor in a cell
// is preserved, never minted), and no placeholder.
//
// The chrome is a band and a selection (CODEC §"The table island"), and the band raises
// nothing: what floats over the grid is a held column's alignment or the held first
// row's header toggle. Every control is absolutely positioned out of the grid, so none
// is in a row or a column of it; `codec/prose.css` draws the band, the clusters and the
// selection wash.
import { baseKeymap, chainCommands, selectAll, toggleMark } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import {
	EditorState,
	NodeSelection,
	Selection,
	TextSelection,
	type Command
} from 'prosemirror-state';
import { EditorView, type NodeView, type NodeViewConstructor } from 'prosemirror-view';
import type { TableCell, TableProps } from '@quillmark/wasm';
import { decode } from './decode.js';
import { inputRulesPlugin, undoRuleKeymap } from './inputrules.js';
import { linkPastePlugin } from './link-paste.js';
import { tablePropsOfNode } from './islands.js';
import { tableElement, tableText } from './table-copy.js';
import { breakKeymap } from './breaks.js';
import { cellSchema } from './schema.js';
import {
	ALIGNS,
	anchorAt,
	canMerge,
	cellAt,
	closeBlock,
	cellContent,
	cellEqual,
	cellFromDoc,
	clearCells,
	columnCount,
	deleteColumn,
	deleteRow,
	insertColumn,
	insertRow,
	mergeCells,
	moveColumn,
	moveRow,
	normalizeTable,
	rowCells,
	rowCount,
	rowEmpty,
	setAlign,
	setHead,
	headRows,
	columnShares,
	setWidths,
	shapeEqual,
	spanGrid,
	splitCell,
	withCell,
	type Span,
	type TableAlign
} from './table.js';

/** Everything the island's chrome says. Accessible names, not decoration: every
 *  control here is a bar, so an untranslated one reads the wrong language rather than
 *  merely inconsistent (VISUAL_EDITOR §"What the surface says"). */
export interface TableChromeStrings {
	/** The island's own name, on the wrapper. */
	tableLabel: string;
	/** Row 0 is the header, which is not "Row 0". */
	tableHeaderRow: string;
	tableRow: (index: number) => string;
	tableColumn: (index: number) => string;
	/** A cell's accessible name: nothing else names a nested leaf. */
	tableCell: (row: string, column: string) => string;
	/** A grip's name. It selects its line, and the verbs are then the selection's
	 *  (Backspace, Alt+arrows) or the drag's, so the name is the gesture. Row 0 takes a
	 *  name of its own for the reason it takes one above: the gesture is every other
	 *  row's, but the line it names is still the header and not "row 0". */
	tableSelectHeaderRow: string;
	tableSelectRow: (index: number) => string;
	tableSelectColumn: (index: number) => string;
	/** The two trailing bars, each of which grows the table along its own axis. */
	tableAddRow: string;
	tableAddColumn: string;
	/** The held column's alignment cluster, a name per toggle. */
	tableAlignLeft: string;
	tableAlignCenter: string;
	tableAlignRight: string;
	/** The held first row's toggle, pressed while the row draws as the header. */
	tableHeaderToggle: string;
	/** The held cells' cluster: one cell from the block, and the merged cells in it back
	 *  to the cells under them. */
	tableMergeCells: string;
	tableSplitCell: string;
}

/**
 * The package's English for the island chrome. It lives here, beside the surface
 * that draws it, rather than in the visual tier's table: the codec mounts this
 * chrome and a consumer reaching `createField` directly gets wording with it. The
 * visual `strings` set extends this one, so a consumer overrides these keys beside
 * every other key and there is still one English list.
 */
export const DEFAULT_TABLE_STRINGS: TableChromeStrings = {
	tableLabel: 'Table',
	tableHeaderRow: 'Header row',
	tableRow: (index) => `Row ${index}`,
	tableColumn: (index) => `Column ${index}`,
	tableCell: (row, column) => `${row}, ${column}`,
	tableSelectHeaderRow: 'Select header row',
	tableSelectRow: (index) => `Select row ${index}`,
	tableSelectColumn: (index) => `Select column ${index}`,
	tableAddRow: 'Add row',
	tableAddColumn: 'Add column',
	tableAlignLeft: 'Align left',
	tableAlignCenter: 'Align center',
	tableAlignRight: 'Align right',
	tableHeaderToggle: 'Header row',
	tableMergeCells: 'Merge cells',
	tableSplitCell: 'Split cell'
};

/** What the field hands each island view: its wording (read live, so a locale swap
 *  re-renders) and the callbacks that keep a nested view visible to the leaf. */
export interface TableViewDeps {
	strings: () => TableChromeStrings;
	/** Register a mounted cell view; the returned function unregisters it. The field
	 *  needs the set to answer "which view holds the caret" for the format popover. */
	register: (view: EditorView) => () => void;
	/** A cell took focus: the leaf's own `focus` handler never fires for one (a focus
	 *  event does not bubble), so the active address would not follow the caret. */
	onCellFocus: () => void;
	/** The clearance a revealed caret keeps, in the leaf's own line box (`field.ts`), which
	 *  is a cell's line box too. `undefined` where the derivation is out of reach (jsdom),
	 *  which is PM's 5px default. */
	clearance: number | undefined;
}

/** The grip's glyph, as the path data a DOM node can carry — this chrome's own set rather
 *  than `visual/icons/nodes.ts`, this being the one place chrome is built without Svelte,
 *  and `/core` reaching no surface module. Same 24×24 frame and the same origin, off an
 *  earlier release than the set there; `NOTICE` carries the notices for both. The dots
 *  are zero-length strokes under a round cap, which is how that set draws a dot
 *  everywhere it has one. */
const GRIP: Record<Axis, string[]> = {
	column: ['M5 9h.01', 'M12 9h.01', 'M19 9h.01', 'M5 15h.01', 'M12 15h.01', 'M19 15h.01'],
	row: ['M9 5h.01', 'M9 12h.01', 'M9 19h.01', 'M15 5h.01', 'M15 12h.01', 'M15 19h.01']
};

/** An alignment a press sets: every one but `none`, which is what a column arrives at. */
type Aligned = Exclude<TableAlign, 'none'>;

/** The alignments the cluster draws and Shift+arrow steps through, in that order. */
const SETTABLE = ALIGNS.filter((a): a is Aligned => a !== 'none');

/** The cluster's glyphs, off the same release as the grip's. */
const ALIGN_GLYPH: Record<Aligned, string[]> = {
	left: ['M21 6H3', 'M15 12H3', 'M17 18H3'],
	center: ['M21 6H3', 'M17 12H7', 'M19 18H5'],
	right: ['M21 6H3', 'M21 12H9', 'M21 18H7']
};

/** The header toggle's glyph, off the same release: a frame with its top band ruled off. */
const HEADER_GLYPH = [
	'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
	'M3 9h18'
];

/** Draw a cell's alignment on its box: its own where it holds one, its column's
 *  otherwise, and the vertical one where it holds one. */
function layCell(box: HTMLElement, props: TableProps, r: number, c: number): void {
	const cell = cellAt(props, r, c);
	const column = props.aligns[c] ?? 'none';
	box.style.textAlign = cell.align ?? (column === 'none' ? '' : column);
	box.style.verticalAlign = cell.valign ?? '';
}

/** The cells of an inclusive rectangle, in reading order. */
function allCells(props: TableProps, held: Cells): TableCell[] {
	const out: TableCell[] = [];
	for (let r = held.r0; r <= held.r1; r++)
		for (let c = held.c0; c <= held.c1; c++) out.push(cellAt(props, r, c));
	return out;
}

/** A glyph's marks at `weight`: the set's own is 2, and the grip takes 3, its marks being
 *  dots, which at the line weight of a stroke disappear at the size the bar renders. */
function svg(paths: string[], weight: number): SVGElement {
	const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	el.setAttribute('viewBox', '0 0 24 24');
	el.setAttribute('fill', 'none');
	el.setAttribute('stroke', 'currentColor');
	el.setAttribute('stroke-width', String(weight));
	el.setAttribute('stroke-linecap', 'round');
	el.setAttribute('stroke-linejoin', 'round');
	el.setAttribute('aria-hidden', 'true');
	for (const d of paths) {
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', d);
		el.appendChild(path);
	}
	return el;
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	return node;
}

/** A band button. It swallows its own `mousedown` (prosemirror-menu's trick, and
 *  the format popover's): without it the browser focuses the button, blurring the
 *  cell whose caret the op is about to be measured against. No control on the band ever
 *  holds the focus: a cell is the island's one host, and what a press acts on is where
 *  it lands the caret. */
function chromeButton(className: string, label: string, run: () => void): HTMLButtonElement {
	const btn = el('button', className);
	btn.type = 'button';
	btn.title = label;
	btn.setAttribute('aria-label', label);
	btn.addEventListener('mousedown', (e) => e.preventDefault());
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		run();
	});
	return btn;
}

/** A cell's plugin stack: marks, the markdown shorthands and a pasted URL's link, and
 *  nothing that belongs to the field (history, anchors, the ghost). */
function cellPlugins(keys: Record<string, Command>) {
	return [
		inputRulesPlugin(cellSchema),
		undoRuleKeymap(),
		linkPastePlugin(cellSchema.marks.link),
		keymap(keys),
		keymap(baseKeymap)
	];
}

/** The controls, each of which answers for its own press. Spelled apart from
 *  {@link owned} because the pointer router needs them before it needs the cells: a grip
 *  and a cluster are inside the cell they name, so the two selectors overlap on exactly
 *  the press whose reading they disagree about. */
const CONTROLS = '.qm-table-grip, .qm-table-add, .qm-table-align, .qm-table-resize';

/** What the nested views and the band answer for themselves, which is what `stopEvent`
 *  keeps from PM. */
const OWNED = `.qm-table-cell-host, ${CONTROLS}`;

/** How far a press travels before it is a drag rather than a click. Under it, a press
 *  that jitters is still the gesture it was aimed as. */
const DEAD_ZONE = 3;

/** A line's key in the grip registry, spelled once. */
const lineKey = (line: Line): string => `${line.axis}:${line.index}`;

/** A viewport point: where a press landed, which is the only thing the two bands are
 *  told apart by. */
interface Point {
	x: number;
	y: number;
}

const within = (rect: DOMRect, p: Point): boolean =>
	p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;

/** A point's distance to a rect: zero inside it, the gap to the nearest edge outside. */
function distance(rect: DOMRect, p: Point): number {
	return Math.hypot(
		Math.max(rect.left - p.x, 0, p.x - rect.right),
		Math.max(rect.top - p.y, 0, p.y - rect.bottom)
	);
}

interface MountedCell {
	view: EditorView;
	/** The cell's box, which the nearest-cell measure reads: the view's own `dom` is
	 *  the contenteditable inside it and stops at the text. */
	host: HTMLElement;
	/** The `td`/`th` itself: what the selection wash and a drop's extent are measured
	 *  and painted on. Held rather than queried, so `r`/`c` stay the typed pair above
	 *  instead of a `data-` attribute parsed back out of the DOM. */
	box: HTMLElement;
	/** The cell value this view is displaying, which is what tells an own edit from an
	 *  external one in {@link TableIslandView.update}. Held rather than projected back
	 *  off the doc: `cellFromDoc` crosses the WASM boundary once per cell holding an
	 *  anchor, and both paths that move a nested doc have the value already. */
	shown: TableCell;
	unregister: () => void;
	r: number;
	c: number;
	/** The columns and rows the cell spans: one each unless it is merged. */
	span: Span;
}

/** Whether a mounted cell's span reaches into an inclusive block. */
const touches = (m: MountedCell, b: { r0: number; c0: number; r1: number; c1: number }): boolean =>
	m.r <= b.r1 &&
	m.r + m.span.rowspan - 1 >= b.r0 &&
	m.c <= b.c1 &&
	m.c + m.span.colspan - 1 >= b.c0;

/** Whether a mounted cell's span covers the slot `(r, c)`. */
const covers = (m: MountedCell, r: number, c: number): boolean =>
	touches(m, { r0: r, c0: c, r1: r, c1: c });

/** Which line a gesture acts on. `row` is in the chrome's row space (0 is the
 *  header), `column` in the column space. */
type Axis = 'row' | 'column';

interface Line {
	axis: Axis;
	index: number;
}

/**
 * The selected cells: an inclusive rectangle in the chrome's coordinate space.
 * NodeView-local state rather than a PM `Selection`, because nothing outside this
 * island can name it: a cell index inside one leaf is not a position in the document's
 * coordinate space, and a custom `Selection` would have to be one to be dispatched.
 *
 * `swept` is how the rectangle was drawn, and the verbs read it: a grip, Escape or
 * select-all names lines, and a pointer travelling across cells holds those cells. A
 * named line is what Backspace deletes and an arrow steps; swept cells are text, which
 * Backspace clears and an arrow lets go of, whatever lines they happen to span.
 */
interface Cells {
	r0: number;
	c0: number;
	r1: number;
	c1: number;
	swept: boolean;
}

const sameCells = (a: Cells, b: Cells): boolean =>
	a.r0 === b.r0 && a.c0 === b.c0 && a.r1 === b.r1 && a.c1 === b.c1 && a.swept === b.swept;

/** The block two corners span, in either order: what a sweep holds. */
const spanCells = (a: { r: number; c: number }, b: { r: number; c: number }): Cells => ({
	r0: Math.min(a.r, b.r),
	c0: Math.min(a.c, b.c),
	r1: Math.max(a.r, b.r),
	c1: Math.max(a.c, b.c),
	swept: true
});

/** A drag in flight: the line lifted, where the press started, and whether it has
 *  passed the dead zone yet.
 *
 *  `lines` is the geometry, read once when the drag engages. Nothing reflows between
 *  the press and the release (the lift is a tone and the drop rule is out of flow), so
 *  a rect per pointermove would re-measure an unchanged table: at 20x8 that is 150
 *  forced layouts an event. */
interface Drag {
	line: Line;
	origin: Point;
	engaged: boolean;
	/** Where the line would land on release, in the same space as `line.index`. */
	drop: number;
	/** The last drop index painted, so a move inside the same line draws nothing. */
	painted: number;
	pointerId: number;
	grip: HTMLButtonElement;
	/** Each line's extent along the drag's axis, by index, plus the frame's origin. */
	lines: { index: number; start: number; end: number; cross: number; span: number }[];
	origin0: { left: number; top: number };
}

/** A block selection in flight: the cell the press landed in, and the cell boxes a
 *  pointer resolves against — measured once at engage, for the reason a line drag
 *  measures once. `live` is what keeps a press that jitters inside its own cell a
 *  caret: the gesture becomes a selection only once it has left that cell. */
interface Sweep {
	origin: { r: number; c: number };
	from: Point;
	engaged: boolean;
	live: boolean;
	boxes: { r: number; c: number; rect: DOMRect }[];
}

/** A column border in flight: the two columns either side of it, measured at the press,
 *  and the narrowest either may reach, which is a cell's own measure floor. */
interface Resize {
	c: number;
	handle: HTMLElement;
	pointerId: number;
	from: number;
	widths: number[];
	floor: number;
	engaged: boolean;
}

/** Each mounted island drawing a table, by its `dom`, which is what the outer view hands
 *  back for a position: how a key in the field reaches into a table ({@link tableAt}). A
 *  placeholder is absent, so it answers as the atom it draws. */
const mounted = new WeakMap<Node, TableIslandView>();

/** A caret in the grid: its cell by position, and its offset in that cell's doc. */
interface Seat {
	r: number;
	c: number;
	head: number;
}

/**
 * Where the caret stood as each table value was written over, keyed by that value. An
 * undo hands the node back the very `props` object the undone edit replaced, so the seat
 * held against it is where the edit was made from: where PM's history puts the caret
 * back in a field's own text.
 */
const departures = new WeakMap<TableProps, Seat>();

class TableIslandView implements NodeView {
	readonly dom: HTMLElement;
	private cells: MountedCell[] = [];
	/** The props the current DOM was built from: what an `update` compares against to
	 *  tell a reseed from a rebuild. */
	private rendered: TableProps | undefined;
	private selected: Cells | undefined;
	private drag: Drag | undefined;
	private sweep: Sweep | undefined;
	/** The grips, by the line each acts on: what selection paint and a drag reach for
	 *  without a query. The typed twin of `cells`, `Line` included — a key parsed back
	 *  into one is the `data-` attribute `MountedCell.box` refuses. */
	private grips = new Map<string, { line: Line; grip: HTMLButtonElement }>();
	/** The alignment clusters, by column. */
	private clusters: HTMLElement[] = [];
	/** The first row's header toggle, up while that row is held. */
	private headerCluster: HTMLElement | undefined;
	/** The merge and split cluster, hung under the held block's first cell or the caret's
	 *  merged cell while either is up. */
	private cellCluster: HTMLElement | undefined;
	/** The rail's cells, one per column: a row of no height above the first, which the
	 *  column chrome hangs off, a merged cell in the first row standing over several. */
	private rails: HTMLElement[] = [];

	/** The grid's own box, and the containing block every out-of-flow control is placed
	 *  against. Not the scroller: an absolute inside a scroll container is placed
	 *  against a padding box the scroll then slides out from under, so a control at the
	 *  grid's far end would drift into the middle of it. */
	private frame: HTMLElement | undefined;
	private dropMark: HTMLElement | undefined;
	/** The grid's `<col>`s, which a border drag sizes live and a render sizes from the
	 *  stored weights. */
	private cols: HTMLTableColElement[] = [];
	private resize: Resize | undefined;
	/** A drag's trailing `click`, which would otherwise re-select the moved line. */
	private suppressClick = false;
	/** The grips of the row and column under the pointer, drawn up. */
	private near: HTMLButtonElement[] = [];

	constructor(
		private node: PMNode,
		private readonly outer: EditorView,
		private readonly getPos: () => number | undefined,
		private readonly deps: TableViewDeps
	) {
		this.dom = el('div', 'qm-island qm-table-island');
		this.dom.setAttribute('data-qm-island', node.attrs.islandType as string);
		this.dom.setAttribute('data-qm-island-id', node.attrs.id as string);
		this.dom.addEventListener('mousedown', this.onPointerDown);
		this.dom.addEventListener('mouseover', this.onHover);
		this.dom.addEventListener('mouseleave', this.onLeave);
		this.dom.addEventListener('copy', this.onCopy, true);
		this.render();
	}

	// ── PM's NodeView contract ────────────────────────────────────────────────

	update(node: PMNode): boolean {
		if (node.type !== this.node.type) return false;
		const before = this.rendered;
		this.node = node;
		const props = tablePropsOfNode(node);
		if (!props || !before || !shapeEqual(before, props)) {
			this.render();
			return true;
		}
		// Same rectangle: reseed only the cells whose value the nested view is not
		// already showing. The cell that produced this update wrote exactly what it is
		// showing, so it compares equal and keeps its caret; an undo or an external
		// re-hydrate does not, and takes the fresh state.
		//
		// Against `shown` rather than a projection of the doc: this runs on every outer
		// transaction, which is every keystroke in the table, and projecting each cell
		// costs a `mapMarks` across the WASM boundary wherever one holds an anchor.
		this.rendered = props;
		const departure = departures.get(props);
		for (const mounted of this.cells) {
			const stored = cellAt(props, mounted.r, mounted.c);
			if (cellEqual(stored, mounted.shown)) continue;
			const head = mounted.view.state.selection.head;
			const fresh = EditorState.create({
				doc: decode(cellContent(stored), cellSchema),
				plugins: cellPlugins(this.cellKeys(mounted.r, mounted.c))
			});
			mounted.view.updateState(fresh);
			mounted.shown = stored;
			// The rule a field's own re-hydrate takes: keep the offset, clamped into the
			// text that is there now, a fresh state resolving to the cell's start. An undo
			// outranks it below, the departure being where the edit was.
			const at = Math.min(head, fresh.doc.content.size);
			mounted.view.dispatch(fresh.tr.setSelection(Selection.near(fresh.doc.resolve(at))));
		}
		if (departure && this.focusedSeat()) this.focusCell(departure.r, departure.c, departure.head);
		// A cell's alignment is no part of its text, so it is restated on every box: the
		// reseed above compares text and marks alone.
		for (const mounted of this.cells) layCell(mounted.box, props, mounted.r, mounted.c);
		this.paintSelection();
		return true;
	}

	/** The nested views own every event inside a cell or a control; everything else
	 *  stays PM's, so a key pressed over a selected island still reaches the field's
	 *  keymap. What a pointer press means on the rest of the chrome is
	 *  {@link TableIslandView.onPointerDown}'s and not this one's: `stopEvent` gates
	 *  the whole subtree, so widening it would take that routing with it. */
	stopEvent(event: Event): boolean {
		const target = event.target as Element | null;
		return !!target?.closest?.(OWNED);
	}

	/** Nothing in this subtree is PM-managed: the cells are separate views. */
	ignoreMutation(): boolean {
		return true;
	}

	destroy(): void {
		this.dom.removeEventListener('mousedown', this.onPointerDown);
		this.dom.removeEventListener('mouseover', this.onHover);
		this.dom.removeEventListener('mouseleave', this.onLeave);
		this.dom.removeEventListener('copy', this.onCopy, true);
		this.endDrag();
		this.endSweep();
		this.endResize();
		this.teardownCells();
	}

	// ── The pointer ───────────────────────────────────────────────────────────

	/**
	 * Route a press to its band (CODEC §"The table island"): inside the frame the
	 * nearest cell's caret, outside it the document's, and a band control answers for
	 * itself.
	 *
	 * A press in a cell is a caret and the nested view is taking it; what is armed here
	 * is only the promotion, since a press that travels into another cell stops being a
	 * caret and becomes a block. That is the one gesture that has to see a press the
	 * nested view already owns, which is why it runs ahead of the cell host's guard
	 * rather than behind it. A control is the other way round: a grip is inside the cell
	 * it names, so its guard runs ahead of the cell branch, or a grip press would plant a
	 * caret in that cell and arm a sweep the drag then draws a block with.
	 *
	 * A `mousedown` listener, and it stops the event: PM's own mousedown is what arms
	 * the node selection the matching mouseup then takes. `stopEvent` is the other way
	 * to reach that, and it gates the subtree's keydown and drag routing too.
	 */
	private readonly onPointerDown = (event: MouseEvent): void => {
		// Any other island type is an atom with no interior: a press on it is
		// unambiguous, and PM's to answer. So is a secondary press, which types nothing.
		if (!this.rendered || event.button !== 0) return;
		const target = event.target as Element | null;
		if (target?.closest?.(CONTROLS)) return; // a control answers for itself
		const point = { x: event.clientX, y: event.clientY };
		const box = target?.closest?.('.qm-table-cell');
		const cell = box && this.cells.find((m) => m.box === box);
		if (cell) {
			// A fresh press in a cell means "caret here", so it retires whatever block was
			// held: a press back into the cell that already has focus raises no `focus`
			// event, and without this the block would survive to eat the next Backspace.
			this.clearSelection();
			// A cell's own padding and its borders are the table's, not the view's: a press
			// there lands the caret it aimed at rather than nothing.
			if (!target?.closest?.('.qm-table-cell-host')) {
				event.preventDefault();
				event.stopPropagation();
				this.focusCell(cell.r, cell.c);
			}
			this.armSweep(cell, point);
			return;
		}
		// Past the control guard and the cell branch, the press is on the island's own
		// space: the band's padding, or the frame beside the grid.
		event.preventDefault();
		event.stopPropagation();
		const grid = this.dom.querySelector('.qm-table');
		if (grid && within(grid.getBoundingClientRect(), point)) this.focusNearestCell(point);
		else this.caretBeside(point);
	};

	/** A cell under the pointer draws its row's and its column's grips, so a line's
	 *  handle is found from the line rather than only from the band beside it. A control
	 *  under the pointer is its own reveal, and draws no other. */
	private readonly onHover = (event: MouseEvent): void => {
		const target = event.target as Element | null;
		const box = target?.closest?.(CONTROLS) ? null : target?.closest?.('.qm-table-cell');
		const cell = box ? this.cells.find((m) => m.box === box) : undefined;
		const next = cell
			? [
					this.grips.get(lineKey({ axis: 'row', index: cell.r }))?.grip,
					this.grips.get(lineKey({ axis: 'column', index: cell.c }))?.grip
				].filter((grip): grip is HTMLButtonElement => !!grip)
			: [];
		for (const grip of this.near) if (!next.includes(grip)) grip.removeAttribute('data-near');
		for (const grip of next) grip.setAttribute('data-near', '');
		this.near = next;
	};

	private readonly onLeave = (): void => {
		for (const grip of this.near) grip.removeAttribute('data-near');
		this.near = [];
	};

	/** A copy over a held rectangle writes its cells (`table-copy.ts`). Captured, since the
	 *  caret's cell would otherwise copy its own text selection over them. */
	private readonly onCopy = (event: ClipboardEvent): void => {
		const held = this.selected;
		if (!held || !event.clipboardData) return;
		const props = this.props();
		event.clipboardData.setData('text/html', tableElement(props, held).outerHTML);
		event.clipboardData.setData('text/plain', tableText(props, held));
		event.preventDefault();
		event.stopPropagation();
	};

	/** The cell a press inside the frame belongs to: the nearest by rect, which for a
	 *  press on a border or a cell's own padding is the cell it is against.
	 *
	 *  A row's cells share a vertical extent and a column's a horizontal one, and the
	 *  distance is a hypotenuse of the two, so the nearest cell is the nearest row
	 *  crossed with the nearest column: the header row and the first column answer for
	 *  the whole grid. R+C rects rather than R×C, for the reason a line drag measures
	 *  once — at 20x8 that is 27 forced layouts a press instead of 160. */
	private focusNearestCell(point: Point): void {
		let row: number | undefined;
		let column: number | undefined;
		let nearestRow = Infinity;
		let nearestColumn = Infinity;
		for (const mounted of this.cells) {
			if (mounted.c !== 0 && mounted.r !== 0) continue;
			const box = mounted.host.getBoundingClientRect();
			if (mounted.c === 0) {
				const at = Math.max(box.top - point.y, 0, point.y - box.bottom);
				if (at < nearestRow) {
					nearestRow = at;
					row = mounted.r;
				}
			}
			if (mounted.r === 0) {
				const at = Math.max(box.left - point.x, 0, point.x - box.right);
				if (at < nearestColumn) {
					nearestColumn = at;
					column = mounted.c;
				}
			}
		}
		if (row !== undefined && column !== undefined) this.focusCell(row, column);
	}

	/** A caret beside the island, on the side the press landed: a gap cursor where the
	 *  document holds no text position there, and the neighbouring block's own edge
	 *  where it holds one.
	 *
	 *  The gap is asked for through the plugin's own `createSelectionBetween` rather
	 *  than built here: whether a position takes one is the gap cursor's rule, and a
	 *  leaf mounted without that plugin then answers "no gap" instead of dispatching
	 *  a selection nothing draws. */
	private caretBeside(point: Point): void {
		const box = this.dom.getBoundingClientRect();
		this.leave(point.y < (box.top + box.bottom) / 2 ? -1 : 1);
	}

	/** Land the document's caret on one side of the island, by
	 *  {@link TableIslandView.caretBeside}'s rule; false where that side holds no caret. */
	private leave(side: -1 | 1): boolean {
		const pos = this.getPos();
		if (pos == null) return false;
		const $at = this.outer.state.doc.resolve(side < 0 ? pos : pos + this.node.nodeSize);
		const selection =
			this.outer.someProp('createSelectionBetween', (f) => f(this.outer, $at, $at)) ??
			Selection.findFrom($at, side, true);
		if (!selection) return false;
		this.outer.focus();
		this.outer.dispatch(this.outer.state.tr.setSelection(selection));
		return true;
	}

	/** Land the caret in the table from the block beside it: its last cell's end from
	 *  below, its first cell's start from above. */
	enter(side: -1 | 1): void {
		const props = this.props();
		if (side < 0) this.focusCell(rowCount(props) - 1, columnCount(props) - 1, 'end');
		else this.focusCell(0, 0, 'start');
	}

	/** The island as the selection: the Escape that climbs out of a cell or a held
	 *  rectangle, which is the whole of what selects it. Backspace there deletes the
	 *  table, as it does over every other island; the cell selection covering every rank
	 *  reaches the same delete without leaving the grid (CODEC §"The table island"). */
	private selectIsland(): void {
		const pos = this.getPos();
		if (pos == null) return;
		this.clearSelection();
		this.outer.focus();
		this.outer.dispatch(
			this.outer.state.tr.setSelection(NodeSelection.create(this.outer.state.doc, pos))
		);
	}

	// ── Sweeping a block of cells ─────────────────────────────────────────────

	private armSweep(origin: MountedCell, from: Point): void {
		this.endSweep();
		this.sweep = {
			origin: { r: origin.r, c: origin.c },
			from,
			engaged: false,
			live: false,
			boxes: []
		};
		document.addEventListener('mousemove', this.onSweepMove, true);
		document.addEventListener('mouseup', this.onSweepUp, true);
	}

	/**
	 * Promote a travelling press to a block. Until the pointer leaves the cell it
	 * started in the gesture is still a caret and the nested view keeps it; from the
	 * first cell it crosses, the block is the selection and the browser's own text drag
	 * is dropped, two selections over one press being one too many.
	 */
	private readonly onSweepMove = (event: MouseEvent): void => {
		const sweep = this.sweep;
		if (!sweep) return;
		const at = { x: event.clientX, y: event.clientY };
		if (!sweep.engaged) {
			if (Math.hypot(at.x - sweep.from.x, at.y - sweep.from.y) < DEAD_ZONE) return;
			sweep.engaged = true;
			sweep.boxes = this.cells.map((m) => ({
				r: m.r,
				c: m.c,
				rect: m.box.getBoundingClientRect()
			}));
		}
		const head = this.cellNear(sweep.boxes, at);
		if (!head) return;
		if (!sweep.live && head.r === sweep.origin.r && head.c === sweep.origin.c) return;
		sweep.live = true;
		this.select(spanCells(sweep.origin, head));
		document.getSelection()?.removeAllRanges();
		event.preventDefault();
	};

	private readonly onSweepUp = (): void => this.endSweep();

	private endSweep(): void {
		if (!this.sweep) return;
		this.sweep = undefined;
		document.removeEventListener('mousemove', this.onSweepMove, true);
		document.removeEventListener('mouseup', this.onSweepUp, true);
	}

	/** The cell a point is in, or the nearest one outside the grid: a sweep that runs
	 *  past the last row still names a cell, which is what lets it reach the edge. */
	private cellNear(
		boxes: { r: number; c: number; rect: DOMRect }[],
		at: Point
	): { r: number; c: number } | undefined {
		let best: { r: number; c: number } | undefined;
		let nearest = Infinity;
		for (const box of boxes) {
			const gap = distance(box.rect, at);
			if (gap >= nearest) continue;
			nearest = gap;
			best = { r: box.r, c: box.c };
		}
		return best;
	}

	// ── The selection ─────────────────────────────────────────────────────────

	/** The rectangle a line covers, which is what selecting one means: a grip draws no
	 *  second kind of selection, it draws this one. `props` is the caller's where it
	 *  reads a line per grip ({@link TableIslandView.paintSelection}): each `props()`
	 *  revalidates the whole table. */
	private lineCells(line: Line, props: TableProps = this.props()): Cells {
		return line.axis === 'row'
			? { r0: line.index, c0: 0, r1: line.index, c1: columnCount(props) - 1, swept: false }
			: { r0: 0, c0: line.index, r1: rowCount(props) - 1, c1: line.index, swept: false };
	}

	/** The index space an axis allows, which is the whole of it on both. The header is
	 *  row 0 rather than a line above the floor: a walk reaches it, a drag lands on it,
	 *  and the row that lands there is the header (`table.ts` §{@link moveRow}). */
	private bounds(axis: Axis, props: TableProps): { floor: number; limit: number } {
		return axis === 'row'
			? { floor: 0, limit: rowCount(props) - 1 }
			: { floor: 0, limit: columnCount(props) - 1 };
	}

	/** Select a line, and land the caret on it. The line verbs bind in the cell
	 *  (CODEC §"The table island"), so the rectangle has to run through the caret for the
	 *  next key to read a line off it. The focus moves first and the paint follows: a cell
	 *  taking the focus retires whatever was held. */
	private selectLine(line: Line): void {
		this.carryCaret(line);
		this.select(this.lineCells(line));
	}

	/** Put the caret on the line, keeping its other coordinate, and leave it exactly
	 *  where it is on a line it is already in: a walk down the rows stays in its column,
	 *  and a grip press on the caret's own row does not shunt it to a cell's end. */
	private carryCaret(line: Line): void {
		const held = this.cells.find((m) => m.view.hasFocus());
		if (line.axis === 'row') {
			if (held?.r !== line.index) this.focusCell(line.index, held?.c ?? 0);
		} else if (held?.c !== line.index) this.focusCell(held?.r ?? 0, line.index);
	}

	/** Which line the held rectangle names, on one axis: a row spanning every column, a
	 *  column spanning every row, and nothing for a block that spans neither or for cells
	 *  a sweep holds, which are text however many lines they cross. */
	private lineOn(axis: Axis): number | undefined {
		const held = this.selected;
		if (!held || held.swept) return undefined;
		const props = this.props();
		if (axis === 'row')
			return held.r0 === held.r1 && held.c0 === 0 && held.c1 === columnCount(props) - 1
				? held.r0
				: undefined;
		return held.c0 === held.c1 && held.r0 === 0 && held.r1 === rowCount(props) - 1
			? held.c0
			: undefined;
	}

	private select(held: Cells): void {
		// A block over part of a merged cell holds all of it, as the cell is one.
		const cells = held.swept ? { ...closeBlock(this.props(), held), swept: true } : held;
		// A sweep resolves a rectangle per pointer move and most of them are the one
		// already held, which is a repaint of the state that is up.
		if (this.selected && sameCells(this.selected, cells)) return;
		// One subject at a time: a cell selection retires an island one, or the surface
		// paints a washed row inside an outlined table and the next Backspace has two
		// honest readings.
		this.retireIsland();
		this.selected = cells;
		this.paintSelection();
	}

	/** Move the outer selection off this island when it holds it: a caret or a rectangle
	 *  inside the grid is the subject from then on, and an outline left on the table says
	 *  the next Backspace deletes it. */
	private retireIsland(): void {
		const pos = this.getPos();
		const outer = this.outer.state.selection;
		if (pos == null || !(outer instanceof NodeSelection) || outer.from !== pos) return;
		const $at = this.outer.state.doc.resolve(pos);
		const beside =
			this.outer.someProp('createSelectionBetween', (f) => f(this.outer, $at, $at)) ??
			Selection.findFrom($at, -1, true);
		if (beside) this.outer.dispatch(this.outer.state.tr.setSelection(beside));
	}

	private clearSelection(): void {
		if (!this.selected) return;
		this.selected = undefined;
		this.paintSelection();
	}

	/** Wash the selected cells, mark the grip of any line the selection exactly covers, and
	 *  put up the cluster of a column it covers. Imperative rather than a re-render: a
	 *  rebuild destroys the nested views, and a selection is exactly the state that must
	 *  not cost the carets in them. */
	private paintSelection(): void {
		const held = this.selected;
		const props = this.props();
		for (const { line, grip } of this.grips.values()) {
			const named = !!held && sameCells(held, this.lineCells(line, props));
			grip.setAttribute('aria-pressed', String(named));
			const cluster = line.axis === 'column' ? this.clusters[line.index] : undefined;
			if (cluster) cluster.hidden = !named;
			if (line.axis === 'row' && line.index === 0 && this.headerCluster)
				this.headerCluster.hidden = !named;
		}
		for (const cell of this.cells)
			cell.box.toggleAttribute('data-selected', !!held && touches(cell, held));
		this.paintCellCluster();
	}

	/** The merge and split cluster: up under the block's bottom-left cell, offering
	 *  Merge where the block is more than one cell and Split where it holds a merged one,
	 *  and under the caret's own cell where that is merged and nothing is held. */
	private paintCellCluster(): void {
		const cluster = this.cellCluster;
		if (!cluster) return;
		const props = this.props();
		const held = this.selected;
		const caret = held ? undefined : this.cells.find((m) => m.view.hasFocus());
		const block = held?.swept
			? held
			: caret && (caret.span.colspan > 1 || caret.span.rowspan > 1)
				? { r0: caret.r, c0: caret.c, r1: caret.r, c1: caret.c }
				: undefined;
		const merge = !!held && canMerge(props, held);
		const split =
			!!block &&
			this.cells.some((m) => touches(m, block) && (m.span.colspan > 1 || m.span.rowspan > 1));
		const host = block && this.cells.find((m) => covers(m, block.r1, block.c0));
		cluster.hidden = !host || (!merge && !split);
		if (cluster.hidden || !host) return cluster.remove();
		const [mergeBtn, splitBtn] = cluster.children as unknown as [HTMLElement, HTMLElement];
		mergeBtn.hidden = !merge;
		splitBtn.hidden = !split;
		if (cluster.parentElement !== host.box) host.box.appendChild(cluster);
	}

	/** Merge the held block into one cell, holding the caret in it. */
	private merge(): void {
		const held = this.selected;
		if (!held) return;
		const block = closeBlock(this.props(), held);
		this.selected = undefined;
		this.write(mergeCells(this.props(), block), { r: block.r0, c: block.c0 });
	}

	/** Split every merged cell the held block or the caret's cell holds. */
	private split(): void {
		const held = this.selected;
		const caret = held ? undefined : this.cells.find((m) => m.view.hasFocus());
		const block = held ?? (caret && { r0: caret.r, c0: caret.c, r1: caret.r, c1: caret.c });
		if (!block) return;
		let props = this.props();
		for (const m of this.cells)
			if (touches(m, block) && (m.span.colspan > 1 || m.span.rowspan > 1))
				props = splitCell(props, m.r, m.c);
		this.selected = undefined;
		this.write(props, { r: block.r0, c: block.c0 });
	}

	/**
	 * What Backspace means over the selection (CODEC §"The table island"). Swept cells
	 * clear and keep their lines. Named lines go, read off their extent: every rank on
	 * both axes is the table, which goes as the island, and on a one-column or one-row
	 * table a single grip draws that.
	 */
	private deleteSelection(): void {
		const held = this.selected;
		if (!held) return;
		const props = this.props();
		if (held.swept) {
			if (allCells(props, held).some((cell) => cell.text !== ''))
				this.write(clearCells(props, held.r0, held.c0, held.r1, held.c1));
			return;
		}
		const wide = held.c0 === 0 && held.c1 === columnCount(props) - 1;
		const tall = held.r0 === 0 && held.r1 === rowCount(props) - 1;
		if (tall && wide) return this.deleteIsland();
		if (tall) return this.dropColumns(held);
		if (wide) return this.dropRows(held);
		this.write(clearCells(props, held.r0, held.c0, held.r1, held.c1));
		this.select(held);
	}

	/** Delete the whole island: an ordinary delete on the outer view, so the table goes
	 *  the way the node selection's Backspace already took it and rides the same undo
	 *  stack. The selection is dropped without a repaint: the DOM holding it is about to
	 *  be gone. */
	private deleteIsland(): void {
		const pos = this.getPos();
		if (pos == null) return;
		this.selected = undefined;
		this.outer.focus();
		this.outer.dispatch(this.outer.state.tr.delete(pos, pos + this.node.nodeSize));
	}

	/** Drop the rows the selection covers, high index first so the ones still to go keep
	 *  their indices, and select whatever took the first one's place. The header is among
	 *  them like any other row, and the row left at index 0 is the header afterwards. One
	 *  `write`, so the whole gesture is one undo step. */
	private dropRows(held: Cells): void {
		let props = this.props();
		for (let r = held.r1; r >= held.r0; r--) props = deleteRow(props, r);
		this.write(props);
		this.selectLine({ axis: 'row', index: Math.min(held.r0, rowCount(this.props()) - 1) });
	}

	/** Drop the columns the selection covers, and select what took the first one's place —
	 *  the row arm's rule, spelled the same way, since a rank going is a rank going on
	 *  either axis. Neither this nor {@link TableIslandView.dropRows} can empty the table:
	 *  a rectangle covering every rank of its axis spans the other one too, which is the
	 *  island arm above, so a rank always survives here. */
	private dropColumns(held: Cells): void {
		let props = this.props();
		for (let c = held.c1; c >= held.c0; c--) props = deleteColumn(props, c);
		this.write(props);
		this.selectLine({ axis: 'column', index: Math.min(held.c0, columnCount(this.props()) - 1) });
	}

	/** Move the line and keep it selected: a move whose selection did not travel would
	 *  leave the next Alt+arrow acting on whatever took the index. */
	private moveLine(line: Line, by: number): void {
		const props = this.props();
		const { floor, limit } = this.bounds(line.axis, props);
		const to = Math.max(floor, Math.min(line.index + by, limit));
		if (to === line.index) return;
		this.write(
			line.axis === 'row' ? moveRow(props, line.index, by) : moveColumn(props, line.index, by)
		);
		this.selectLine({ axis: line.axis, index: to });
	}

	/** Set column `c`'s alignment, clear its cells' own, which would outrank it, and keep
	 *  the column held: a changed alignment rebuilds the views, which retires the selection
	 *  as a move's rebuild does. One `set` for both, and a column already at `to` with no
	 *  cell of its own writes nothing. */
	private align(c: number, to: Aligned): void {
		const props = this.props();
		const own = Array.from({ length: rowCount(props) }, (_, r) => cellAt(props, r, c)).some(
			(cell) => cell.align !== undefined
		);
		if (props.aligns[c] !== to || own) this.write(setAlign(props, c, to));
		this.selectLine({ axis: 'column', index: c });
	}

	// ── Drag to reorder ───────────────────────────────────────────────────────

	/**
	 * Press-and-drag a grip moves its line. The press still selects: the dead zone is
	 * what tells the two apart, so a click that jitters is the gesture it was aimed as
	 * and only a real travel becomes a drag.
	 */
	private readonly onGripDown = (
		line: Line,
		grip: HTMLButtonElement,
		event: PointerEvent
	): void => {
		if (event.button !== 0) return;
		// The previous gesture ends first, as `armSweep`'s does: `endDrag` reads
		// `this.drag` to know which grip to unbind, so a second press over a live drag
		// would orphan the first grip's listeners and its pointer capture.
		this.endDrag();
		this.drag = {
			line,
			origin: { x: event.clientX, y: event.clientY },
			engaged: false,
			drop: line.index,
			painted: -1,
			pointerId: event.pointerId,
			grip,
			lines: [],
			origin0: { left: 0, top: 0 }
		};
		// Optional for the reason the release is: pointer capture is the browser's, and a
		// DOM without it still routes the move and up events the drag reads.
		grip.setPointerCapture?.(event.pointerId);
		grip.addEventListener('pointermove', this.onGripMove);
		grip.addEventListener('pointerup', this.onGripUp);
		grip.addEventListener('pointercancel', this.onGripUp);
	};

	private readonly onGripMove = (event: PointerEvent): void => {
		const drag = this.drag;
		if (!drag) return;
		const travel = Math.hypot(event.clientX - drag.origin.x, event.clientY - drag.origin.y);
		if (!drag.engaged && travel < DEAD_ZONE) return;
		if (!drag.engaged) this.engage(drag);
		drag.drop = this.dropIndex(drag, drag.line.axis === 'row' ? event.clientY : event.clientX);
		this.paintDrop(drag);
	};

	/** The drag becomes one: lift the line, and measure the table once. */
	private engage(drag: Drag): void {
		drag.engaged = true;
		this.dom.classList.add('qm-table-dragging');
		drag.grip.classList.add('qm-table-lifted');
		for (const cell of this.boxesOf(drag.line)) cell.classList.add('qm-table-lifted');
		const frame = this.frame;
		if (!frame) return;
		const box = frame.getBoundingClientRect();
		drag.origin0 = { left: box.left, top: box.top };
		const { floor, limit } = this.bounds(drag.line.axis, this.props());
		for (let i = floor; i <= limit; i++) {
			// A line's extent is read off the cells standing in it alone: a merged cell
			// stretches across the lines it covers.
			const row = drag.line.axis === 'row';
			const cells = this.cells
				.filter((m) =>
					row ? m.r === i && m.span.rowspan === 1 : m.c === i && m.span.colspan === 1
				)
				.map((m) => m.box.getBoundingClientRect());
			const all = this.boxesOf({ axis: drag.line.axis, index: i }).map((b) =>
				b.getBoundingClientRect()
			);
			const own = cells[0];
			if (!own || !all.length) continue;
			const cross = Math.min(...all.map((b) => (row ? b.left : b.top)));
			const far = Math.max(...all.map((b) => (row ? b.right : b.bottom)));
			drag.lines.push(
				row
					? { index: i, start: own.top, end: own.bottom, cross, span: far - cross }
					: { index: i, start: own.left, end: own.right, cross, span: far - cross }
			);
		}
	}

	private readonly onGripUp = (event: PointerEvent): void => {
		const drag = this.drag;
		if (!drag) return;
		const { line, drop, engaged } = drag;
		this.endDrag();
		if (!engaged) return;
		// A cancel is not a release: the line stays where it was, and no `click` follows
		// it, so arming the guard below would leave it to swallow the next press instead.
		if (event.type !== 'pointerup') return;
		// The press that ends a drag is not the press that selects: the click still to
		// come would re-select the line the drag just moved off.
		this.suppressClick = true;
		if (drop !== line.index) this.moveLine(line, drop - line.index);
		else this.selectLine(line);
	};

	private endDrag(): void {
		const drag = this.drag;
		if (!drag) return;
		this.drag = undefined;
		this.dropMark?.remove();
		this.dropMark = undefined;
		this.dom.classList.remove('qm-table-dragging');
		for (const lifted of this.dom.querySelectorAll('.qm-table-lifted'))
			lifted.classList.remove('qm-table-lifted');
		drag.grip.removeEventListener('pointermove', this.onGripMove);
		drag.grip.removeEventListener('pointerup', this.onGripUp);
		drag.grip.removeEventListener('pointercancel', this.onGripUp);
		if (drag.grip.hasPointerCapture?.(drag.pointerId))
			drag.grip.releasePointerCapture(drag.pointerId);
	}

	/** Which line the pointer is over, along the drag's axis: the nearest by the extents
	 *  measured at engage. One dimension, because every cell of a row shares its top and
	 *  bottom and every cell of a column shares its left and right, so the cross-axis
	 *  term is identical across the candidates and cancels out of the comparison. */
	private dropIndex(drag: Drag, at: number): number {
		let best = drag.line.index;
		let nearest = Infinity;
		for (const line of drag.lines) {
			const gap = at < line.start ? line.start - at : at > line.end ? at - line.end : 0;
			if (gap >= nearest) continue;
			nearest = gap;
			best = line.index;
		}
		return best;
	}

	private boxesOf(line: Line): HTMLElement[] {
		const props = this.props();
		return this.cells.filter((m) => touches(m, this.lineCells(line, props))).map((m) => m.box);
	}

	/** The drop indicator: one rule on the boundary the line would land against, drawn
	 *  in the frame so it spans the grid and travels with it. Redrawn only when the
	 *  boundary changes, which is once per line crossed rather than once per move. */
	private paintDrop(drag: Drag): void {
		if (drag.drop === drag.painted) return;
		const line = drag.lines.find((l) => l.index === drag.drop);
		const frame = this.frame;
		if (!line || !frame) return;
		drag.painted = drag.drop;
		if (!this.dropMark) {
			this.dropMark = el('div', 'qm-table-drop');
			this.dropMark.setAttribute('data-axis', drag.line.axis);
			frame.appendChild(this.dropMark);
		}
		const edge = (drag.drop > drag.line.index ? line.end : line.start) - 1;
		const mark = this.dropMark;
		if (drag.line.axis === 'row') {
			mark.style.top = `${edge - drag.origin0.top}px`;
			mark.style.left = `${line.cross - drag.origin0.left}px`;
			mark.style.width = `${line.span}px`;
		} else {
			mark.style.left = `${edge - drag.origin0.left}px`;
			mark.style.top = `${line.cross - drag.origin0.top}px`;
			mark.style.height = `${line.span}px`;
		}
	}

	// ── Column widths ─────────────────────────────────────────────────────────

	/** Size the grid's columns, or return it to auto-fit. A weighted grid spans the leaf
	 *  laid out fixed, as the page's fractional columns span the text block, so the
	 *  proportions it draws are the ones the page prints. */
	private weigh(widths: string[] | undefined): void {
		this.frame?.toggleAttribute('data-weighted', widths !== undefined);
		this.cols.forEach((col, c) => (col.style.width = widths?.[c] ?? ''));
	}

	/**
	 * The border after column `c`, in the band: a press and a drag move it, trading width
	 * between the two columns it divides, and the release writes every column's measured
	 * width as its weight, one `set` and one undo step. A double-click returns the table
	 * to auto-fit.
	 *
	 * Pointer chrome for the reason a grip is, and named to nothing: it is no button, and
	 * a column's width has no keyboard route.
	 */
	private resizer(c: number): HTMLElement {
		const handle = el('span', 'qm-table-resize');
		handle.setAttribute('aria-hidden', 'true');
		handle.addEventListener('mousedown', (e) => e.preventDefault());
		handle.addEventListener('pointerdown', (e) => this.onResizeDown(c, handle, e));
		handle.addEventListener('dblclick', () => {
			if (this.props().widths) this.write(setWidths(this.props(), undefined));
		});
		return handle;
	}

	private readonly onResizeDown = (c: number, handle: HTMLElement, event: PointerEvent): void => {
		if (event.button !== 0) return;
		this.endResize();
		// Each column's width and a cell's floor, its host's measure plus the box's own
		// padding and border, read off a cell standing in that column alone.
		const alone = (x: number) => this.cells.find((m) => m.c === x && m.span.colspan === 1);
		const widths = this.rails.map(
			(rail, x) => (alone(x)?.box ?? rail).getBoundingClientRect().width
		);
		const head = alone(c);
		const floor = head
			? Number.parseFloat(getComputedStyle(head.host).minWidth) +
				head.box.getBoundingClientRect().width -
				head.host.getBoundingClientRect().width
			: 0;
		this.resize = {
			c,
			handle,
			pointerId: event.pointerId,
			from: event.clientX,
			widths,
			floor: Number.isFinite(floor) ? floor : 0,
			engaged: false
		};
		handle.setPointerCapture?.(event.pointerId);
		handle.addEventListener('pointermove', this.onResizeMove);
		handle.addEventListener('pointerup', this.onResizeUp);
		handle.addEventListener('pointercancel', this.onResizeUp);
	};

	/** The widths a border at `x` leaves: the two columns it divides trade the travel,
	 *  each clamped at the floor, and every other column keeps the width it was pressed at. */
	private resized(resize: Resize, x: number): number[] {
		const { c, widths, floor } = resize;
		const left = widths[c] ?? 0;
		const right = widths[c + 1] ?? 0;
		const travel = Math.max(floor - left, Math.min(right - floor, x - resize.from));
		return widths.map((w, i) => (i === c ? left + travel : i === c + 1 ? right - travel : w));
	}

	private readonly onResizeMove = (event: PointerEvent): void => {
		const resize = this.resize;
		if (!resize) return;
		if (!resize.engaged && Math.abs(event.clientX - resize.from) < DEAD_ZONE) return;
		resize.engaged = true;
		resize.handle.setAttribute('data-active', '');
		const widths = this.resized(resize, event.clientX);
		const total = widths.reduce((a, b) => a + b, 0);
		this.weigh(widths.map((w) => `${(w / total) * 100}%`));
	};

	private readonly onResizeUp = (event: PointerEvent): void => {
		const resize = this.resize;
		if (!resize) return;
		this.endResize();
		if (!resize.engaged) return;
		if (event.type !== 'pointerup') {
			this.weigh(columnShares(this.props())?.map((share) => `${share * 100}%`));
			return;
		}
		const widths = this.resized(resize, event.clientX).map((w) => Math.max(1, Math.round(w)));
		this.write(setWidths(this.props(), widths));
	};

	private endResize(): void {
		const resize = this.resize;
		if (!resize) return;
		this.resize = undefined;
		resize.handle.removeAttribute('data-active');
		resize.handle.removeEventListener('pointermove', this.onResizeMove);
		resize.handle.removeEventListener('pointerup', this.onResizeUp);
		resize.handle.removeEventListener('pointercancel', this.onResizeUp);
		if (resize.handle.hasPointerCapture?.(resize.pointerId))
			resize.handle.releasePointerCapture(resize.pointerId);
	}

	// ── Render ────────────────────────────────────────────────────────────────

	private teardownCells(): void {
		for (const mounted of this.cells) {
			mounted.unregister();
			mounted.view.destroy();
		}
		this.cells = [];
	}

	private render(): void {
		const seat = this.focusedSeat();
		this.endDrag();
		this.endSweep();
		this.endResize();
		this.teardownCells();
		this.grips.clear();
		this.near = [];
		this.clusters = [];
		this.headerCluster = undefined;
		this.cellCluster = undefined;
		this.rails = [];
		this.dom.textContent = '';
		const props = tablePropsOfNode(this.node);
		const departure = props && departures.get(props);
		this.rendered = props;
		if (props) mounted.set(this.dom, this);
		else mounted.delete(this.dom);
		if (!props) {
			// Any other island type: the literal placeholder `toDOM` draws (islands.ts).
			this.dom.appendChild(document.createTextNode(`[${this.node.attrs.islandType || 'island'}]`));
			return;
		}
		const s = this.deps.strings();
		this.dom.setAttribute('role', 'group');
		this.dom.setAttribute('aria-label', s.tableLabel);

		// `thead`/`tbody` rather than one `tbody`: the header is a separate field in the
		// model, and this is the markup that says so to something that cannot see the
		// weight the header rows draw. A table with no header row draws its first row as a
		// body row on the page, so it is one here too, still holding row 0's chrome.
		const table = el('table', 'qm-table');
		const colgroup = el('colgroup');
		this.cols = Array.from({ length: columnCount(props) }, () => el('col'));
		colgroup.append(el('col', 'qm-table-rail-col'), ...this.cols);
		const heads = Math.min(headRows(props), rowCount(props));
		const grid = spanGrid(props);
		const body = el('tbody');
		const head = heads ? el('thead') : body;
		head.appendChild(this.rail(props, s));
		for (let r = 0; r < rowCount(props); r++)
			(r < heads ? head : body).appendChild(this.row(props, grid, r, s));
		table.append(colgroup, ...(heads ? [head] : []), body);
		this.cellCluster = this.mergeCluster(s);

		// The frame is the grid's own box, and the two controls about an axis rather than
		// about a line hang off its edges: an add bar along each trailing edge. A cell
		// would have served for neither — a table with no body rows has no last row to
		// hang the row bar in, and a bar spans the whole edge rather than one line of it.
		const frame = el('div', 'qm-table-frame');
		frame.append(table, this.addBar('column', s.tableAddColumn), this.addBar('row', s.tableAddRow));
		this.frame = frame;
		this.weigh(columnShares(props)?.map((share) => `${share * 100}%`));
		const scroller = el('div', 'qm-table-scroller');
		scroller.appendChild(frame);
		this.dom.appendChild(scroller);
		this.paintSelection();
		this.reseat(seat, departure);
	}

	/**
	 * Where the focus sits, in terms a rebuild can restore it by: the caret's cell by
	 * position, that being the one seat the island has and not an element that survives
	 * one.
	 *
	 * A rebuild is what a changed rectangle costs, and the op that changed it usually
	 * says where the caret lands ({@link TableIslandView.write}'s `focus`). An undo says
	 * nothing — it is the outer history's transaction, not an op of this view's — so
	 * without this the DOM under the focus is removed and the focus falls to the
	 * document body, where the next undo reaches no view at all.
	 */
	private focusedSeat(): Seat | undefined {
		const held = this.cells.find((m) => m.view.hasFocus());
		return held && { r: held.r, c: held.c, head: held.view.state.selection.head };
	}

	/** Put the focus back after a rebuild: at the departure where the table returns to a
	 *  value an edit was made from, which is an undo, else at the end of the cell
	 *  {@link TableIslandView.focusedSeat} found, clamped by `focusCell` into the
	 *  rectangle that is there now, the seat being perhaps a cell the rebuild removed. A
	 *  caller that has a landing of its own overrides this by running after. */
	private reseat(seat: Seat | undefined, departure: Seat | undefined): void {
		if (!seat) return;
		if (departure) this.focusCell(departure.r, departure.c, departure.head);
		else this.focusCell(seat.r, seat.c);
	}

	/** The rail: a row of no height above the first, a cell per column, holding each
	 *  column's grip and the border handle after it. The column chrome hangs here rather
	 *  than off the first row's cells, a merged cell there standing over several columns
	 *  and covering others. */
	private rail(props: TableProps, s: TableChromeStrings): HTMLElement {
		const tr = el('tr', 'qm-table-rail');
		tr.setAttribute('aria-hidden', 'true');
		tr.appendChild(el('td', 'qm-table-rail-cell'));
		for (let c = 0; c < columnCount(props); c++) {
			const cell = el('td', 'qm-table-rail-cell');
			cell.appendChild(this.grip({ axis: 'column', index: c }, s.tableSelectColumn(c + 1)));
			if (c < columnCount(props) - 1) cell.appendChild(this.resizer(c));
			this.rails.push(cell);
			tr.appendChild(cell);
		}
		return tr;
	}

	/** One table row: its drawn cells, each carrying whatever chrome hangs off it, after a
	 *  rail cell of no width holding the row's grip, which hangs there for the reason a
	 *  column's hangs off the rail row. A slot a merged cell covers draws nothing of its
	 *  own. */
	private row(
		props: TableProps,
		grid: (Span | null)[][],
		r: number,
		s: TableChromeStrings
	): HTMLElement {
		const head = headRows(props);
		const heads = r < head;
		const cols = columnCount(props);
		const rows = rowCount(props);
		const tr = el('tr', heads ? 'qm-table-header-row' : undefined);
		const rail = el('td', 'qm-table-rail-cell');
		rail.setAttribute('aria-hidden', 'true');
		// The grip takes a name of its own on the header for the reason a cell does: the
		// gesture is every other row's, but the line it names is still the header.
		rail.appendChild(
			this.grip(
				{ axis: 'row', index: r },
				heads ? s.tableSelectHeaderRow : s.tableSelectRow(r - head + 1)
			)
		);
		tr.appendChild(rail);
		rowCells(props, r).forEach((_, c) => {
			const span = grid[r]?.[c];
			if (!span) return;
			const box = el(heads ? 'th' : 'td', 'qm-table-cell');
			if (heads) box.setAttribute('scope', span.colspan > 1 ? 'colgroup' : 'col');
			if (span.colspan > 1) box.setAttribute('colspan', String(span.colspan));
			if (span.rowspan > 1) box.setAttribute('rowspan', String(span.rowspan));
			box.setAttribute('data-r', String(r));
			box.setAttribute('data-c', String(c));
			// Which edges of the frame the box meets, which the stroke and the corners read
			// (`prose.css`): a merged cell meets the edge its span reaches.
			const right = c + span.colspan === cols;
			const last = r + span.rowspan === rows;
			const corners = [
				r === 0 && c === 0 && 'start-start',
				r === 0 && right && 'start-end',
				last && c === 0 && 'end-start',
				last && right && 'end-end'
			].filter((corner): corner is string => !!corner);
			if (right) box.setAttribute('data-edge-end', '');
			if (last && rows > Math.min(head, rows)) box.setAttribute('data-edge-bottom', '');
			if (corners.length) box.setAttribute('data-corners', corners.join(' '));
			layCell(box, props, r, c);
			const host = el('div', 'qm-table-cell-host');
			box.appendChild(host);
			// The first row's cells hold the clusters about a column: each column's under the
			// drawn cell standing over it, and the header toggle under the last.
			if (r === 0)
				for (let x = c; x < c + span.colspan; x++)
					box.appendChild(this.alignCluster(x, props.aligns[x] ?? 'none', s));
			if (r === 0 && right) box.appendChild(this.headerToggle(head > 0, s));
			tr.appendChild(box);
			this.mountCell(box, host, r, c, span, s);
		});
		return tr;
	}

	/** A line's grip, and the whole of that line's chrome: a press selects the line, a
	 *  press that travels drags it. Both are "this line", asked once with the pointer,
	 *  and the dead zone is what tells them apart.
	 *
	 *  Pointer chrome and nothing else: no key binds here and no route focuses it, the
	 *  line verbs binding in the cell the selection runs through
	 *  (§{@link TableIslandView.cellKeys}). Out of the tab order at no cost in reach,
	 *  since a grip follows the cell it hangs in: a forward Tab is the cell traversal's
	 *  before the browser gets there, and a backward one leaves the grid off cell (0,0)
	 *  without passing a grip (§{@link TableIslandView.step}). */
	private grip(line: Line, label: string): HTMLButtonElement {
		const btn = chromeButton('qm-table-grip', label, () => {
			if (this.suppressClick) this.suppressClick = false;
			else this.selectLine(line);
		});
		btn.tabIndex = -1;
		btn.setAttribute('aria-pressed', 'false');
		btn.setAttribute('data-axis', line.axis);
		const bar = el('span', 'qm-table-grip-bar');
		bar.appendChild(svg(GRIP[line.axis], 3));
		btn.appendChild(bar);
		btn.addEventListener('pointerdown', (e) => this.onGripDown(line, btn, e));
		this.grips.set(lineKey(line), { line, grip: btn });
		return btn;
	}

	/** A column's alignment cluster: a toggle per alignment, pressed on the one the column
	 *  holds. Up only while this column is the named line
	 *  ({@link TableIslandView.paintSelection}), and absent rather than transparent the
	 *  rest of the time: it floats over the first row, and a box hit-tested there at rest
	 *  would take that cell's presses. Out of the tab order for the reason a grip is, its
	 *  keyboard twins being Shift+Left and Shift+Right (§{@link TableIslandView.cellKeys}). */
	private alignCluster(c: number, held: TableAlign, s: TableChromeStrings): HTMLElement {
		const cluster = el('div', 'qm-table-align');
		cluster.setAttribute('role', 'group');
		cluster.setAttribute('aria-label', s.tableColumn(c + 1));
		cluster.hidden = true;
		// The cluster's own edge is no button, and a press on it would otherwise take the
		// focus off the caret the write lands back on.
		cluster.addEventListener('mousedown', (e) => e.preventDefault());
		const names: Record<Aligned, string> = {
			left: s.tableAlignLeft,
			center: s.tableAlignCenter,
			right: s.tableAlignRight
		};
		for (const align of SETTABLE) {
			const btn = chromeButton('qm-table-align-option', names[align], () => this.align(c, align));
			btn.tabIndex = -1;
			btn.setAttribute('aria-pressed', String(held === align));
			btn.setAttribute('data-align', align);
			btn.appendChild(svg(ALIGN_GLYPH[align], 2));
			cluster.appendChild(btn);
		}
		this.clusters[c] = cluster;
		return cluster;
	}

	/** The first row's header toggle: one press draws the row as the header or as a body
	 *  row, writing the table's `head` as one `set`, and the row stays held. Up only
	 *  while the first row is held, hanging under its last cell, and out of the tab order
	 *  for the reason a grip is. */
	private headerToggle(header: boolean, s: TableChromeStrings): HTMLElement {
		const cluster = el('div', 'qm-table-align');
		cluster.setAttribute('data-header', '');
		cluster.hidden = true;
		cluster.addEventListener('mousedown', (e) => e.preventDefault());
		const btn = chromeButton('qm-table-align-option', s.tableHeaderToggle, () => {
			this.write(setHead(this.props(), header ? 0 : 1));
			this.selectLine({ axis: 'row', index: 0 });
		});
		btn.tabIndex = -1;
		btn.setAttribute('aria-pressed', String(header));
		btn.appendChild(svg(HEADER_GLYPH, 2));
		cluster.appendChild(btn);
		this.headerCluster = cluster;
		return cluster;
	}

	/** The merge and split cluster, one for the grid, which
	 *  {@link TableIslandView.paintCellCluster} hangs where it applies. Out of the tab
	 *  order for the reason a grip is. */
	private mergeCluster(s: TableChromeStrings): HTMLElement {
		const cluster = el('div', 'qm-table-align');
		cluster.setAttribute('data-cells', '');
		cluster.setAttribute('role', 'group');
		cluster.hidden = true;
		cluster.addEventListener('mousedown', (e) => e.preventDefault());
		for (const [label, run] of [
			[s.tableMergeCells, () => this.merge()],
			[s.tableSplitCell, () => this.split()]
		] as const) {
			const btn = chromeButton('qm-table-cells-option', label, run);
			btn.tabIndex = -1;
			btn.textContent = label;
			cluster.appendChild(btn);
		}
		return cluster;
	}

	/** A trailing bar: the whole edge past the last line of its axis, and the one way a
	 *  pointer grows the table. It spans the edge rather than capping it, because what it
	 *  appends to is the axis and not a line. It draws no glyph — the bar arriving under
	 *  the pointer out past the last line is the claim — so its name carries the verb for
	 *  everything that does not read position.
	 *
	 *  Out of the tab order, as a grip is: the Tab that declines off the last cell leaves
	 *  the island rather than landing on two controls drawn only under the pointer. A row
	 *  is the keyboard's from inside a cell, by Enter at the last row and Tab past the
	 *  last cell, and a column is the pointer's alone. */
	private addBar(axis: Axis, label: string): HTMLButtonElement {
		const btn = chromeButton('qm-table-add', label, () => {
			const props = this.props();
			if (axis === 'row')
				this.write(insertRow(props, props.rows.length), { r: rowCount(props), c: 0 });
			else this.write(insertColumn(props, columnCount(props) - 1), { r: 0, c: columnCount(props) });
		});
		btn.setAttribute('data-axis', axis);
		btn.tabIndex = -1;
		btn.appendChild(el('span', 'qm-table-add-bar'));
		return btn;
	}

	private mountCell(
		box: HTMLElement,
		host: HTMLElement,
		r: number,
		c: number,
		span: Span,
		s: TableChromeStrings
	): void {
		const props = this.props();
		const head = headRows(props);
		const row = r < head ? s.tableHeaderRow : s.tableRow(r - head + 1);
		const name = s.tableCell(row, s.tableColumn(c + 1));
		const seed = cellAt(props, r, c);
		const view: EditorView = new EditorView(host, {
			state: EditorState.create({
				doc: decode(cellContent(seed), cellSchema),
				plugins: cellPlugins(this.cellKeys(r, c))
			}),
			attributes: { 'aria-label': name, class: 'qm-table-cell-editor' },
			// A cell is one of the leaf's lines, so a reveal here keeps the leaf's
			// clearance: PM's 5px default is the caret visible and unusable that rung
			// exists to refuse (`field.ts`).
			scrollThreshold: this.deps.clearance,
			scrollMargin: this.deps.clearance,
			dispatchTransaction: (tr) => {
				const from = { r, c, head: view.state.selection.head };
				const next = view.state.apply(tr);
				view.updateState(next);
				if (!tr.docChanged) return;
				// A cell edit is the caret's, so it retires the rectangle: a wash left up
				// over text being typed says the next Backspace takes a rank, and it does
				// not. The clear op is not this path — it writes through the leaf, and the
				// reseed it comes back as changes no cell's own doc.
				this.clearSelection();
				const now = this.props();
				const cell = cellFromDoc(next.doc, cellAt(now, r, c));
				mounted.shown = cell;
				this.write(withCell(now, r, c, cell), undefined, from);
			},
			handleDOMEvents: {
				focus: () => {
					this.clearSelection();
					this.retireIsland();
					this.paintCellCluster();
					this.deps.onCellFocus();
					return false;
				},
				blur: () => {
					queueMicrotask(() => this.paintCellCluster());
					return false;
				}
			}
		});
		// `seed` is what the doc above was decoded from, and decode∘project is identity
		// (`table.ts`, the cell codec), so it is what this view is showing.
		const mounted: MountedCell = {
			view,
			host,
			box,
			shown: seed,
			unregister: this.deps.register(view),
			r,
			c,
			span
		};
		this.cells.push(mounted);
	}

	// ── Ops ───────────────────────────────────────────────────────────────────

	/** The table this view is currently showing; the zero table if the node stopped
	 *  being one, which no op can produce. */
	private props(): TableProps {
		return tablePropsOfNode(this.node) ?? normalizeTable({ header: [], rows: [], aligns: [] });
	}

	/**
	 * Commit a new rectangle onto the node. `setNodeMarkup` is an ordinary PM
	 * transaction, so the field lowers it through the island channel and the whole
	 * op is one commit and one undo step, which is why every op writes a whole
	 * table rather than mutating the props in place.
	 */
	private write(
		next: TableProps,
		focus?: { r: number; c: number },
		from = this.focusedSeat()
	): void {
		const pos = this.getPos();
		if (pos == null) return;
		const node = this.outer.state.doc.nodeAt(pos);
		if (!node || node.type !== this.node.type) return;
		const left = tablePropsOfNode(node);
		if (left && from) departures.set(left, from);
		this.outer.dispatch(
			this.outer.state.tr.setNodeMarkup(pos, undefined, {
				...node.attrs,
				props: normalizeTable(next)
			})
		);
		if (focus) this.focusCell(focus.r, focus.c);
	}

	/** Land the caret at the end of a cell, at its start, or at an offset clamped into its
	 *  text, the cell itself clamped into the rectangle: where a row or column op puts it,
	 *  since the op rebuilt the views the caret was in. */
	private focusCell(r: number, c: number, edge: 'start' | 'end' | number = 'end'): void {
		const props = this.props();
		const row = Math.max(0, Math.min(r, rowCount(props) - 1));
		const col = Math.max(0, Math.min(c, columnCount(props) - 1));
		const mounted = this.cells.find((m) => covers(m, row, col));
		if (!mounted) return;
		const { view } = mounted;
		const { doc } = view.state;
		const at =
			edge === 'start'
				? Selection.atStart(doc)
				: edge === 'end'
					? Selection.atEnd(doc)
					: Selection.near(doc.resolve(Math.min(edge, doc.content.size)));
		// Flagged, for the reason the leaf's own landing is (`field.ts`, `setCaret`): PM
		// focuses with `preventScroll`, so an unflagged dispatch lands the caret where no
		// scroller has moved to — a Tab past the right edge of the horizontal scroller a
		// wide table lives in, or the row an Enter on the last one appends below the fold.
		view.focus();
		view.dispatch(view.state.tr.setSelection(at).scrollIntoView());
	}

	/** The span of the drawn cell at `(r, c)`: one each where nothing is merged. */
	private spanAt(r: number, c: number): Span {
		return this.cells.find((m) => m.r === r && m.c === c)?.span ?? { colspan: 1, rowspan: 1 };
	}

	/** The cell beside `(r, c)` in reading order, a row's end wrapping to the next row's
	 *  start; past the first or last cell its row is outside the table. */
	private reading(r: number, c: number, dir: 1 | -1): { r: number; c: number } {
		const props = this.props();
		const cols = columnCount(props);
		const grid = spanGrid(props);
		let at = { r, c };
		do {
			const next = at.c + dir;
			at =
				next >= cols
					? { r: at.r + 1, c: 0 }
					: next < 0
						? { r: at.r - 1, c: cols - 1 }
						: { r: at.r, c: next };
		} while (at.r >= 0 && at.r < rowCount(props) && !grid[at.r]?.[at.c]);
		return at;
	}

	/**
	 * A cell's keys. Traversal is the island's link in the leaf's chain
	 * (VISUAL_EDITOR §Chrome), except that it binds on the nested view: the outer
	 * keymap never sees a keystroke a cell handled (`stopEvent`).
	 *
	 * Enter is the next row. Shift-Enter is a line break, the body's own command
	 * (`breaks.ts`): one `\n` in the cell's `text`.
	 */
	private cellKeys(r: number, c: number): Record<string, Command> {
		const marks: Record<string, Command> = {};
		if (cellSchema.marks.strong) marks['Mod-b'] = toggleMark(cellSchema.marks.strong);
		if (cellSchema.marks.em) marks['Mod-i'] = toggleMark(cellSchema.marks.em);
		if (cellSchema.marks.underline) marks['Mod-u'] = toggleMark(cellSchema.marks.underline);
		if (cellSchema.marks.strike) marks['Mod-Shift-x'] = toggleMark(cellSchema.marks.strike);
		if (cellSchema.marks.code) marks['Mod-e'] = toggleMark(cellSchema.marks.code);
		// The arrows are the grid's own walk, each leaving a cell only from the text's edge
		// on its side. Up and down reach the cell above or below, `focusCell` clamping at
		// the top and bottom. Left and right reach the neighbour in reading order, landing
		// at the edge they entered by and stopping at the first and last cells. No arrow
		// grows the table, growth being Tab's and Enter's: on a caret key it would make a
		// walk a growth affordance.
		const caretAtEdge = (view: EditorView | undefined, dir: 'up' | 'down' | 'left' | 'right') => {
			const { selection } = view?.state ?? {};
			return (
				!!view && selection instanceof TextSelection && selection.empty && view.endOfTextblock(dir)
			);
		};
		const walk = (dir: 'up' | 'down'): Command => {
			return (_state, _dispatch, view) => {
				if (!caretAtEdge(view, dir)) return false;
				this.focusCell(dir === 'up' ? r - 1 : r + this.spanAt(r, c).rowspan, c);
				return true;
			};
		};
		const cross = (dir: -1 | 1): Command => {
			return (_state, _dispatch, view) => {
				if (!caretAtEdge(view, dir < 0 ? 'left' : 'right')) return false;
				const to = this.reading(r, c, dir);
				if (to.r < 0 || to.r >= rowCount(this.props())) return false;
				this.focusCell(to.r, to.c, dir < 0 ? 'end' : 'start');
				return true;
			};
		};
		// A block selection outranks the caret it was swept from: the origin cell still
		// holds the focus, so its own view is where the block's Backspace lands. Declining
		// when no block is held is what leaves an ordinary Backspace to `baseKeymap`.
		const erase: Command = () => {
			if (!this.selected) return false;
			this.deleteSelection();
			return true;
		};
		// The line verbs, over the held rectangle and nothing else: with none held every
		// one of these declines and the key is the caret's, which is what lets them sit on
		// keys a cell is already typing under. An arrow over swept cells lets go of them,
		// leaving the caret where it is, as an arrow collapses a text selection. Over named
		// lines it names the line on its own axis through the caret — the one already held
		// steps to its neighbour and carries the caret, and any other turns into it, which
		// is how a row becomes the column the caret is in. Alt moves the line instead, and
		// over a rectangle that is not one it does nothing but keep the key: while a
		// rectangle is held every arrow is its own, and an Alt+arrow handed back is the
		// browser's Back on two platforms, mid-gesture.
		const line = (axis: Axis, by: -1 | 1, move: boolean): Command => {
			return () => {
				if (!this.selected) return false;
				if (this.selected.swept && !move) {
					this.clearSelection();
					return true;
				}
				const on = this.lineOn(axis);
				if (move) {
					if (on !== undefined) this.moveLine({ axis, index: on }, by);
					return true;
				}
				if (on === undefined) {
					this.selectLine({ axis, index: axis === 'row' ? r : c });
					return true;
				}
				const { floor, limit } = this.bounds(axis, this.props());
				this.selectLine({ axis, index: Math.max(floor, Math.min(on + by, limit)) });
				return true;
			};
		};
		// Shift steps a held column's alignment a place along the cluster's order, stopping
		// at either end, and a column with none steps from the first. Over any other
		// rectangle it keeps the key, every arrow being the rectangle's while one is held.
		const slide = (by: -1 | 1): Command => {
			return () => {
				if (!this.selected) return false;
				const on = this.lineOn('column');
				if (on === undefined) return true;
				const held = this.props().aligns[on];
				const at = Math.max(
					0,
					SETTABLE.findIndex((a) => a === held)
				);
				this.align(on, SETTABLE[Math.max(0, Math.min(at + by, SETTABLE.length - 1))]!);
				return true;
			};
		};
		// Select-all grows a rung a press: the cell's text, which the base keymap's
		// `selectAll` takes, then the caret's row, then every cell, then the document. Any
		// held rectangle short of every cell grows to every cell.
		const grow: Command = (state) => {
			const props = this.props();
			const every = {
				r0: 0,
				c0: 0,
				r1: rowCount(props) - 1,
				c1: columnCount(props) - 1,
				swept: false
			};
			const held = this.selected;
			if (held && sameCells(held, every)) {
				this.clearSelection();
				this.outer.focus();
				return selectAll(this.outer.state, this.outer.dispatch);
			}
			if (held) this.select(every);
			else {
				const { from, to } = state.selection;
				if (from > Selection.atStart(state.doc).from || to < Selection.atEnd(state.doc).to)
					return false;
				this.selectLine({ axis: 'row', index: r });
			}
			return true;
		};
		return {
			...marks,
			...breakKeymap(cellSchema),
			// One undo stack per leaf: a cell carries no history of its own, so Mod-z
			// unwinds a cell keystroke and a row op in the order they happened.
			'Mod-z': () => undo(this.outer.state, this.outer.dispatch),
			'Mod-y': () => redo(this.outer.state, this.outer.dispatch),
			'Shift-Mod-z': () => redo(this.outer.state, this.outer.dispatch),
			Backspace: erase,
			Delete: erase,
			ArrowUp: chainCommands(line('row', -1, false), walk('up')),
			ArrowDown: chainCommands(line('row', 1, false), walk('down')),
			ArrowLeft: chainCommands(line('column', -1, false), cross(-1)),
			ArrowRight: chainCommands(line('column', 1, false), cross(1)),
			'Alt-ArrowUp': line('row', -1, true),
			'Alt-ArrowDown': line('row', 1, true),
			'Alt-ArrowLeft': line('column', -1, true),
			'Alt-ArrowRight': line('column', 1, true),
			'Shift-ArrowLeft': slide(-1),
			'Shift-ArrowRight': slide(1),
			'Mod-a': grow,
			Tab: () => this.step(r, c, 1),
			'Shift-Tab': () => this.step(r, c, -1),
			Enter: () => {
				// Over a rectangle it hands the caret back, which is the line verbs' own
				// exit: the caret never left the cell, so there is nowhere else to put it.
				if (this.selected) {
					this.clearSelection();
					return true;
				}
				// Past the last row it appends one, and on an empty trailing row it refuses the
				// row on offer, as Tab's decline does and an empty item's Enter leaves a list:
				// the row goes and the caret lands past the table. Row 1 is never the one
				// refused, so the table keeps a row under its first.
				const props = this.props();
				const below = r + this.spanAt(r, c).rowspan;
				if (below < rowCount(props)) this.focusCell(below, c);
				else if (r > 1 && rowEmpty(props, r) && this.leave(1)) this.write(deleteRow(props, r));
				else this.write(insertRow(props, below - 1), { r: below, c });
				return true;
			},
			// Escape climbs a rung a press: the caret's own row, then the island. The row
			// is the entry the band has no other route to — every line verb reads a held
			// rectangle, and this is the gesture that draws one from the keyboard — and it
			// is the row rather than the column because the column is one arrow further
			// on. What the press past the island means is the shell's
			// (VISUAL_EDITOR §"Settled and open").
			Escape: () => {
				if (this.selected) this.selectIsland();
				else this.selectLine({ axis: 'row', index: r });
				return true;
			}
		};
	}

	/**
	 * Tab's traversal: the next (or previous) cell in reading order. Past the last cell it
	 * appends a row, which is the growth affordance the keyboard has.
	 *
	 * It declines at both ends, and that is the island's keyboard exit: the key is not
	 * swallowed, so the browser moves the focus out of the grid the way it moved it in.
	 * Backward that end is the first cell. Forward it is the last cell of an empty
	 * trailing row: a row is on offer, and walking off the end of an unwritten one
	 * refuses it, the reading an empty item's Enter takes in a list (`lists.ts`). Growth
	 * that never declined leaves Tab no forward exit at all, every press past the last
	 * cell appending.
	 */
	private step(r: number, c: number, dir: 1 | -1): boolean {
		const props = this.props();
		const to = this.reading(r, c, dir);
		if (to.r < 0) return false;
		if (to.r >= rowCount(props)) {
			const last = rowCount(props) - 1;
			if (rowEmpty(props, last)) return false;
			this.write(insertRow(props, last), { r: last + 1, c: 0 });
		} else this.focusCell(to.r, to.c);
		return true;
	}
}

/** The table island mounted at `pos` in `view`, which a caret can step into; `undefined`
 *  for any other node, or where no view is mounted. */
export function tableAt(view: EditorView, pos: number): { enter(side: -1 | 1): void } | undefined {
	const dom = view.nodeDOM(pos);
	return dom ? mounted.get(dom) : undefined;
}

/** The `island_block` node view: a table island's editing surface, and the literal
 *  placeholder for every other island type. */
export function tableNodeView(deps: TableViewDeps): NodeViewConstructor {
	return (node, view, getPos) => new TableIslandView(node, view, getPos, deps);
}
