// A field proposal as the runs its row draws: what it keeps, strikes and tints.
import { describe, expect, it } from 'vitest';
import { reviewRuns, type ReviewRun } from '../../src/lib/visual/review.js';

const words = { on: 'On', off: 'Off' };
const show = (runs: ReviewRun[]): string =>
	runs
		.map((r) => (r.kind === 'del' ? `-[${r.text}]` : r.kind === 'ins' ? `+[${r.text}]` : r.text))
		.join('');

describe('reviewRuns', () => {
	it('keeps the members of a list both hold, and strikes and tints the rest', () => {
		expect(show(reviewRuns(['Ann', 'Bo', 'Cy'], ['Ann', 'Di', 'Cy', 'Ed'], words))).toBe(
			'Ann, -[Bo], +[Di], Cy, +[Ed]'
		);
	});

	it('shows only the records of a list that differ, and only their keys that differ', () => {
		const was = [
			{ name: 'Ann', rank: 'Maj', unit: 'A' },
			{ name: 'Bo', rank: 'Capt', unit: 'B' },
			{ name: 'Cy', rank: 'Lt', unit: 'C' }
		];
		const now = [
			was[0],
			{ name: 'Bo', rank: 'Maj', unit: 'B' },
			{ name: 'Di', rank: 'Lt', unit: 'D' }
		];
		expect(show(reviewRuns(was, now, words))).toBe(
			'Bo (rank: -[Capt]+[Maj]), name: -[Cy]+[Di]; unit: -[C]+[D]'
		);
	});

	it('strikes a record a list drops and tints one it gains, whole', () => {
		const ann = { name: 'Ann', rank: 'Maj' };
		expect(show(reviewRuns([ann], [ann, { name: 'Bo', rank: 'Capt' }], words))).toBe(
			'+[name: Bo; rank: Capt]'
		);
		expect(show(reviewRuns([ann, { name: 'Bo' }], [ann], words))).toBe('-[name: Bo]');
	});

	it('shows a record field by the keys that differ', () => {
		expect(
			show(reviewRuns({ to: 'HQ', via: 'Ops' }, { to: 'HQ', via: 'J3', cc: 'J6' }, words))
		).toBe('via: -[Ops]+[J3]; cc: +[J6]');
	});

	it('differs two lines of words by their words, and anything else whole', () => {
		expect(show(reviewRuns('the red fox', 'the quick fox', words))).toBe('the -[red]+[quick] fox');
		expect(show(reviewRuns(true, false, words))).toBe('-[On]+[Off]');
		expect(show(reviewRuns([], ['Ann'], words))).toBe('+[Ann]');
	});
});
