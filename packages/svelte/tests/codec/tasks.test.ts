// @vitest-environment jsdom
// A task item (CODEC §"Task items"): `checked` rides the list item through decode and
// lowering, a body holding one edits, its checkbox toggles as one undoable step, Enter
// leaves a task item's new half an open task, Mod-Enter ticks the one around the caret,
// and a markdown paste lands one editable.
import { describe, it, expect } from 'vitest';
import { splitBlock } from 'prosemirror-commands';
import { undo } from 'prosemirror-history';
import { Selection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Content, ContentContainer, Document } from '@quillmark/wasm';
import {
	blockSchema,
	bodyKeymap,
	createField,
	decode,
	listKeymap,
	pmToContent
} from '$lib/core/codec';
import {
	contentEqual,
	endOf,
	keyDriver,
	md,
	mount,
	normalize,
	quill,
	startOf,
	viewOf
} from './_util.js';

const TASKS = '- [x] done\n- [ ] open\n- plain';

/** Each line's own `list_item` attrs, outermost first. */
const items = (rt: Content) =>
	rt.lines.map((l) =>
		l.containers
			.filter(
				(c): c is Extract<ContentContainer, { container: 'list_item' }> =>
					c.container === 'list_item'
			)
			.map((c) => c.attrs)
	);

/** Each line's `checked`, `'none'` where its innermost item carries no key. */
const checks = (rt: Content) =>
	items(rt).map((path) => {
		const at = path.at(-1);
		return at && 'checked' in at ? at.checked : 'none';
	});

function body(markdown: string, holds: boolean[] = []) {
	const doc = quill().seedDocument();
	doc.overwrite({}, md(markdown));
	const field = createField({
		doc,
		quill: quill(),
		addr: {},
		container: mount(),
		onHold: (held) => holds.push(held)
	});
	return { doc, field, view: viewOf(field) };
}

const boxes = (view: EditorView) =>
	Array.from(view.dom.querySelectorAll<HTMLInputElement>('input.qm-task-box'));

describe('checked rides the codec', () => {
	it('decodes onto the item and projects back unchanged', () => {
		const rt = normalize(md(TASKS));
		const pm = decode(rt, blockSchema);
		const list = pm.firstChild!;
		expect([0, 1, 2].map((i) => list.child(i).attrs.checked)).toEqual([true, false, null]);
		expect(contentEqual(normalize(pmToContent(pm)), rt)).toBe(true);
	});

	it('an ordinary item projects no checked key', () => {
		const rt = pmToContent(decode(normalize(md('- a\n- b')), blockSchema));
		for (const path of items(rt)) for (const attrs of path) expect('checked' in attrs).toBe(false);
	});

	it('a nested task item keeps its own, under its parent’s', () => {
		const rt = normalize(md('- [x] parent\n  - [ ] child'));
		expect(contentEqual(normalize(pmToContent(decode(rt, blockSchema))), rt)).toBe(true);
		expect(items(rt)[1].map((a) => a.checked)).toEqual([true, false]);
	});
});

describe('a body holding task items', () => {
	it('mounts editable, and an edit elsewhere keeps every checked', () => {
		const holds: boolean[] = [];
		const { doc, field, view } = body(`lead\n\n${TASKS}`, holds);
		expect(holds).toEqual([]);
		expect(view.editable).toBe(true);
		const before = checks(doc.main.body);
		view.dispatch(view.state.tr.insertText('Z', Selection.atStart(view.state.doc).from));
		expect(doc.main.body.text.startsWith('Zlead')).toBe(true);
		expect(checks(doc.main.body)).toEqual(before);
		expect(checks(doc.main.body)).toEqual(['none', true, false, 'none']);
		field.destroy();
	});

	it('draws one enabled checkbox per task item, outside the caret’s reach', () => {
		const { field, view } = body(TASKS);
		const drawn = boxes(view);
		expect(drawn.map((b) => [b.checked, b.disabled])).toEqual([
			[true, false],
			[false, false]
		]);
		expect(drawn[0].closest('[contenteditable="false"]')).not.toBe(null);
		expect(view.state.doc.textContent).toBe('doneopenplain');
		field.destroy();
	});

	it('a checkbox click toggles checked, and one undo takes it back', () => {
		const { doc, field, view } = body(TASKS);
		view.dispatch(view.state.tr.insertText('Z', Selection.atEnd(view.state.doc).from));
		boxes(view)[1].click();
		expect(checks(doc.main.body)).toEqual([true, true, 'none']);
		expect(boxes(view)[1].checked).toBe(true);
		undo(view.state, view.dispatch);
		expect(checks(doc.main.body)).toEqual([true, false, 'none']);
		expect(boxes(view)[1].checked).toBe(false);
		expect(doc.main.body.text).toBe('done\nopen\nplainZ');
		field.destroy();
	});

	it('a held leaf draws its task items disabled', () => {
		const holds: boolean[] = [];
		const { field, view } = body('- [x] done\n\n<qm-keep>\n\nkept\n\n</qm-keep>', holds);
		expect(holds).toEqual([true]);
		expect(boxes(view).map((b) => b.disabled)).toEqual([true]);
		field.destroy();
	});
});

describe('Enter in a task item', () => {
	const { press } = keyDriver(listKeymap(blockSchema));
	const checkedOf = (state: ReturnType<typeof press>) => checks(pmToContent(state.doc));

	it('at the end opens an open task below', () => {
		expect(checkedOf(press(endOf('- [x] done', 0), 'Enter'))).toEqual([true, false]);
	});

	it('mid-text leaves the text after the caret an open task', () => {
		const state = endOf('- [x] done', 0);
		const mid = state.apply(
			state.tr.setSelection(TextSelection.create(state.doc, state.selection.from - 2))
		);
		const next = press(mid, 'Enter');
		expect(next.doc.firstChild!.child(1).textContent).toBe('ne');
		expect(checkedOf(next)).toEqual([true, false]);
	});

	it('at the head opens the open task above, the text keeping its own', () => {
		const next = press(startOf('- [x] first\n- [x] done', 1), 'Enter');
		expect(next.doc.firstChild!.child(2).textContent).toBe('done');
		expect(checkedOf(next)).toEqual([true, false, true]);
	});

	it('in an empty task item leaves the list as any empty item does', () => {
		const once = press(endOf('- [x] done', 0), 'Enter');
		const out = press(once, 'Enter');
		expect(out.doc.lastChild!.type.name).toBe('paragraph');
		expect(checkedOf(out)).toEqual([true, 'none']);
	});

	it('in an empty nested task item lifts it a level, keeping its checked', () => {
		const once = press(endOf('- [x] parent\n  - [x] child', 1), 'Enter');
		const out = press(once, 'Enter');
		expect(out.doc.firstChild!.childCount).toBe(2);
		expect(items(pmToContent(out.doc)).map((p) => p.map((a) => a.checked))).toEqual([
			[true],
			[true, true],
			[false]
		]);
	});

	it('an ordinary item splits into ordinary items', () => {
		expect(checkedOf(press(endOf('- plain', 0), 'Enter'))).toEqual(['none', 'none']);
	});
});

describe('Mod-Enter in a body', () => {
	const { press } = keyDriver(bodyKeymap(blockSchema));
	const checkedOf = (state: ReturnType<typeof press>) => checks(pmToContent(state.doc));

	it('ticks the task item around the caret, and a second press unticks it', () => {
		const once = press(endOf(TASKS, 1), 'Mod-Enter');
		expect(checkedOf(once)).toEqual([true, true, 'none']);
		expect(checkedOf(press(once, 'Mod-Enter'))).toEqual([true, false, 'none']);
	});

	it('in an ordinary item under a task item ticks the task item', () => {
		const next = press(endOf('- [ ] parent\n  - child', 1), 'Mod-Enter');
		expect(items(pmToContent(next.doc)).map((p) => p.map((a) => a.checked))).toEqual([
			[true],
			[true, undefined]
		]);
	});

	it('declines outside a task item', () => {
		const state = endOf(TASKS, 2);
		expect(press(state, 'Mod-Enter')).toBe(state);
		const lead = endOf(`lead\n\n${TASKS}`, 0);
		expect(press(lead, 'Mod-Enter')).toBe(lead);
	});

	it('in a fence inside a task item leaves the fence, ticking nothing', () => {
		const next = press(endOf('- [ ] task\n\n  ```\n  code\n  ```', 1), 'Mod-Enter');
		expect(next.selection.$from.parent.type.name).toBe('paragraph');
		expect(next.selection.$from.parent.textContent).toBe('');
		expect(checkedOf(next).every((c) => c === false)).toBe(true);
	});

	it('pressed in a mounted body is one step one undo takes back', () => {
		const { doc, field, view } = body(TASKS);
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, endOf(TASKS, 1).selection.from)
			)
		);
		view.dom.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
		);
		expect(checks(doc.main.body)).toEqual([true, true, 'none']);
		expect(boxes(view)[1].checked).toBe(true);
		undo(view.state, view.dispatch);
		expect(checks(doc.main.body)).toEqual([true, false, 'none']);
		field.destroy();
	});
});

describe('a markdown task list pasted as text', () => {
	function paste(doc: Document, view: EditorView, text: string) {
		const event = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', {
			value: { getData: (t: string) => (t === 'text/plain' ? text : ''), setData: () => {} }
		});
		view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
		splitBlock(view.state, view.dispatch);
		view.dom.dispatchEvent(event);
		return doc.main.body;
	}

	it('on a fresh line lands as task items the body edits', () => {
		const holds: boolean[] = [];
		const { doc, field, view } = body('lead', holds);
		const stored = paste(doc, view, '- [x] done\n- [ ] open');
		expect(checks(stored)).toEqual(['none', true, false]);
		expect(holds).toEqual([]);
		expect(view.editable).toBe(true);
		boxes(view)[0].click();
		expect(checks(doc.main.body)).toEqual(['none', false, false]);
		field.destroy();
	});
});
