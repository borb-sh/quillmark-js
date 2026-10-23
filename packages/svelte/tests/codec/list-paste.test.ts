// @vitest-environment jsdom
// A pasted list takes the numbering of where it lands (`codec/list-paste.ts`). Each copy is
// the one a view writes for a selection, `selection.content()` through ProseMirror's own
// clipboard serializer, and each paste a browser's paste event on a mounted leaf.
import { describe, it, expect } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { createField, type FieldController } from '$lib/core/codec';
import { md, mount, quill, representable, viewOf } from './_util.js';

function leaf(markdown: string): { field: FieldController; view: EditorView } {
	const doc = quill().seedDocument();
	doc.overwrite({}, md(markdown));
	const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
	return { field, view: viewOf(field) };
}

/** The position just after the first `text` in the leaf, or just before it with `head`. */
function at(view: EditorView, text: string, head = false): number {
	let pos = -1;
	view.state.doc.descendants((node, p) => {
		if (pos < 0 && node.isText && node.text!.includes(text))
			pos = p + node.text!.indexOf(text) + (head ? 0 : text.length);
		return pos < 0;
	});
	if (pos < 0) throw new Error(`no ${text}`);
	return pos;
}

/** What a copy of `[from, to)` out of a leaf over `markdown` puts on the clipboard. */
function copy(
	markdown: string,
	range: (view: EditorView) => [number, number]
): Record<string, string> {
	const { field, view } = leaf(markdown);
	const [from, to] = range(view);
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
	const { dom, text } = view.serializeForClipboard(view.state.selection.content());
	field.destroy();
	return { 'text/html': (dom as HTMLElement).innerHTML, 'text/plain': text };
}

function pasteEvent(data: Record<string, string>): ClipboardEvent {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { getData: (type: string) => data[type] ?? '', setData: () => {} }
	});
	return event as ClipboardEvent;
}

/** The leaf over `markdown` after `data` is pasted at the caret `caret` places. */
function pasted(markdown: string, caret: (view: EditorView) => void, data: Record<string, string>) {
	const { field, view } = leaf(markdown);
	caret(view);
	view.dom.dispatchEvent(pasteEvent(data));
	const state = view.state;
	field.destroy();
	return state;
}

const whole = (view: EditorView): [number, number] => [1, view.state.doc.content.size - 1];
/** Items `b` and `c` of a list `a, b, c`, selected from `b`'s text to `c`'s. */
const run = (view: EditorView): [number, number] => [at(view, 'b', true), at(view, 'c')];
/** An empty item opened after the item ending in `text`. */
const emptyItemAfter = (text: string) => (view: EditorView) => {
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at(view, text))));
	view.dispatch(view.state.tr.split(view.state.selection.from, 2));
};
/** The empty line under the list, where Enter on an empty last item leaves the caret. */
const lineAfter = (view: EditorView) => {
	const end = view.state.doc.content.size;
	view.dispatch(view.state.tr.insert(end, view.state.schema.nodes.paragraph.create()));
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end + 1)));
};
/** A fresh line under a paragraph. */
const lineUnder = (view: EditorView) => lineAfter(view);

describe('a list on a line of its own', () => {
	it('a whole list keeps the start it was copied with', () => {
		const state = pasted('intro', lineUnder, copy('7. a\n8. b\n9. c', whole));
		expect(state.doc.child(1).attrs.start).toBe(7);
		expect(state.doc.child(1).childCount).toBe(3);
	});

	it('a run of items copied out of a list counts from 1', () => {
		const state = pasted('intro', lineUnder, copy('5. a\n6. b\n7. c', run));
		expect(state.doc.toString()).toBe(
			'doc(paragraph("intro"), ordered_list(list_item(paragraph("b")), list_item(paragraph("c"))))'
		);
		expect(state.doc.child(1).attrs.start).toBe(1);
	});

	it('a run that runs on past the list still counts from 1', () => {
		const state = pasted(
			'intro',
			lineUnder,
			copy('5. a\n6. b\n7. c\n\ntail', (view) => [at(view, 'b', true), at(view, 'tail')])
		);
		expect(state.doc.child(1).type.name).toBe('ordered_list');
		expect(state.doc.child(1).attrs.start).toBe(1);
	});

	it('a selection inside a later item copies no number from the list', () => {
		const state = pasted(
			'intro',
			lineUnder,
			copy('5. a\n6. b\n\n   bb', (view) => [at(view, 'b', true), at(view, 'bb')])
		);
		const list = state.doc.child(1);
		expect(list.type.name).toBe('ordered_list');
		expect(list.attrs.start).toBe(1);
	});

	it('a run of bullets stays bullets', () => {
		const state = pasted('intro', lineUnder, copy('- a\n- b\n- c', run));
		expect(state.doc.child(1).type.name).toBe('bullet_list');
	});
});

describe('a list pasted into a list joins its count', () => {
	it('a whole list into an empty item: its items, not a list nested in the item', () => {
		const state = pasted('1. x\n2. y', emptyItemAfter('y'), copy('7. a\n8. b', whole));
		expect(state.doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph("x")), list_item(paragraph("y")), list_item(paragraph("a")), list_item(paragraph("b"))))'
		);
		expect(state.doc.child(0).attrs.start).toBe(1);
		expect(representable(state)).toBe(true);
	});

	it('bullets into a numbered list take its kind', () => {
		const state = pasted('1. x\n2. y', emptyItemAfter('y'), copy('- a\n- b', whole));
		expect(state.doc.childCount).toBe(1);
		expect(state.doc.child(0).type.name).toBe('ordered_list');
		expect(state.doc.child(0).childCount).toBe(4);
	});

	it('a run of items into an empty item', () => {
		const state = pasted('1. x\n2. y', emptyItemAfter('y'), copy('1. a\n2. b\n3. c', run));
		expect(state.doc.child(0).childCount).toBe(4);
	});

	it('on the empty line a list was left by, the items are that list’s next ones', () => {
		for (const source of ['1. a\n2. b\n3. c', '7. a\n8. b\n9. c']) {
			const range = source.startsWith('7') ? whole : run;
			const state = pasted('1. x\n2. y', lineAfter, copy(source, range));
			expect(state.doc.childCount, source).toBe(1);
			expect(state.doc.child(0).attrs.start, source).toBe(1);
			expect(representable(state), source).toBe(true);
		}
	});

	it('under a list of the other kind the paste stands as its own list', () => {
		const state = pasted('- x\n- y', lineAfter, copy('1. a\n2. b\n3. c', run));
		expect(state.doc.childCount).toBe(2);
		expect(state.doc.child(1).type.name).toBe('ordered_list');
	});
});

/** The caret at the head of the line holding `text`. */
const headOf = (text: string) => (view: EditorView) =>
	view.dispatch(
		view.state.tr.setSelection(TextSelection.create(view.state.doc, at(view, text, true)))
	);
/** The caret at the end of the line holding `text`. */
const endOf = (text: string) => (view: EditorView) =>
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at(view, text))));
const ABCD = '1. Alpha\n2. Bravo\n3. Charlie\n4. Delta';

describe('text from inside one line pastes as text', () => {
	const harl = () => copy(ABCD, (view) => [at(view, 'harl', true), at(view, 'harl')]);

	it('at the head of an item, it joins that item’s line', () => {
		const state = pasted(ABCD, headOf('Bravo'), harl());
		expect(state.doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph("Alpha")), list_item(paragraph("harlBravo")), list_item(paragraph("Charlie")), list_item(paragraph("Delta"))))'
		);
		expect(representable(state)).toBe(true);
	});

	it('at the head of a paragraph, the paragraph stays one', () => {
		const state = pasted('Para\n\nmore', headOf('Para'), harl());
		expect(state.doc.toString()).toBe('doc(paragraph("harlPara"), paragraph("more"))');
	});

	it('a numbered item’s text at the head of a bullet keeps the bullet', () => {
		const alpha = copy('1. Alpha', (view) => [at(view, 'Alpha', true), at(view, 'Alpha')]);
		const state = pasted('- one\n- two', headOf('two'), alpha);
		expect(state.doc.toString()).toBe(
			'doc(bullet_list(list_item(paragraph("one")), list_item(paragraph("Alphatwo"))))'
		);
	});

	it('a heading’s text does not make the line a heading', () => {
		const head = copy('# Head', (view) => [at(view, 'Head', true), at(view, 'Head')]);
		expect(pasted('Para', headOf('Para'), head).doc.toString()).toBe('doc(paragraph("HeadPara"))');
	});

	// A web page's copy states no open depth, so its item is read whole.
	it('an item copied off a web page is still an item', () => {
		const state = pasted('intro', lineUnder, { 'text/html': '<ol><li>One</li></ol>' });
		expect(state.doc.child(1).type.name).toBe('ordered_list');
	});
});

describe('items pasted at the head of an item are its list’s', () => {
	it('a whole item copied with its line end lands above the item, in the same list', () => {
		const charlie = copy(ABCD, (view) => [at(view, 'Charlie', true), at(view, 'Delta', true)]);
		const state = pasted(ABCD, headOf('Alpha'), charlie);
		expect(state.doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph("Charlie")), list_item(paragraph("Alpha")), list_item(paragraph("Bravo")), list_item(paragraph("Charlie")), list_item(paragraph("Delta"))))'
		);
		expect(representable(state)).toBe(true);
	});

	it('a line end then a line, as a word processor pastes them: nothing nests', () => {
		const tail = copy(ABCD, (view) => [at(view, 'Bravo'), at(view, 'Charlie')]);
		const state = pasted(ABCD, headOf('Alpha'), tail);
		expect(state.doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph), list_item(paragraph("CharlieAlpha")), list_item(paragraph("Bravo")), list_item(paragraph("Charlie")), list_item(paragraph("Delta"))))'
		);
	});
});

describe('paragraphs pasted into an item’s line are items', () => {
	const three = '<p>one</p><p>two</p><p>three</p>';
	const items = (...texts: string[]) =>
		texts.map((text) => `list_item(paragraph${text ? `("${text}")` : ''})`).join(', ');

	it('at the end of an item, each paragraph after the first is the next item', () => {
		const sources: Record<string, string>[] = [
			{ 'text/html': three },
			{ 'text/plain': 'one\ntwo\nthree' }
		];
		for (const data of sources) {
			const state = pasted(ABCD, endOf('Bravo'), data);
			expect(state.doc.toString()).toBe(
				`doc(ordered_list(${items('Alpha', 'Bravoone', 'two', 'three', 'Charlie', 'Delta')}))`
			);
			expect(representable(state)).toBe(true);
		}
	});

	it('into an empty item, the first fills it', () => {
		const state = pasted('1. x\n2. y', emptyItemAfter('y'), { 'text/html': three });
		expect(state.doc.toString()).toBe(
			`doc(ordered_list(${items('x', 'y', 'one', 'two', 'three')}))`
		);
	});

	it('mid-line, the line’s tail ends the last', () => {
		const state = pasted('1. Bravo', (view) => endOf('Bra')(view), { 'text/html': three });
		expect(state.doc.toString()).toBe(`doc(ordered_list(${items('Braone', 'two', 'threevo')}))`);
	});

	it('a task’s new siblings are tasks, unchecked', () => {
		const state = pasted('- [x] done', endOf('done'), { 'text/html': three });
		const list = state.doc.child(0);
		expect(list.childCount).toBe(3);
		expect([0, 1, 2].map((i) => list.child(i).attrs.checked)).toEqual([true, false, false]);
	});

	it('into an unnumbered line under an item, they stay unnumbered lines', () => {
		const state = pasted('1. Alpha\n\n   more', endOf('more'), { 'text/html': three });
		expect(state.doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph("Alpha"), paragraph("moreone"), paragraph("two"), paragraph("three"))))'
		);
	});
});
