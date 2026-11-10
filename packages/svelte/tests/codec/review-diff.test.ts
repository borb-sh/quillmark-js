// The word diff a proposal draws: every hunk list takes its first line to its second, a changed
// word differs whole, and neighbouring changes read as one phrase.
import { describe, it, expect } from 'vitest';
import { wordDiff, type DiffHunk } from '$lib/core/codec/review-diff.js';
import { HARD_BREAK } from '$lib/core/codec/islands.js';

/** `before` with `hunks` applied. */
function patched(before: string, hunks: DiffHunk[]): string {
	let out = '';
	let at = 0;
	for (const hunk of hunks) {
		out += before.slice(at, hunk.at) + hunk.insert;
		at = hunk.end;
	}
	return out + before.slice(at);
}

/** What `hunks` take out of `before`, a piece a hunk. */
const struck = (before: string, hunks: DiffHunk[]): string[] =>
	hunks.map((h) => before.slice(h.at, h.end));

const PAIRS: [string, string][] = [
	['The quick brown fox jumps over the lazy dog.', 'The quick red fox leaps over the lazy dog.'],
	['We will meet on Monday.', 'We will meet on Monday, weather permitting.'],
	['Please review the attached draft at once.', 'Please review the draft.'],
	['', 'A line where there was none.'],
	['A line that goes entirely.', ''],
	['one two three four five six', 'six five four three two one'],
	['Request approval of the plan', 'Bananas are an excellent source of potassium today'],
	['naïve café — déjà vu', 'naive cafe — deja vu'],
	[`first line${HARD_BREAK}second line`, `first line${HARD_BREAK}another line`],
	['same  spacing   kept', 'same spacing kept'],
	['a, b; c.', 'a; b, c!'],
	['It’s the member’s duty', "It's the members' duty"]
];

describe('wordDiff', () => {
	it.each(PAIRS)('takes %j to %j', (before, after) => {
		expect(patched(before, wordDiff(before, after))).toBe(after);
	});

	it('keeps its hunks in order and apart', () => {
		for (const [before, after] of PAIRS) {
			const hunks = wordDiff(before, after);
			hunks.forEach((hunk, i) => {
				expect(hunk.at).toBeLessThanOrEqual(hunk.end);
				if (i) expect(hunk.at).toBeGreaterThan(hunks[i - 1].end);
			});
		}
	});

	it('finds nothing between a line and itself', () => {
		expect(wordDiff('unchanged', 'unchanged')).toEqual([]);
	});

	it('strikes a changed word whole, however many letters the two share', () => {
		const before = 'The meeting is scheduled for Tuesday.';
		const hunks = wordDiff(before, 'The meeting is scheduled for Thursday.');
		expect(struck(before, hunks)).toEqual(['Tuesday']);
		expect(hunks[0].insert).toBe('Thursday');
	});

	it('reads two changed words with a space between them as one phrase', () => {
		const before = 'Submit the final report by Friday.';
		const hunks = wordDiff(before, 'Submit the draft summary by Friday.');
		expect(struck(before, hunks)).toEqual(['final report']);
		expect(hunks[0].insert).toBe('draft summary');
	});

	it('keeps two changes apart where a word stands between them', () => {
		const before = 'The red car and the blue van.';
		const hunks = wordDiff(before, 'The green car and the white van.');
		expect(struck(before, hunks)).toEqual(['red', 'blue']);
	});

	it('adds words without striking any', () => {
		const before = 'Send the memo.';
		const hunks = wordDiff(before, 'Send the signed memo.');
		expect(struck(before, hunks).join('')).toBe('');
		expect(
			hunks
				.map((h) => h.insert)
				.join('')
				.trim()
		).toBe('signed');
	});

	it('differs whole where two lines share too few words to be an edit of one another', () => {
		const before = 'Request approval of the plan';
		const after = 'Bananas are an excellent source of potassium today';
		expect(wordDiff(before, after)).toEqual([{ at: 0, end: before.length, insert: after }]);
	});
});
