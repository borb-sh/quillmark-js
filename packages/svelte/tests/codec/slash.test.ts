// @vitest-environment jsdom
// The slash menu: the trigger's word boundary, the dismissals that edit no text, and
// a pick that consumes exactly the trigger run in one commit.
import { describe, it, expect, beforeAll } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { createField } from '$lib/core/codec';
import type { FieldController, LeafViews, SlashState } from '$lib/core/codec';
import { filterItems } from '$lib/core/codec/slash.js';
import type { Document, TableProps } from '@quillmark/wasm';
import { mount, press, quill, md } from './_util.js';

// jsdom has no layout, and ProseMirror measures: the caret it scrolls into view
// after a structural key, and the trigger the menu anchors on. One stub for both,
// since neither number is what these tests assert.
beforeAll(() => {
	const rects = [new DOMRect()] as unknown as DOMRectList;
	Element.prototype.getClientRects = () => rects;
	Element.prototype.getBoundingClientRect = () => new DOMRect();
	Range.prototype.getClientRects = () => rects;
	Range.prototype.getBoundingClientRect = () => new DOMRect();
});

/** A body leaf over `markdown`, with the menu's reports captured. */
function leaf(markdown = 'para') {
	const doc: Document = quill().seedDocument();
	doc.overwrite({}, md(markdown));
	const reports: (SlashState | undefined)[] = [];
	// One count per committed edit (`field.ts` §`dispatchTransaction`), which is what a
	// host recompiles on: the currency a pick is measured in.
	let commits = 0;
	const field = createField({
		doc,
		quill: quill(),
		addr: {},
		container: mount(),
		onChange: () => commits++,
		onSlash: (state) => reports.push(state)
	});
	const view = (field as FieldController & LeafViews).view;
	return { doc, field, view, reports, state: () => reports.at(-1), commits: () => commits };
}

/** Type `text` at the caret, one character per transaction, the way a keyboard does:
 *  the trigger reads the char before the caret, so a bulk insert is a different edit. */
function type(view: EditorView, text: string): void {
	for (const ch of text) {
		view.dispatch(view.state.tr.insertText(ch, view.state.selection.head));
	}
}

/** Delete `count` characters back from the caret, the way the key does: one
 *  transaction each, since the trigger recomputes per transaction. */
function backspace(view: EditorView, count = 1): void {
	for (let i = 0; i < count; i++) {
		const head = view.state.selection.head;
		view.dispatch(view.state.tr.delete(head - 1, head));
	}
}

/** Put the caret at a USV offset and type. */
function typeAt(field: FieldController, view: EditorView, pos: number, text: string): void {
	field.setCaret(pos);
	type(view, text);
}

describe('the trigger is a word boundary', () => {
	it('opens on `/` at the start of a textblock', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/');
		expect(state()?.items.length).toBeGreaterThan(0);
		field.destroy();
	});

	it('opens on `/` after whitespace', () => {
		const { field, view, state } = leaf('para');
		typeAt(field, view, 4, ' /');
		expect(state()).toBeDefined();
		field.destroy();
	});

	it('stays shut mid-word, so `and/or` and a URL are prose', () => {
		const { field, view, state } = leaf('and');
		typeAt(field, view, 3, '/or');
		expect(state()).toBeUndefined();
		expect(field.getContent().text).toBe('and/or');
		field.destroy();
	});

	it('stays shut inside a code block, which reinterprets nothing', () => {
		const { field, view, state } = leaf('```\ncode\n```');
		typeAt(field, view, field.getContent().text.length, ' /');
		expect(state()).toBeUndefined();
		field.destroy();
	});

	it('is absent from a constrained inline leaf, which holds no island and no block', () => {
		const doc = quill().seedDocument();
		const reports: (SlashState | undefined)[] = [];
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'title' },
			container: mount(),
			inline: true,
			onSlash: (state) => reports.push(state)
		});
		const view = (field as FieldController & LeafViews).view;
		field.setCaret(0);
		type(view, '/');
		expect(reports.at(-1)).toBeUndefined();
		field.destroy();
	});
});

describe('the vocabulary is the block shapes a pick fills, one implementation behind two doors', () => {
	it('offers the turns a shorthand mints, and the table no shorthand reaches', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/');
		expect(state()?.items).toEqual(['heading', 'list', 'numbered-list', 'quote', 'code', 'table']);
		field.destroy();
	});

	it('is lowercase kebab-case throughout: a name is typed, not read', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/');
		for (const name of state()!.items) expect(name).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
		field.destroy();
	});

	/** Type `name` as a trigger run at the head of the block holding USV `pos`, and pick
	 *  it. What each case asserts is that the pick lands what the shorthand lands. */
	function pick(field: FieldController, view: EditorView, pos: number, name: string): void {
		field.setCaret(pos);
		type(view, `/${name}`);
		press(view, 'Enter');
	}

	it('`/quote` wraps the block, the container `> ` opens', () => {
		const { field, view } = leaf('alpha');
		pick(field, view, 0, 'quote');
		const stored = field.getContent();
		expect(stored.text).toBe('alpha');
		expect(stored.lines[0].containers).toEqual([{ container: 'quote' }]);
		field.destroy();
	});

	it('`/list` mints the paragraph item `- ` does', () => {
		const { field, view } = leaf('alpha');
		pick(field, view, 0, 'list');
		const stored = field.getContent();
		expect(stored.text).toBe('alpha');
		expect(stored.lines[0].containers).toEqual([
			{ container: 'list_item', attrs: { ordered: false, start: 1, ordinal: 0 } }
		]);
		field.destroy();
	});

	it('`/numbered-list` mints the ordered one, numbered from 1', () => {
		const { field, view } = leaf('alpha');
		pick(field, view, 0, 'numbered-list');
		expect(field.getContent().lines[0].containers).toEqual([
			{ container: 'list_item', attrs: { ordered: true, start: 1, ordinal: 0 } }
		]);
		field.destroy();
	});

	it('a list pick continues the list above it rather than opening a second', () => {
		const { field, view } = leaf('- alpha\n\nbeta');
		pick(field, view, 6, 'list');
		const stored = field.getContent();
		// One list of two items, so the second item is ordinal 1 of the first's list.
		expect(stored.lines.map((l) => l.containers)).toEqual([
			[{ container: 'list_item', attrs: { ordered: false, start: 1, ordinal: 0 } }],
			[{ container: 'list_item', attrs: { ordered: false, start: 1, ordinal: 1 } }]
		]);
		field.destroy();
	});

	it('`/heading` is level 1, the level `# ` counts to', () => {
		const { field, view } = leaf('alpha');
		pick(field, view, 0, 'heading');
		expect(field.getContent().lines[0]).toMatchObject({ kind: 'heading', attrs: { level: 1 } });
		field.destroy();
	});

	it('`/code` opens the fence and the paragraph after it, and keeps the caret inside', () => {
		const { field, view } = leaf('');
		pick(field, view, 0, 'code');
		expect(field.getContent().lines.map((l) => l.kind)).toEqual(['code', 'para']);
		// A code block is the one block no gap cursor sits beside, so the exit is minted;
		// the caret stays in the fence.
		expect(view.state.selection.$head.parent.type.name).toBe('code_block');
		field.destroy();
	});
});

describe('a name is offered only where its command would run', () => {
	it('offers the island alone mid-paragraph, the rest turning the block the caret is in', () => {
		const { field, view, state } = leaf('para');
		typeAt(field, view, 4, ' /');
		expect(state()?.items).toEqual(['table']);
		field.destroy();
	});

	it("drops the lists at an item's head, where `- ` declines and Tab owns the nesting", () => {
		const { field, view, state } = leaf('- alpha');
		typeAt(field, view, 0, '/');
		expect(state()?.items).not.toContain('list');
		expect(state()?.items).not.toContain('numbered-list');
		// The item holds every other shape the content does, and `# ` / `> ` fire there.
		expect(state()?.items).toContain('heading');
		expect(state()?.items).toContain('quote');
		field.destroy();
	});

	it('a pick the menu never offers consumes nothing: the run is left as typed', () => {
		// `slashPick` is a public seam, so the decline is reachable without the menu.
		const { field, view } = leaf('- alpha');
		field.setCaret(0);
		type(view, '/list');
		field.slashPick('list');
		expect(field.getContent().text).toBe('/listalpha');
		field.destroy();
	});
});

describe('the query filters, and a miss draws nothing', () => {
	it('narrows on the name', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/tab');
		expect(state()?.items).toEqual(['table']);
		field.destroy();
	});

	it('draws nothing on a query nothing matches, leaving the text as typed', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/zzz');
		expect(state()?.items).toEqual([]);
		expect(field.getContent().text).toBe('/zzz');
		field.destroy();
	});

	it('narrows back in off a typo: the RUN outlives a query the vocabulary missed', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/tabel');
		expect(state()?.items).toEqual([]);
		// Backspace to `/tab`, the recovery a writer reaches for.
		backspace(view, 2);
		expect(state()?.query).toBe('tab');
		expect(state()?.items).toEqual(['table']);
		field.destroy();
	});

	it('keeps every key with the body while nothing is offered', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/zzz');
		expect(state()?.items).toEqual([]);
		// A surface only a keyboard can reach is worse than no surface: the run is live
		// and undrawn, so it claims none of the keys it claims over offers.
		for (const key of ['ArrowDown', 'ArrowUp', 'Escape']) {
			expect(
				view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key })))
			).toBeFalsy();
		}
		press(view, 'Enter');
		// Enter split the paragraph rather than inserting: no offer, no pick.
		expect(field.getContent().islands).toHaveLength(0);
		expect(field.getContent().text).toBe('/zzz\n');
		field.destroy();
	});

	it('closes on a space: a menu that survives one eats a sentence', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/ta ');
		expect(state()).toBeUndefined();
		field.destroy();
	});

	// Over a vocabulary of its own, so the rule is stated rather than illustrated by
	// whichever names the menu happens to carry.
	it('matches a case-insensitive prefix of the name or of any of its words', () => {
		const vocab = ['table', 'numbered-list', 'footnote'];
		expect(filterItems(vocab, 'TAB')).toEqual(['table']);
		// The noun a writer has, wherever it sits in the name.
		expect(filterItems(vocab, 'list')).toEqual(['numbered-list']);
		// A prefix and not a substring: `note` is inside `footnote` and completes nothing.
		expect(filterItems(vocab, 'note')).toEqual([]);
		expect(filterItems(vocab, '')).toEqual(vocab);
	});

	it('offers both lists on `/list`, in the vocabulary order', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/list');
		expect(state()?.items).toEqual(['list', 'numbered-list']);
		field.destroy();
	});
});

describe('a dismissal edits no text; a pick consumes exactly the run', () => {
	it('Escape closes and leaves the trigger run in the document', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/ta');
		press(view, 'Escape');
		expect(state()).toBeUndefined();
		expect(field.getContent().text).toBe('/ta');
		field.destroy();
	});

	it('an Escape sticks: the run is gone, so typing on does not raise it again', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/ta');
		press(view, 'Escape');
		type(view, 'b');
		// Escape says the `/` was prose. Recomputing the run from the text before the
		// caret would overrule that on the next keystroke.
		expect(state()).toBeUndefined();
		expect(field.getContent().text).toBe('/tab');
		field.destroy();
	});

	it('a caret move out of the run closes it', () => {
		const { field, view, state } = leaf('para');
		typeAt(field, view, 4, ' /ta');
		field.setCaret(0);
		expect(state()).toBeUndefined();
		field.destroy();
	});

	it('losing the focus closes it, so the run cannot outlive the surface drawing it', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/ta');
		expect(state()).toBeDefined();
		// A blur dispatches no transaction, so the recompute never sees it: without this
		// dismissal the run survives a click into another field while the chrome's own
		// outside-press layer closes the menu, and a click back onto the same caret
		// restores neither — the run is unchanged, so no report fires and the menu stays
		// shut over an Enter it is still claiming.
		view.dom.dispatchEvent(new FocusEvent('blur'));
		expect(state()).toBeUndefined();
		expect(field.getContent().text).toBe('/ta');
		// And Enter is the body's again: it splits the block, where a live run would have
		// consumed the text and inserted a table.
		press(view, 'Enter');
		expect(field.getContent().islands).toHaveLength(0);
		expect(field.getContent().text).toBe('/ta\n');
		field.destroy();
	});

	it('an undo closes it', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/ta');
		view.someProp('handleKeyDown', (f) =>
			f(view, new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
		);
		expect(state()).toBeUndefined();
		field.destroy();
	});

	it("the arrows are the menu's while it is open, and walk it as a ring", () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/');
		const claimed = (key: string) =>
			view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key })));
		expect(claimed('ArrowDown')).toBe(true);
		expect(state()?.index).toBe(1);
		expect(claimed('ArrowUp')).toBe(true);
		expect(state()?.index).toBe(0);
		// A ring, so no press is a no-op: Up off the first row lands on the last.
		expect(claimed('ArrowUp')).toBe(true);
		expect(state()?.index).toBe(state()!.items.length - 1);
		field.destroy();
	});

	it('Enter picks: the run is gone and the island opened, in ONE commit', () => {
		const { field, view, state, commits } = leaf('');
		typeAt(field, view, 0, '/tab');
		expect(state()?.items[0]).toBe('table');
		const before = commits();
		press(view, 'Enter');
		// The delete and the insert are one transaction, so the gesture recompiles the
		// document once rather than through a state with the run's text still in it.
		expect(commits()).toBe(before + 1);
		// The empty block the run was typed in is replaced, and a paragraph after the
		// island is the exit.
		expect(field.getContent().lines.map((l) => l.kind)).toEqual(['island', 'para']);
		field.destroy();
	});

	it('a pick mid-paragraph keeps the text and takes only the run', () => {
		const { field, view } = leaf('para');
		typeAt(field, view, 4, ' /table');
		press(view, 'Enter');
		const stored = field.getContent();
		// The paragraph keeps every character but the run, and the island opens after it
		// rather than splitting it.
		expect(stored.text).toBe('para \n￼\n');
		expect(stored.lines.map((l) => l.kind)).toEqual(['para', 'island', 'para']);
		field.destroy();
	});

	it('a table pick mints the next island id and lands the caret in the first cell', () => {
		const { doc, field, view } = leaf('para');
		field.setCaret(4);
		view.dispatch(view.state.tr.split(view.state.selection.head));
		type(view, '/table');
		press(view, 'Enter');
		const body = doc.main.body;
		expect(body.islands.map((i) => i.id)).toEqual(['isl-0']);
		expect(body.islands[0].type).toBe('table');
		expect(body.islands[0].loss).toBe('lossless');
		const props = body.islands[0].props as TableProps;
		expect(props.header).toHaveLength(3);
		expect(props.rows).toHaveLength(2);
		// The island opened a line of its own, and a paragraph after it: a block island
		// at the end of a body would otherwise leave nowhere to type.
		expect(body.text).toBe('para\n￼\n');
		expect(body.lines.map((l) => l.kind)).toEqual(['para', 'island', 'para']);
		// And the caret is in the fresh table rather than on it.
		const focused = (field as FieldController & LeafViews).focusedView();
		expect((field as FieldController & LeafViews).nestedViews()).toContain(focused);
		field.destroy();
	});

	it('a pointer pick runs the same path as Enter', () => {
		const { field, view } = leaf('');
		typeAt(field, view, 0, '/tab');
		field.slashPick('table');
		expect(field.getContent().lines.map((l) => l.kind)).toEqual(['island', 'para']);
		field.destroy();
	});

	it('a pointer entering an item moves the ONE highlight the keys drive', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/');
		field.slashFocus('quote');
		expect(state()!.items[state()!.index]).toBe('quote');
		// A name the menu is not offering moves nothing: a stale pointer event arrives
		// after the query that filtered its row away.
		field.slashFocus('nonesuch');
		expect(state()!.items[state()!.index]).toBe('quote');
		field.destroy();
	});
});

describe('a pick lands in the container the caret was writing in', () => {
	/** Run `/table` with the trigger typed at the start of the block holding USV `pos`: a
	 *  boundary the menu opens on, and the one that leaves the block's own text intact
	 *  once the run is consumed, so an assertion reads the structure and nothing else. */
	function pick(field: FieldController, view: EditorView, pos: number): void {
		field.setCaret(pos);
		type(view, '/table');
		press(view, 'Enter');
	}

	/** The `list_item` container an item at `ordinal` carries. */
	// No `instance`: a canonical read omits the zero, which every container here is.
	const item = (ordinal: number, ordered = false) => ({
		container: 'list_item',
		attrs: { ordered, start: 1, ordinal }
	});

	it('nests a table in the bullet item the caret was in', () => {
		const { field, view } = leaf('- alpha\n- beta');
		pick(field, view, 0);
		const stored = field.getContent();
		expect(stored.text).toBe('alpha\n￼\nbeta');
		expect(stored.lines.map((l) => l.kind)).toEqual(['para', 'island', 'para']);
		expect(stored.lines[1].containers).toEqual([item(0)]);
		field.destroy();
	});

	it('nests it in an ordered item, whose ordinal the island line carries', () => {
		const { field, view } = leaf('1. alpha\n2. beta');
		pick(field, view, 6);
		const stored = field.getContent();
		expect(stored.lines.map((l) => l.kind)).toEqual(['para', 'para', 'island', 'para']);
		expect(stored.lines[2].containers).toEqual([item(1, true)]);
		field.destroy();
	});

	it('nests it at the depth of a nested item, carrying the whole path', () => {
		const { field, view } = leaf('- alpha\n    - beta');
		pick(field, view, 6);
		const stored = field.getContent();
		expect(stored.lines[2].containers).toEqual([item(0), item(0)]);
		field.destroy();
	});

	it('nests it in a quote', () => {
		const { field, view } = leaf('> alpha');
		pick(field, view, 0);
		const stored = field.getContent();
		expect(stored.lines[1].containers).toEqual([{ container: 'quote' }]);
		field.destroy();
	});

	it('mints the exit paragraph at the end of the BODY', () => {
		const { field, view } = leaf('- alpha\n- beta');
		pick(field, view, 6);
		const stored = field.getContent();
		expect(stored.text).toBe('alpha\nbeta\n￼\n');
		expect(stored.lines.map((l) => l.kind)).toEqual(['para', 'para', 'island', 'para']);
		// The exit is the item's: the island opened inside it, so the way out is there too.
		expect(stored.lines[3].containers).toEqual([item(1)]);
		field.destroy();
	});

	it('mints none where the doc goes on, a non-last item having the next to type in', () => {
		const { field, view } = leaf('- alpha\n- beta');
		pick(field, view, 0);
		// Three lines, not four: a fourth would be an empty continuation of item 0, which
		// the reference quill typesets as an unnumbered paragraph.
		expect(field.getContent().lines).toHaveLength(3);
		field.destroy();
	});

	it('lands the caret in the fresh cell even where no exit paragraph follows', () => {
		const { field, view } = leaf('- alpha\n- beta');
		pick(field, view, 0);
		const focused = (field as FieldController & LeafViews).focusedView();
		expect((field as FieldController & LeafViews).nestedViews()).toContain(focused);
		field.destroy();
	});
});

describe('the menu does not disturb the body it sits in', () => {
	it('Enter with no menu open still splits a paragraph', () => {
		const { field, view } = leaf('para');
		field.setCaret(2);
		press(view, 'Enter');
		expect(field.getContent().lines).toHaveLength(2);
		field.destroy();
	});

	it('Escape with no menu open is not swallowed', () => {
		const { view } = leaf('para');
		const handled = view.someProp('handleKeyDown', (f) =>
			f(view, new KeyboardEvent('keydown', { key: 'Escape' }))
		);
		expect(handled).toBeFalsy();
	});

	it("a leaf given no `onSlash` mounts no trigger, so the keys stay the body's", () => {
		const doc = quill().seedDocument();
		doc.overwrite({}, md(''));
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		const view = (field as FieldController & LeafViews).view;
		field.setCaret(0);
		type(view, '/');
		// The `/` is prose, and nothing claimed Enter.
		expect(field.getContent().text).toBe('/');
		press(view, 'Enter');
		expect(field.getContent().lines).toHaveLength(2);
		field.destroy();
	});
});

describe('the menu anchors to a reference, not a measurement', () => {
	it('reports an anchor carrying the leaf as `contextElement`', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/');
		// The field floating-ui unwraps to decide what to observe for scroll, resize and
		// layout shift. Dropping it leaves the menu anchored to
		// numbers taken at this keystroke, which nothing then refreshes.
		expect(state()?.anchor.contextElement).toBe(view.dom);
		field.destroy();
	});

	it('measures on demand, so a second read follows the leaf', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/');
		const anchor = state()!.anchor;
		// The trigger's caret is a `Range` measure, and the stub stands in for the layout
		// jsdom has none of; moving it is the leaf scrolling under an open menu.
		let top = 10;
		Range.prototype.getBoundingClientRect = () => new DOMRect(0, top, 1, 12);
		expect(anchor.getBoundingClientRect().top).toBe(10);
		top = 90;
		expect(anchor.getBoundingClientRect().top).toBe(90);
		field.destroy();
	});

	it('holds its last rect once the position stops measuring', () => {
		const { field, view, state } = leaf('');
		typeAt(field, view, 0, '/');
		const anchor = state()!.anchor;
		Range.prototype.getBoundingClientRect = () => new DOMRect(0, 42, 1, 12);
		expect(anchor.getBoundingClientRect().top).toBe(42);
		// floating-ui calls the measure at moments none of its callers choose, a torn-down
		// view among them, so it may not throw out of a positioning pass.
		field.destroy();
		expect(() => anchor.getBoundingClientRect()).not.toThrow();
		expect(anchor.getBoundingClientRect().top).toBe(42);
	});
});
