// @vitest-environment jsdom
// `onCaretMove` reports a place, so a transaction that moved the caret nowhere is
// not one to report: a leaf dispatches one caret signal per transaction, and
// landing a caret where it already sits is a transaction like any other. Driven
// through `setCaret`, which is the one entry that places a caret on demand and so
// the one that can ask for the same place twice.
//
// The document spans leaves, which is what a per-leaf guard cannot do: leaving a place
// and coming back to the same offset in it is two moves, and a consumer following
// the caret has to hear both. A focus is what tells the memo the leaf was left, and it
// has to be: a form control reports no caret of its own, having no offset to name, so
// the arrival is the whole of the signal.
import { describe, it, expect, afterEach } from 'vitest';
import type { ContentHit, Document } from '@quillmark/wasm';
import type { Place } from '$lib/core';
import { quill, example } from '../helpers/fixtures.js';
import { mountEditor, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

function open(doc: Document) {
	const places: Place[] = [];
	return { places, ...mountEditor(quill(), doc, { onCaretMove: (at: Place) => places.push(at) }) };
}

const at = (field: string, pos: number) => ({ field, pos }) as ContentHit;

describe('the caret signal reports places, not transactions', () => {
	it('landing the caret where it already sits reports once', async () => {
		const { editor, places } = open(example());

		await editor.setCaret(at('main.body', 3));
		const first = places.length;
		expect(places.at(-1)).toEqual({ field: 'main.body', pos: 3 });

		await editor.setCaret(at('main.body', 3));
		await editor.setCaret(at('main.body', 3));
		expect(places.length).toBe(first);
	});

	it('a place left and returned to is two moves, across leaves', async () => {
		const { editor, places } = open(example());

		await editor.setCaret(at('main.body', 3));
		places.length = 0;

		await editor.setCaret(at('main.title', 3));
		await editor.setCaret(at('main.body', 3));
		expect(places).toEqual([
			{ field: 'main.title', pos: 3 },
			{ field: 'main.body', pos: 3 }
		]);
	});

	it('a focus into a leaf with no caret is what makes the return a move', async () => {
		const { editor, places, active } = open(example());

		await editor.setCaret(at('main.body', 3));
		places.length = 0;
		active.length = 0;

		// A form control has no offset to name, so it reports its arrival and no caret:
		// the memo would otherwise still read `main.body`/3 when the body is returned to.
		await editor.focusField('main.columns');
		expect(places).toEqual([]);
		expect(active).toEqual([{ field: 'main.columns', cardId: 'main' }]);

		await editor.setCaret(at('main.body', 3));
		expect(places).toEqual([{ field: 'main.body', pos: 3 }]);
	});
});
