// Probe 4: a writer that reads, waits while two peers edit, and writes from what it read:
// `writer.revise` under `baseHash` or `baseContent`, and `apply` under `base`.
import { describe, expect, it } from 'vitest';
import type { Content } from '@quillmark/wasm';
import {
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
	write,
	type Peer
} from './helpers.js';

const MD = docMd('First para here.\n\nSecond para here.\n\nThird para.');

function snapshot(p: Peer): { hash: string; md: string; content: Content; bytes: Uint8Array } {
	return {
		hash: p.doc.hash(BODY),
		md: p.doc.toMarkdown(BODY, { annotated: true }).markdown,
		content: p.doc.read(BODY),
		bytes: p.doc.save(BODY)
	};
}

function session(): { ps: Peer[]; snap: ReturnType<typeof snapshot> } {
	const ps = peers(2, () => parse(MD));
	typeAt(ps[0], BODY, 0, '');
	const snap = snapshot(ps[0]);
	typeAt(ps[0], BODY, 0, 'A: ');
	typeAt(ps[1], BODY, ps[1].doc.read(BODY).text.indexOf('Third'), 'B: ');
	settle(ps, BODY);
	return { ps, snap };
}

describe('a late writer in a peer that holds the history', () => {
	it('writer.revise under baseHash rebases over both peers and syncs', () => {
		const { ps, snap } = session();
		const r = quill()
			.writer(ps[0].doc)
			.revise(BODY, snap.md.replace('Second para here.', 'Second paragraph, revised.'), {
				baseHash: snap.hash
			});
		expect(r.rebased).toBe(true);
		settle(ps, BODY);
		const { values } = converged(ps, [BODY]);
		expect(values[0].text).toBe('A: First para here.\nSecond paragraph, revised.\nB: Third para.');
	});

	it('a revise that rewords a paragraph replaces its block record, minting a positional id', () => {
		const { ps, snap } = session();
		const id = ps[0].doc.read(BODY).blocks[1].id;
		quill()
			.writer(ps[0].doc)
			.revise(BODY, snap.md.replace('Second para here.', 'Second paragraph, revised.'), {
				baseHash: snap.hash
			});
		const after = ps[0].doc.read(BODY).blocks[1].id;
		expect(after).not.toBe(id);
		expect(after).not.toContain(':');
	});

	it('text a peer typed inside the span the late writer rewrote interleaves, unreported', () => {
		const ps = peers(2, () => parse(MD));
		typeAt(ps[0], BODY, 0, '');
		const snap = snapshot(ps[0]);
		typeAt(ps[1], BODY, ps[1].doc.read(BODY).text.indexOf('para here.\nThird'), 'TYPED ');
		settle(ps, BODY);
		const r = quill()
			.writer(ps[0].doc)
			.revise(BODY, snap.md.replace('Second para here.', 'Something else entirely.'), {
				baseHash: snap.hash
			});
		settle(ps, BODY);
		const { values } = converged(ps, [BODY]);
		expect(r.rebased).toBe(true);
		expect(Object.keys(r)).not.toContain('conflicts');
		expect(values[0].text.split('\n')[1]).toContain('TYPED');
	});

	it('a setBlock against a block re-kinded since refuses with edit::rebase_conflict', () => {
		const ps = peers(2, () => parse(MD));
		typeAt(ps[0], BODY, 0, '');
		const hash = ps[0].doc.hash(BODY);
		const id = ps[0].doc.read(BODY).blocks[1].id;
		write(ps[1], BODY, { steps: [{ setBlock: { id, kind: 'heading', attrs: { level: 2 } } }] });
		settle(ps, BODY);
		expect(
			code(() =>
				ps[0].doc.apply(
					BODY,
					{ steps: [{ setBlock: { id, kind: 'code' } }] },
					{ base: hash, actor: ps[0].actor }
				)
			)
		).toBe('edit::rebase_conflict');
	});

	it('apply under a stale base rebases a splice over a concurrent one', () => {
		const ps = peers(2, () => parse(MD));
		typeAt(ps[1], BODY, 0, '');
		const hash = ps[1].doc.hash(BODY);
		typeAt(ps[0], BODY, 0, 'Z');
		settle(ps, BODY);
		const r = ps[1].doc.apply(
			BODY,
			{ steps: [{ splice: { at: 0, delete: 'First', insert: 'Prime' } }] },
			{ base: hash, actor: ps[1].actor }
		);
		expect(r.rebased).toBe(true);
		settle(ps, BODY);
		// Two inserts at one place interleave as Automerge orders their actors.
		expect(['ZPrime para here.', 'PrimeZ para here.']).toContain(
			converged(ps, [BODY]).values[0].text.split('\n')[0]
		);
	});
});

describe('a late writer in another process', () => {
	it('a baseHash read before the server loaded the bytes is stale', () => {
		const { ps, snap } = session();
		const server = core.Document.fromStored(ps[0].doc.toStored());
		server.load(BODY, ps[0].doc.save(BODY));
		expect(
			code(() =>
				quill()
					.writer(server)
					.revise(BODY, snap.md.replace('Third', 'Last'), { baseHash: snap.hash })
			)
		).toBe('edit::stale_base');
	});

	it('a write made on the snapshot bytes and synced is a concurrent edit (writeFrom over save)', () => {
		const { ps, snap } = session();
		const scratch = core.Document.fromStored(ps[0].doc.toStored());
		scratch.load(BODY, snap.bytes);
		expect(scratch.read(BODY)).toEqual(snap.content);
		const r = scratch.apply(
			BODY,
			{ steps: [{ splice: { at: 0, delete: 'First', insert: 'Prime' } }] },
			{ base: snap.hash, actor: 'srv' }
		);
		expect(r.rebased).toBe(false);
		const all = [
			...ps,
			{ ...ps[0], name: 'srv', doc: scratch, actor: 'srv', states: new Map(), receipts: [] }
		];
		settle(all, BODY);
		expect(['A: Prime para here.', 'PrimeA:  para here.']).toContain(
			converged(all, [BODY]).values[0].text.split('\n')[0]
		);
	});

	it('writer.revise under baseContent rebases on a server and syncs back', () => {
		const { ps, snap } = session();
		const server = core.Document.fromStored(ps[0].doc.toStored());
		server.load(BODY, ps[0].doc.save(BODY));
		const r = quill()
			.writer(server)
			.revise(BODY, snap.md.replace('Third para.', 'Third para, by the server.'), {
				baseContent: snap.content
			});
		expect(r.rebased).toBe(true);
		const all = [
			...ps,
			{ ...ps[0], name: 'srv', doc: server, actor: 'srv', states: new Map(), receipts: [] }
		];
		settle(all, BODY);
		expect(converged(all, [BODY]).values[0].text).toBe(
			'A: First para here.\nSecond para here.\nB: Third para, by the server.'
		);
	});

	// GAP: `apply`'s `base` is a hash alone; a structured Change from a process that did not
	// take the writes since has no `baseContent` form.
	it.fails('GAP: apply takes the value it read as its base', () => {
		const { ps, snap } = session();
		const server = core.Document.fromStored(ps[0].doc.toStored());
		server.load(BODY, ps[0].doc.save(BODY));
		server.apply(BODY, { steps: [{ splice: { at: 0, delete: 'First', insert: 'Prime' } }] }, {
			baseContent: snap.content
		} as never);
		expect(server.read(BODY).text.startsWith('A: Prime')).toBe(true);
	});
});
