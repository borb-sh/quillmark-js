// @vitest-environment jsdom
// The slash menu's hint: where the decoration stands, and that it names the key in the
// wording the host passes. Whether it shows is the stylesheet's too, which draws it
// only in a focused leaf, and after the ghost where one stands (`prose.css`).
import { describe, it, expect, beforeAll } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { createField, DEFAULT_SLASH_STRINGS } from '$lib/core/codec';
import type { CreateFieldOpts, FieldController, LeafViews } from '$lib/core/codec';
import type { Document } from '@quillmark/wasm';
import { mount, press, quill, md } from './_util.js';

// jsdom has no layout, and ProseMirror measures the caret it scrolls into view.
beforeAll(() => {
	const rects = [new DOMRect()] as unknown as DOMRectList;
	Element.prototype.getClientRects = () => rects;
	Element.prototype.getBoundingClientRect = () => new DOMRect();
	Range.prototype.getClientRects = () => rects;
	Range.prototype.getBoundingClientRect = () => new DOMRect();
});

/** A focused body leaf over `markdown`, with a menu mounted unless `opts` says otherwise. */
function leaf(markdown: string, opts: Partial<CreateFieldOpts> = {}) {
	const doc: Document = quill().seedDocument();
	doc.overwrite({}, md(markdown));
	const field = createField({
		doc,
		quill: quill(),
		addr: {},
		container: mount(),
		onSlash: () => {},
		...opts
	});
	const view = (field as FieldController & LeafViews).view;
	view.focus();
	return { field, view };
}

const hints = (view: EditorView) => [
	...view.dom.querySelectorAll<HTMLElement>('[data-slash-hint]')
];

describe('the hint stands on the empty line the caret holds', () => {
	it('on a fresh line, naming the key', () => {
		const { field, view } = leaf('one');
		field.setCaret(3);
		press(view, 'Enter');
		const [hint, ...rest] = hints(view);
		expect(rest).toEqual([]);
		expect(hint.textContent).toBe('');
		expect(hint.dataset.slashHint).toBe(DEFAULT_SLASH_STRINGS.slashHint);
		field.destroy();
	});

	it('on an empty body', () => {
		const { field, view } = leaf('');
		field.setCaret(0);
		expect(hints(view)).toHaveLength(1);
		field.destroy();
	});

	// The one line both decorations stamp is what the stylesheet draws the pair off.
	it('on an empty body beside its ghost, the one line carrying both', () => {
		const { field, view } = leaf('', { placeholder: 'Write…' });
		field.setCaret(0);
		const [line, ...rest] = hints(view);
		expect(rest).toEqual([]);
		expect(line.classList).toContain('qm-prose-placeholder');
		expect(line.dataset.placeholder).toBe('Write…');
		field.destroy();
	});

	it('in the host’s wording', () => {
		const { field, view } = leaf('', {
			slashStrings: () => ({ ...DEFAULT_SLASH_STRINGS, slashHint: 'Tapez / pour insérer' })
		});
		field.setCaret(0);
		expect(hints(view)[0].dataset.slashHint).toBe('Tapez / pour insérer');
		field.destroy();
	});

	it('follows the caret off the line, and goes once the line holds text', () => {
		const { field, view } = leaf('one');
		field.setCaret(3);
		press(view, 'Enter');
		field.setCaret(1);
		expect(hints(view)).toEqual([]);
		field.setCaret(4);
		expect(hints(view)).toHaveLength(1);
		view.dispatch(view.state.tr.insertText('/', view.state.selection.head));
		expect(hints(view)).toEqual([]);
		field.destroy();
	});
});

describe('nowhere a `/` opens no menu', () => {
	it('on a line with text', () => {
		const { field, view } = leaf('para');
		field.setCaret(4);
		expect(hints(view)).toEqual([]);
		field.destroy();
	});

	it('in a code block, which reinterprets nothing', () => {
		const { field, view } = leaf('```\n```');
		field.setCaret(0);
		expect(view.state.selection.$from.parent.type.name).toBe('code_block');
		expect(hints(view)).toEqual([]);
		field.destroy();
	});

	it('in a leaf with no menu mounted', () => {
		const { field, view } = leaf('', { onSlash: undefined });
		field.setCaret(0);
		expect(hints(view)).toEqual([]);
		field.destroy();
	});
});
