// @vitest-environment jsdom
// A document a consumer loaded rather than seeded (`Document.fromMarkdown`, the
// transport door every saved document comes back through) rests as authored: a
// content field holds the string it parsed, not the `Content`. The leaf reads through
// `reader.getContent`, which decodes by declared type, so it takes both rest forms
// and an edit lands back in the same document.
import { describe, it, expect } from 'vitest';
import { init, type Quill, type Document } from '@quillmark/wasm';
import { createField } from '$lib/core/codec';
import type { FieldController } from '$lib/core/codec';
import type { EditorView } from 'prosemirror-view';
import { quill, template } from '../helpers/fixtures.js';

const core = await init();

function mount(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
}
const viewOf = (f: FieldController): EditorView =>
	(f as FieldController & { view: EditorView }).view;

/** A saved document: templated, written, serialized, and parsed back. */
function loaded(): { q: Quill; doc: Document } {
	const q = quill();
	const seed = template();
	q.writer(seed).set('title', 'Reloaded title');
	const doc = core.Document.fromMarkdown(seed.toMarkdown());
	seed.free();
	return { q, doc };
}

describe('a document loaded from markdown', () => {
	it('rests a richtext field as a STRING, and its body as Content', () => {
		// The asymmetry this whole file exists for. Asserted rather than assumed:
		// it is a boundary fact, and the leaf's tolerance is only correct while it holds.
		const { doc } = loaded();
		expect(typeof doc.getStored({ field: 'title' })).toBe('string');
		expect(typeof doc.getStored({})).toBe('object');
		doc.free();
	});

	it('round-trips through toMarkdown → fromMarkdown', () => {
		const { doc } = loaded();
		const again = core.Document.fromMarkdown(doc.toMarkdown());
		expect(again.toMarkdown()).toBe(doc.toMarkdown());
		expect(again.cardCount).toBe(doc.cardCount);
		again.free();
		doc.free();
	});

	it('mounts a prose leaf over a field resting as a string, and commits back', () => {
		const { q, doc } = loaded();
		const field = createField({
			doc,
			quill: q,
			addr: { field: 'title' },
			container: mount(),
			inline: true
		});
		expect(field.getContent().text).toContain('Reloaded title');

		// The half a tolerant read alone would not buy: the commit has to land too,
		// and it brings the field to content rest, so the authored shape is transient.
		const view = viewOf(field);
		view.dispatch(view.state.tr.insertText('!', 1));
		expect(doc.toMarkdown()).toContain('!Reloaded title');
		expect(typeof doc.getStored({ field: 'title' })).toBe('object');

		field.destroy();
		doc.free();
	});

	it('mounts the body leaf, which was Content all along', () => {
		const { q, doc } = loaded();
		const field = createField({ doc, quill: q, addr: {}, container: mount() });
		expect(field.getContent().text.length).toBeGreaterThan(0);
		field.destroy();
		doc.free();
	});

	it('mounts a leaf on a card of a loaded document', () => {
		// Cards take the same lowering as main, so the authored shape reaches them too.
		const { q, doc } = loaded();
		const seeded = q.seedDocument();
		const kind = Object.keys(q.schema.card_kinds ?? {})[0];
		const card = q.seedCard(kind, seeded.seedOverlay(kind));
		expect(card).toBeTruthy();
		seeded.insertCard(card!, 0);
		const withCard = core.Document.fromMarkdown(seeded.toMarkdown());
		expect(withCard.cardCount).toBeGreaterThan(0);

		const field = createField({ doc: withCard, quill: q, addr: { card: 0 }, container: mount() });
		expect(typeof field.getContent().text).toBe('string');

		field.destroy();
		withCard.free();
		seeded.free();
		doc.free();
	});

	it('reads a richtext field through the bound door too (`quill.parse`)', () => {
		// The other lane of the same read: `quill.parse` conforms on the way in, so the
		// field rests as the `Content`. `getContent` answers identically either way, which
		// is the property that lets the leaf stop asking which door built its document.
		const q = quill();
		const seed = q.seedDocument();
		q.writer(seed).set('title', 'Reloaded title');
		const md = seed.toMarkdown();
		const parsed = q.parse(md);
		const transported = core.Document.fromMarkdown(md);

		expect(typeof parsed.getStored({ field: 'title' })).toBe('object');
		expect(q.reader(parsed).getContent('title')).toEqual(q.reader(transported).getContent('title'));

		transported.free();
		parsed.free();
		seed.free();
	});
});
