// A write taken back: what returns to the state it was written from, what anyone else wrote that
// stays, and what is held where someone changed the write's own lines since.
import { describe, expect, it } from 'vitest';
import type { Document } from '@quillmark/wasm';
import * as Y from 'yjs';
import {
	bindDocument,
	heldState,
	revert,
	seedDocument,
	Unwritable,
	writeFrom,
	writeHeld
} from '../src/index.js';
import type { CardOp, DocumentBinding, RevertOpts, Written } from '../src/index.js';
import { edit, quill, snapshot } from './helpers.js';

const q = quill();

interface Tab {
	doc: Document;
	ydoc: Y.Doc;
	binding: DocumentBinding;
}

/** Two tabs of one session, history kept, every update delivered at once; over a body of
 *  `lines` where given. */
function session(lines?: string[]): [Tab, Tab] {
	const first = q.exampleDocument()!;
	if (lines) q.writer(first).revise({}, lines.join('\n\n'));
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
/** Make `change` from the state `t` holds and land it. */
const write = (t: Tab, change: (doc: Document) => CardOp | CardOp[] | void): Written => {
	const written = writeFrom({
		history: t.ydoc,
		base: Y.encodeSnapshot(Y.snapshot(t.ydoc)),
		quill: q,
		doc: t.doc,
		edit: change
	});
	Y.applyUpdate(t.ydoc, written.update, 'ai');
	return written;
};
const rewrite = (t: Tab, lines: string[]) =>
	write(t, (doc) => void q.writer(doc).revise({}, lines.join('\n\n')));
const at = (t: Tab) => ({ history: t.ydoc, quill: q, doc: t.doc });
/** Take `written` back and land the update. */
const undo = (t: Tab, written: Written, more: Partial<RevertOpts> = {}): Written => {
	const undone = revert(written, { ...at(t), ...more });
	Y.applyUpdate(t.ydoc, undone.update, 'undo');
	return undone;
};

const LINES = [
	'Alpha confirms two things before noon.',
	'Bravo reviews the draft and signs the memo at the end of the week.',
	'Charlie files it.'
];
const REWRITTEN = [
	'Alpha confirms three things before noon.',
	LINES[1],
	'Charlie files it on Friday.'
];

describe('revert', () => {
	it('returns the document to the state the write was made from', () => {
		const [a, b] = session(LINES);
		const before = snapshot(a.doc);
		const written = rewrite(a, REWRITTEN);
		expect(body(a)).toEqual(REWRITTEN);
		const undone = undo(a, written);
		expect(undone.held).toEqual([]);
		expect(snapshot(a.doc)).toBe(before);
		expect(snapshot(b.doc)).toBe(before);
	});

	it('writes the write again when it is itself reverted', () => {
		const [a, b] = session(LINES);
		const written = rewrite(a, REWRITTEN);
		const after = snapshot(a.doc);
		undo(a, undo(a, written));
		expect(snapshot(a.doc)).toBe(after);
		expect(snapshot(b.doc)).toBe(after);
	});

	it('leaves what was typed elsewhere, before the write landed and since', () => {
		const [a, b] = session(LINES);
		const base = Y.encodeSnapshot(Y.snapshot(a.ydoc));
		retype(b, 'reviews', 'checks');
		const written = writeFrom({
			...at(a),
			base,
			edit: (doc) => void q.writer(doc).revise({}, REWRITTEN.join('\n\n'))
		});
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		retype(b, 'the memo', 'the letter');
		retype(b, 'before noon', 'by noon');
		const undone = undo(a, written);
		expect(undone.held).toEqual([]);
		expect(body(a)).toEqual([
			'Alpha confirms two things by noon.',
			'Bravo checks the draft and signs the letter at the end of the week.',
			LINES[2]
		]);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('holds the lines someone changed where the write changed them, and takes back the rest', () => {
		const [a, b] = session(LINES);
		const written = rewrite(a, REWRITTEN);
		retype(b, 'three things', 'three small things');
		const undone = undo(a, written);
		expect(undone.conflicts).toEqual([]);
		expect(body(a)).toEqual(['Alpha confirms three small things before noon.', LINES[1], LINES[2]]);
		expect(undone.held).toEqual([
			expect.objectContaining({
				type: 'text',
				before: REWRITTEN[0],
				theirs: body(a)[0],
				after: LINES[0]
			})
		]);
		const [part] = undone.held;
		expect(heldState(part, at(a)).state).toBe('open');
		Y.applyUpdate(a.ydoc, writeHeld(part, at(a)).update, 'undo');
		expect(body(a)).toEqual(LINES);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('reports the change it met instead of holding it under hold none', () => {
		const [a, b] = session(LINES);
		const written = rewrite(a, REWRITTEN);
		retype(b, 'three things', 'three small things');
		const undone = revert(written, { ...at(a), hold: 'none' });
		expect(undone.held).toEqual([]);
		expect(undone.conflicts).toEqual([expect.objectContaining({ type: 'field', from: 'main' })]);
	});

	it('restores a field the write set and one it removed', () => {
		const [a, b] = session();
		const before = snapshot(a.doc);
		const written = write(a, (doc) => {
			const w = q.writer(doc);
			w.set('title', 'Retitled');
			w.revise('abstract', 'Rewritten.');
			doc.removeField({ field: 'subtitle' });
		});
		expect(snapshot(a.doc)).not.toBe(before);
		undo(a, written);
		expect(snapshot(a.doc)).toBe(before);
		expect(snapshot(b.doc)).toBe(before);
	});

	it('takes back an inserted card, a removed one and a move, with each card as it was', () => {
		const [a, b] = session();
		const before = snapshot(a.doc);
		const written = write(a, (doc) => {
			const w = q.writer(doc);
			w.addCard('note', { label: 'Added' }, 'From the writer.', 1);
			doc.removeCard(3);
			doc.moveCard(0, 2);
			return [
				{ op: 'insert', at: 1 },
				{ op: 'remove', at: 3 },
				{ op: 'move', from: 0, to: 2 }
			];
		});
		expect(snapshot(a.doc)).not.toBe(before);
		undo(a, written);
		expect(snapshot(a.doc)).toBe(before);
		expect(snapshot(b.doc)).toBe(before);
	});

	it('keeps a card added since and what was typed into another', () => {
		const [a, b] = session();
		const heading = q.toAuthoring(a.doc).cards?.[0].fields?.heading;
		const written = write(a, (doc) => void q.writer(doc).card(0).set('heading', 'New'));
		edit(b.doc, { card: 3 }, [{ insert: 'Typed. ' }]);
		b.binding.push();
		q.writer(b.doc).addCard('note', { label: 'Theirs' }, '', 0);
		b.binding.push({ op: 'insert', at: 0 });
		undo(a, written);
		const cards = q.toAuthoring(a.doc).cards!;
		expect(cards[0].fields).toEqual({ label: 'Theirs' });
		expect(cards[1].fields?.heading).toBe(heading);
		expect(cards[4].body).toMatch(/^Typed\. /);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('holds a line the write added that someone has typed in, for the host to remove', () => {
		const [a, b] = session(LINES);
		const added = 'Delta checks the figures.';
		const written = rewrite(a, [LINES[0], added, LINES[1], LINES[2]]);
		retype(b, 'the figures', 'every figure');
		const undone = undo(a, written);
		const theirs = 'Delta checks every figure.';
		expect(body(a)).toEqual([LINES[0], theirs, LINES[1], LINES[2]]);
		expect(undone.held).toEqual([
			expect.objectContaining({ type: 'text', before: added, theirs, after: '' })
		]);
		Y.applyUpdate(a.ydoc, writeHeld(undone.held[0], at(a)).update, 'undo');
		expect(body(a)).toEqual(LINES);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('takes back only what the write wrote, not the part it held', () => {
		const [a, b] = session(LINES);
		const base = Y.encodeSnapshot(Y.snapshot(a.ydoc));
		retype(b, 'reviews', 'checks');
		const theirs = body(a)[1];
		const written = writeFrom({
			...at(a),
			base,
			hold: 'hunk',
			edit: (doc) =>
				void q
					.writer(doc)
					.revise(
						{},
						[REWRITTEN[0], LINES[1].replace('reviews', 'approves'), REWRITTEN[2]].join('\n\n')
					)
		});
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		expect(written.held).toHaveLength(1);
		const undone = undo(a, written);
		expect(undone.held).toEqual([]);
		expect(body(a)).toEqual([LINES[0], theirs, LINES[2]]);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('gives a retyped card its kind and a renamed one its title', () => {
		const [a, b] = session();
		const before = snapshot(a.doc);
		const written = write(a, (doc) => {
			const was = doc.card(1);
			doc.removeCard(1);
			doc.unchecked.insertCard({ ...was, kind: 'section' }, 1);
			doc.storeExt({ card: 0 }, { editor: { title: 'Renamed' } });
		});
		expect(snapshot(a.doc)).not.toBe(before);
		undo(a, written);
		expect(snapshot(a.doc)).toBe(before);
		expect(snapshot(b.doc)).toBe(before);
	});

	it('holds what it would do to a card someone removed since', () => {
		const [a, b] = session();
		const written = write(a, (doc) => void q.writer(doc).card(0).set('heading', 'New'));
		b.doc.removeCard(0);
		b.binding.push({ op: 'remove', at: 0 });
		const count = a.doc.cardCount;
		const undone = undo(a, written);
		expect(undone.held).toEqual([expect.objectContaining({ type: 'card' })]);
		expect(a.doc.cardCount).toBe(count);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('refuses a write the history does not hold', () => {
		const [a] = session(LINES);
		const written = writeFrom({
			...at(a),
			base: Y.encodeSnapshot(Y.snapshot(a.ydoc)),
			edit: (doc) => void q.writer(doc).revise({}, REWRITTEN.join('\n\n'))
		});
		expect(() => revert(written, at(a))).toThrow(Unwritable);
	});
});
