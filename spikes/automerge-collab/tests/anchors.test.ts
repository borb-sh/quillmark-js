// Probe 3: comment anchors and `x-` marks through sync.
import { describe, expect, it } from 'vitest';
import {
	BODY,
	converged,
	deleteAt,
	docMd,
	parse,
	peers,
	settle,
	typeAt,
	write
} from './helpers.js';

describe('anchors across sync', () => {
	it('an anchor placed on one peer reaches the other', () => {
		const ps = peers(2, () => parse(docMd('Hello wonderful world.')));
		write(ps[0], BODY, { steps: [{ anchor: { id: 'c-1', start: 6, end: 15 } }] });
		settle(ps, BODY);
		converged(ps, [BODY]);
		expect(ps[1].doc.read(BODY).anchors).toEqual([{ id: 'c-1', start: 6, end: 15 }]);
		expect(ps[1].doc.anchorContext('c-1')?.quote).toBe('wonderful');
	});

	it('an anchor on text one peer deletes: which receipt names it', () => {
		const ps = peers(2, () => parse(docMd('Hello wonderful world.')));
		const [a, b] = ps;
		write(a, BODY, { steps: [{ anchor: { id: 'c-1', start: 6, end: 15 } }] });
		settle(ps, BODY);
		a.receipts.length = 0;
		b.receipts.length = 0;
		const local = deleteAt(b, BODY, 5, 15);
		expect(local.droppedAnchors.map((d) => d.id)).toEqual(['c-1']);
		settle(ps, BODY);
		converged(ps, [BODY]);
		const remote = a.receipts.flatMap((r) => r.droppedAnchors.map((d) => d.id));
		expect(remote).toEqual(['c-1']);
		expect(a.doc.read(BODY).anchors ?? []).toEqual([]);
	});

	it('an anchor placed concurrently with the deletion of its text', () => {
		const ps = peers(2, () => parse(docMd('Hello wonderful world.')));
		const [a, b] = ps;
		write(a, BODY, { steps: [{ anchor: { id: 'c-2', start: 6, end: 15 } }] });
		deleteAt(b, BODY, 5, 15);
		settle(ps, BODY);
		converged(ps, [BODY]);
		const dropped = (p: typeof a) => p.receipts.flatMap((r) => r.droppedAnchors.map((d) => d.id));
		// a placed it and the merge left it nowhere; b never held it.
		expect({ a: dropped(a), b: dropped(b) }).toEqual({ a: ['c-2'], b: [] });
	});

	it('an anchor survives a concurrent insert inside it and moves', () => {
		const ps = peers(2, () => parse(docMd('Hello wonderful world.')));
		const [a, b] = ps;
		write(a, BODY, { steps: [{ anchor: { id: 'c-3', start: 6, end: 15 } }] });
		settle(ps, BODY);
		typeAt(b, BODY, 0, 'Oh. ');
		typeAt(a, BODY, 10, 'der');
		settle(ps, BODY);
		converged(ps, [BODY]);
		expect(a.doc.anchorContext('c-3')?.quote).toBe('wonddererful');
	});

	it('a point anchor survives sync', () => {
		const ps = peers(2, () => parse(docMd('Hello world.')));
		write(ps[0], BODY, { steps: [{ anchor: { id: 'c-p', start: 5, end: 5 } }] });
		typeAt(ps[1], BODY, 5, ',');
		settle(ps, BODY);
		converged(ps, [BODY]);
		expect(ps[0].doc.read(BODY).anchors).toEqual([{ id: 'c-p', start: 5, end: 5 }]);
	});

	it('two peers placing one anchor id concurrently', () => {
		const ps = peers(2, () => parse(docMd('Hello wonderful world.')));
		write(ps[0], BODY, { steps: [{ anchor: { id: 'c-dup', start: 0, end: 5 } }] });
		write(ps[1], BODY, { steps: [{ anchor: { id: 'c-dup', start: 16, end: 21 } }] });
		settle(ps, BODY);
		const { values } = converged(ps, [BODY]);
		expect(values[0].anchors?.filter((x) => x.id === 'c-dup')).toHaveLength(1);
	});
});

describe('x- marks across sync', () => {
	it('an x- mark survives sync and a concurrent edit beside it', () => {
		const ps = peers(2, () => parse(docMd('Hello world.')));
		write(ps[0], BODY, {
			steps: [{ mark: { start: 0, end: 5, type: 'x-hl', attrs: { color: 'y' }, add: true } }]
		});
		typeAt(ps[1], BODY, 11, '!');
		settle(ps, BODY);
		const { values } = converged(ps, [BODY]);
		expect(values[0].marks).toEqual([{ start: 0, end: 5, type: 'x-hl', attrs: { color: 'y' } }]);
	});

	it('an x- block kind and an x- island survive sync', () => {
		const ps = peers(2, () => parse(docMd('Hello world.\n\nTwo.')));
		const c = ps[0].doc.read(BODY);
		write(ps[0], BODY, {
			steps: [
				{ setBlock: { id: c.blocks[1].id, kind: 'x-callout', attrs: { tone: 'warn' } } },
				{
					island: {
						at: 5,
						island: { id: '?i', type: 'x-chip', props: { v: 1 } },
						block: c.blocks[0].id
					}
				}
			]
		});
		typeAt(ps[1], BODY, 0, '>');
		settle(ps, BODY);
		const { values } = converged(ps, [BODY]);
		expect(values[0].blocks[1].kind).toBe('x-callout');
		expect(values[0].islands?.[0].type).toBe('x-chip');
	});
});
