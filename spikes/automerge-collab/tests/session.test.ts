// Probe 5: the session lifecycle COLLAB.md runs: one seed every client starts from, a log of
// updates, save and reload mid-session, a peer joining late, and the whole document's other
// parts (the card list, kinds, whole-value fields) that a session also carries.
import { describe, expect, it } from 'vitest';
import type { Document } from '@quillmark/wasm';
import {
	ABSTRACT,
	BODY,
	code,
	converged,
	core,
	docMd,
	parse,
	peers,
	quill,
	settle,
	typeAt,
	type Peer
} from './helpers.js';

const MD = docMd('Hello world.\n\n- one\n- two\n', 'Alpha.', '\n~~~\n$kind: note\n~~~\n\nNote.\n');

const peer = (name: string, doc: Document, actor?: string): Peer => ({
	name,
	doc,
	actor,
	states: new Map(),
	receipts: [],
	errors: []
});

/** Each body and content field of each card, the addresses a host must enumerate itself. */
function values(doc: Document): { card?: string; field?: string }[] {
	const out: { card?: string; field?: string }[] = [{}];
	for (const item of doc.main.payloadItems)
		if (
			item.type === 'field' &&
			typeof item.value === 'object' &&
			item.value &&
			'blocks' in item.value
		)
			out.push({ field: item.key });
	for (const c of doc.cards) out.push({ card: c.id });
	return out;
}

describe('seed', () => {
	it('a seed is a stored row plus one save per value; every peer loads both', () => {
		const origin = parse(MD);
		const addrs = values(origin);
		const seed = { row: origin.toStored(), bytes: addrs.map((a) => origin.save(a)) };
		const join = (name: string, actor: string) => {
			const d = core.Document.fromStored(seed.row);
			addrs.forEach((a, i) => d.load(a, seed.bytes[i]));
			return peer(name, d, actor);
		};
		const ps = [join('a', 'pa'), join('b', 'pb')];
		typeAt(ps[0], BODY, 0, 'A');
		typeAt(ps[1], ABSTRACT, 0, 'B');
		for (const a of addrs) settle(ps, a);
		converged(ps, addrs);
		expect(addrs).toEqual([
			{},
			{ field: 'title' },
			{ field: 'abstract' },
			{ card: origin.cards[0].id }
		]);
	});
});

describe('a log of updates', () => {
	it('there is no incremental change export: only whole saves and sync messages', () => {
		const d = parse(MD) as unknown as Record<string, unknown>;
		const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(d));
		const incremental = proto.filter((n) =>
			/incremental|changes|merge|heads|applyUpdate|encodeState/i.test(n)
		);
		expect(incremental).toEqual([]);
	});

	it('replaying a client-to-server message log into a fresh peer reaches the server (unspecified)', () => {
		const md = docMd('Hello world.');
		const seed = parse(md).save(BODY);
		const make = (actor?: string) => {
			const d = parse(md);
			d.load(BODY, seed);
			return peer(actor ?? 'srv', d, actor);
		};
		const [a, b, server] = [make('pa'), make('pb'), make()];
		const inbound: Uint8Array[] = [];
		const toServer = (c: Peer) => {
			for (;;) {
				const m = c.doc.generateSyncMessage(BODY, state(c, server));
				if (m) {
					inbound.push(m);
					server.doc.receiveSyncMessage(BODY, state(server, c), m);
				}
				const n = server.doc.generateSyncMessage(BODY, state(server, c));
				if (n) c.doc.receiveSyncMessage(BODY, state(c, server), n);
				if (!m && !n) return;
			}
		};
		for (let i = 0; i < 4; i++) {
			typeAt(a, BODY, 0, `a${i}`);
			toServer(a);
			typeAt(b, BODY, b.doc.read(BODY).text.length - 1, `b${i}`);
			toServer(b);
		}
		const late = make('pc');
		const s = core.Document.syncState();
		for (const m of inbound) late.doc.receiveSyncMessage(BODY, s, m);
		expect(late.doc.read(BODY).text).toBe(server.doc.read(BODY).text);
	});

	it('two saves merge only through two scratch Documents synced together', () => {
		const md = docMd('Hello world.');
		const seed = parse(md).save(BODY);
		const edited = (actor: string, at: number, t: string) => {
			const d = parse(md);
			d.load(BODY, seed);
			d.apply(BODY, { steps: [{ splice: { at, insert: t } }] }, { actor });
			return d.save(BODY);
		};
		const x = edited('px', 0, 'X');
		const y = edited('py', 5, 'Y');
		const m1 = parse(md);
		m1.load(BODY, x);
		const m2 = parse(md);
		m2.load(BODY, y);
		settle([peer('m1', m1), peer('m2', m2)], BODY);
		expect(m1.read(BODY).text).toBe('XHelloY world.');
	});

	it('load replaces: a local edit not yet synced is lost when another save loads over it', () => {
		const ps = peers(2, () => parse(docMd('Hello world.')));
		typeAt(ps[0], BODY, 0, 'A');
		typeAt(ps[1], BODY, 5, 'B');
		ps[0].doc.load(BODY, ps[1].doc.save(BODY));
		expect(ps[0].doc.read(BODY).text).toBe('HelloB world.');
	});
});

describe('save and reload mid-session', () => {
	it('a row and its saves reload, and the peer keeps syncing', () => {
		const ps = peers(2, () => parse(MD));
		typeAt(ps[0], BODY, 0, 'A');
		settle(ps, BODY);
		const row = ps[0].doc.toStored();
		const bytes = ps[0].doc.save(BODY);
		const back = core.Document.fromStored(row);
		back.load(BODY, bytes);
		const r = peer('p0-back', back, 'peer0');
		typeAt(r, BODY, 0, 'R');
		typeAt(ps[1], BODY, 3, 'S');
		settle([r, ps[1]], BODY);
		converged([r, ps[1]], [BODY]);
	});

	// GAP: the stored row alone does not rejoin. A Document from `fromStored` builds its live
	// document from the value under the shared no-actor id, which collides with the build every
	// peer made from the seed value.
	it.fails('GAP: a peer reloaded from the stored row alone rejoins the session', () => {
		const ps = peers(2, () => parse(MD));
		typeAt(ps[0], BODY, 0, 'A');
		settle(ps, BODY);
		const back = peer('p0-back', core.Document.fromStored(ps[0].doc.toStored()), 'peer0b');
		typeAt(back, BODY, 0, 'F');
		typeAt(ps[1], BODY, 0, 'G');
		settle([back, ps[1]], BODY);
		converged([back, ps[1]], [BODY]);
	});

	it('the live document survives clone()', () => {
		const ps = peers(2, () => parse(MD));
		typeAt(ps[0], BODY, 0, 'A');
		settle(ps, BODY);
		const c = ps[1].doc.clone();
		expect(Buffer.from(c.save(BODY)).equals(Buffer.from(ps[1].doc.save(BODY)))).toBe(true);
	});
});

describe('a peer joining late', () => {
	it('from the seed, one sync with any peer brings it level', () => {
		const origin = parse(MD);
		const row = origin.toStored();
		const seed = origin.save(BODY);
		const make = (name: string, actor: string) => {
			const d = core.Document.fromStored(row);
			d.load(BODY, seed);
			return peer(name, d, actor);
		};
		const [a, b] = [make('a', 'pa'), make('b', 'pb')];
		for (let i = 0; i < 10; i++) {
			typeAt(a, BODY, 0, `${i}`);
			typeAt(b, BODY, b.doc.read(BODY).text.length, `${i}`);
			settle([a, b], BODY);
		}
		const late = make('late', 'pl');
		settle([late, a], BODY);
		converged([late, a, b], [BODY]);
	});
});

describe('what a session carries besides content values', () => {
	// GAP: the live document is per value. The card list, a card's $kind, and every whole-value
	// field (COLLAB.md's `$cards`, the card maps, `f` values) have no live form and no sync verb.
	it.fails('GAP: a card one peer adds reaches the other through sync', () => {
		const ps = peers(2, () => parse(MD));
		quill().writer(ps[0].doc).addCard('note', {}, 'Added.', undefined, { actor: 'peer0' });
		for (const a of values(ps[0].doc)) settle(ps, a);
		expect(ps[1].doc.cards.length).toBe(ps[0].doc.cards.length);
	});

	it('a message for a card the receiver lacks refuses with edit::unknown_card_id', () => {
		const ps = peers(2, () => parse(MD));
		const id = quill()
			.writer(ps[0].doc)
			.addCard('note', {}, 'Added.', undefined, { actor: 'peer0' }).id;
		expect(code(() => settle(ps, { card: id }))).toBe('edit::unknown_card_id');
	});

	it.fails('GAP: a scalar field one peer sets reaches the other through sync', () => {
		const ps = peers(2, () => parse(MD));
		quill().writer(ps[0].doc).set('status', 'final');
		for (const a of values(ps[0].doc)) settle(ps, a);
		expect(ps[1].doc.getStored('status')).toBe('final');
	});

	it('removing and re-adding a card under its id starts a new live document', () => {
		const ps = peers(2, () => parse(MD));
		const id = ps[0].doc.cards[0].id!;
		typeAt(ps[0], { card: id }, 0, 'A');
		settle(ps, { card: id });
		const card = ps[1].doc.card(0);
		ps[1].doc.removeCard(0);
		ps[1].doc.unchecked.insertCard(card, 0);
		typeAt(ps[1], { card: id }, 0, 'B');
		expect(code(() => settle(ps, { card: id }))).toBe('edit::automerge');
	});
});

const states = new WeakMap<Peer, Map<Peer, ReturnType<typeof core.Document.syncState>>>();
function state(p: Peer, other: Peer) {
	let m = states.get(p);
	if (!m) states.set(p, (m = new Map()));
	let s = m.get(other);
	if (!s) m.set(other, (s = core.Document.syncState()));
	return s;
}

describe('card moves', () => {
	it('moveCard keeps a card body live document', () => {
		const md = docMd(
			'Main.',
			'x',
			'\n~~~\n$kind: note\n~~~\n\nOne.\n\n~~~\n$kind: note\n~~~\n\nTwo.\n'
		);
		const ps = peers(2, () => parse(md));
		const id = ps[0].doc.cards[1].id!;
		typeAt(ps[0], { card: id }, 0, 'A');
		settle(ps, { card: id });
		ps[1].doc.moveCard(1, 0);
		typeAt(ps[1], { card: id }, 0, 'B');
		settle(ps, { card: id });
		expect(ps[0].doc.read({ card: id }).text).toBe('BATwo.');
	});
});

describe('routing', () => {
	// GAP: a sync message names no value, and every value built from equal content shares one
	// Automerge history (the build under the no-actor id), so a message a host routes to the wrong
	// address merges silently into another field.
	it.fails('GAP: a message for one field delivered at another, equal-valued one is refused', () => {
		const md = docMd('Body.', '').replace('title: T', 'title: ""');
		const [a, b] = peers(2, () => parse(md));
		const title = { field: 'title' };
		typeAt(a, title, 0, 'Title typed');
		const sa = core.Document.syncState();
		const sb = core.Document.syncState();
		for (let i = 0; i < 6; i++) {
			const m = a.doc.generateSyncMessage(title, sa);
			if (m) b.doc.receiveSyncMessage(ABSTRACT, sb, m);
			const n = b.doc.generateSyncMessage(ABSTRACT, sb);
			if (n) a.doc.receiveSyncMessage(title, sa, n);
		}
		expect(b.doc.read(ABSTRACT).text).toBe('');
	});
});
