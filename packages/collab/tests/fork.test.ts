// Writes made from an older revision: what they merge with, what they report as a conflict, and
// what `changesSince` reads between two states.
import { describe, expect, it } from 'vitest';
import type { Document } from '@quillmark/wasm';
import * as Y from 'yjs';
import { bindDocument, changesSince, seedDocument, Unwritable, writeFrom } from '../src/index.js';
import type { CardOp, DocumentBinding } from '../src/index.js';
import { quill, snapshot } from './helpers.js';

const q = quill();

interface Tab {
	doc: Document;
	ydoc: Y.Doc;
	binding: DocumentBinding;
}

/** Two tabs of one session, history kept, every update delivered at once. */
function session(): [Tab, Tab] {
	const first = q.exampleDocument()!;
	const seed = seedDocument(first, q);
	first.free();
	const tabs = [1, 2].map((clientID) => {
		const ydoc = new Y.Doc({ gc: false });
		ydoc.clientID = clientID;
		Y.applyUpdate(ydoc, seed, 'net');
		const doc = q.exampleDocument()!;
		return { doc, ydoc, binding: bindDocument({ doc, quill: q, ydoc }) };
	}) as [Tab, Tab];
	for (const tab of tabs)
		tab.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
			if (origin === 'net') return;
			for (const other of tabs) if (other !== tab) Y.applyUpdate(other.ydoc, update, 'net');
		});
	return tabs;
}

const revision = (t: Tab) => Y.encodeSnapshot(Y.snapshot(t.ydoc));
const authoring = (t: Tab) => q.toAuthoring(t.doc);
const type = (t: Tab, at: number, words: string) => {
	t.doc.applyChange({}, { delta: { ops: [...(at ? [{ retain: at }] : []), { insert: words }] } });
	t.binding.push();
};
const write = (t: Tab, base: Uint8Array, edit: (doc: Document) => CardOp | CardOp[] | void) =>
	writeFrom({ history: t.ydoc, base, quill: q, doc: t.doc, edit });

describe('writeFrom', () => {
	it('merges a field written from an old revision with what was typed since', () => {
		const [a, b] = session();
		const base = revision(a);
		type(a, 0, 'Typed. ');
		const written = write(
			a,
			base,
			(doc) => void q.writer(doc).reviseField('abstract', 'Rewritten.')
		);
		expect(written.conflicts).toEqual([]);
		expect(written.changes).toEqual([
			expect.objectContaining({
				type: 'field',
				from: 'main',
				field: 'abstract',
				after: 'Rewritten.'
			})
		]);
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		expect(authoring(a).fields?.abstract).toBe('Rewritten.');
		expect(authoring(a).body).toMatch(/^Typed\. The body/);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('writes only what a whole-body rewrite changed, so text typed elsewhere in it stays', () => {
		const [a, b] = session();
		const base = revision(a);
		const old = authoring(a).body!;
		type(a, Array.from(a.doc.main.body.text).length, ' Edited.');
		const written = write(a, base, (doc) => {
			q.writer(doc).reviseBody(old.replace('The body is a full block leaf', 'The body is new'));
		});
		expect(written.conflicts).toEqual([]);
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		const body = authoring(a).body!;
		expect(body).toMatch(/^The body is new:/);
		expect(body).toMatch(/segments rather than one run\. Edited\.$/);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('keeps a line typed into between two lines a rewrite changed where it was typed', () => {
		const [a, b] = session();
		const lines = ['Alpha one.', 'Bravo two.', 'Charlie three.', 'Delta four.', 'Echo five.'];
		q.writer(a.doc).reviseBody(lines.join('\n\n'));
		a.binding.push();
		const base = revision(a);
		const at = Array.from(b.doc.main.body.text).join('').indexOf('three.');
		type(b, at, 'typed ');
		const written = write(a, base, (doc) => {
			const next = [...lines];
			next[1] += ' One.';
			next[3] += ' Two.';
			q.writer(doc).reviseBody(next.join('\n\n'));
		});
		expect(written.conflicts).toEqual([]);
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		expect(authoring(a).body!.split('\n\n')).toEqual([
			'Alpha one.',
			'Bravo two. One.',
			'Charlie typed three.',
			'Delta four. Two.',
			'Echo five.'
		]);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('reports a line both sides rewrote, and lines next to each other as apart', () => {
		const [a] = session();
		const lines = ['Alpha one.', 'Bravo two.', 'Charlie three.'];
		q.writer(a.doc).reviseBody(lines.join('\n\n'));
		a.binding.push();
		const base = revision(a);
		type(a, Array.from(a.doc.main.body.text).join('').indexOf('two.'), 'typed ');
		const same = write(a, base, (doc) => {
			q.writer(doc).reviseBody(['Alpha one.', 'Bravo 2.', 'Charlie three.'].join('\n\n'));
		});
		expect(same.conflicts).toEqual([
			expect.objectContaining({
				type: 'field',
				from: 'main',
				hunks: [{ line: 2, before: 'Bravo two.', after: 'Bravo typed two.' }]
			})
		]);
		const next = write(a, base, (doc) => {
			q.writer(doc).reviseBody(['Alpha 1.', 'Bravo two.', 'Charlie 3.'].join('\n\n'));
		});
		expect(next.conflicts).toEqual([]);
	});

	it('lands a card inserted from an old revision beside the card it followed there', () => {
		const [a, b] = session();
		const base = revision(a);
		a.doc.moveCard(3, 0);
		a.binding.push({ op: 'move', from: 3, to: 0 });
		const written = write(a, base, (doc) => {
			q.writer(doc).addCard('note', { label: 'Added' }, 'From the writer.', 1);
			return { op: 'insert', at: 1 };
		});
		expect(written.conflicts).toEqual([]);
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		expect(a.doc.cards.map((c) => c.kind)).toEqual([
			'figure',
			'section',
			'note',
			'note',
			'signoff',
			'credits'
		]);
		expect(authoring(a).cards?.[2].fields).toEqual({ label: 'Added' });
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('writes several card operations from one edit', () => {
		const [a, b] = session();
		const base = revision(a);
		const written = write(a, base, (doc) => {
			const w = q.writer(doc);
			w.addCard('note', { label: 'First' }, '', 0);
			w.addCard('note', { label: 'Second' }, '', 2);
			doc.moveCard(doc.cardCount - 1, 1);
			return [
				{ op: 'insert', at: 0 },
				{ op: 'insert', at: 2 },
				{ op: 'move', from: doc.cardCount - 1, to: 1 }
			];
		});
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		expect(authoring(a).cards?.[0].fields?.label).toBe('First');
		expect(authoring(a).cards?.[3].fields?.label).toBe('Second');
		expect(a.doc.cardCount).toBe(7);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('reports a card removed since that the edit wrote', () => {
		const [a] = session();
		const base = revision(a);
		a.doc.removeCard(0);
		a.binding.push({ op: 'remove', at: 0 });
		const written = write(a, base, (doc) => void q.writer(doc).card(0).set('heading', 'New'));
		expect(written.conflicts).toEqual([{ type: 'remove', from: 0 }]);
	});

	it('refuses a card-list change made without its operation, writing nothing', () => {
		const [a] = session();
		const base = revision(a);
		expect(() =>
			write(a, base, (doc) => void q.writer(doc).addCard('note', { label: 'Lost' }, '', 0))
		).toThrow(Unwritable);
		expect(a.doc.cardCount).toBe(5);
	});

	it('writes past a value elsewhere in the session the Document refused', () => {
		const [a] = session();
		const errors: unknown[] = [];
		a.binding.destroy();
		a.binding = bindDocument({
			doc: a.doc,
			quill: q,
			ydoc: a.ydoc,
			onError: (e) => errors.push(e)
		});
		a.ydoc.transact(() => a.ydoc.getMap('main').set('not a name', 1), 'net');
		expect(errors).toHaveLength(1);
		const written = write(
			a,
			revision(a),
			(doc) => void q.writer(doc).reviseField('abstract', 'Still.')
		);
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		expect(authoring(a).fields?.abstract).toBe('Still.');
	});
});

describe('changesSince', () => {
	it('reads card moves, removals, inserts, retypes and fields between two states', () => {
		const [a] = session();
		const base = revision(a);
		a.doc.moveCard(3, 0);
		a.binding.push({ op: 'move', from: 3, to: 0 });
		a.doc.removeCard(3);
		a.binding.push({ op: 'remove', at: 3 });
		q.writer(a.doc).addCard('note', { label: 'Last' });
		a.binding.push({ op: 'insert', at: a.doc.cardCount - 1 });
		q.writer(a.doc).card(1).set('heading', 'Results');
		a.binding.push();
		const changes = changesSince({ history: a.ydoc, base, quill: q, doc: a.doc });
		expect(changes).toEqual([
			{ type: 'remove', from: 2 },
			{ type: 'move', from: 3, at: 0 },
			{ type: 'insert', at: 4, card: { kind: 'note', fields: { label: 'Last' }, body: '' } },
			{
				type: 'field',
				from: 0,
				at: 1,
				field: 'heading',
				before: 'Findings',
				after: 'Results',
				hunks: [{ line: 0, before: 'Findings', after: 'Results' }]
			}
		]);
	});

	it('reads nothing when nothing moved', () => {
		const [a] = session();
		expect(changesSince({ history: a.ydoc, base: revision(a), quill: q, doc: a.doc })).toEqual([]);
	});
});
