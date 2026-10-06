// The add box's search (VISUAL_EDITOR §"The matrix"): which items typed words name
// across the document's checklists, and in what order.
import { describe, it, expect } from 'vitest';
import type { QuillFieldSchema } from '@quillmark/wasm';
import {
	checklistCarries,
	matchScore,
	matchTitle,
	matrixPrinted,
	searchChecklists
} from '$lib/visual/checklists';

describe('matchScore', () => {
	it('names a title by whole words, openings and abbreviations', () => {
		expect(matchScore('flt cc', 'Flight CC')).toBeGreaterThan(0);
		expect(matchScore('joint', 'Joint Staff')).toBeGreaterThan(0);
		expect(matchScore('staff haf', 'HAF Staff')).toBeGreaterThan(0);
		expect(matchScore('exec', 'Exec / Aide / CAG')).toBeGreaterThan(0);
		expect(matchScore('cafe', 'Café')).toBeGreaterThan(0);
	});

	it('names a run of words by their openings run together', () => {
		expect(matchScore('jqo', 'Joint Qualified Officer')).toBeGreaterThan(0);
		expect(matchScore('jq', 'Joint Qualified Officer')).toBeGreaterThan(0);
		expect(matchScore('jq officer', 'Joint Qualified Officer')).toBeGreaterThan(0);
		expect(matchScore('fcc', 'Flight CC')).toBeGreaterThan(0);
		expect(matchScore('sqcc', 'Sq/CC Candidate')).toBeGreaterThan(0);
		expect(matchScore('flightcc', 'Flight CC')).toBeGreaterThan(0);
		expect(matchScore('cyber200', 'Cyber 200')).toBeGreaterThan(0);
	});

	it('takes the stronger claims first, so a short word leaves the whole one its match', () => {
		expect(matchScore('c cc', 'CC Candidate')).toBeGreaterThan(0);
	});

	it('reads any script', () => {
		expect(matchScore('шта', 'Штаб')).toBeGreaterThan(0);
		expect(matchScore('幕僚', '幕僚')).toBeGreaterThan(0);
	});

	it('is strong only where every word is claimed whole or as an opening', () => {
		expect(matchTitle('flight c', 'Flight CC')?.strong).toBe(true);
		expect(matchTitle('flt cc', 'Flight CC')?.strong).toBe(false);
		expect(matchTitle('fcc', 'Flight CC')?.strong).toBe(false);
		expect(matchTitle('wg', 'Wing IG')?.strong).toBe(false);
	});

	it('names nothing a word of the query cannot claim', () => {
		expect(matchScore('flt cc', 'Sq/CC Candidate')).toBe(0);
		expect(matchScore('joint', 'JQO')).toBe(0);
		expect(matchScore('lft', 'Flight')).toBe(0);
		expect(matchScore('', 'Flight')).toBe(0);
		// One title word answers one query word.
		expect(matchScore('cc cc', 'Flight CC')).toBe(0);
	});

	it('ranks a whole word over an opening over an abbreviation, and the title opened first', () => {
		expect(matchScore('ops', 'Ops')).toBeGreaterThan(matchScore('ops', 'Operations'));
		expect(matchScore('op', 'Operations')).toBeGreaterThan(matchScore('ops', 'Operations'));
		expect(matchScore('joint staff', 'Joint Staff')).toBeGreaterThan(
			matchScore('staff joint', 'Joint Staff')
		);
		expect(matchScore('staff', 'Staff')).toBeGreaterThan(
			matchScore('staff', 'Staff Officer Course')
		);
	});
});

describe('searchChecklists', () => {
	const leadership: QuillFieldSchema = {
		type: 'matrix',
		members: { sq_cc: 'Squadron CC', flight_cc: 'Flight CC' }
	};
	const staff: QuillFieldSchema = {
		type: 'matrix',
		members: { haf: 'HAF Staff', joint: 'Joint Staff', jqo: 'JQO' },
		open: true
	};

	it('searches every list, rosters and added items alike, and reads each tick', () => {
		const hits = searchChecklists('cc', [
			{ list: 'staff', schema: staff, value: { wing_cc: { title: 'Wing CC' } } },
			{ list: 'leadership', schema: leadership, value: { flight_cc: true } }
		]);
		expect(hits.map((h) => [h.list, h.id, h.held])).toEqual([
			['staff', 'wing_cc', true],
			['leadership', 'sq_cc', false],
			['leadership', 'flight_cc', true]
		]);
	});

	it('orders by score, a tie keeping the lists and their items in order', () => {
		const hits = searchChecklists('joint', [
			{ list: 'leadership', schema: leadership, value: undefined },
			{ list: 'staff', schema: staff, value: undefined }
		]);
		expect(hits.map((h) => h.title)).toEqual(['Joint Staff']);
		const flt = searchChecklists('flt cc', [
			{ list: 'staff', schema: staff, value: undefined },
			{ list: 'leadership', schema: leadership, value: undefined }
		]);
		expect(flt.map((h) => [h.list, h.title])).toEqual([['leadership', 'Flight CC']]);
	});

	it('caps the results', () => {
		const wide: QuillFieldSchema = {
			type: 'matrix',
			members: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`m${i}`, `Member ${i}`]))
		};
		expect(searchChecklists('member', [{ list: 0, schema: wide, value: undefined }])).toHaveLength(
			8
		);
		expect(
			searchChecklists('member', [{ list: 0, schema: wide, value: undefined }], 3)
		).toHaveLength(3);
	});
});

describe('checklistCarries', () => {
	const staff: QuillFieldSchema = { type: 'matrix', members: { haf: 'HAF Staff' }, open: true };
	const value = { wing_cc: { title: 'Wing CC' } };

	it('reads every item of the list, roster and added alike, case and surrounding space aside', () => {
		expect(checklistCarries(staff, value, 'HAF Staff')).toBe(true);
		expect(checklistCarries(staff, value, 'Wing CC')).toBe(true);
		expect(checklistCarries(staff, value, 'haf staff')).toBe(true);
		expect(checklistCarries(staff, value, '  Wing CC ')).toBe(true);
		expect(checklistCarries(staff, value, 'Wing-CC')).toBe(false);
		expect(checklistCarries(staff, value, 'Wing')).toBe(false);
		expect(checklistCarries(staff, undefined, 'Wing CC')).toBe(false);
	});
});

describe('matrixPrinted', () => {
	it('reads the stored map, else a mapping default', () => {
		const withDefault: QuillFieldSchema = {
			type: 'matrix',
			members: { a: 'A' },
			default: { a: true }
		};
		expect(matrixPrinted(undefined, withDefault)).toEqual({ a: true });
		expect(matrixPrinted({}, withDefault)).toEqual({});
		expect(matrixPrinted(undefined, { type: 'matrix', members: { a: 'A' } })).toBeUndefined();
		expect(matrixPrinted(['a'], withDefault)).toBeUndefined();
	});
});
