// Where a nested proposal lands in a field's value, and the value it writes there.
import { describe, it, expect } from 'vitest';
import { locate, valueIn, valueWith, type FieldProposal } from '$lib/visual/review';

const proposal = (before?: unknown): FieldProposal =>
	before === undefined
		? { id: 'p', field: 'main.list[0]' }
		: { id: 'p', field: 'main.list[0]', before };

describe('a value at a place', () => {
	it('is read and written by steps, a member past the end appended and one set to nothing taken out', () => {
		const value = { rows: ['a', 'b'], who: { name: 'Ada' } };
		expect(valueIn(value, ['who', 'name'])).toBe('Ada');
		expect(valueWith(value, ['rows', 5], 'c')).toEqual({
			rows: ['a', 'b', 'c'],
			who: { name: 'Ada' }
		});
		expect(valueWith(value, ['rows', 0], undefined)).toEqual({ rows: ['b'], who: { name: 'Ada' } });
		expect(valueWith(value, ['who', 'name'], undefined)).toEqual({ rows: ['a', 'b'], who: {} });
		expect(value).toEqual({ rows: ['a', 'b'], who: { name: 'Ada' } });
	});
});

describe('a member a proposal read', () => {
	it('is found at its index, else at the nearest index holding it', () => {
		expect(locate(['a', 'b', 'c'], [1], proposal('b'), new Set())).toEqual({
			steps: [1],
			found: true
		});
		expect(locate(['b', 'c'], [1], proposal('b'), new Set())).toEqual({ steps: [0], found: true });
		expect(locate(['a', 'c'], [1], proposal('b'), new Set()).found).toBe(false);
	});

	it('is found from an index past the end of a list that has shortened', () => {
		expect(locate(['b'], [1], proposal('b'), new Set())).toEqual({ steps: [0], found: true });
		expect(locate(['a', 'd'], [3], proposal('a'), new Set())).toEqual({ steps: [0], found: true });
	});

	it('is not one another proposal of the list already holds', () => {
		const claimed = new Set<string>();
		expect(locate(['x', 'x'], [0], proposal('x'), claimed).steps).toEqual([0]);
		expect(locate(['x', 'x'], [0], proposal('x'), claimed).steps).toEqual([1]);
	});

	it('is the index as named where the proposal read nothing there', () => {
		expect(locate(['a'], [1], proposal(), new Set())).toEqual({ steps: [1], found: true });
	});
});
