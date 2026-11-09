// @vitest-environment jsdom
// A text drag between two leaves moves: the leaf the drag started in gives its text up
// once another leaf has taken the drop, and keeps it under the copy modifier. Each step is
// the drag event a browser fires, read by the handlers ProseMirror registers; jsdom lays
// nothing out, so where the pointer is comes from the view's own `posAtCoords`, stubbed.
import { describe, it, expect } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { createField } from '$lib/core/codec';
import { mount, quill, viewOf } from './_util.js';

function leaves() {
	const doc = quill().seedDocument();
	const open = (field: string, text: string): EditorView => {
		const view = viewOf(createField({ doc, quill: quill(), addr: { field }, container: mount() }));
		view.dispatch(view.state.tr.insertText(text, 1, view.state.doc.content.size - 1));
		return view;
	};
	return { doc, title: open('title', 'One two'), subtitle: open('subtitle', 'Three') };
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

	it('writes both leaves to the document', async () => {
		const { doc, title, subtitle } = leaves();
		await drag(title, 0, 4, subtitle, 5);
		const reader = quill().reader(doc);
		expect(reader.getContentAt({ field: 'title' }, [])?.text).toBe('two');
		expect(reader.getContentAt({ field: 'subtitle' }, [])?.text).toBe('ThreeOne ');
	});
});
