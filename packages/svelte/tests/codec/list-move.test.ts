// Alt+↑/↓ in a list (`codec/list-move.ts`), driven through the body's composed keymap so
// a rebinding breaks these.
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { blockSchema, bodyKeymap, decode } from '$lib/core/codec';
import { md, run, keyDriver, startOf, representable } from './_util.js';

const keys = bodyKeymap(blockSchema);
const { expectPress } = keyDriver(keys);

/** A state over `markdown` selecting from the head of `from`'s text to the end of `to`'s. */
function selecting(markdown: string, from: string, to = from): EditorState {
	const doc = decode(md(markdown), blockSchema);
	const find = (text: string, end: boolean) => {
		let pos = -1;
		doc.descendants((node, p) => {
			if (pos < 0 && node.isText && node.text!.includes(text))
				pos = p + node.text!.indexOf(text) + (end ? text.length : 0);
			return pos < 0;
		});
		return pos;
	};
	return EditorState.create({
		doc,
		selection: TextSelection.create(doc, find(from, false), find(to, true))
	});
}

const ABC = '1. Alpha\n2. Bravo\n3. Charlie';

describe('Alt+↑/↓ moves the item', () => {
	it('down past the next item, the caret going with it', () => {
		const next = expectPress(
			startOf(ABC, 0),
			'Alt-ArrowDown',
			'doc(ordered_list(list_item(paragraph("Bravo")), list_item(paragraph("Alpha")), list_item(paragraph("Charlie"))))'
		);
		expect(next.selection.$from.parent.textContent).toBe('Alpha');
	});

	it('up, its sub-items with it', () => {
		const state = selecting('1. Alpha\n2. Bravo\n   1. sub', 'Bravo');
		expectPress(
			state,
			'Alt-ArrowUp',
			'doc(ordered_list(list_item(paragraph("Bravo"), ordered_list(list_item(paragraph("sub")))), list_item(paragraph("Alpha"))))'
		);
	});

	it('a sub-item moves among its own siblings', () => {
		const state = selecting('1. Alpha\n   1. one\n   2. two\n2. Bravo', 'two');
		expectPress(
			state,
			'Alt-ArrowUp',
			'doc(ordered_list(list_item(paragraph("Alpha"), ordered_list(list_item(paragraph("two")), list_item(paragraph("one")))), list_item(paragraph("Bravo"))))'
		);
	});

	it('a selection across items moves them together', () => {
		expectPress(
			selecting(ABC, 'Bravo', 'Charlie'),
			'Alt-ArrowUp',
			'doc(ordered_list(list_item(paragraph("Bravo")), list_item(paragraph("Charlie")), list_item(paragraph("Alpha"))))'
		);
	});

	it('declines at the list’s edge and outside a list', () => {
		expect(run(startOf(ABC, 0), keys['Alt-ArrowUp']!)).toBeNull();
		expect(run(startOf(ABC, 2), keys['Alt-ArrowDown']!)).toBeNull();
		expect(run(startOf('Para\n\nmore', 0), keys['Alt-ArrowDown']!)).toBeNull();
	});

	it('a task keeps its check', () => {
		const next = expectPress(
			startOf('- [x] done\n- [ ] open', 0),
			'Alt-ArrowDown',
			'doc(bullet_list(list_item(paragraph("open")), list_item(paragraph("done"))))'
		);
		expect(next.doc.child(0).child(1).attrs.checked).toBe(true);
		expect(representable(next)).toBe(true);
	});
});
