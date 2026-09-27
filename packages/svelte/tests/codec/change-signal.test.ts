// @vitest-environment jsdom
// The prose leaf's two outputs, and the one thing that separates them: `onChange`
// reports an edit that committed, `onCaretMove` reports where the caret is now. A
// bare selection move fires the second and not the first, which is the whole
// reason a host can drive a recompile off `onChange` without recompiling on every
// arrow key.
import { describe, it, expect, beforeEach } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { createField } from '$lib/core/codec';
import type { Addr, Document } from '@quillmark/wasm';
import type { EditorError } from '$lib/core';
import { mount, quill, viewOf } from './_util.js';

describe('the prose leaf change signal', () => {
	let doc: Document;
	beforeEach(() => {
		doc = quill().seedDocument();
	});

	it('fires onChange for a commit and not for a selection move', () => {
		const changes: Addr[] = [];
		const carets: number[] = [];
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'title' },
			container: mount(),
			inline: true,
			onChange: (addr) => changes.push(addr),
			onCaretMove: (_addr, pos) => carets.push(pos)
		});
		const view = viewOf(field);

		view.dispatch(view.state.tr.insertText('X', 1));
		expect(changes).toHaveLength(1);
		expect(changes[0]).toEqual({ field: 'title' });
		expect(carets).toHaveLength(1);

		// A caret that only moves: the signal a preview follows, and no recompile.
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
		expect(changes).toHaveLength(1);
		expect(carets).toHaveLength(2);

		field.destroy();
	});

	it('fires onChange on the FIRST edit to an unset field, which installs', () => {
		// `colophon` is declared with a `default:` and no stored value, so the first
		// edit goes down the install branch rather than applyChange. The host's
		// change signal must not be a property of which branch the commit took.
		const changes: Addr[] = [];
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'colophon' },
			container: mount(),
			inline: true,
			onChange: (addr) => changes.push(addr)
		});
		expect(doc.getStored({ field: 'colophon' })).toBeUndefined();

		const view = viewOf(field);
		view.dispatch(view.state.tr.insertText('hello', 1));

		expect(doc.getStored({ field: 'colophon' })).toBeDefined();
		expect(changes).toHaveLength(1);
		field.destroy();
	});

	it('fires onChange for an anchor insert, which changes no text', () => {
		// Zero-width, so `docChanged` is false: the commit routes on the anchor meta
		// instead, and the signal has to follow the commit rather than the text.
		const changes: Addr[] = [];
		const field = createField({
			doc,
			quill: quill(),
			addr: {},
			container: mount(),
			onChange: (addr) => changes.push(addr)
		});
		field.insertAnchor('a1', 1);
		expect(changes).toHaveLength(1);
		expect(field.anchorsInRange(0, 4)).toContain('a1');
		field.destroy();
	});

	it('reports a commit that could not land, and does not signal a change', () => {
		// A freed document is the reachable way to make both the applyChange and the
		// install fallback throw: the leaf keeps the optimistic PM state, reports
		// `commit-lost`, and must not tell the host an edit landed.
		const errors: EditorError[] = [];
		const changes: Addr[] = [];
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'title' },
			container: mount(),
			inline: true,
			onChange: (addr) => changes.push(addr),
			onError: (e) => errors.push(e)
		});
		const view = viewOf(field);
		doc.free();

		view.dispatch(view.state.tr.insertText('X', 1));

		expect(changes).toHaveLength(0);
		expect(errors.map((e) => e.code)).toEqual(['commit-fallback', 'commit-lost']);
		expect(errors.every((e) => e.severity === 'error')).toBe(true);
		// The edit stands on screen: the leaf never crashes and never reverts.
		expect(view.state.doc.textContent).toContain('X');
		field.destroy();
	});
});
