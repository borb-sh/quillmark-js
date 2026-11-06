// Writes from a revision compared word by word, and the parts of them held back: what lands,
// what is held, where a held part stands as people keep editing, and what writing it does.
import { describe, expect, it } from 'vitest';
import type { Document } from '@quillmark/wasm';
import * as Y from 'yjs';
import {
	bindDocument,
	heldState,
	seedDocument,
	Unwritable,
	writeFrom,
	writeHeld
} from '../src/index.js';
import type { CardOp, DocumentBinding, Held, HeldText, WriteFromOpts } from '../src/index.js';
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
		expect(heldState(held, { history: a.ydoc, quill: q, doc: a.doc }).state).toBe('open');
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
		expect(heldState(held, { history: a.ydoc, quill: q, doc: a.doc }).state).toBe('open');
		retype(b, 'Bravo reviews', 'Bravo rereads');
		expect(heldState(held, { history: a.ydoc, quill: q, doc: a.doc })).toEqual({
			state: 'edited',
			current: 'Bravo rereads the draft and signs the memo on Thursday.'
		});
		retype(
			b,
			'rereads the draft and signs the memo on Thursday',
			'reviews the draft and signs the memo by Friday'
		);
		expect(heldState(held, { history: a.ydoc, quill: q, doc: a.doc }).state).toBe('matched');
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
		expect(heldState(held, { history: a.ydoc, quill: q, doc: a.doc }).state).toBe('gone');
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
		expect(heldState(written.held[0], { history: a.ydoc, quill: q, doc: a.doc }).state).toBe(
			'open'
		);
		Y.applyUpdate(
			a.ydoc,
			writeHeld(written.held[0], { history: a.ydoc, quill: q, doc: a.doc }).update,
			'ai'
		);
		expect(q.toAuthoring(a.doc).fields?.keywords).toEqual(['model']);
		expect(heldState(written.held[0], { history: a.ydoc, quill: q, doc: a.doc }).state).toBe(
			'matched'
		);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('holds only the line whose end meets a change, and writes it leaving the others', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		retype(b, 'noon.', 'noon. Typed.');
		retype(b, 'Bravo', 'Bravo now');
		const written = write(
			a,
			base,
			['Alpha confirms two things before noon. Drafted.', LINES[1], 'Charlie files it today.'],
			{ hold: 'hunk' }
		);
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		const typed = 'Bravo now reviews the draft and signs the memo at the end of the week.';
		expect(body(a)).toEqual([
			'Alpha confirms two things before noon. Typed.',
			typed,
			'Charlie files it today.'
		]);
		expect(written.held).toEqual([expect.objectContaining({ before: LINES[0] })]);
		Y.applyUpdate(
			a.ydoc,
			writeHeld(written.held[0], { history: a.ydoc, quill: q, doc: a.doc }).update,
			'ai'
		);
		expect(body(a)).toEqual([
			'Alpha confirms two things before noon. Drafted.',
			typed,
			'Charlie files it today.'
		]);
	});

	it('holds what both wrote into an empty field, and writes it', () => {
		const [a, b] = session(['']);
		const base = revision(a);
		edit(b.doc, {}, [{ insert: 'Typed here.' }]);
		b.binding.push();
		const written = write(a, base, ['Drafted here.'], { hold: 'hunk' });
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		expect(heldState(written.held[0], { history: a.ydoc, quill: q, doc: a.doc })).toEqual({
			state: 'open',
			current: 'Typed here.'
		});
		Y.applyUpdate(
			a.ydoc,
			writeHeld(written.held[0], { history: a.ydoc, quill: q, doc: a.doc }).update,
			'ai'
		);
		expect(body(a)).toEqual(['Drafted here.']);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});
});

describe('held cards', () => {
	const ANSWER = LINES.map((l) => l.replace('.', ', as drafted.'));
	const opts = (t: Tab) => ({ history: t.ydoc, quill: q, doc: t.doc });
	/** `a` writes `edit` and the answer's body from `base`, holding by hunk, and applies it. */
	const answer = (t: Tab, base: Uint8Array, edit: (doc: Document) => CardOp | void) => {
		const written = writeFrom({
			...opts(t),
			base,
			hold: 'hunk',
			edit: (doc) => {
				q.writer(doc).revise({}, ANSWER.join('\n\n'));
				return edit(doc);
			}
		});
		Y.applyUpdate(t.ydoc, written.update, 'ai');
		expect(written.conflicts).toEqual([]);
		expect(body(t)).toEqual(ANSWER);
		return written.held;
	};
	const accept = (t: Tab, held: Held) =>
		Y.applyUpdate(t.ydoc, writeHeld(held, opts(t)).update, 'ai');
	const kinds = (t: Tab) => t.doc.cards.map((c) => c.kind);

	it('holds a removal of a card someone wrote in, and removes it on request', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		const id = a.doc.card(0).id;
		q.writer(b.doc).card(0).set('heading', 'Typed');
		b.binding.push();
		const held = answer(a, base, (doc) => {
			doc.removeCard(0);
			return { op: 'remove', at: 0 };
		});
		expect(a.doc.card(0).id).toBe(id);
		expect(held).toEqual([expect.objectContaining({ type: 'card', from: 0, id })]);
		expect(held[0]).not.toHaveProperty('proposal');
		expect(heldState(held[0], opts(a)).state).toBe('open');
		accept(a, held[0]);
		expect(a.doc.cards.map((c) => c.id)).not.toContain(id);
		expect(heldState(held[0], opts(a)).state).toBe('matched');
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('holds what the edit wrote into a card removed since, and leaves it removed', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		b.doc.removeCard(0);
		b.binding.push({ op: 'remove', at: 0 });
		const held = answer(a, base, (doc) => void q.writer(doc).card(0).set('heading', 'Drafted'));
		expect(a.doc.cardCount).toBe(4);
		expect(held).toEqual([expect.objectContaining({ type: 'card', from: 0, at: 0 })]);
		expect(held[0]).not.toHaveProperty('theirs');
		expect(heldState(held[0], opts(a)).state).toBe('gone');
		expect(() => writeHeld(held[0], opts(a))).toThrow(Unwritable);
	});

	it('holds a move of a card moved since, and does not bring back a card removed since', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		const order = kinds(a);
		b.doc.moveCard(3, 0);
		b.binding.push({ op: 'move', from: 3, to: 0 });
		b.doc.removeCard(1);
		b.binding.push({ op: 'remove', at: 1 });
		const held = answer(a, base, (doc) => {
			doc.moveCard(0, 1);
			doc.moveCard(3, 4);
			return [
				{ op: 'move', from: 0, to: 1 },
				{ op: 'move', from: 3, to: 4 }
			] as unknown as CardOp;
		});
		expect(kinds(a)).toEqual([order[3], order[1], order[2], order[4]]);
		expect(held.map((h) => h.type === 'card' && h.from).sort()).toEqual([0, 3]);
		const moved = held.find((h) => h.type === 'card' && h.from === 3)!;
		expect(heldState(moved, opts(a)).state).toBe('open');
		accept(a, moved);
		expect(kinds(a)).toEqual([order[1], order[2], order[4], order[3]]);
		expect(heldState(moved, opts(a)).state).toBe('matched');
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('holds a card retyped since that the edit wrote, and writes the edit’s card on request', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		const at = a.doc.cards.findIndex((c) => c.kind === 'figure');
		const was = b.doc.card(at);
		b.doc.removeCard(at);
		b.doc.unchecked.insertCard({ ...was, kind: 'section' }, at);
		b.binding.push();
		const held = answer(a, base, (doc) => void q.writer(doc).card(at).set('caption', 'Drafted'));
		expect(a.doc.card(at).kind).toBe('section');
		expect(held).toEqual([
			expect.objectContaining({
				type: 'card',
				from: at,
				theirs: expect.objectContaining({ kind: 'section' })
			})
		]);
		accept(a, held[0]);
		expect(a.doc.card(at).kind).toBe('figure');
		expect(q.toAuthoring(a.doc).cards![at].fields?.caption).toBe('Drafted');
		expect(heldState(held[0], opts(a)).state).toBe('matched');
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('reports nothing where both removed one card', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		b.doc.removeCard(0);
		b.binding.push({ op: 'remove', at: 0 });
		const held = answer(a, base, (doc) => {
			doc.removeCard(0);
			return { op: 'remove', at: 0 };
		});
		expect(held).toEqual([]);
	});

	it('reads and writes a held part that went through JSON', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		retype(b, 'at the end of the week', 'on Thursday');
		q.writer(b.doc).card(0).set('heading', 'Typed');
		b.binding.push();
		const written = write(a, base, ANSWER, {
			hold: 'hunk',
			edit: (doc) => {
				q.writer(doc).revise({}, ANSWER.join('\n\n'));
				doc.removeCard(0);
				return { op: 'remove', at: 0 };
			}
		});
		Y.applyUpdate(a.ydoc, written.update, 'ai');
		const parts = JSON.parse(JSON.stringify(written.held)) as Held[];
		expect(parts.map((h) => h.type).sort()).toEqual(['card', 'text']);
		for (const part of parts) {
			expect(heldState(part, opts(a)).state).toBe('open');
			accept(a, part);
			expect(heldState(part, opts(a)).state).toBe('matched');
		}
		expect(body(a)).toEqual(ANSWER);
		expect(snapshot(b.doc)).toBe(snapshot(a.doc));
	});

	it('refuses an edit that makes another change when it runs again', () => {
		const [a, b] = session(LINES);
		const base = revision(a);
		retype(b, 'at the end of the week', 'on Thursday');
		let runs = 0;
		expect(() =>
			write(a, base, ANSWER, {
				hold: 'hunk',
				edit: (doc) => void q.writer(doc).revise({}, [...ANSWER, `Run ${++runs}.`].join('\n\n'))
			})
		).toThrow(Unwritable);
	});
});
