// Writes from a revision compared word by word, and the parts of them held back: what lands,
// what is held, where a held part stands as people keep editing, and what writing it does.
import { describe, expect, it } from 'vitest';
import type { Document } from '@quillmark/wasm';
import * as Y from 'yjs';
import { bindDocument, heldState, seedDocument, writeFrom, writeHeld } from '../src/index.js';
import type { DocumentBinding, HeldText, WriteFromOpts } from '../src/index.js';
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
});

describe('held parts', () => {
	const ANSWER = [
		'Alpha confirms three things before noon.',
		'Bravo reviews the draft and signs the memo by Friday.',
		'Charlie files it today.'
	];

	function heldAnswer() {
		const [a, b] = session(LINES);
		const base = revision(a);
		retype(b, 'at the end of the week', 'on Thursday');
		const written = write(a, base, ANSWER, { hold: 'hunk' });
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		return { a, b, written, held: written.held[0] as HeldText };
	}

	it('writes the lines that meet nothing and holds the one that does', () => {
		const { a, b, written, held } = heldAnswer();
		expect(written.conflicts).toEqual([]);
		expect(body(a)).toEqual([
			ANSWER[0],
			'Bravo reviews the draft and signs the memo on Thursday.',
			ANSWER[2]
		]);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
		expect(written.held).toHaveLength(1);
		expect(held).toMatchObject({
			type: 'text',
			from: 'main',
			before: LINES[1],
			theirs: 'Bravo reviews the draft and signs the memo on Thursday.',
			after: ANSWER[1]
		});
		expect(heldState(held, a.ydoc).state).toBe('open');
	});

	it('holds the whole field when asked to hold by field', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		retype(b, 'at the end of the week', 'on Thursday');
		const written = write(a, base, ANSWER, { hold: 'field' });
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		expect(body(a)).toEqual([
			LINES[0],
			'Bravo reviews the draft and signs the memo on Thursday.',
			LINES[2]
		]);
		expect(written.held).toHaveLength(1);
		expect(written.held[0]).toMatchObject({
			before: LINES.join('\n\n'),
			after: ANSWER.join('\n\n')
		});
	});

	it('follows a held line through edits around it and in it', () => {
		const { a, b, held } = heldAnswer();
		retype(b, 'Alpha', 'Alpha now');
		expect(heldState(held, a.ydoc).state).toBe('open');
		retype(b, 'Bravo reviews', 'Bravo rereads');
		expect(heldState(held, a.ydoc)).toEqual({
			state: 'edited',
			current: 'Bravo rereads the draft and signs the memo on Thursday.'
		});
		retype(
			b,
			'rereads the draft and signs the memo on Thursday',
			'reviews the draft and signs the memo by Friday'
		);
		expect(heldState(held, a.ydoc).state).toBe('matched');
	});

	it('writes a held line over what it holds now, keeping every other line', () => {
		const { a, b, held } = heldAnswer();
		retype(b, 'Bravo reviews', 'Bravo rereads');
		retype(b, 'Charlie', 'Charlie then');
		const written = writeHeld(held, { history: a.ydoc, quill: q, doc: a.doc });
		expect(written.conflicts).toEqual([]);
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		expect(body(a)).toEqual([ANSWER[0], ANSWER[1], 'Charlie then files it today.']);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('reads a held line whose text was deleted as gone', () => {
		const { a, b, held } = heldAnswer();
		retype(b, 'Bravo reviews the draft and signs the memo on Thursday.', '');
		expect(heldState(held, a.ydoc).state).toBe('gone');
		expect(() => writeHeld(held, { history: a.ydoc, quill: q, doc: a.doc })).toThrow();
	});

	it('holds a whole-value field both set, and writes it on request', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		q.writer(b.doc).set('keywords', ['typed']);
		b.binding.push();
		const written = writeFrom({
			history: a.ydoc,
			base,
			quill: q,
			doc: a.doc,
			hold: 'hunk',
			edit: (doc) => {
				q.writer(doc).set('keywords', ['model']);
				q.writer(doc).revise({}, ANSWER.join('\n\n'));
			}
		});
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		expect(body(a)).toEqual(ANSWER);
		expect(q.toAuthoring(a.doc).fields?.keywords).toEqual(['typed']);
		expect(written.held).toEqual([
			expect.objectContaining({
				type: 'value',
				field: 'keywords',
				theirs: ['typed'],
				after: ['model']
			})
		]);
		expect(heldState(written.held[0], a.ydoc).state).toBe('open');
		Y.applyUpdate(
			a.ydoc,
			writeHeld(written.held[0], { history: a.ydoc, quill: q, doc: a.doc }).update,
			'ai'
		);
		expect(q.toAuthoring(a.doc).fields?.keywords).toEqual(['model']);
		expect(heldState(written.held[0], a.ydoc).state).toBe('matched');
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});
});
