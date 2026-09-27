// @vitest-environment jsdom
// The document swap, driven through a main-card leaf, which is the case a hand
// reseed misses: composable cards key on session id and would re-mount on their
// own, the main card is keyed on nothing, and its prose leaves mount once per
// stable leaf key with `createField` closing over the `doc` handed to them. So a
// swap the surface does not re-key on leaves the main card rendering — and
// committing to — the previous document, with every id and index still agreeing.
//
// What is asserted is the remount itself: the leaf's DOM node is replaced and its
// content is the new document's. That is the whole mechanism, because a leaf whose
// `createField` ran against the new handle commits there by construction.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Quill, Document } from '@quillmark/wasm';
import { quill } from '../helpers/fixtures.js';
import { mountEditor, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

/** A document whose `title` is `text`, seeded off the reference quill. */
function docWith(q: Quill, text: string): Document {
	const doc = q.seedDocument();
	q.writer(doc).set('title', text);
	return doc;
}

/** The main card's `title` leaf, by the key the registry stamps on it. */
const titleLeaf = (target: HTMLElement) => target.querySelector('[data-leaf-key$="title"]');

describe('swapping the doc prop', () => {
	it('remounts the main card leaf onto the new handle', () => {
		const q = quill();
		const a = docWith(q, 'FIRST SUBJECT');
		const b = docWith(q, 'SECOND SUBJECT');
		const { target, props, errors } = mountEditor(q, a);

		const before = titleLeaf(target);
		expect(before).not.toBeNull();
		expect(before?.textContent).toContain('FIRST SUBJECT');

		props.doc = b;
		flushSync();

		const after = titleLeaf(target);
		expect(after).not.toBeNull();
		// A remount, not a re-render: the node itself is replaced, which is what
		// `createField` running again against `b` looks like from outside.
		expect(after).not.toBe(before);
		expect(after?.textContent).toContain('SECOND SUBJECT');
		// And the leaf carries none of the previous document's text.
		expect(after?.textContent).not.toContain('FIRST SUBJECT');
		// And reports nothing: the re-key covers the swap.
		expect(errors).toEqual([]);
	});
});

describe('swapping the quill prop alone', () => {
	it('reports rebind-ignored once, at dev severity, and throws it', () => {
		const q = quill();
		const a = docWith(q, 'A');
		const { props, errors } = mountEditor(q, a);

		// A distinct handle over the same fixture: the pairing is what the guard
		// watches, not the schema's contents.
		props.quill = Object.create(q) as Quill;
		// The guard throws after it reports, under the `DEV` this suite builds with.
		let thrown: Error | undefined;
		try {
			flushSync();
		} catch (e) {
			thrown = e as Error;
		}
		props.quill = Object.create(q) as Quill;
		try {
			flushSync();
		} catch {
			/* reported once, so the second swap is silent */
		}

		const reported = errors.filter((e) => e.code === 'rebind-ignored');
		expect(reported).toHaveLength(1);
		expect(reported[0].severity).toBe('dev');
		expect(thrown?.message).toContain('rebind-ignored');
	});
});
