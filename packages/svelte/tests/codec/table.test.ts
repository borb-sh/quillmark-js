// @vitest-environment jsdom
// The table island: the rectangularizing constructors, the cell codec, and the
// NodeView the two meet in.
//
// The load-bearing assertion is the rectangle one. Props normalize to one column
// count, and the editor holds optimistic PM and re-hydrates only on an external
// change, so an op that emitted a ragged table would leave the store rectangularized
// and PM ragged, permanently, with no error channel. Text gets away with
// normalization drift because it is mark union; a table's drift is structural. So
// every row and column op is asserted install-then-read against its own projection.
import { describe, it, expect } from 'vitest';
import { GapCursor } from 'prosemirror-gapcursor';
import { Slice } from 'prosemirror-model';
import { EditorState, NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createField, decode, blockSchema, inlineSchema } from '$lib/core/codec';
import type { FieldController, LeafViews } from '$lib/core/codec';
import {
	ALIGNS,
	cellContent,
	cellEqual,
	cellFromDoc,
	columnCount,
	deleteColumn,
	deleteRow,
	emptyCell,
	insertColumn,
	insertRow,
	moveRow,
	newTable,
	normalizeTable,
	rowCells,
	rowCount,
	setAlign,
	shapeEqual,
	withCell
} from '$lib/core/codec/table.js';
import { mintIslandId } from '$lib/core/codec/islands.js';
import type { Content, TableCell, TableProps } from '@quillmark/wasm';
import { mount, press, quill, md } from './_util.js';

const TABLE_MD = 'para\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntail';

/** A table payload no reader can index. The store's table decode fills what it can and
 *  keeps the rest, so this is a stored state and not only a pasted one; the cast is the
 *  authored shape, which the type is right to refuse. */
const BAD_PROPS = { any: 1 } as unknown as TableProps;

function cell(text: string): TableCell {
	return { text, marks: [] };
}

/** The table island's props in a content. */
function propsOf(rt: Content): TableProps {
	return rt.islands[0].props as TableProps;
}

/** A content holding one table island, with `props` in place of the imported ones. */
function withTable(props: TableProps): Content {
	const rt = md(TABLE_MD);
	rt.islands[0].props = props;
	return rt;
}

/** Install a content and read it back: the store's own normalization, which is what
 *  a ragged op would be caught by. */
function stored(rt: Content): Content {
	const doc = quill().seedDocument();
	doc.overwrite({}, rt);
	return doc.main.body;
}

/** The table `text` grid, the shape assertions read against. */
function grid(props: TableProps): string[][] {
	return Array.from({ length: rowCount(props) }, (_, r) => rowCells(props, r).map((c) => c.text));
}

const LETTERED = normalizeTable({
	header: [cell('h1'), cell('h2')],
	rows: [
		[cell('a1'), cell('a2')],
		[cell('b1'), cell('b2')]
	],
	aligns: ['left', 'right']
});

describe('the rectangle survives every op', () => {
	// One case per op, each asserted the same way: what the store holds after an
	// install is exactly the projection the editor is showing.
	const OPS: { name: string; run: (p: TableProps) => TableProps }[] = [
		{ name: 'insert a row below the header', run: (p) => insertRow(p, 0) },
		{ name: 'insert a row below the last', run: (p) => insertRow(p, rowCount(p) - 1) },
		{ name: 'delete a body row', run: (p) => deleteRow(p, 1) },
		{ name: 'delete the header row', run: (p) => deleteRow(p, 0) },
		{ name: 'move the header row down', run: (p) => moveRow(p, 0, 1) },
		{ name: 'move a body row up into the header', run: (p) => moveRow(p, 2, -2) },
		{ name: 'insert a column left', run: (p) => insertColumn(p, -1) },
		{ name: 'insert a column right', run: (p) => insertColumn(p, 0) },
		{ name: 'delete a column', run: (p) => deleteColumn(p, 1) },
		{ name: 'set an alignment', run: (p) => setAlign(p, 1, 'center') },
		{ name: 'clear an alignment back to the default', run: (p) => setAlign(p, 0, 'none') },
		{ name: 'set a cell', run: (p) => withCell(p, 1, 0, cell('typed')) }
	];

	for (const op of OPS) {
		it(`${op.name}: install-then-read equals the projection`, () => {
			const next = op.run(LETTERED);
			// The op's own output is already a rectangle…
			expect(next.header).toHaveLength(columnCount(next));
			for (const row of next.rows) expect(row).toHaveLength(columnCount(next));
			// …and the store agrees, cell for cell and alignment for alignment.
			const back = propsOf(stored(withTable(next)));
			expect(grid(back)).toEqual(grid(next));
			expect(back.aligns).toEqual(next.aligns);
		});
	}

	it('a ragged table normalizes to the widest axis rather than the narrowest', () => {
		const ragged = normalizeTable({
			header: [cell('h')],
			rows: [[cell('a'), cell('b'), cell('c')]],
			aligns: []
		});
		expect(columnCount(ragged)).toBe(3);
		expect(ragged.header.map((c) => c.text)).toEqual(['h', '', '']);
		expect(ragged.aligns).toEqual(['none', 'none', 'none']);
	});
});

describe('what the model already answers', () => {
	it('the header MOVES like any row, and being the header is holding index 0', () => {
		// Down one: the body row it passed lands at index 0 and is the header now.
		expect(grid(moveRow(LETTERED, 0, 1))).toEqual([
			['a1', 'a2'],
			['h1', 'h2'],
			['b1', 'b2']
		]);
		// And the reverse trip: the last body row carried to the top becomes the header.
		expect(grid(moveRow(LETTERED, 2, -2))).toEqual([
			['b1', 'b2'],
			['h1', 'h2'],
			['a1', 'a2']
		]);
	});

	it('the LAST row is the one the model keeps: under it there is no table', () => {
		const one = normalizeTable({ header: [cell('h')], rows: [], aligns: ['none'] });
		expect(grid(deleteRow(one, 0))).toEqual([['h']]);
	});

	it('a one-column table keeps its column', () => {
		const one = newTable(1, 1);
		expect(columnCount(deleteColumn(one, 0))).toBe(1);
	});

	it('an insert to the left of the first column lands at the front', () => {
		const wider = insertColumn(LETTERED, -1);
		expect(wider.header.map((c) => c.text)).toEqual(['', 'h1', 'h2']);
		expect(wider.aligns).toEqual(['none', 'left', 'right']);
	});

	it('a minted island id continues the positional sequence', () => {
		const doc = decode(md(TABLE_MD), blockSchema);
		expect(mintIslandId(doc)).toBe('isl-1');
		expect(mintIslandId(decode(md('nothing here'), blockSchema))).toBe('isl-0');
	});
});

describe('the cell codec: a cell is its own content unit', () => {
	/** A cell through decode and back: the round-trip a keystroke rides. */
	function roundTrip(c: TableCell): TableCell {
		return cellFromDoc(decode(cellContent(c), inlineSchema), c);
	}

	it("a cell's marks are cell-local and survive the trip", () => {
		const c: TableCell = { text: 'bold text', marks: [{ start: 0, end: 4, type: 'strong' }] };
		expect(roundTrip(c)).toEqual(c);
	});

	it('an anchor in a cell is preserved verbatim across an edit', () => {
		const c: TableCell = {
			text: 'abcd',
			marks: [{ start: 3, end: 3, type: 'anchor', attrs: { id: 'a1' } }] as TableCell['marks']
		};
		// Retype the cell to something longer, inserted before the anchor.
		const edited = decode(cellContent({ text: 'XXabcd', marks: [] }), inlineSchema);
		const next = cellFromDoc(edited, c);
		const anchor = next.marks.find((m) => m.type === 'anchor') as {
			start: number;
			attrs: { id: string };
		};
		expect(anchor.attrs.id).toBe('a1');
		expect(anchor.start).toBe(5); // rebased through the two inserted chars
	});

	it('a cell anchor holds its position against an insertion at it, as a field’s does', () => {
		const c: TableCell = {
			text: 'abcd',
			marks: [{ start: 2, end: 2, type: 'anchor', attrs: { id: 'a1' } }] as TableCell['marks']
		};
		// Typed at the anchor's own position: the one offset where the two assocs differ.
		const edited = decode(cellContent({ text: 'abXcd', marks: [] }), inlineSchema);
		const anchor = cellFromDoc(edited, c).marks.find((m) => m.type === 'anchor') as {
			start: number;
		};
		expect(anchor.start).toBe(2);
	});

	it('two spellings of one mark are one cell, whatever order the keys arrive in', () => {
		// The two sides are a WASM read and this tier's projection, and neither promises
		// the other's key order: compared as text, an own edit reads as an external one
		// and `TableIslandView.update` reseeds the cell being typed in on every
		// keystroke, caret and all.
		const stored: TableCell = {
			text: 'linked',
			marks: [
				{ start: 0, end: 6, type: 'link', attrs: { url: 'https://x.com' } }
			] as TableCell['marks']
		};
		const projected: TableCell = {
			text: 'linked',
			marks: [
				{ attrs: { url: 'https://x.com' }, type: 'link', end: 6, start: 0 }
			] as TableCell['marks']
		};

		expect(cellEqual(stored, projected)).toBe(true);
		expect(cellEqual(stored, { ...stored, text: 'linkes' })).toBe(false);
		expect(cellEqual(stored, { ...stored, marks: [] })).toBe(false);
	});

	it('a cell holds no line: a stray newline joins rather than splitting', () => {
		const c: TableCell = { text: 'one\ntwo', marks: [] };
		expect(roundTrip(c).text).toBe('one two');
	});
});

// ── The NodeView ────────────────────────────────────────────────────────────

/** A body holding one table island, mounted as a leaf. */
function tableLeaf(props?: TableProps) {
	const doc = quill().seedDocument();
	doc.overwrite({}, props ? withTable(props) : md(TABLE_MD));
	const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
	return { doc, field };
}

/** The row grips, in order and the header's first, and the column grips. Both read off
 *  the axis each declares, which is what leaves the two caps out of either set: neither
 *  names a line. So a row grip's index in this set is its row in the chrome's space. */
function grips(field: FieldController, kind: 'row' | 'column'): HTMLButtonElement[] {
	return Array.from(
		field.el.querySelectorAll<HTMLButtonElement>(`.qm-table-grip[data-axis='${kind}']`)
	);
}

/** A band's far cap: the bar that appends a line at the end of its own axis. */
function cap(field: FieldController, kind: 'row' | 'column'): HTMLButtonElement {
	return field.el.querySelector<HTMLButtonElement>(`.qm-table-add[data-axis='${kind}']`)!;
}

/** Where the caret is: the island's one focus host, and so where every line verb is
 *  driven from. Re-queried per press, since the caret travels with the line it names and
 *  an op that changes the rectangle rebuilds the views. */
function caret(field: FieldController): EditorView {
	return (field as FieldController & LeafViews).focusedView();
}

/** Which cells the surface is washing: the selected line, read back off the DOM. */
function washed(field: FieldController): string[] {
	return Array.from(field.el.querySelectorAll('.qm-table-cell[data-selected]')).map(
		(c) => `${c.getAttribute('data-r')},${c.getAttribute('data-c')}`
	);
}

/** Sweep a block: press in one cell and travel to another, which is the one gesture
 *  that turns a caret into a selection. The moves are dispatched on the document, where
 *  the view listens, and the boxes are the stubbed geometry `layout` installed. */
function sweep(field: FieldController, from: number, to: number): void {
	const boxes = field.el.querySelectorAll('.qm-table-cell');
	const at = (i: number) => {
		const r = boxes[i].getBoundingClientRect();
		return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
	};
	const head = at(from);
	boxes[from].dispatchEvent(
		new MouseEvent('mousedown', {
			bubbles: true,
			cancelable: true,
			clientX: head.x,
			clientY: head.y
		})
	);
	for (const step of [from, to]) {
		const p = at(step);
		document.dispatchEvent(
			new MouseEvent('mousemove', {
				bubbles: true,
				cancelable: true,
				clientX: p.x + 8,
				clientY: p.y + 8
			})
		);
	}
	document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

/** The leaf's own view: the document the island sits in. */
function outerView(field: FieldController): EditorView {
	return (field as FieldController & LeafViews).view;
}

/** The nested cell views, in mount (reading) order: the leaf's own handle, which
 *  the format popover reads for the same reason (`LeafViews`). */
function cellViews(field: FieldController): EditorView[] {
	return (field as FieldController & LeafViews).nestedViews();
}

/** The stored table props for a mounted leaf. */
function leafProps(field: FieldController): TableProps {
	return propsOf(field.getContent());
}

describe('the table NodeView', () => {
	it('draws one grip per line and one cap per axis, and no track for either', () => {
		const { field } = tableLeaf(LETTERED);
		expect(field.el.querySelectorAll('.qm-table-cell-host').length).toBe(6);
		expect(field.el.querySelectorAll('th.qm-table-cell').length).toBe(2);
		// One grip per column and one per row, the header's included: it is a row, and a
		// row grip acts on rows.
		expect(grips(field, 'column')).toHaveLength(2);
		expect(grips(field, 'row')).toHaveLength(3);
		// The header's own grip is named for the line it draws, not for an index it
		// would share with the first body row.
		expect(grips(field, 'row')[0].getAttribute('aria-label')).toBe('Select header row');
		// The band's ends are two: one cap per axis, and nothing at the origin — the
		// whole table is what a selection covering every rank says, not a control.
		expect(field.el.querySelectorAll('.qm-table-add')).toHaveLength(2);
		// And the grid is the data's shape: the chrome is in no row and no column of
		// it, so nothing empty reaches the accessibility tree.
		const lines = field.el.querySelectorAll('.qm-table tr');
		expect(lines).toHaveLength(3);
		lines.forEach((line) => expect(line.children).toHaveLength(2));
		field.destroy();
	});

	it('a cell keystroke reaches the store through the island channel', () => {
		const { doc, field } = tableLeaf(LETTERED);
		const before = doc.main.body.text;
		const cellView = cellViews(field)[0];
		cellView.dispatch(cellView.state.tr.insertText('!', 1));
		expect(leafProps(field).header[0].text).toBe('!h1');
		// The field's own text never saw it: cell text lives in the entry.
		expect(doc.main.body.text).toBe(before);
		field.destroy();
	});

	it('every anchor in the FIELD survives a cell keystroke', () => {
		const { doc, field } = tableLeaf(LETTERED);
		field.insertAnchor('a1', 2);
		const cellView = cellViews(field)[0];
		cellView.dispatch(cellView.state.tr.insertText('!', 1));
		expect(doc.main.body.marks.some((m) => m.type === 'anchor')).toBe(true);
		field.destroy();
	});

	it('the edited cell keeps its caret: an own edit reseeds nothing', () => {
		const { field } = tableLeaf(LETTERED);
		const cellView = cellViews(field)[0];
		const before = cellView.state;
		cellView.dispatch(cellView.state.tr.insertText('!', 1));
		// The same state object advanced; a reseed would have replaced it wholesale
		// and put the caret back at the start.
		expect(cellView.state).not.toBe(before);
		expect(cellView.state.selection.head).toBe(2);
		field.destroy();
	});

	it('a grip SELECTS its line: the wash is the whole of what the FIRST press does', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'row')[1].click();
		// Row 1 in the chrome's space, which is the first body row.
		expect(washed(field)).toEqual(['1,0', '1,1']);
		expect(grips(field, 'row')[1].getAttribute('aria-pressed')).toBe('true');
		// Nothing was armed on the document: the island is not what got selected.
		expect(outerView(field).state.selection instanceof NodeSelection).toBe(false);
		grips(field, 'column')[1].click();
		expect(washed(field)).toEqual(['0,1', '1,1', '2,1']);
		expect(grips(field, 'row')[1].getAttribute('aria-pressed')).toBe('false');
		field.destroy();
	});

	it('a grip press carries the caret onto the line, which is where the verbs bind', () => {
		const { field } = tableLeaf(LETTERED);
		const views = cellViews(field);
		views[1].focus(); // the header's second cell
		grips(field, 'row')[2].click();
		// The caret kept its column and changed rows: the rectangle is the line through
		// the caret, so a press on a line the caret is not in has to bring it along.
		expect(views.indexOf(caret(field))).toBe(5);
		expect(washed(field)).toEqual(['2,0', '2,1']);
		// And the grip took none of it: nothing on the band is a focus host.
		expect(field.el.ownerDocument.activeElement).not.toBe(grips(field, 'row')[2]);
		field.destroy();
	});

	it('Backspace over a selected row deletes it', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'row')[1].click();
		press(caret(field), 'Backspace');
		expect(grid(leafProps(field))).toEqual([
			['h1', 'h2'],
			['b1', 'b2']
		]);
		field.destroy();
	});

	it('the HEADER row deletes the same way, and the row under it takes its place', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'row')[0].click();
		expect(washed(field)).toEqual(['0,0', '0,1']);
		press(caret(field), 'Backspace');
		// A table is one row shorter and still has a header, which is the whole of what
		// the model asked for. Alignment is the column's, so it does not travel.
		expect(grid(leafProps(field))).toEqual([
			['a1', 'a2'],
			['b1', 'b2']
		]);
		expect(leafProps(field).aligns).toEqual(['left', 'right']);
		field.destroy();
	});

	it('Backspace over a selected column deletes it, alignment and all', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'column')[1].click();
		press(caret(field), 'Backspace');
		expect(grid(leafProps(field))).toEqual([['h1'], ['a1'], ['b1']]);
		expect(leafProps(field).aligns).toEqual(['left']);
		field.destroy();
	});

	it('a dropped rank hands the selection to whatever took its place, on either axis', () => {
		// One rule for both, or the next Alt+arrow acts on a line the writer did not aim
		// at — and which line that is would depend on which axis they were on.
		const wide = tableLeaf(insertColumn(LETTERED, 1));
		grips(wide.field, 'column')[1].click();
		press(caret(wide.field), 'Backspace');
		expect(washed(wide.field)).toEqual(['0,1', '1,1', '2,1']);
		wide.field.destroy();

		const tall = tableLeaf(LETTERED);
		grips(tall.field, 'row')[1].click();
		press(caret(tall.field), 'Backspace');
		expect(washed(tall.field)).toEqual(['1,0', '1,1']);
		tall.field.destroy();
	});

	it('the LAST rank of an axis hands it back, there being nothing after it', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'column')[1].click();
		press(caret(field), 'Backspace');
		// Two columns, the second dropped: the clamp lands on the one that is left.
		expect(washed(field)).toEqual(['0,0', '1,0', '2,0']);
		field.destroy();
	});

	it('an arrow steps the selection, carries the caret, and stops where the axis does', () => {
		const { field } = tableLeaf(LETTERED);
		const views = cellViews(field);
		grips(field, 'row')[1].click();
		press(caret(field), 'ArrowDown');
		expect(washed(field)).toEqual(['2,0', '2,1']);
		// The caret went with the step, keeping its column: the held rectangle is the
		// line through the caret, so one left behind would aim the next arrow elsewhere.
		expect(views.indexOf(caret(field))).toBe(4);
		// Up runs to the header and stops there, the row axis floor being row 0 like
		// every other index the chrome walks.
		press(caret(field), 'ArrowUp');
		press(caret(field), 'ArrowUp');
		expect(washed(field)).toEqual(['0,0', '0,1']);
		press(caret(field), 'ArrowUp');
		expect(washed(field)).toEqual(['0,0', '0,1']);
		field.destroy();
	});

	it('a cross-axis arrow turns the line onto the caret’s other axis', () => {
		const { field } = tableLeaf(LETTERED);
		cellViews(field)[3].focus(); // row 1, column 1
		press(caret(field), 'Escape');
		expect(washed(field)).toEqual(['1,0', '1,1']);
		// The arrow names the line on its own axis through the caret, so the first press
		// across turns the row into the caret's column: the keyboard's whole route to one.
		press(caret(field), 'ArrowLeft');
		expect(washed(field)).toEqual(['0,1', '1,1', '2,1']);
		// And the next one steps it, the held rectangle now being a line on that axis.
		press(caret(field), 'ArrowLeft');
		expect(washed(field)).toEqual(['0,0', '1,0', '2,0']);
		field.destroy();
	});

	it('the one line that IS the table deletes it: a one-column table, its grip', () => {
		const { doc, field } = tableLeaf(newTable(1, 1));
		grips(field, 'column')[0].click();
		// That rectangle spans both axes — the column is every column and it runs every
		// row — so it is the table, and the table is what goes.
		press(caret(field), 'Backspace');
		expect(doc.main.body.islands).toHaveLength(0);
		field.destroy();
	});

	it('Alt+arrow moves the selected line, and the selection travels with it', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'row')[1].click();
		press(caret(field), 'ArrowDown', { altKey: true });
		expect(grid(leafProps(field))).toEqual([
			['h1', 'h2'],
			['b1', 'b2'],
			['a1', 'a2']
		]);
		// Row 2 now, which is where the moved row went: a selection left behind would
		// aim the next press at whatever took the index.
		expect(washed(field)).toEqual(['2,0', '2,1']);
		field.destroy();
	});

	it('an Alt+arrow across the held line keeps the key without acting', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'row')[1].click();
		const view = caret(field);
		const claimed = view.someProp('handleKeyDown', (f) =>
			f(view, new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true }))
		);
		// A row is not a column, so there is no line to move — and the key is the
		// rectangle's anyway: handed back, it is the browser's Back mid-gesture.
		expect(claimed).toBe(true);
		expect(grid(leafProps(field))).toEqual(grid(LETTERED));
		field.destroy();
	});

	it('a column moves with its alignment', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'column')[1].click();
		press(caret(field), 'ArrowLeft', { altKey: true });
		expect(grid(leafProps(field))).toEqual([
			['h2', 'h1'],
			['a2', 'a1'],
			['b2', 'b1']
		]);
		expect(leafProps(field).aligns).toEqual(['right', 'left']);
		field.destroy();
	});

	it('Alt+arrow carries the header down, and the row it passed is the header now', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'row')[0].click();
		press(caret(field), 'ArrowDown', { altKey: true });
		expect(grid(leafProps(field))).toEqual([
			['a1', 'a2'],
			['h1', 'h2'],
			['b1', 'b2']
		]);
		// The selection travels with the line, which is now row 1 and no longer the
		// header: what a grip names is an index, and the move handed index 0 over.
		expect(washed(field)).toEqual(['1,0', '1,1']);
		field.destroy();
	});

	it('Escape climbs a rung a press: the caret’s row, then the island', () => {
		const { field } = tableLeaf(LETTERED);
		const views = cellViews(field);
		views[3].focus(); // row 1, column 1
		press(caret(field), 'Escape');
		// The row through the caret, and the caret still in it: this is the gesture that
		// draws a rectangle from the keyboard, and every line verb reads one.
		expect(washed(field)).toEqual(['1,0', '1,1']);
		expect(views.indexOf(caret(field))).toBe(3);
		press(caret(field), 'Escape');
		const selection = outerView(field).state.selection;
		expect(selection instanceof NodeSelection && selection.node.type.name).toBe('island_block');
		expect(washed(field)).toEqual([]);
		field.destroy();
	});

	it('a cell edit retires the rectangle: typing is the caret’s', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'row')[1].click();
		expect(washed(field)).not.toEqual([]);
		const view = caret(field);
		view.dispatch(view.state.tr.insertText('!', 1));
		// A wash left up over text being typed says the next Backspace takes the row,
		// and it does not.
		expect(washed(field)).toEqual([]);
		field.destroy();
	});

	it('a caret in a cell drops the line selection: one subject at a time', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'row')[1].click();
		expect(washed(field)).not.toEqual([]);
		cellViews(field)[0].focus();
		expect(washed(field)).toEqual([]);
		field.destroy();
	});

	it('a cap appends at the far end of its own axis', () => {
		const { field } = tableLeaf(LETTERED);
		cap(field, 'column').click();
		expect(columnCount(leafProps(field))).toBe(3);
		expect(grid(leafProps(field))[0]).toEqual(['h1', 'h2', '']);
		// Re-queried: an op rebuilds the chrome, so the cap pressed before is not the
		// element now.
		cap(field, 'row').click();
		expect(leafProps(field).rows).toHaveLength(3);
		// Both grew the rectangle rather than the axis they were on alone.
		expect(grid(leafProps(field)).every((line) => line.length === 3)).toBe(true);
		field.destroy();
	});

	it('a vertical arrow walks the grid, and never grows it', () => {
		const { field } = tableLeaf(LETTERED);
		const views = cellViews(field);
		const focused = () => (field as FieldController & LeafViews).focusedView();
		views[1].focus();
		press(views[1], 'ArrowDown');
		expect(focused()).toBe(views[3]); // the cell below, same column
		// Past the last row it clamps rather than appending: Tab is the growth
		// affordance, and a caret key is not one.
		views[5].focus();
		press(views[5], 'ArrowDown');
		expect(leafProps(field).rows).toHaveLength(2);
		expect(focused()).toBe(views[5]);
		field.destroy();
	});

	it('Tab past the last cell appends a row; the store follows', () => {
		const { field } = tableLeaf(LETTERED);
		const views = cellViews(field);
		const last = views[views.length - 1];
		last.focus();
		press(last, 'Tab');
		expect(leafProps(field).rows).toHaveLength(3);
		field.destroy();
	});

	it('Tab declines at both ends, which is the island’s keyboard exit', () => {
		const { field } = tableLeaf(LETTERED);
		const claims = (view: EditorView, init: KeyboardEventInit = {}) =>
			view.someProp('handleKeyDown', (f) =>
				f(view, new KeyboardEvent('keydown', { key: 'Tab', ...init }))
			);
		// Backward, the first cell. Unclaimed, so the browser moves the focus out of the
		// grid the way it moved it in.
		expect(claims(cellViews(field)[0], { shiftKey: true })).toBeFalsy();
		expect(leafProps(field).rows).toHaveLength(2);
		field.destroy();
		// Forward, the last cell of an empty trailing row: growth is an offer, and walking
		// off the end of an unwritten row refuses it. Without the decline every forward
		// press appends and a writer never reaches the block below.
		const offered = tableLeaf(
			normalizeTable({ ...LETTERED, rows: [...LETTERED.rows, [emptyCell(), emptyCell()]] })
		).field;
		const views = cellViews(offered);
		expect(claims(views[views.length - 1])).toBeFalsy();
		expect(leafProps(offered).rows).toHaveLength(3);
		offered.destroy();
	});

	it('what sits in the tab order is what a key reaches', () => {
		const { field } = tableLeaf(LETTERED);
		// Five grips no Tab arrives at, so five stops the document does not spend.
		for (const axis of ['row', 'column'] as const)
			for (const grip of grips(field, axis)) expect(grip.tabIndex).toBe(-1);
		// The caps stay: they are the keyboard's route to growth on either axis.
		for (const axis of ['row', 'column'] as const) expect(cap(field, axis).tabIndex).toBe(0);
		// And no key reaches a grip by any other route either: it is pointer chrome, and
		// the line verbs bind in the cell the selection runs through.
		grips(field, 'row')[1].click();
		expect(cellViews(field).some((v) => v.hasFocus())).toBe(true);
		field.destroy();
	});

	it('a rebuild puts the focus back, so a second undo still has a view to reach', () => {
		const { field } = tableLeaf(LETTERED);
		const views = cellViews(field);
		const last = views[views.length - 1];
		last.focus();
		press(last, 'Tab'); // appends a row: a changed rectangle, so the views are rebuilt
		expect(leafProps(field).rows).toHaveLength(3);
		const grown = cellViews(field).find((v) => v.hasFocus());
		expect(grown).toBeDefined();
		press(grown!, 'z', { ctrlKey: true });
		expect(leafProps(field).rows).toHaveLength(2);
		// An undo is the outer history's transaction, not an op of this view's, so it
		// names no landing: without the seat the DOM under the focus goes and the focus
		// falls to the document body, where the next undo reaches nothing.
		expect(cellViews(field).some((v) => v.hasFocus())).toBe(true);
		field.destroy();
	});

	it('a reseed keeps the cell’s caret rather than dropping it to the start', () => {
		const { field } = tableLeaf(LETTERED);
		const view = cellViews(field)[0];
		view.focus();
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
		view.dispatch(view.state.tr.insertText('XY', 3));
		expect(view.state.selection.head).toBe(5);
		press(view, 'z', { ctrlKey: true });
		expect(leafProps(field).header[0].text).toBe('h1');
		// Where the edit was, not where a fresh state resolves to.
		expect(cellViews(field)[0].state.selection.head).toBe(3);
		field.destroy();
	});

	it('Enter in a cell is the next row, never a newline', () => {
		const { field } = tableLeaf(LETTERED);
		const views = cellViews(field);
		views[0].focus();
		press(views[0], 'Enter');
		expect(leafProps(field).header[0].text).toBe('h1'); // no newline landed
		expect(leafProps(field).rows).toHaveLength(2); // and no row was appended
		// The caret is in the cell below, which is the whole of what Enter means here.
		expect((field as FieldController & LeafViews).focusedView()).toBe(views[2]);
		field.destroy();
	});

	it('Escape leaves the cell for the island, which Backspace then deletes', () => {
		const { doc, field } = tableLeaf(LETTERED);
		const first = cellViews(field)[0];
		first.focus();
		press(first, 'Escape'); // the caret's row
		press(first, 'Escape'); // and the island under it
		const outer = outerView(field);
		const selection = outer.state.selection;
		expect(selection instanceof NodeSelection && selection.node.type.name).toBe('island_block');
		// Delete is the selection's verb, the one every island already answered to;
		// nothing on the band names it a second time.
		outer.dispatch(outer.state.tr.deleteSelection());
		expect(doc.main.body.islands).toHaveLength(0);
		expect(doc.main.body.text).toBe('para\ntail');
		field.destroy();
	});

	it('an external re-hydrate reseeds the cells', () => {
		const { doc, field } = tableLeaf(LETTERED);
		const next = withCell(LETTERED, 0, 0, cell('EXTERNAL'));
		doc.overwrite({}, withTable(next));
		field.applyExternal();
		expect(cellViews(field)[0].state.doc.textContent).toBe('EXTERNAL');
		field.destroy();
	});

	// What the reseed loop compares an arriving cell against is the record each mounted
	// cell holds of the value it is showing, so both paths that move a nested doc have
	// to leave that record current. The two below are what a stale one costs.

	it('an own edit reseeds nothing: the view keeps the doc its own transaction produced', () => {
		const { field } = tableLeaf(LETTERED);
		const view = cellViews(field)[0];
		const tr = view.state.tr.insertText('!', 1);
		view.dispatch(tr);
		// Node identity, which the caret cannot answer for: a reseed decodes a fresh doc
		// from the stored cell, and lands the caret back at the same offset by clamping.
		expect(view.state.doc).toBe(tr.doc);
		field.destroy();
	});

	it('a reseed leaves the record current, so a second external change reseeds again', () => {
		const { doc, field } = tableLeaf(LETTERED);
		doc.overwrite({}, withTable(withCell(LETTERED, 0, 0, cell('ONE'))));
		field.applyExternal();
		expect(cellViews(field)[0].state.doc.textContent).toBe('ONE');
		// Back to the value the cell mounted with, which is what a record left at the
		// mount seed still holds: it would compare equal and the reseed be skipped.
		doc.overwrite({}, withTable(LETTERED));
		field.applyExternal();
		expect(cellViews(field)[0].state.doc.textContent).toBe('h1');
		field.destroy();
	});

	it('an island whose props no reader can index keeps the literal placeholder', () => {
		const doc = quill().seedDocument();
		const rt = md(TABLE_MD);
		rt.islands[0] = { id: 'isl-0', type: 'table', props: BAD_PROPS, loss: 'unrepresentable' };
		doc.overwrite({}, rt);
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		expect(field.el.querySelector('table')).toBeNull();
		expect(field.el.textContent).toContain('[table]');
		field.destroy();
	});
});
// ── The selection ───────────────────────────────────────────────────────────
//
// One rectangle of cells, drawn two ways — a grip names the line it covers, a press
// that travels sweeps the block it crossed — and one verb over it. What Backspace
// means is read off the rectangle's extent, so these assert the extents rather than
// the gestures: a row swept cell by cell has to delete exactly as the row its grip
// named does, or there are two rules wearing one key.

describe('a selection is a rectangle of cells, and Backspace reads its extent', () => {
	it('a press that travels out of its cell sweeps a block; one that stays is a caret', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		// Cell 2 is row 1 column 1, cell 5 is row 2 column 2: the block between them.
		sweep(field, 2, 5);
		expect(washed(field)).toEqual(['1,0', '1,1', '2,0', '2,1']);
		// And a press that does not travel leaves the caret alone: the cell keeps it.
		pressAt(field.el.querySelectorAll('.qm-table-cell-host')[0], 40, 30);
		expect(washed(field)).toEqual([]);
		field.destroy();
	});

	it('a block of cells CLEARS on Backspace, and the rectangle stays selected', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		sweep(field, 2, 4); // rows 1–2, column 1 only: neither axis is spanned
		expect(washed(field)).toEqual(['1,0', '2,0']);
		press(cellViews(field)[2], 'Backspace');
		expect(grid(leafProps(field))).toEqual([
			['h1', 'h2'],
			['', 'a2'],
			['', 'b2']
		]);
		expect(washed(field)).toEqual(['1,0', '2,0']);
		field.destroy();
	});

	it('a block spanning every column is a set of ROWS, and deletes them', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		sweep(field, 2, 5); // both body rows, both columns
		press(cellViews(field)[2], 'Backspace');
		expect(grid(leafProps(field))).toEqual([['h1', 'h2']]);
		field.destroy();
	});

	it('a block spanning every row is a set of COLUMNS, and deletes them', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		sweep(field, 1, 5); // header through last body row, column 2 only
		expect(washed(field)).toEqual(['0,1', '1,1', '2,1']);
		press(cellViews(field)[1], 'Backspace');
		expect(grid(leafProps(field))).toEqual([['h1'], ['a1'], ['b1']]);
		expect(leafProps(field).aligns).toEqual(['left']);
		field.destroy();
	});

	it('the whole table is the ISLAND, and Backspace deletes it', () => {
		const { doc, field } = tableLeaf(LETTERED);
		layout(field);
		sweep(field, 0, 5); // every cell
		expect(washed(field)).toHaveLength(6);
		press(cellViews(field)[0], 'Backspace');
		// The rule's own limit: every rank going at once leaves no table for a rank
		// deletion to have produced, so what the selection covers is the table.
		expect(doc.main.body.islands).toHaveLength(0);
		expect(doc.main.body.text).toBe('para\ntail');
		field.destroy();
	});

	it('one Mod-z brings the deleted table back whole', () => {
		const { doc, field } = tableLeaf(LETTERED);
		layout(field);
		sweep(field, 0, 5);
		press(cellViews(field)[0], 'Backspace');
		expect(doc.main.body.islands).toHaveLength(0);
		// The delete is an ordinary transaction on the leaf's own view, so it rides the
		// one undo stack every other op here does and comes back in one step.
		press(outerView(field), 'z', { ctrlKey: true });
		expect(doc.main.body.islands).toHaveLength(1);
		expect(grid(leafProps(field))).toEqual(grid(LETTERED));
		field.destroy();
	});

	it("a fresh press in a cell retires the block, and Backspace is the text's again", () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		sweep(field, 2, 5);
		expect(washed(field)).not.toEqual([]);
		// The origin cell already holds the focus, so no `focus` event fires: the press
		// itself is what has to drop the block.
		pressAt(field.el.querySelectorAll('.qm-table-cell-host')[2], 40, 55);
		expect(washed(field)).toEqual([]);
		// The block handler declines with nothing held, which is what leaves an ordinary
		// Backspace to the text. jsdom edits no contenteditable, so what is observable is
		// the wrong outcome: the cells emptied by a handler that should not have fired.
		press(cellViews(field)[2], 'Backspace');
		expect(grid(leafProps(field))).toEqual([
			['h1', 'h2'],
			['a1', 'a2'],
			['b1', 'b2']
		]);
		field.destroy();
	});

	it('a grip draws the same rectangle its line covers', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'row')[1].click();
		expect(washed(field)).toEqual(['1,0', '1,1']);
		// Swept or named, one rectangle: the grip is marked exactly when the selection is
		// its own line, which is the only thing that tells the two gestures apart.
		expect(grips(field, 'row')[1].getAttribute('aria-pressed')).toBe('true');
		layout(field);
		sweep(field, 2, 3);
		expect(washed(field)).toEqual(['1,0', '1,1']);
		expect(grips(field, 'row')[1].getAttribute('aria-pressed')).toBe('true');
		field.destroy();
	});

	it('a swept row moves like the one a grip named: the extent is what a verb reads', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		sweep(field, 2, 3); // row 1, cell by cell
		press(caret(field), 'ArrowDown', { altKey: true });
		expect(grid(leafProps(field))).toEqual([
			['h1', 'h2'],
			['b1', 'b2'],
			['a1', 'a2']
		]);
		expect(washed(field)).toEqual(['2,0', '2,1']);
		field.destroy();
	});

	it('every selected cell goes with its rank, header and all', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		// The header and the first body row, across every column: two rows, and both go.
		// The header being stored apart from `rows` buys it no exemption — the row left
		// at index 0 is the header, so the table below is one that lost two ranks.
		sweep(field, 0, 3);
		expect(washed(field)).toEqual(['0,0', '0,1', '1,0', '1,1']);
		press(cellViews(field)[0], 'Backspace');
		expect(grid(leafProps(field))).toEqual([['b1', 'b2']]);
		field.destroy();
	});

	it('the header row alone deletes, and the row under it is the header now', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		sweep(field, 0, 1); // the whole header, and nothing under it
		press(cellViews(field)[0], 'Backspace');
		expect(grid(leafProps(field))).toEqual([
			['a1', 'a2'],
			['b1', 'b2']
		]);
		// And it is the header cell it landed in: the `thead` holds one row, whichever
		// row that is.
		expect(field.el.querySelectorAll('th.qm-table-cell')[0].textContent).toBe('a1');
		field.destroy();
	});

	it('a sub-rectangle is the only thing left that clears', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		// One cell: it spans neither axis, so no rank covers it and no rank can go.
		sweep(field, 0, 2);
		expect(washed(field)).toEqual(['0,0', '1,0']);
		press(cellViews(field)[0], 'Backspace');
		expect(grid(leafProps(field))).toEqual([
			['', 'h2'],
			['', 'a2'],
			['b1', 'b2']
		]);
		field.destroy();
	});
});

// ── The grip drag ───────────────────────────────────────────────────────────
//
// A grip lives inside the cell it names, so a press on one reaches the island's own
// pointer router as a press in that cell. The router has to read it as the line's, or
// the travel that drags a line also sweeps the cells it crosses and one press draws two
// selections.

/** Drive a grip drag: the press, the travel and the release, all on the grip, which is
 *  where the view listens once it has the pointer. jsdom implements no pointer capture,
 *  and the view asks for it optionally for that reason. */
function dragGrip(grip: HTMLButtonElement, path: [number, number][]): void {
	const at = (type: string, [x, y]: [number, number]) =>
		grip.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				cancelable: true,
				pointerId: 1,
				clientX: x,
				clientY: y
			})
		);
	at('pointerdown', path[0]);
	for (const step of path.slice(1)) at('pointermove', step);
	at('pointerup', path[path.length - 1]);
}

describe('a grip drag moves its line', () => {
	it('the travel draws no block: a grip press is not a press in the cell it sits in', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		// The mousedown-then-travel that sweeps a block from a cell's own host (above),
		// aimed at the grip inside that same cell.
		pressAt(grips(field, 'row')[1], 35, 55);
		for (const [x, y] of [
			[60, 60],
			[150, 80]
		])
			document.dispatchEvent(
				new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y })
			);
		document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
		expect(washed(field)).toEqual([]);
		// And no caret was planted on the way in: the press was the line's throughout.
		expect((field as FieldController & LeafViews).focusedView()).toBe(outerView(field));
		field.destroy();
	});

	it('the line lands where the pointer left it, and stays selected', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		// Row 1 (45–65 in the stubbed geometry) lifted and carried into row 2's extent.
		dragGrip(grips(field, 'row')[1], [
			[35, 55],
			[35, 60],
			[35, 80]
		]);
		expect(grid(leafProps(field))).toEqual([
			['h1', 'h2'],
			['b1', 'b2'],
			['a1', 'a2']
		]);
		// The selection travels with the line, or the next Alt+arrow acts on whatever
		// took the index.
		expect(washed(field)).toEqual(['2,0', '2,1']);
		field.destroy();
	});

	it('a body row dragged onto the header becomes the header', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		// Row 2 (70–85) lifted and carried up into row 0's extent (20–40), which the drag
		// reaches because the row axis runs to 0 like the column one does.
		dragGrip(grips(field, 'row')[2], [
			[35, 78],
			[35, 70],
			[35, 30]
		]);
		expect(grid(leafProps(field))).toEqual([
			['b1', 'b2'],
			['h1', 'h2'],
			['a1', 'a2']
		]);
		expect(washed(field)).toEqual(['0,0', '0,1']);
		// The drop landed in `header`, not on top of it: the `thead` is one row deep
		// however many rows have passed through index 0.
		expect(field.el.querySelectorAll('thead tr')).toHaveLength(1);
		expect(field.el.querySelectorAll('th.qm-table-cell')[0].textContent).toBe('b1');
		field.destroy();
	});
});

// ── The pointer, and what a selection is for ────────────────────────────────
//
// Click-to-NodeSelect belongs to an atom with no interior, and a table has cells. So
// a press on the chrome resolves to a caret (inside the frame the nearest cell's,
// outside it the document's), and a printable key over a selected island writes past
// it rather than replacing it. What selects the island is one named gesture, Escape,
// and no pointer gesture at all.

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

const domRect = (box: Box): DOMRect =>
	({
		...box,
		x: box.left,
		y: box.top,
		width: box.right - box.left,
		height: box.bottom - box.top,
		toJSON: () => box
	}) as DOMRect;

// The island's boxes, which jsdom lays nothing out to produce: the bands are geometry,
// so a test that drives them supplies one. The grid sits inset in the island by the
// band the scroller opens, and the six cell hosts (reading order) tile it.
const ISLAND: Box = { left: 0, top: 0, right: 200, bottom: 120 };
const GRID: Box = { left: 10, top: 10, right: 190, bottom: 90 };
const HOSTS: Box[] = [
	{ left: 30, top: 20, right: 100, bottom: 40 },
	{ left: 110, top: 20, right: 180, bottom: 40 },
	{ left: 30, top: 45, right: 100, bottom: 65 },
	{ left: 110, top: 45, right: 180, bottom: 65 },
	{ left: 30, top: 70, right: 100, bottom: 85 },
	{ left: 110, top: 70, right: 180, bottom: 85 }
];

function layout(field: FieldController, hosts: Box[] = HOSTS): void {
	const stub = (el: Element | null, box: Box) => {
		if (el) (el as HTMLElement).getBoundingClientRect = () => domRect(box);
	};
	stub(field.el.querySelector('.qm-table-island'), ISLAND);
	stub(field.el.querySelector('.qm-table'), GRID);
	field.el
		.querySelectorAll('.qm-table-cell-host')
		.forEach((host, i) => hosts[i] && stub(host, hosts[i]));
	// The `td`s take the same boxes as the hosts they hold: what a press resolves
	// against is the host, and what a sweep resolves against is the box, so a test that
	// drives either needs both. Tiling them identically is close enough for a hit test
	// and keeps one set of numbers.
	field.el.querySelectorAll('.qm-table-cell').forEach((box, i) => hosts[i] && stub(box, hosts[i]));
}

// jsdom implements no `Range` rects, and PM reads them to scroll a caret it just
// moved into view. The one browser API a landing past the island touches, stubbed at
// the zero box: what is under test is where the caret went, not what scrolled.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => domRect({ left: 0, top: 0, right: 0, bottom: 0 });

/** A press at a viewport point, on the element under it: `mousedown` is where the
 *  guard sits, being where PM arms the selection the mouseup would take. */
function pressAt(target: Element, x: number, y: number): void {
	target.dispatchEvent(
		new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y })
	);
}

/** The `td` of a cell, which is the cell's padding and its borders: chrome inside the
 *  frame, and the commonest place a press misses a host by a few pixels. */
function cellBox(field: FieldController, index: number): Element {
	return field.el.querySelectorAll('.qm-table-cell')[index];
}

/** Drive a printable key at a mounted view the way an input event does: PM routes
 *  text over a non-`TextSelection` through this prop before replacing the selection. */
function type(view: EditorView, text: string): boolean {
	const { from, to } = view.state.selection;
	return !!view.someProp('handleTextInput', (f) => f(view, from, to, text, () => view.state.tr));
}

describe('a pointer press on the island resolves to a caret', () => {
	it('inside the frame it lands in the NEAREST cell, by geometry', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		// The border between the two cells of row 1, a hair into the left one.
		pressAt(cellBox(field, 2), 103, 55);
		expect((field as FieldController & LeafViews).focusedView()).toBe(cellViews(field)[2]);
		expect(outerView(field).state.selection instanceof NodeSelection).toBe(false);
		field.destroy();
	});

	it("the band is the table's too, where no handle is under the press", () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		// Inside the frame, beside the last row and left of every cell: the band the
		// scroller opens is the table's, and a press in it lands in the nearest cell
		// rather than selecting anything.
		pressAt(cellBox(field, 4), 20, 78);
		expect((field as FieldController & LeafViews).focusedView()).toBe(cellViews(field)[4]);
		expect(outerView(field).state.selection instanceof NodeSelection).toBe(false);
		field.destroy();
	});

	it('outside the frame it writes beside the table, on the side it landed', () => {
		const { field } = tableLeaf(LETTERED);
		layout(field);
		const island = field.el.querySelector('.qm-table-island')!;
		pressAt(island, 195, 110); // below the grid: the document's band
		const after = outerView(field).state.selection;
		expect(after instanceof TextSelection).toBe(true);
		expect(after.$head.parent.textContent).toBe('tail');
		pressAt(island, 5, 5); // above it
		const before = outerView(field).state.selection;
		expect(before.$head.parent.textContent).toBe('para');
		field.destroy();
	});

	it('a gap cursor is the caret where the document holds no text position', () => {
		// The island is the whole document, so there is no block beside it to write in.
		const doc = quill().seedDocument();
		doc.overwrite({}, md('| a | b |\n|---|---|\n| 1 | 2 |'));
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		layout(field, HOSTS.slice(0, 4));
		pressAt(field.el.querySelector('.qm-table-island')!, 195, 110);
		expect(outerView(field).state.selection instanceof GapCursor).toBe(true);
		field.destroy();
	});

	it('an island drawing no interior keeps the click: the rule, not an exception', () => {
		const doc = quill().seedDocument();
		const rt = md(TABLE_MD);
		rt.islands[0] = { id: 'isl-0', type: 'table', props: BAD_PROPS, loss: 'unrepresentable' };
		doc.overwrite({}, rt);
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		// Dispatched at the island rather than through it: PM's own mousedown wants a
		// `elementFromPoint` jsdom does not have, and what is asserted is that the
		// guard declined to stand in front of it.
		const event = new MouseEvent('mousedown', { cancelable: true, clientX: 5, clientY: 5 });
		field.el.querySelector('.qm-table-island')!.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
		field.destroy();
	});
});

describe('a selection is the subject of the next command', () => {
	it('a printable key over a BLOCK island opens a paragraph after it', () => {
		const { doc, field } = tableLeaf(LETTERED);
		const first = cellViews(field)[0];
		first.focus();
		press(first, 'Escape'); // the caret's row
		press(first, 'Escape'); // and the island under it
		const outer = outerView(field);
		expect(type(outer, 'x')).toBe(true);
		expect(doc.main.body.islands).toHaveLength(1); // the table stands
		expect(outer.state.doc.child(2).textContent).toBe('x');
		expect(outer.state.selection instanceof TextSelection).toBe(true);
		expect(outer.state.selection.empty).toBe(true);
		field.destroy();
	});

	it('a printable key over an INLINE island lands after the image, in its line', () => {
		const doc = quill().seedDocument();
		doc.overwrite({}, md('a ![alt](url) b'));
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		const outer = outerView(field);
		let at = -1;
		outer.state.doc.descendants((node, pos) => {
			if (node.type.name === 'island_inline') at = pos;
		});
		expect(at).toBeGreaterThan(-1);
		outer.dispatch(outer.state.tr.setSelection(NodeSelection.create(outer.state.doc, at)));
		expect(type(outer, 'x')).toBe(true);
		expect(doc.main.body.islands).toHaveLength(1); // the image stands
		expect(doc.main.body.text).toBe('a ￼x b');
		field.destroy();
	});
});

// ── The clipboard door is shut ───────────────────────────────────────────────
//
// Markdown and HTML reach a field by import (CODEC §"Markdown at the edges"), never by
// a paste, so no surface reads or writes a table on the clipboard. A pasted `<table>`
// gets ProseMirror's own DOM parse against a schema that declares no `parseDOM` for an
// island, which is to say it arrives as its text.

/** A clipboard event jsdom can carry: it implements no `DataTransfer`, and `getData` /
 *  `setData` are what a handler would reach for. The seed is what a paste arrives with;
 *  the same object is what a copy would be read back off, and stays empty. */
function clipboard(kind: 'copy' | 'cut' | 'paste', seed: Record<string, string> = {}) {
	const held: Record<string, string> = { ...seed };
	const event = new Event(kind, { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: {
			getData: (type: string) => held[type] ?? '',
			setData: (type: string, value: string) => {
				held[type] = value;
			}
		}
	});
	return { event: event as ClipboardEvent, held };
}

const PASTED = '<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>';

describe('no table crosses the clipboard', () => {
	it('an HTML table pasted into the body mints no island', () => {
		const { doc, field } = tableLeaf(LETTERED);
		const outer = outerView(field);
		outer.dispatch(outer.state.tr.setSelection(Selection.atEnd(outer.state.doc)));
		outer.pasteHTML(PASTED, clipboard('paste').event);
		expect(doc.main.body.islands).toHaveLength(1); // the one the leaf opened with
		field.destroy();
	});

	it('a copy over a held rectangle claims nothing and writes nothing', () => {
		const { field } = tableLeaf(LETTERED);
		grips(field, 'row')[1].click();
		const { event, held } = clipboard('copy');
		field.el.querySelector('.qm-table-island')!.dispatchEvent(event);
		expect(held).toEqual({});
		expect(event.defaultPrevented).toBe(false);
		field.destroy();
	});

	it('a table pasted into a cell is the cell’s own paste, and the table does not grow', () => {
		const { field } = tableLeaf(LETTERED);
		const view = cellViews(field)[3]; // row 1, column 1
		view.focus();
		view.pasteHTML(PASTED, clipboard('paste', { 'text/html': PASTED }).event);
		expect(shapeEqual(leafProps(field), LETTERED)).toBe(true);
		field.destroy();
	});
});
