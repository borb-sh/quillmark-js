// The binding's cases one at a time: the edits where the content model fights a CRDT, and what a
// host hears back through `onRemote`.
import { describe, expect, it } from 'vitest';
import type { Content, ContentContainer, Document } from '@quillmark/wasm';
import * as Y from 'yjs';
import { bindDocument, Diverged, seedDocument } from '../src/index.js';
import { inserts, project } from '../src/project.js';
import { contentRoot, contentTypes, readField } from '../src/shape.js';
import { core, deliver, edit, peers, quill, settle, snapshot, type Peer } from './helpers.js';
import type { Delta } from '../src/index.js';

const example = () => quill().exampleDocument()!;
const body = (p: Peer, card?: number): Content =>
	p.doc.getStored(card === undefined ? {} : { card }) as Content;
const withBody = (text: string) => (): Document => {
	const doc = example();
	doc.replace(
		{},
		{ text, blocks: text.split('\n').map((_, i) => ({ id: `b${i}`, kind: 'para' as const })) }
	);
	return doc;
};
const LIST: ContentContainer = { id: 'l', kind: 'list', attrs: { ordered: true, start: 1 } };
const listDoc = (): Document => {
	const doc = example();
	doc.replace(
		{},
		{
			text: 'one\ntwo',
			blocks: [
				{ id: 'b0', kind: 'para', path: ['l', 'i0'] },
				{ id: 'b1', kind: 'para', path: ['l', 'i1'] }
			],
			containers: [LIST, { id: 'i0', kind: 'item' }, { id: 'i1', kind: 'item' }]
		}
	);
	return doc;
};

describe('content', () => {
	it('two items added to one list at once stay one list', () => {
		const [a, b] = peers(2, listDoc);
		const add = (p: Peer, at: number, word: string) => {
			p.doc.apply(
				{},
				{
					steps: [
						{ container: { id: `i-${word}`, kind: 'item' } },
						{
							splice: {
								at,
								insert: `\n${word}`,
								blocks: [{ id: `b-${word}`, kind: 'para', path: ['l', `i-${word}`] }]
							}
						}
					]
				}
			);
			p.binding.push();
		};
		add(a, 3, 'alpha');
		add(b, 7, 'beta');
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		const got = body(a);
		expect(got.text).toBe('one\nalpha\ntwo\nbeta');
		expect(got.blocks.map((x) => x.path)).toEqual(
			['i0', 'i-alpha', 'i1', 'i-beta'].map((i) => ['l', i])
		);
	});

	it('a table inserted on a line another client types on keeps one slot and both edits', () => {
		const [a, b] = peers(2, listDoc);
		const table = core.importMarkdown('| h |\n| - |').content.islands![0];
		a.doc.apply(
			{},
			{
				steps: [
					{
						splice: {
							at: 7,
							insert: '\n\uFFFC',
							blocks: [{ id: 'bt', kind: 'para' }],
							islands: [table]
						}
					}
				]
			}
		);
		a.binding.push();
		edit(b.doc, {}, [{ retain: 3 }, { insert: '!' }]);
		b.binding.push();
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		const got = body(a);
		expect(got.islands).toHaveLength(1);
		expect(got.islands![0].id).not.toBe(table.id);
		expect(Array.from(got.text).filter((c) => c === '\uFFFC')).toHaveLength(1);
		expect(got.text).toContain('!');
	});

	it("a client's anchor survives another client's edit and stays its own", () => {
		const [a, b] = peers(2, listDoc);
		a.doc.apply({}, { steps: [{ anchor: { id: 'c1', start: 4, end: 7 } }] });
		a.binding.push();
		edit(b.doc, {}, [{ insert: 'zero ' }]);
		b.binding.push();
		settle([a, b]);
		expect(body(a).anchors).toEqual([{ id: 'c1', start: 9, end: 12 }]);
		expect(body(b).anchors).toBeUndefined();
		expect(body(a).text).toBe(body(b).text);
	});

	it('a repair that inserts is read by every client and written back by none', () => {
		const [a, b] = peers(2, withBody('Title words\nbody'));
		a.doc.apply({}, { steps: [{ setBlock: { id: 'b0', kind: 'heading', attrs: { level: 1 } } }] });
		a.binding.push();
		b.doc.apply({}, { steps: [{ splice: { at: 5, delete: ' ', insert: ' ' } }] });
		b.binding.push();
		settle([a, b]);
		const merged = body(a).text;
		edit(a.doc, {}, [{ retain: merged.length }, { insert: ' A' }]);
		a.binding.push();
		edit(b.doc, {}, [{ retain: merged.length }, { insert: ' B' }]);
		b.binding.push();
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		expect([`${merged} A B`, `${merged} B A`]).toContain(body(a).text);
	});

	it('the leader writes a repair that inserts back, and every client then reads none', () => {
		const tabled = () => {
			const doc = example();
			doc.replace({}, core.importMarkdown('lead\n\n| h |\n| - |\n\ntail').content);
			return doc;
		};
		const inserting = (p: Peer) =>
			project(readField(contentTypes(p.ydoc, contentRoot('main')))).repairs.filter(inserts);
		for (const leader of [undefined, 2, 'elected later'] as const) {
			const [a, b, c] = peers(3, tabled, quill(), typeof leader === 'number' ? leader : undefined);
			const slot = Array.from(body(a).text).indexOf('￼');
			edit(a.doc, {}, [{ retain: slot + 1 }, { delete: '\ntail'.length }]);
			a.binding.push();
			edit(b.doc, {}, [{ retain: slot + 2 }, { insert: 'typed ' }]);
			b.binding.push();
			settle([a, b, c]);
			if (leader === 'elected later') {
				expect(inserting(a)).toHaveLength(1);
				c.binding.leader = true;
				settle([a, b, c]);
			}
			expect(inserting(a)).toHaveLength(leader === undefined ? 1 : 0);
			expect(snapshot(a.doc)).toBe(snapshot(c.doc));
			expect(snapshot(b.doc)).toBe(snapshot(c.doc));
			expect([a, b, c].flatMap((p) => p.errors)).toEqual([]);
		}
	});

	it('text split off a table by repair is not split twice by two clients typing', () => {
		const [a, b] = peers(2, () => {
			const doc = example();
			doc.replace({}, core.importMarkdown('lead\n\n| h |\n| - |\n\ntail').content);
			return doc;
		});
		const slot = Array.from(body(a).text).indexOf('￼');
		edit(a.doc, {}, [{ retain: slot + 1 }, { delete: '\ntail'.length }]);
		a.binding.push();
		edit(b.doc, {}, [{ retain: slot + 2 }, { insert: 'typed ' }]);
		b.binding.push();
		settle([a, b]);
		const blocks = body(a).blocks.length;
		edit(a.doc, {}, [{ insert: 'A ' }]);
		a.binding.push();
		edit(b.doc, {}, [{ insert: 'B ' }]);
		b.binding.push();
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		expect(body(a).blocks).toHaveLength(blocks);
	});

	it('Enter at the start of a block another client re-kinds keeps that kind on the text', () => {
		const [a, b] = peers(2, withBody('one\ntwo'));
		a.doc.apply({}, { steps: [{ setBlock: { id: 'b1', kind: 'heading', attrs: { level: 2 } } }] });
		a.binding.push();
		b.doc.splitBlock({}, 4, { id: 'bn' });
		b.binding.push();
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		expect(body(a).text).toBe('one\n\ntwo');
		expect(body(a).blocks.map((x) => [x.id, x.kind])).toEqual([
			['b0', 'para'],
			['bn', 'para'],
			['b1', 'heading']
		]);
	});

	it('text typed before a repeat of itself is written where it was typed', () => {
		const [a, b] = peers(2, withBody('see the cat'));
		a.doc.apply({}, { steps: [{ splice: { at: 4, delete: 'the cat', insert: '' } }] });
		a.binding.push();
		b.doc.apply({}, { steps: [{ splice: { at: 4, insert: 'the big ' } }] });
		b.binding.push();
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		expect(body(a).text).toBe('see the big ');
	});

	it('hands the host the delta a remote edit made', () => {
		const [a, b] = peers(2, listDoc);
		edit(b.doc, {}, [{ retain: 2 }, { insert: 'xy' }]);
		b.binding.push();
		deliver(a);
		const [change] = a.changes;
		const { delta } = change.content.find((c) => c.addr.card === undefined && !c.addr.field)!;
		expect(delta).toEqual({ ops: [{ retain: 2 }, { insert: 'xy' }] });
	});

	it("hands the host the Document's own text change where a repair inserts", () => {
		const [a, b] = peers(2, () => {
			const doc = example();
			doc.replace({}, core.importMarkdown('lead\n\n| h |\n| - |\n\ntail').content);
			return doc;
		});
		const slot = Array.from(body(a).text).indexOf('￼');
		edit(a.doc, {}, [{ retain: slot + 1 }, { delete: '\ntail'.length }]);
		a.binding.push();
		edit(b.doc, {}, [{ retain: slot + 2 }, { insert: 'typed ' }]);
		b.binding.push();
		const before = body(a).text;
		deliver(a);
		const { delta } = a.changes.at(-1)!.content.find((c) => !c.addr.card && !c.addr.field)!;
		expect(
			project(readField(contentTypes(a.ydoc, contentRoot('main')))).repairs.some(inserts)
		).toBe(true);
		expect(applyDelta(before, delta!)).toBe(body(a).text);
	});

	it('a text field keeps its plain codec through Y', () => {
		const [a, b] = peers(2, example);
		quill().writer(b.doc).revise('subtitle', 'A *plain* line');
		b.binding.push();
		deliver(a);
		expect(a.doc.getStored({ field: 'subtitle' })).toMatchObject({
			text: 'A *plain* line',
			codec: 'plain'
		});
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
	});
});

describe('cards', () => {
	it('a card moved while another client edits it keeps the edit', () => {
		const [a, b] = peers(2, example);
		a.doc.moveCard(0, 2);
		a.binding.push({ op: 'move', from: 0, to: 2 });
		edit(b.doc, { card: 0 }, [{ insert: 'moved ' }]);
		b.binding.push();
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		expect(a.doc.card(2).kind).toBe('section');
		expect(body(a, 2).text.startsWith('moved ')).toBe(true);
	});

	it('a remote insert arrives as a card op with the card whole', () => {
		const [a, b] = peers(2, example);
		const card = quill().seedCard('note', b.doc.seedOverlay('note'))!;
		b.doc.unchecked.insertCard(card, 1);
		b.binding.push({ op: 'insert', at: 1 });
		deliver(a);
		expect(a.changes.at(-1)!.cards).toEqual([{ op: 'insert', at: 1 }]);
		expect(a.doc.card(1).kind).toBe('note');
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
	});

	it('two cards placed at once take one $id each, the same on every client', () => {
		const [a, b] = peers(2, example);
		for (const p of [a, b]) {
			p.doc.unchecked.insertCard(quill().seedCard('note', p.doc.seedOverlay('note'))!, 0);
			p.binding.push({ op: 'insert', at: 0 });
		}
		expect(a.doc.card(0).id).toBe(b.doc.card(0).id);
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		const ids = a.doc.cards.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const p of [a, b])
			p.binding.ids.forEach((name, i) =>
				expect(p.ydoc.getMap(name).get('$id')).toBe(p.doc.card(i).id)
			);
		expect([a, b].flatMap((p) => p.errors)).toEqual([]);
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
		const was = a.doc.card(at);
		a.doc.removeCard(at);
		a.doc.unchecked.insertCard({ ...was, kind: 'section' }, at);
		a.binding.push();
		edit(b.doc, { card: at, field: 'caption' }, [{ insert: 'b ' }]);
		b.binding.push();
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		expect(a.doc.card(at).kind).toBe('section');
		expect(a.errors).toEqual([]);
		expect(b.errors).toEqual([]);
	});

	it('an edit racing a retype to a kind without the field lands, and the field keeps its root', () => {
		const [a, b] = peers(2, example);
		const at = a.doc.cards.findIndex((c) => c.kind === 'section');
		const lead = { card: at, field: 'lead' };
		edit(a.doc, lead, [{ insert: 'a ' }]);
		a.binding.push();
		const was = b.doc.card(at);
		b.doc.removeCard(at);
		b.doc.unchecked.insertCard({ ...was, kind: 'signoff' }, at);
		b.binding.push();
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		expect(b.doc.card(at).kind).toBe('signoff');
		expect((a.doc.getStored(lead) as Content).text.startsWith('a ')).toBe(true);
		const now = a.doc.card(at);
		a.doc.removeCard(at);
		a.doc.unchecked.insertCard({ ...now, kind: 'section' }, at);
		a.binding.push();
		settle([a, b]);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
		expect(b.doc.read(lead).text.startsWith('a ')).toBe(true);
		expect(a.errors).toEqual([]);
		expect(b.errors).toEqual([]);
	});
});

describe('a remote value the Document refuses', () => {
	it('stays in Y as it is, and a local edit does not revert it', () => {
		const [a, b] = peers(2, example);
		b.ydoc.transact(() => b.ydoc.getMap('main').set('bad-name', 1));
		settle([a, b]);
		expect(a.errors).toHaveLength(1);
		edit(a.doc, {}, [{ insert: 'a ' }]);
		a.binding.push();
		settle([a, b]);
		expect(a.ydoc.getMap('main').get('bad-name')).toBe(1);
		expect(b.ydoc.getMap('main').get('bad-name')).toBe(1);
		expect(snapshot(a.doc)).toBe(snapshot(b.doc));
	});

	it('tells the host when it starts holding one and when it lets the last go', () => {
		const q = quill();
		const seed = seedDocument(example(), q);
		const ydoc = new Y.Doc();
		Y.applyUpdate(ydoc, seed);
		const heard: boolean[] = [];
		const binding = bindDocument({
			doc: example(),
			quill: q,
			ydoc,
			leader: true,
			onError: () => {},
			onHolding: (holding) => heard.push(holding)
		});
		ydoc.transact(() => ydoc.getMap('main').set('bad-name', 1), 'net');
		expect([binding.holding, heard]).toEqual([true, [true]]);
		ydoc.transact(() => ydoc.getMap('main').delete('bad-name'), 'net');
		expect([binding.holding, heard]).toEqual([false, [true, false]]);
	});

	it('in the card list stops the binding, which says so', () => {
		const [a, b] = peers(2, example);
		b.ydoc.transact(() => {
			b.ydoc.getMap('bad').set('$kind', 'Not A Kind!');
			b.ydoc.getArray<string>('$cards').insert(0, ['bad']);
		});
		deliver(a);
		expect(a.errors.at(-1)).toBeInstanceOf(Diverged);
		const before = Y.encodeStateVector(a.ydoc);
		edit(a.doc, {}, [{ insert: 'a ' }]);
		expect(a.binding.push()).toEqual([]);
		expect(Y.encodeStateVector(a.ydoc)).toEqual(before);
	});

	it('a host that throws on a remote change hears it through onError, and keeps receiving', () => {
		const q = quill();
		const seed = seedDocument(example(), q);
		const [x, y] = [new Y.Doc(), new Y.Doc()];
		Y.applyUpdate(x, seed);
		Y.applyUpdate(y, seed);
		const errors: unknown[] = [];
		const doc = example();
		bindDocument({
			doc,
			quill: q,
			ydoc: x,
			leader: true,
			onRemote: () => {
				throw new Error('host');
			},
			onError: (e) => errors.push(e)
		});
		const other = example();
		const binding = bindDocument({ doc: other, quill: q, ydoc: y, leader: true });
		for (const word of ['one ', 'two ']) {
			edit(other, {}, [{ insert: word }]);
			binding.push();
			Y.applyUpdate(x, Y.encodeStateAsUpdate(y, Y.encodeStateVector(x)));
		}
		expect(errors.map((e) => (e as Error).message)).toEqual(['host', 'host']);
		expect((doc.getStored({}) as Content).text.startsWith('two one ')).toBe(true);
	});
});

function applyDelta(text: string, delta: Delta): string {
	let out = '';
	let at = 0;
	for (const op of delta.ops) {
		if ('retain' in op) out += text.slice(at, (at += op.retain));
		else if ('delete' in op) at += op.delete;
		else out += op.insert;
	}
	return out + text.slice(at);
}
