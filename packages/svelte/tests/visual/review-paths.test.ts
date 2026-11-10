// Where a nested proposal lands in a field's value, and the value it writes there.
import { describe, it, expect } from 'vitest';
import {
	besideOf,
	locate,
	valueIn,
	valueWith,
	valueWithInserted,
	type FieldProposal
} from '$lib/visual/review';

const proposal = (before?: unknown): FieldProposal =>
	before === undefined
		? { id: 'p', state: 'proposed', field: 'main.list[0]' }
		: { id: 'p', state: 'proposed', field: 'main.list[0]', before };

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
		expect(valueWithInserted(value, ['rows', 1], 'z')).toEqual({
			rows: ['a', 'z', 'b'],
			who: { name: 'Ada' }
		});
		expect(value).toEqual({ rows: ['a', 'b'], who: { name: 'Ada' } });
	});

	it('puts a member back beside the one that stood before it, else the one after', () => {
		const was = ['a', 'b', 'c', 'd'];
		expect(besideOf(was, [0])).toEqual({ after: { member: 'b' } });
		expect(valueWithInserted(['c', 'd'], [2], 'b', besideOf(was, [1]))).toEqual(['b', 'c', 'd']);
		expect(valueWithInserted(['b', 'c'], [0], 'a', besideOf(was, [0]))).toEqual(['a', 'b', 'c']);
		expect(valueWithInserted(['x'], [1], 'b', besideOf(was, [1]))).toEqual(['x', 'b']);
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

	it('is not one another proposal of the list already holds', () => {
		const claimed = new Set<string>();
		expect(locate(['x', 'x'], [0], proposal('x'), claimed).steps).toEqual([0]);
		expect(locate(['x', 'x'], [0], proposal('x'), claimed).steps).toEqual([1]);
	});

	it('is the index as named where the proposal read nothing there', () => {
		expect(locate(['a'], [1], proposal(), new Set())).toEqual({ steps: [1], found: true });
	});
});
