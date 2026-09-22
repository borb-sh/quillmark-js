// address.ts: the one hop between the `DocPath` grammar and the `Addr` the document
// verbs take, both directions. Pure address math, no document and no surface.
import { describe, it, expect } from 'vitest';
import { fieldPathForAddr, addrForFieldPath } from '$lib/core';
// Not on `/core`'s entry: the nested split is the editor's ladder, not a hop a host
// needs (`core/index.ts` carries what more than one surface speaks).
import { nestedAddrForFieldPath, nearestAddrForFieldPath } from '$lib/core/address.js';
import { cardPath } from '$lib/core/address.js';

describe('fieldPathForAddr', () => {
	it('maps the main body and main fields', () => {
		expect(fieldPathForAddr({}, [])).toBe('main.body');
		expect(fieldPathForAddr({ field: 'subject' }, [])).toBe('main.subject');
	});

	it('maps a card body and card field by ABSOLUTE document index', () => {
		const kinds = ['indorsement', 'indorsement'];
		expect(fieldPathForAddr({ card: 0 }, kinds)).toBe('cards.indorsement[0].body');
		expect(fieldPathForAddr({ card: 1 }, kinds)).toBe('cards.indorsement[1].body');
		expect(fieldPathForAddr({ card: 1, field: 'from' }, kinds)).toBe('cards.indorsement[1].from');
	});

	it('addresses by absolute index across interleaved kinds — no per-kind counting', () => {
		const kinds = ['note', 'indorsement', 'note', 'indorsement'];
		// The 2nd indorsement sits at absolute index 3 and is addressed as [3].
		expect(fieldPathForAddr({ card: 3, field: 'from' }, kinds)).toBe('cards.indorsement[3].from');
		expect(fieldPathForAddr({ card: 2 }, kinds)).toBe('cards.note[2].body');
	});

	it('uses the unknown-kind form (cards[i]) for a blank kind', () => {
		expect(fieldPathForAddr({ card: 0, field: 'from' }, [''])).toBe('cards[0].from');
	});

	it('drops an out-of-range or malformed card index', () => {
		expect(fieldPathForAddr({ card: 5 }, ['indorsement'])).toBeUndefined();
		expect(fieldPathForAddr({ card: -1 }, ['indorsement'])).toBeUndefined();
	});
});

describe('cardPath', () => {
	it('names the CARD, not the body leaf inside it', () => {
		const kinds = ['note', 'indorsement'];
		expect(cardPath(1, kinds)).toBe('cards.indorsement[1]');
		// The distinction the structure lane rides: a card op is about the card.
		expect(fieldPathForAddr({ card: 1 }, kinds)).toBe('cards.indorsement[1].body');
	});

	it('uses the unknown-kind form, and drops an out-of-range index', () => {
		expect(cardPath(0, [''])).toBe('cards[0]');
		expect(cardPath(2, ['note'])).toBeUndefined();
	});
});

describe('addrForFieldPath', () => {
	it('maps main and card paths back to the mutator currency', () => {
		expect(addrForFieldPath('main.body')).toEqual({});
		expect(addrForFieldPath('main.subject')).toEqual({ field: 'subject' });
		expect(addrForFieldPath('cards.indorsement[1].from')).toEqual({ card: 1, field: 'from' });
	});

	it('lands a bare card and a .body terminal on the same field-less addr', () => {
		expect(addrForFieldPath('cards.indorsement[2]')).toEqual({ card: 2 });
		expect(addrForFieldPath('cards.indorsement[2].body')).toEqual({ card: 2 });
	});

	it('reads the unknown-kind card form', () => {
		expect(addrForFieldPath('cards[1].from')).toEqual({ card: 1, field: 'from' });
	});

	it('rejects a path that names no single commit address', () => {
		// A nested / array-element path, a field-rooted one, and a malformed one.
		expect(addrForFieldPath('main.keywords.0')).toBeUndefined();
		expect(addrForFieldPath('recipients[0].name')).toBeUndefined();
		expect(addrForFieldPath('')).toBeUndefined();
		expect(addrForFieldPath('cards.indorsement[x].from')).toBeUndefined();
		expect(addrForFieldPath('cards.indorsement[-1].from')).toBeUndefined();
	});

	it('round-trips every routable address', () => {
		const kinds = ['note', 'indorsement', 'indorsement'];
		for (const addr of [{}, { field: 'subject' }, { card: 1, field: 'from' }, { card: 2 }]) {
			const path = fieldPathForAddr(addr, kinds);
			expect(path).toBeDefined();
			expect(addrForFieldPath(path!)).toEqual(addr);
		}
		// And the card form, whose inverse is the field-less addr.
		expect(addrForFieldPath(cardPath(1, kinds)!)).toEqual({ card: 1 });
	});
});

describe('nestedAddrForFieldPath', () => {
	it('reads the bracketed index the boundary emits, as a numeric step', () => {
		expect(nestedAddrForFieldPath('main.keywords[0]')).toEqual({
			field: { field: 'keywords' },
			steps: [0]
		});
		expect(nestedAddrForFieldPath('cards.indorsement[1].signature_block[2]')).toEqual({
			field: { card: 1, field: 'signature_block' },
			steps: [2]
		});
	});

	it('reads a property path as a string step, and a mixed path rung by rung', () => {
		// The `PathStep[]` grammar `reader.getContentAt` walks: an index a number, a key a
		// string, in the order the address spells them.
		expect(nestedAddrForFieldPath('main.contact.email')).toEqual({
			field: { field: 'contact' },
			steps: ['email']
		});
		expect(nestedAddrForFieldPath('main.vectors[0].tours[2].title')).toEqual({
			field: { field: 'vectors' },
			steps: [0, 'tours', 2, 'title']
		});
		expect(nestedAddrForFieldPath('main.checks.fonts.note')).toEqual({
			field: { field: 'checks' },
			steps: ['fonts', 'note']
		});
	});

	it('reads a dotted trailing digit as a key, never as an index', () => {
		// The grammar spells an index bracketed; a dotted digit is a property name the
		// schema check downstream will refuse.
		expect(nestedAddrForFieldPath('main.keywords.0')).toEqual({
			field: { field: 'keywords' },
			steps: ['0']
		});
	});

	it('answers nothing for a path with no steps past a field', () => {
		// A whole field, a card and a body are `addrForFieldPath`'s. Whether the schema
		// declares each step is the caller's guard: this module holds the grammar and no
		// schema.
		expect(nestedAddrForFieldPath('main.keywords')).toBeUndefined();
		expect(nestedAddrForFieldPath('main.body')).toBeUndefined();
		expect(nestedAddrForFieldPath('cards.indorsement[1]')).toBeUndefined();
		expect(nestedAddrForFieldPath('')).toBeUndefined();
		expect(nestedAddrForFieldPath('cards.indorsement[x].from.a')).toBeUndefined();
	});
});

describe('nearestAddrForFieldPath', () => {
	it('is `addrForFieldPath` wherever the path names a commit address', () => {
		for (const path of [
			'main.body',
			'main.subject',
			'cards.indorsement[1].from',
			'cards.indorsement[1].body',
			'cards.indorsement[1]'
		]) {
			expect(nearestAddrForFieldPath(path)).toEqual(addrForFieldPath(path));
		}
	});

	it('truncates an object property and an array element to their field', () => {
		expect(nearestAddrForFieldPath('main.contact.email')).toEqual({ field: 'contact' });
		// A variant cell reads the same way: the container commits whole, so the field
		// that draws the cell is the address a click or a diagnostic on it lands.
		expect(nearestAddrForFieldPath('main.handling.controlled_by')).toEqual({
			field: 'handling'
		});
		expect(nearestAddrForFieldPath('main.keywords[0]')).toEqual({ field: 'keywords' });
		expect(nearestAddrForFieldPath('cards.indorsement[1].contact.email')).toEqual({
			card: 1,
			field: 'contact'
		});
		expect(nearestAddrForFieldPath('cards.indorsement[1].refs[2].title')).toEqual({
			card: 1,
			field: 'refs'
		});
	});

	it('truncates to the top-level field however deep the leaf sits', () => {
		expect(nearestAddrForFieldPath('main.a.b.c.d')).toEqual({ field: 'a' });
		expect(nearestAddrForFieldPath('main.rows[0].cells[1].text')).toEqual({ field: 'rows' });
	});

	it('does not read an index under a root as a field', () => {
		// Unmintable for a document — the engine emits a field segment before any index
		// — and the two segments name nothing, so it drops instead of landing on a body.
		expect(nearestAddrForFieldPath('main[0]')).toBeUndefined();
		expect(nearestAddrForFieldPath('cards.indorsement[1][0]')).toBeUndefined();
	});

	it('drops a path with no addressable prefix at all', () => {
		// Field-rooted (config-space) and malformed: the root itself is unnameable, so
		// there is nothing to truncate to.
		expect(nearestAddrForFieldPath('recipients[0].name')).toBeUndefined();
		expect(nearestAddrForFieldPath('')).toBeUndefined();
		expect(nearestAddrForFieldPath('cards.indorsement[x].from')).toBeUndefined();
	});

	it('keeps an out-of-range card index rather than truncating it away', () => {
		// Staleness is `resolveCardKey`'s to catch against the live `cardIds`; dropping
		// the index here would route a dead card's error onto the main card.
		expect(nearestAddrForFieldPath('cards.indorsement[9].contact.email')).toEqual({
			card: 9,
			field: 'contact'
		});
	});
});
