// The binding's cases one at a time: the edits where the content model fights a CRDT, and what a
// host hears back through `onRemote`.
import { describe, expect, it } from 'vitest';
import type { Content, ContentContainer, Document } from '@quillmark/wasm';
import { core, deliver, peers, quill, settle, snapshot, type Peer } from './helpers.js';

const example = () => quill().exampleDocument()!;
const body = (p: Peer, card?: number): Content =>
	p.doc.getStored(card === undefined ? {} : { card }) as Content;
const item = (ordinal: number): ContentContainer[] => [
	{ container: 'list_item', attrs: { ordered: true, start: 1, ordinal } }
];
const listDoc = (): Document => {
	const doc = example();
	doc.overwrite(
		{},
		{
			text: 'one\ntwo',
			lines: [
				{ kind: 'para', containers: item(0) },
				{ kind: 'para', containers: item(1) }
			],
			marks: [],
			islands: []
		}
	);
	return doc;
};

describe('content', () => {
	it('two items added to one list at once number as one list', () => {
		const [a, b] = peers(2, listDoc);
		const add = (p: Peer, at: number, word: string) => {
			const lines = [...body(p).lines];
			lines.splice(at + 1, 0, lines[at]);
			p.doc.applyChange(
				{},
				{
					delta: {
						ops: [{ retain: at === 0 ? 3 : 7 }, { insert: `\n${word}` }]
					},
					lineOps: lines.map((_, i) => ({ op: 'setContainers', line: i, containers: item(i) }))
				}
			);
			p.binding.push();
		};
		add(a, 0, 'alpha');
		add(b, 1, 'beta');
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		const got = body(a);
		expect(got.text).toBe('one\nalpha\ntwo\nbeta');
		expect(got.lines.map((l) => l.containers)).toEqual([0, 1, 2, 3].map(item));
	});

	it('a table inserted on a line another client types on keeps one slot and both edits', () => {
		const [a, b] = peers(2, listDoc);
		const props = { header: [{ text: 'h', marks: [] }], rows: [], aligns: ['none' as const] };
		a.doc.applyChange(
			{},
			{
				delta: { ops: [{ retain: 3 }, { insert: '\n' }] },
				islandOps: [{ op: 'insert', at: 4, id: 'isl-0', type: 'table', props }]
			}
		);
		a.binding.push();
		b.doc.applyChange({}, { delta: { ops: [{ retain: 3 }, { insert: '!' }] } });
		b.binding.push();
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		const got = body(a);
		expect(got.islands).toHaveLength(1);
		expect(got.islands[0].id).not.toBe('isl-0');
		expect(Array.from(got.text).filter((c) => c === '￼')).toHaveLength(1);
		expect(got.text).toContain('one!');
	});

	it("a client's anchor survives another client's edit and stays its own", () => {
		const [a, b] = peers(2, listDoc);
		a.doc.applyChange(
			{},
			{ markOps: [{ op: 'add', type: 'anchor', attrs: { id: 'c1' }, start: 4, end: 7 }] }
		);
		a.binding.push();
		b.doc.applyChange({}, { delta: { ops: [{ insert: 'zero ' }] } });
		b.binding.push();
		settle([a, b]);
		const anchor = body(a).marks.find((m) => m.type === 'anchor');
		expect(anchor).toMatchObject({ start: 9, end: 12 });
		expect(body(b).marks.some((m) => m.type === 'anchor')).toBe(false);
		expect(body(a).text).toBe(body(b).text);
	});

	it('hands the host the delta a remote edit made', () => {
		const [a, b] = peers(2, listDoc);
		b.doc.applyChange({}, { delta: { ops: [{ retain: 2 }, { insert: 'xy' }] } });
		b.binding.push();
		deliver(a);
		const [change] = a.changes;
		const { delta } = change.content.find((c) => c.addr.card === undefined && !c.addr.field)!;
		expect(delta).toBeDefined();
		expect(core.mapPos(delta!, 5, 'after')).toBe(7);
		expect(core.mapPos(delta!, 1, 'after')).toBe(1);
	});
});

describe('cards', () => {
	it('a card moved while another client edits it keeps the edit', () => {
		const [a, b] = peers(2, example);
		a.doc.moveCard(0, 2);
		a.binding.push({ op: 'move', from: 0, to: 2 });
		b.doc.applyChange({ card: 0 }, { delta: { ops: [{ insert: 'moved ' }] } });
		b.binding.push();
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		expect(a.doc.card(2).kind).toBe('section');
		expect(body(a, 2).text.startsWith('moved ')).toBe(true);
	});

	it('a remote insert arrives as a card op with the card whole', () => {
		const [a, b] = peers(2, example);
		const card = quill().seedCard('note', b.doc.seedOverlay('note'))!;
		b.doc.insertCard(card, 1);
		b.binding.push({ op: 'insert', at: 1 });
		deliver(a);
		expect(a.changes.at(-1)!.cards).toEqual([{ op: 'insert', at: 1 }]);
		expect(a.doc.card(1).kind).toBe('note');
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
	});

	it('syncs a card title and keeps the rest of $ext local', () => {
		const [a, b] = peers(2, example);
		a.doc.storeExt({ card: 1 }, { editor: { title: 'Aside', tips: false }, mine: 1 });
		a.binding.push();
		deliver(b);
		expect(b.doc.getExt({ card: 1 })).toEqual({ editor: { title: 'Aside' } });
		expect(b.changes.at(-1)!.fields).toEqual([1]);
	});

	it('a retype carries a field into the form the new kind declares', () => {
		const [a, b] = peers(2, example);
		const at = a.doc.cards.findIndex((c) => c.kind === 'figure');
		a.doc.insertCard({ ...a.doc.card(at), kind: 'section' }, at);
		a.doc.removeCard(at + 1);
		a.binding.push();
		b.doc.applyChange({ card: at, field: 'caption' }, { delta: { ops: [{ insert: 'b ' }] } });
		b.binding.push();
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		expect(a.doc.card(at).kind).toBe('section');
		expect(a.errors).toEqual([]);
		expect(b.errors).toEqual([]);
	});
});
