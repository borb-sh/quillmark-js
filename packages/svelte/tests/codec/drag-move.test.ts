// @vitest-environment jsdom
// A text drag between two leaves moves: the leaf the drag started in gives its text up
// once another leaf has taken the drop, and keeps it under the copy modifier. Each step is
// the drag event a browser fires, read by the handlers ProseMirror registers; jsdom lays
// nothing out, so where the pointer is comes from the view's own `posAtCoords`, stubbed.
import { describe, it, expect } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { closeHistory, redo, undo } from 'prosemirror-history';
import type { EditorView } from 'prosemirror-view';
import { createField } from '$lib/core/codec';
import type { FieldController, LeafViews } from '$lib/core/codec';
import { md, mount, quill, viewOf } from './_util.js';

// jsdom implements no `Range` rects, and PM reads them to scroll the caret a history step
// moved into view.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function leaves(titled = 'One two') {
	const doc = quill().seedDocument();
	const open = (field: string, text: string): EditorView => {
		const view = viewOf(createField({ doc, quill: quill(), addr: { field }, container: mount() }));
		view.dispatch(view.state.tr.insertText(text, 1, view.state.doc.content.size - 1));
		return view;
	};
	return { doc, title: open('title', titled), subtitle: open('subtitle', 'Three') };
}

/** One drag's data, carried from its `dragstart` to its `drop`. */
function transfer() {
	const data = new Map<string, string>();
	return {
		files: [],
		effectAllowed: '',
		clearData: () => data.clear(),
		setData: (type: string, value: string) => void data.set(type, value),
		getData: (type: string) => data.get(type) ?? ''
	};
}
function fire(view: EditorView, type: string, dataTransfer: unknown, at: number, init = {}): void {
	view.posAtCoords = () => ({ pos: at, inside: -1 });
	const event = new Event(type, { bubbles: true, cancelable: true });
	view.dom.dispatchEvent(Object.assign(event, { dataTransfer, clientX: 0, clientY: 0, ...init }));
}
/** Drag `from`'s characters `[a, b)` to offset `to` of `into`. */
async function drag(
	from: EditorView,
	a: number,
	b: number,
	into: EditorView,
	to: number,
	init = {}
) {
	from.dispatch(from.state.tr.setSelection(TextSelection.create(from.state.doc, a + 1, b + 1)));
	const data = transfer();
	fire(from, 'dragstart', data, a + 1);
	fire(into, 'drop', data, to + 1, init);
	fire(from, 'dragend', data, a + 1);
	await Promise.resolve();
}
const text = (view: EditorView): string => view.state.doc.textContent;

describe('a text drag between two leaves', () => {
	it('moves the text: the leaf it left gives it up', async () => {
		const { title, subtitle } = leaves();
		await drag(title, 0, 4, subtitle, 5);
		expect(text(subtitle)).toBe('ThreeOne ');
		expect(text(title)).toBe('two');
	});

	it('copies under the copy modifier', async () => {
		const { title, subtitle } = leaves();
		await drag(title, 0, 4, subtitle, 5, { ctrlKey: true, altKey: true });
		expect(text(subtitle)).toBe('ThreeOne ');
		expect(text(title)).toBe('One two');
	});

	it('still moves inside one leaf, once', async () => {
		const { title } = leaves();
		await drag(title, 0, 4, title, 7);
		expect(text(title)).toBe('twoOne ');
	});

	it('takes both halves back on an undo in either leaf, and forward on a redo', async () => {
		for (const side of ['subtitle', 'title'] as const) {
			const both = leaves();
			const { title, subtitle } = both;
			// The typing that filled the leaves is a step of its own, behind the move.
			for (const view of [title, subtitle]) view.dispatch(closeHistory(view.state.tr));
			await drag(title, 0, 4, subtitle, 5);
			const stepper = both[side];
			undo(stepper.state, stepper.dispatch);
			expect([text(title), text(subtitle)]).toEqual(['One two', 'Three']);
			redo(stepper.state, stepper.dispatch);
			expect([text(title), text(subtitle)]).toEqual(['two', 'ThreeOne ']);
		}
	});

	it('leaves an undo to its own leaf once the other has been edited', async () => {
		const { title, subtitle } = leaves();
		for (const view of [title, subtitle]) view.dispatch(closeHistory(view.state.tr));
		await drag(title, 0, 4, subtitle, 5);
		title.dispatch(closeHistory(title.state.tr).insertText('!', 1));
		undo(subtitle.state, subtitle.dispatch);
		expect([text(title), text(subtitle)]).toEqual(['!two', 'Three']);
	});

	it('writes both leaves to the document', async () => {
		const { doc, title, subtitle } = leaves();
		await drag(title, 0, 4, subtitle, 5);
		const reader = quill().reader(doc);
		expect(reader.getContentAt({ field: 'title' }, [])?.text).toBe('two');
		expect(reader.getContentAt({ field: 'subtitle' }, [])?.text).toBe('ThreeOne ');
	});

	it('closes the gap a whole word leaves to one space', async () => {
		for (const [line, a, b, left] of [
			['The Showcase Quill', 4, 12, 'The Quill'],
			['The Showcase Quill', 0, 3, 'Showcase Quill'],
			['The Showcase Quill', 13, 18, 'The Showcase'],
			['The Showcase, Quill', 4, 12, 'The, Quill']
		] as const) {
			const { title, subtitle } = leaves(line);
			await drag(title, a, b, subtitle, 5);
			expect(text(title)).toBe(left);
		}
	});

	it('leaves the spaces where part of a word moves', async () => {
		const { title, subtitle } = leaves('The Showcase Quill');
		await drag(title, 4, 8, subtitle, 5);
		expect(text(title)).toBe('The case Quill');
	});

	it('takes the closed gap back with the move', async () => {
		const { title, subtitle } = leaves('The Showcase Quill');
		for (const view of [title, subtitle]) view.dispatch(closeHistory(view.state.tr));
		await drag(title, 4, 12, subtitle, 5);
		undo(subtitle.state, subtitle.dispatch);
		expect([text(title), text(subtitle)]).toEqual(['The Showcase Quill', 'Three']);
	});
});

describe('a text drag between a table cell and the leaf its island stands in', () => {
	function body() {
		const doc = quill().seedDocument();
		doc.replace({}, md('para\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntail'));
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		const leaf = field as FieldController & LeafViews;
		leaf.view.dispatch(closeHistory(leaf.view.state.tr));
		const read = () => [
			leaf.view.state.doc.firstChild!.textContent,
			leaf.nestedViews()[0].state.doc.textContent
		];
		return { outer: leaf.view, cell: () => leaf.nestedViews()[0], read };
	}

	it('undoes a move out of the cell as one step', async () => {
		const { outer, cell, read } = body();
		await drag(cell(), 0, 1, outer, 4);
		expect(read()).toEqual(['paraa', '']);
		undo(outer.state, outer.dispatch);
		expect(read()).toEqual(['para', 'a']);
		redo(outer.state, outer.dispatch);
		expect(read()).toEqual(['paraa', '']);
	});

	it('undoes a move into the cell as one step', async () => {
		const { outer, cell, read } = body();
		await drag(outer, 0, 2, cell(), 1);
		expect(read()).toEqual(['ra', 'apa']);
		undo(outer.state, outer.dispatch);
		expect(read()).toEqual(['para', 'a']);
		redo(outer.state, outer.dispatch);
		expect(read()).toEqual(['ra', 'apa']);
	});
});
