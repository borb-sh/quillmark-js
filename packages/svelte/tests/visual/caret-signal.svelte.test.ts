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
import { mount, unmount, flushSync } from 'svelte';
import { init, type ContentHit, type Document, type Quill } from '@quillmark/wasm';
import type { Place } from '$lib/core';
import type { ActiveLeaf } from '$lib/visual';
import VisualEditor from '$lib/visual/VisualEditor.svelte';
import { quill, template } from '../helpers/fixtures.js';

const core = await init();

// jsdom implements none of these, and the reveal `setCaret` runs reaches all four: the
// group's hop, the arrival wash, and the caret rect PM measures to scroll to.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.getAnimations ??= () => [];
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

interface EditorRef {
	setCaret(hit: ContentHit): Promise<void>;
	focusField(field: string): Promise<void>;
}

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

function mountEditor(q: Quill, doc: Document) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const places: Place[] = [];
	const active: ActiveLeaf[] = [];
	const app = mount(VisualEditor, {
		target,
		props: {
			doc,
			quill: q,
			onCaretMove: (at: Place) => places.push(at),
			onActiveLeafChange: (a: ActiveLeaf) => active.push(a)
		}
	}) as unknown as EditorRef;
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
	};
	return { editor: app, places, active };
}

const at = (field: string, pos: number): ContentHit => ({ field, pos }) as ContentHit;

describe('the caret signal reports places, not transactions', () => {
	it('landing the caret where it already sits reports once', async () => {
		const q = quill();
		const { editor, places } = mountEditor(q, template());

		await editor.setCaret(at('main.body', 3));
		const first = places.length;
		expect(places.at(-1)).toEqual({ field: 'main.body', pos: 3 });

		await editor.setCaret(at('main.body', 3));
		await editor.setCaret(at('main.body', 3));
		expect(places.length).toBe(first);
	});

	it('a place left and returned to is two moves, across leaves', async () => {
		const q = quill();
		const { editor, places } = mountEditor(q, template());

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
		const q = quill();
		const { editor, places, active } = mountEditor(q, template());

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
