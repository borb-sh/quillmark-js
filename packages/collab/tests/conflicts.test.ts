// Writes from a revision compared word by word: what lands beside a change made since, and what
// is reported as meeting one.
import { describe, expect, it } from 'vitest';
import type { Document } from '@quillmark/wasm';
import * as Y from 'yjs';
import { bindDocument, seedDocument, writeFrom } from '../src/index.js';
import type { DocumentBinding, WriteFromOpts } from '../src/index.js';
import { edit, quill, snapshot } from './helpers.js';

const q = quill();

interface Tab {
	doc: Document;
	ydoc: Y.Doc;
	binding: DocumentBinding;
}

/** Two tabs of one session over a body of `lines`, history kept, every update delivered at once. */
function session(lines: string[]): [Tab, Tab] {
	const first = q.exampleDocument()!;
	q.writer(first).revise({}, lines.join('\n\n'));
	const seed = seedDocument(first, q);
	const tabs = [1, 2].map((clientID) => {
		const ydoc = new Y.Doc({ gc: false });
		ydoc.clientID = clientID;
		Y.applyUpdate(ydoc, seed, 'net');
		const doc = first.clone();
		return { doc, ydoc, binding: bindDocument({ doc, quill: q, ydoc, leader: true }) };
	}) as [Tab, Tab];
	first.free();
	for (const tab of tabs)
		tab.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
			if (origin === 'net') return;
			for (const other of tabs) if (other !== tab) Y.applyUpdate(other.ydoc, update, 'net');
		});
	return tabs;
}

const revision = (t: Tab) => Y.encodeSnapshot(Y.snapshot(t.ydoc));
const body = (t: Tab) => q.toAuthoring(t.doc).body!.split('\n\n');
/** Replace the first `from` in the body with `to`, as a typist would. */
const retype = (t: Tab, from: string, to: string) => {
	const at = t.doc.main.body.text.indexOf(from);
	if (at < 0) throw new Error(`no ${from}`);
	edit(t.doc, {}, [
		...(at ? [{ retain: at }] : []),
		{ delete: from.length },
		...(to ? [{ insert: to }] : [])
	]);
	t.binding.push();
};
const write = (t: Tab, base: Uint8Array, lines: string[], more: Partial<WriteFromOpts> = {}) =>
	writeFrom({
		history: t.ydoc,
		base,
		quill: q,
		doc: t.doc,
		edit: (doc) => void q.writer(doc).revise({}, lines.join('\n\n')),
		...more
	});

const LINES = [
	'Alpha confirms two things before noon.',
	'Bravo reviews the draft and signs the memo at the end of the week.',
	'Charlie files it.'
];

describe('conflicts by word', () => {
	it('lands a rewrite of other words of the line someone edited', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		retype(b, 'reviews', 'checks');
		const written = write(a, base, [
			LINES[0],
			'Bravo reviews the final draft and signs the memo at the close of the week.',
			LINES[2]
		]);
		expect(written.conflicts).toEqual([]);
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		expect(body(a)[1]).toBe(
			'Bravo checks the final draft and signs the memo at the close of the week.'
		);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('reports words both rewrote, and the line when asked to compare by line', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		retype(b, 'two', 'a few');
		const same = write(a, base, ['Alpha confirms three things before noon.', LINES[1], LINES[2]]);
		expect(same.conflicts).toEqual([expect.objectContaining({ type: 'field', from: 'main' })]);
		const apart = ['Alpha confirms two things before lunch.', LINES[1], LINES[2]];
		expect(write(a, base, apart).conflicts).toEqual([]);
		expect(write(a, base, apart, { scope: 'line' }).conflicts).toHaveLength(1);
	});

	it('reports a word typed against a word the edit replaced', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		retype(b, 'noon', 'noon today');
		const written = write(a, base, ['Alpha confirms two things before lunch.', LINES[1], LINES[2]]);
		expect(written.conflicts).toHaveLength(1);
	});
	it('reports two insertions at one place, however the words line up', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		retype(b, 'Charlie files it.', 'Charlie files it. Typed.');
		const written = write(a, base, [
			'Alpha confirms three things before noon.',
			LINES[1],
			'Charlie files it. Drafted.'
		]);
		expect(written.conflicts).toHaveLength(1);
	});
});

describe('conflicts by card', () => {
	it('reports nothing where both removed one card', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		b.doc.removeCard(0);
		b.binding.push({ op: 'remove', at: 0 });
		const written = writeFrom({
			history: a.ydoc,
			base,
			quill: q,
			doc: a.doc,
			edit: (doc) => {
				doc.removeCard(0);
				return { op: 'remove', at: 0 };
			}
		});
		expect(written.conflicts).toEqual([]);
	});
});
