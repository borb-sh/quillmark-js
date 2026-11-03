// Probe 1: two Documents converge through the sync verbs on a body and on a richtext field, local
// edits through `apply` under distinct actors.
import { describe, expect, it } from 'vitest';
import {
	ABSTRACT,
	BODY,
	core,
	converged,
	docMd,
	parse,
	peers,
	rewrite,
	settle,
	typeAt,
	write
} from './helpers.js';

const MD = docMd('Hello world.\n\nSecond para.\n\n- one\n- two\n');

describe('two peers', () => {
	it('converge on the body from one seed', () => {
		const seed = parse(MD);
		const bytes = seed.save(BODY);
		const [a, b] = peers(2, () => parse(MD));
		a.doc.load(BODY, bytes);
		b.doc.load(BODY, bytes);
		typeAt(a, BODY, 0, 'A ');
		typeAt(b, BODY, 5, ' B');
		settle([a, b], BODY);
		const { values } = converged([a, b], [BODY]);
		expect(values[0].text.startsWith('A Hello B world.')).toBe(true);
	});

	it('converge on a richtext field through diffRange edits', () => {
		const [a, b] = peers(2, () => parse(MD));
		const before = a.doc.read(ABSTRACT);
		rewrite(a, ABSTRACT, { ...before, text: 'Alpha BETA gamma.' }, 6, 10);
		const bb = b.doc.read(ABSTRACT);
		rewrite(b, ABSTRACT, { ...bb, text: 'Alpha beta gamma delta.' }, 16, 16);
		settle([a, b], ABSTRACT);
		const { values } = converged([a, b], [ABSTRACT]);
		expect(values[0].text).toBe('Alpha BETA gamma delta.');
	});

	it('converge on a composable card body named by $id', () => {
		const md = docMd('Main.', 'x', '\n~~~\n$kind: note\n~~~\n\nNote body.\n');
		const [a, b] = peers(2, () => parse(md));
		const card = a.doc.cards[0].id!;
		expect(b.doc.cards[0].id).toBe(card);
		const addr = { card };
		typeAt(a, addr, 0, 'A');
		typeAt(b, addr, 4, 'B');
		settle([a, b], addr);
		converged([a, b], [addr]);
		expect(a.doc.read(addr).text).toBe('ANoteB body.');
	});

	it('converge on a text (plain codec) field', () => {
		const md = MD.replace('title: T', 'title: T\nsubtitle: Plain words here');
		const [a, b] = peers(2, () => parse(md));
		const addr = { field: 'subtitle' };
		expect(a.doc.read(addr).codec).toBe('plain');
		typeAt(a, addr, 0, 'A ');
		typeAt(b, addr, 5, ' B');
		settle([a, b], addr);
		const { values } = converged([a, b], [addr]);
		expect(values[0].text).toBe('A Plain B words here');
	});

	it('converge with no seed: two peers that built their live documents from one value apart', () => {
		const [a, b] = peers(2, () => parse(MD));
		typeAt(a, BODY, 0, 'A');
		typeAt(b, BODY, 5, 'B');
		settle([a, b], BODY);
		converged([a, b], [BODY]);
		expect(a.doc.read(BODY).text.startsWith('AHelloB world.')).toBe(true);
	});

	it('a split and a type on one block from distinct actors', () => {
		const [a, b] = peers(2, () => parse(MD));
		a.doc.splitBlock(BODY, 5, { base: a.doc.hash(BODY), actor: a.actor });
		typeAt(b, BODY, 6, 'big ');
		settle([a, b], BODY);
		const { values } = converged([a, b], [BODY]);
		expect(values[0].text.startsWith('Hello\n big world.')).toBe(true);
	});

	it('a receive receipt carries the remote change', () => {
		const [a, b] = peers(2, () => parse(MD));
		const before = b.doc.read(BODY);
		typeAt(a, BODY, 0, 'XYZ');
		settle([a, b], BODY);
		const applied = b.receipts.filter((r) => r.applied.steps.length);
		expect(applied).toHaveLength(1);
		const undone = core.invert(applied[0].applied, before);
		expect(b.doc.apply(BODY, undone, { base: b.doc.hash(BODY), actor: b.actor }).hash).toBe(
			parse(MD).hash(BODY)
		);
	});

	// GAP: the receipt's `applied` is a word diff of before and after (`delete: "Hello", insert:
	// "XYZHello"`), not the merge's own splice, so a caret inside the word maps to the word's end.
	it.fails('GAP: a caret inside a word maps through a remote insert ahead of it', () => {
		const [a, b] = peers(2, () => parse(MD));
		typeAt(a, BODY, 0, 'XYZ');
		settle([a, b], BODY);
		const applied = b.receipts.filter((r) => r.applied.steps.length);
		expect(applied).toHaveLength(1);
		expect(core.mapPos(applied[0].applied, 3).pos).toBe(6);
	});
});
