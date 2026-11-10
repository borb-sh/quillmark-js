// @vitest-environment jsdom
// The body's last link: Tab and Shift-Tab held where no surface took them, and Escape
// as the keyboard's way out. The held keys are driven through `bodyKeymap`, so the link is
// under test at its place in the chain; the way out through a mounted view's own keydown,
// since what it decides is whether the browser gets the key.
import { describe, it, expect, afterEach } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import {
	DEFAULT_LEAVE_STRINGS,
	blockSchema,
	bodyKeymap,
	plainSchema,
	proseLeafPlugins
} from '$lib/core/codec';
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

describe('Escape hands the next Tab to the browser', () => {
	const live: (() => void)[] = [];
	afterEach(() => live.splice(0).forEach((off) => off()));

	/** A focused body leaf over `markdown`, the caret in its `index`-th textblock. */
	function mounted(markdown: string, index = 0) {
		const at = startOf(markdown, index);
		const state = EditorState.create({
			doc: at.doc,
			selection: at.selection,
			plugins: proseLeafPlugins(blockSchema, { inline: false })
		});
		const host = document.body.appendChild(document.createElement('div'));
		const view = new EditorView(host, { state });
		view.focus();
		live.push(() => {
			view.destroy();
			host.remove();
		});
		const hint = host.querySelector<HTMLElement>('.qm-leave-hint')!;
		return { view, hint, doc: state.doc };
	}
	/** Press `key` on the view. True where the view left the key to the browser. */
	const left = (view: EditorView, key: string, init: KeyboardEventInit = {}): boolean =>
		view.dom.dispatchEvent(
			new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
		);

	it('stands a status region beside the editable, empty at rest', () => {
		const { hint } = mounted('a');
		expect(hint.getAttribute('role')).toBe('status');
		expect(hint.textContent).toBe('');
	});

	it('names the way out on a Tab the body held', () => {
		const { view, hint, doc } = mounted('a');
		expect(left(view, 'Tab')).toBe(false);
		expect(hint.textContent).toBe(DEFAULT_LEAVE_STRINGS.leaveTaught);
		expect(view.state.doc.eq(doc)).toBe(true);
	});

	it.each([
		['Tab', {}],
		['Shift-Tab', { shiftKey: true }]
	])('leaves %s to the browser after Escape, the focus kept until then', (_name, init) => {
		const { view, hint, doc } = mounted('a');
		expect(left(view, 'Escape')).toBe(false);
		expect(view.hasFocus()).toBe(true);
		expect(hint.textContent).toBe(DEFAULT_LEAVE_STRINGS.leaveArmed);
		expect(left(view, 'Shift', init)).toBe(true);
		expect(left(view, 'Tab', init)).toBe(true);
		expect(view.state.doc.eq(doc)).toBe(true);
	});

	it('leaves from a list item, where Tab would indent', () => {
		const { view, doc } = mounted('- a\n- b', 1);
		left(view, 'Escape');
		expect(left(view, 'Tab')).toBe(true);
		expect(view.state.doc.eq(doc)).toBe(true);
	});

	it('hands Tab back to the body on any other key, and on a blur', () => {
		const typed = mounted('a');
		left(typed.view, 'Escape');
		left(typed.view, 'ArrowRight');
		expect(typed.hint.textContent).toBe('');
		expect(left(typed.view, 'Tab')).toBe(false);

		const blurred = mounted('a');
		left(blurred.view, 'Escape');
		blurred.view.dom.dispatchEvent(new FocusEvent('blur'));
		expect(blurred.hint.textContent).toBe('');
	});

	it('declines in a state without the plugin', () => {
		expect(run(EditorState.create({ schema: blockSchema }), keys['Escape'])).toBe(null);
	});
});
