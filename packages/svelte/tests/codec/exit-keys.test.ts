// @vitest-environment jsdom
// The body's last link: Tab and Shift-Tab held where no surface took them, and Escape
// as the keyboard's way out. Driven through `bodyKeymap`, so the link is under test
// at its place in the chain.
import { describe, it, expect } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { blockSchema, bodyKeymap, plainSchema } from '$lib/core/codec';
import { startOf, run } from './_util.js';

const keys = bodyKeymap(blockSchema);

describe('Tab stays in the body', () => {
	it.each([
		['a paragraph', 'a', 0],
		['a heading', '# a', 0],
		['a paragraph a block stands between it and the list', '- a\n\nb\n\nc', 2]
	])('in %s, Tab and Shift-Tab are claimed and change nothing', (_name, markdown, index) => {
		const state = startOf(markdown, index);
		for (const key of ['Tab', 'Shift-Tab']) {
			let changed = false;
			expect(keys[key](state, () => (changed = true))).toBe(true);
			expect(changed).toBe(false);
		}
	});

	it('a plain leaf binds neither, its Tab being field navigation', () => {
		const plain = bodyKeymap(plainSchema);
		expect(plain['Tab']).toBeUndefined();
		expect(plain['Shift-Tab']).toBeUndefined();
	});
});

describe('Escape gives the focus up', () => {
	it('blurs the body, the doc unchanged', () => {
		const state = startOf('a', 0);
		const host = document.body.appendChild(document.createElement('div'));
		const view = new EditorView(host, { state });
		view.focus();
		expect(view.hasFocus()).toBe(true);
		expect(keys['Escape'](view.state, view.dispatch, view)).toBe(true);
		expect(view.hasFocus()).toBe(false);
		expect(view.state.doc.eq(state.doc)).toBe(true);
		view.destroy();
		host.remove();
	});

	it('declines with no view to blur', () => {
		expect(run(EditorState.create({ schema: blockSchema }), keys['Escape'])).toBe(null);
	});
});
