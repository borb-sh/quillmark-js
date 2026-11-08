// Spike: a transient anchor (id under `~`) rides the wire, clones and Y merges like any anchor,
// and no stored form, annotated read or hash carries it.
import { describe, expect, it } from 'vitest';
import type { Content, Document } from '@quillmark/wasm';
import * as Y from 'yjs';
import { bindDocument, seedDocument, writeFrom } from '../src/index.js';
import { edit, peers, quill, settle } from './helpers.js';

const q = quill();
const TEXT = 'The committee met on Monday\nto plan the roads budget';
const withBody = (): Document => {
	const doc = q.exampleDocument()!;
	doc.replace(
		{},
		{
			text: TEXT,
			blocks: [
				{ id: 'b0', kind: 'para' },
				{ id: 'b1', kind: 'para' }
			]
		}
	);
	return doc;
};
const body = (doc: Document): Content => doc.getStored({}) as Content;
const quote = (doc: Document, id: string) => {
	const c = body(doc);
	const a = c.anchors?.find((x) => x.id === id);
	return a && Array.from(c.text).slice(a.start, a.end).join('');
};
const at = (word: string) => {
	const start = TEXT.indexOf(word);
	return { start, end: start + word.length };
};

describe('transient anchors', () => {
	it('ride the wire and a clone, and leave the stored form, the annotated read and the hash', () => {
		const doc = withBody();
		const before = doc.hash();
		doc.apply({}, { steps: [{ anchor: { id: 'c1', ...at('met on Monday') } }] });
		const stored = doc.hash();
		doc.apply({}, { steps: [{ anchor: { id: '~w1', ...at('roads budget') } }] });

		expect(quote(doc, '~w1')).toBe('roads budget');
		expect(quote(doc.clone(), '~w1')).toBe('roads budget');
		expect(doc.toStored()).toContain('"c1"');
		expect(doc.toStored()).not.toContain('~w1');
		expect(doc.hash()).toBe(stored);
		expect(doc.hash()).not.toBe(before);

		const read = doc.toMarkdown(undefined, { annotated: true });
		expect(read.anchors.map((a) => a.id)).toEqual(['c1']);
		expect(read.markdown).not.toContain('~w1');
	});

	it('survive another client typing before them', () => {
		const [a, b] = peers(2, withBody, q);
		a.doc.apply({}, { steps: [{ anchor: { id: '~w1', ...at('roads budget') } }] });
		a.binding.push();
		edit(b.doc, {}, [{ insert: 'Last week ' }]);
		b.binding.push();
		settle([a, b]);
		expect(body(a.doc).text).toBe(body(b.doc).text);
		expect(quote(a.doc, '~w1')).toBe('roads budget');
		expect(body(b.doc).anchors).toBeUndefined();
	});

	it('survive a write made from an older revision and merged in, as the Wingman writes', () => {
		const first = withBody();
		const seed = seedDocument(first, q);
		first.free();
		const ydoc = new Y.Doc({ gc: false });
		Y.applyUpdate(ydoc, seed, 'net');
		const doc = withBody();
		const binding = bindDocument({ doc, quill: q, ydoc, leader: true });

		const base = Y.encodeSnapshot(Y.snapshot(ydoc));
		doc.apply({}, { steps: [{ anchor: { id: '~w1', ...at('roads budget') } }] });
		edit(doc, {}, [{ insert: 'Last week ' }]);
		binding.push();

		const written = writeFrom({
			history: ydoc,
			base,
			quill: q,
			doc,
			edit: (d) => void d.revise({}, 'The board met on Monday\n\nto plan the roads budget')
		});
		Y.applyUpdate(ydoc, written.update, 'wingman');

		expect(body(doc).text).toBe('Last week The board met on Monday\nto plan the roads budget');
		expect(quote(doc, '~w1')).toBe('roads budget');
	});
});
