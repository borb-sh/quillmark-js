// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { splitBlock } from 'prosemirror-commands';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import {
	blockSchema,
	createField,
	inputRulesPlugin,
	listKeymap,
	pmToContent,
	proseLeafPlugins
} from '$lib/core/codec';
import { pickList, wrapInList, wrapInQuote } from '$lib/core/codec/blocks.js';
import { MAX_NESTING_DEPTH } from '$lib/core/codec/nesting.js';
import { slashItems } from '$lib/core/codec/slash.js';
import { md, mount, quill, representable, textblocks, viewOf } from './_util.js';

const n = blockSchema.nodes;
const p = (text: string) => n.paragraph.create(null, blockSchema.text(text));
const li = (...blocks: PMNode[]) => n.list_item.create(null, blocks);
const ul = (...items: PMNode[]) => n.bullet_list.create(null, items);
const quote = (...blocks: PMNode[]) => n.blockquote.create(null, blocks);
const docOf = (...blocks: PMNode[]) => n.doc.create(null, blocks);

/** `inner` under `levels` list items, each carrying a line of its own. */
function inItems(levels: number, inner: PMNode): PMNode {
	return levels === 0 ? inner : ul(li(p(`l${levels}`), inItems(levels - 1, inner)));
}

/** `inner` under `levels` quotes. */
function inQuotes(levels: number, inner: PMNode): PMNode {
	return levels === 0 ? inner : quote(inQuotes(levels - 1, inner));
}

/** The caret at the head of the doc's last textblock. */
function atLast(doc: PMNode): EditorState {
	const last = textblocks(doc).at(-1)!;
	return EditorState.create({ doc, selection: TextSelection.create(doc, last.start) });
}

/** The state `cmd` dispatches, `null` where it dispatches nothing, and what it returned. */
function apply(state: EditorState, cmd: Command): { handled: boolean; next: EditorState | null } {
	let next: EditorState | null = null;
	const handled = cmd(state, (tr) => (next = state.apply(tr)));
	return { handled, next };
}

/** The deepest container count over any line, as the store reads it. */
function deepest(state: EditorState): number {
	return Math.max(...pmToContent(state.doc).lines.map((line) => line.containers.length));
}

describe('Tab', () => {
	const tab = listKeymap(blockSchema)['Tab'];
	const siblings = ul(li(p('a')), li(p('b')));

	it(`sinks an item to level ${MAX_NESTING_DEPTH}`, () => {
		const { handled, next } = apply(atLast(docOf(inItems(MAX_NESTING_DEPTH - 2, siblings))), tab);
		expect(handled).toBe(true);
		expect(deepest(next!)).toBe(MAX_NESTING_DEPTH);
		expect(representable(next!)).toBe(true);
	});

	it(`is claimed and inert at level ${MAX_NESTING_DEPTH}`, () => {
		const { handled, next } = apply(atLast(docOf(inItems(MAX_NESTING_DEPTH - 1, siblings))), tab);
		expect(handled).toBe(true);
		expect(next).toBe(null);
	});

	it('counts a quote around the list', () => {
		const doc = docOf(inQuotes(1, inItems(MAX_NESTING_DEPTH - 2, siblings)));
		expect(apply(atLast(doc), tab)).toEqual({ handled: true, next: null });
	});

	it('keeps the key in a mounted body at the bound', () => {
		const doc = docOf(inItems(MAX_NESTING_DEPTH - 1, siblings));
		const state = EditorState.create({
			doc,
			selection: atLast(doc).selection,
			plugins: proseLeafPlugins(blockSchema, { inline: false })
		});
		const view = new EditorView(document.createElement('div'), { state });
		const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
		expect(view.someProp('handleKeyDown', (f) => f(view, event))).toBe(true);
		expect(view.state.doc.eq(doc)).toBe(true);
		view.destroy();
	});
});

describe('the wrap commands', () => {
	it.each([
		['wrapInQuote', wrapInQuote()],
		['wrapInList', wrapInList(false)],
		['pickList', pickList(true)]
	])('%s wraps up to the bound and no further', (_name, cmd) => {
		const below = apply(atLast(docOf(inQuotes(MAX_NESTING_DEPTH - 1, p('a')))), cmd);
		expect(below.handled).toBe(true);
		expect(deepest(below.next!)).toBe(MAX_NESTING_DEPTH);
		expect(representable(below.next!)).toBe(true);

		const at = apply(atLast(docOf(inQuotes(MAX_NESTING_DEPTH, p('a')))), cmd);
		expect(at).toEqual({ handled: false, next: null });
	});

	it('the menu offers no wrap at the bound', () => {
		const items = slashItems(atLast(docOf(inQuotes(MAX_NESTING_DEPTH, p('a')))));
		expect(items).toEqual(expect.arrayContaining(['heading', 'code']));
		for (const name of ['list', 'numbered-list', 'subparagraph', 'quote'])
			expect(items).not.toContain(name);
	});

	it('wrapInList counts the items the block stands in', () => {
		const doc = docOf(inItems(MAX_NESTING_DEPTH, p('a')));
		expect(apply(atLast(doc), wrapInList(false)).handled).toBe(false);
	});
});

describe('the `> ` and `- ` shorthands', () => {
	function typeAtLast(doc: PMNode, text: string): EditorView {
		const state = EditorState.create({
			doc,
			selection: atLast(doc).selection,
			plugins: [inputRulesPlugin(blockSchema)]
		});
		const view = new EditorView(document.createElement('div'), { state });
		for (const ch of text) {
			const { from, to } = view.state.selection;
			const deflt = () => view.state.tr.insertText(ch, from, to);
			if (!view.someProp('handleTextInput', (f) => f(view, from, to, ch, deflt)))
				view.dispatch(deflt());
		}
		return view;
	}

	it.each(['> ', '- '])('`%s` fires below the bound and stays text at it', (typed) => {
		const below = typeAtLast(docOf(inQuotes(MAX_NESTING_DEPTH - 1, p('a'))), typed);
		expect(deepest(below.state)).toBe(MAX_NESTING_DEPTH);
		expect(below.state.doc.textContent).toBe('a');
		below.destroy();

		const doc = docOf(inQuotes(MAX_NESTING_DEPTH, p('a')));
		const at = typeAtLast(doc, typed);
		expect(deepest(at.state)).toBe(MAX_NESTING_DEPTH);
		expect(at.state.doc.textContent).toBe(`${typed}a`);
		at.destroy();
	});
});

describe('a paste into a deep body', () => {
	/** A body `levels` quotes deep, the caret on a fresh line under its one line. */
	function deepBody(levels: number) {
		const doc = quill().seedDocument();
		doc.overwrite({}, md(`${'> '.repeat(levels)}a`));
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		const view = viewOf(field);
		view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
		splitBlock(view.state, view.dispatch);
		return { field, view };
	}

	/** A browser's paste of `text` with no HTML beside it. jsdom implements no
	 *  `DataTransfer`, and `getData` is all ProseMirror's handler reads. */
	function pasteEvent(text: string): ClipboardEvent {
		const event = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', {
			value: { getData: (type: string) => (type === 'text/plain' ? text : ''), setData: () => {} }
		});
		return event as ClipboardEvent;
	}

	/** A bullet list `levels` deep. */
	const listOf = (levels: number): string =>
		Array.from({ length: levels }, (_, i) => `${'  '.repeat(i)}- i${i + 1}`).join('\n');

	it.each([
		[2, true],
		[3, false],
		[5, false]
	])('a %i-level list at depth 10 lands: %s', (levels, lands) => {
		const { field, view } = deepBody(10);
		const before = field.getContent();
		const beforeDoc = view.state.doc;
		const thrown: unknown[] = [];
		const onError = (e: ErrorEvent) => thrown.push(e.error);
		window.addEventListener('error', onError);
		view.dom.dispatchEvent(pasteEvent(listOf(levels)));
		window.removeEventListener('error', onError);
		expect(thrown).toEqual([]);
		const after = field.getContent();
		if (lands) {
			expect(Math.max(...after.lines.map((l) => l.containers.length))).toBe(10 + levels);
			expect(view.state.doc.textContent).toContain(`i${levels}`);
		} else {
			expect(after).toEqual(before);
			expect(view.state.doc.textContent).toBe('a');
			expect(view.state.doc.eq(beforeDoc)).toBe(true);
		}
		field.destroy();
	});
});
