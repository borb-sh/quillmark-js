// Probe 7: what an actor is to the sync, and what breaks without one. Every write that names no
// actor, the typed writer's included, writes under one shared Automerge actor.
import { describe, expect, it } from 'vitest';
import {
	ABSTRACT,
	BODY,
	code,
	core,
	docMd,
	parse,
	peers,
	quill,
	settle,
	typeAt,
	type Peer
} from './helpers.js';

const MD = docMd('Hello world.\n\nTwo.');

function concurrent(ps: Peer[]): string | undefined {
	typeAt(ps[0], BODY, 0, 'A');
	typeAt(ps[1], BODY, 5, 'B');
	return code(() => settle(ps, BODY));
}

describe('actors', () => {
	it('two peers writing under no actor: the receiver refuses with edit::automerge', () => {
		expect(concurrent(peers(2, () => parse(MD), [undefined, undefined]))).toBe('edit::automerge');
	});

	it('two peers under one actor: edit::automerge', () => {
		expect(concurrent(peers(2, () => parse(MD), ['same', 'same']))).toBe('edit::automerge');
	});

	it('one peer under an actor and one under none converge', () => {
		expect(concurrent(peers(2, () => parse(MD), ['x', undefined]))).toBeUndefined();
	});

	it('an invalid actor refuses with edit::invalid_actor', () => {
		const [p] = peers(1, () => parse(MD), ['a b']);
		expect(code(() => typeAt(p, BODY, 0, 'q'))).toBe('edit::invalid_actor');
	});

	it('once refused, the pair never converges: every later message is refused too', () => {
		const ps = peers(2, () => parse(MD), ['same', 'same']);
		concurrent(ps);
		ps[0].doc.apply(BODY, { steps: [{ splice: { at: 0, insert: 'later' } }] }, { actor: 'fresh0' });
		expect(code(() => settle(ps, BODY))).toBe('edit::automerge');
		expect(ps[0].doc.read(BODY).text).not.toBe(ps[1].doc.read(BODY).text);
	});

	// GAP: the typed writer takes no actor (BINDINGS § "The write surface"), so two clients whose
	// writers revise one value concurrently, a model's write in each tab, both write under the
	// shared no-actor id and the session's sync on that value stops.
	it.fails('GAP: two peers revising one value through quill.writer concurrently still sync', () => {
		const ps = peers(2, () => parse(MD));
		typeAt(ps[0], BODY, 0, 'a');
		settle(ps, BODY);
		quill().writer(ps[0].doc).revise(BODY, 'aHello world!\n\nTwo.');
		quill().writer(ps[1].doc).revise(BODY, 'aHello world.\n\nTwo?');
		settle(ps, BODY);
	});

	// GAP: a typed `set` (or `unchecked.storeField`) of a content field is diffed into the live
	// document under the no-actor id before the next write, so two peers setting one field
	// concurrently break that field's sync the same way.
	it.fails('GAP: two peers each writer.set one richtext field, then sync', () => {
		const ps = peers(2, () => parse(MD));
		typeAt(ps[0], ABSTRACT, 0, 'x');
		settle(ps, ABSTRACT);
		quill().writer(ps[0].doc).set('abstract', 'Set A.');
		quill().writer(ps[1].doc).set('abstract', 'Set B.');
		settle(ps, ABSTRACT);
	});

	it('a writer.set alone reaches the peer through the next sync message', () => {
		const ps = peers(2, () => parse(MD));
		typeAt(ps[0], ABSTRACT, 0, 'x');
		settle(ps, ABSTRACT);
		quill().writer(ps[0].doc).set('abstract', 'Set by writer.');
		settle(ps, ABSTRACT);
		expect(ps[1].doc.read(ABSTRACT).text).toBe('Set by writer.');
	});

	// GAP: an actor is reusable only by a peer whose bytes hold every change it ever sent. A tab
	// that reloads from a save older than its last sent change and keeps its actor reuses a
	// sequence number, and its peers refuse it for good. Nothing reports the hazard at load.
	it.fails('GAP: a peer reloading an older save under its own actor rejoins', () => {
		const ps = peers(2, () => parse(MD));
		typeAt(ps[0], BODY, 0, 'A');
		settle(ps, BODY);
		const old = ps[0].doc.save(BODY);
		const row = ps[0].doc.toStored();
		typeAt(ps[0], BODY, 0, 'B');
		settle(ps, BODY);
		const back = core.Document.fromStored(row);
		back.load(BODY, old);
		const r: Peer = { ...ps[0], name: 'p0-reloaded', doc: back, states: new Map(), receipts: [] };
		typeAt(r, BODY, 0, 'C');
		settle([r, ps[1]], BODY);
	});

	it('a peer reloading its latest save under its own actor rejoins', () => {
		const ps = peers(2, () => parse(MD));
		typeAt(ps[0], BODY, 0, 'A');
		settle(ps, BODY);
		const back = core.Document.fromStored(ps[0].doc.toStored());
		back.load(BODY, ps[0].doc.save(BODY));
		const r: Peer = { ...ps[0], name: 'p0-reloaded', doc: back, states: new Map(), receipts: [] };
		typeAt(r, BODY, 0, 'R');
		settle([r, ps[1]], BODY);
		expect(ps[1].doc.read(BODY).text.startsWith('RAHello')).toBe(true);
	});
});
