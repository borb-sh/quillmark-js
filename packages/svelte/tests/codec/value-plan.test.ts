// What Accept writes for a field's whole value of words: the proposal carried onto the reader's
// own writing since its writer read it, and outdated where the two meet.
import { describe, it, expect } from 'vitest';
import type { Content } from '@quillmark/wasm';
import { asContent, planValue, valueChanges } from '$lib/core/codec';

const line = (text: string, marks: Content['marks'] = []): Content => ({
	text,
	blocks: [{ id: 'b0', kind: 'para' }],
	...(marks.length && { marks })
});
const plan = (before: string, live: string, after: string) =>
	planValue(asContent(before), asContent(live)!, asContent(after)!);

describe('a proposal of words', () => {
	it('is its after where the reader has written nothing since it was read', () => {
		expect(plan('The cat sat', 'The cat sat', 'The dog sat')).toEqual({
			merged: asContent('The dog sat'),
			outdated: false
		});
	});

	it('keeps words the reader wrote beside the stretch it rewrites', () => {
		const { merged, outdated } = plan('The cat sat', 'The cat sat down', 'The dog sat');
		expect(merged.text).toBe('The dog sat down');
		expect(outdated).toBe(false);
		expect(plan('The cat sat', 'Today the cat sat', 'The cat stood').merged.text).toBe(
			'Today the cat stood'
		);
	});

	it('is outdated, and its after whole, where the reader rewrote words it rewrites', () => {
		expect(plan('The cat sat', 'The cow sat', 'The dog sat')).toEqual({
			merged: asContent('The dog sat'),
			outdated: true
		});
	});

	it('is its after where it says nothing of what its writer read', () => {
		const after = asContent('The dog sat')!;
		expect(planValue(undefined, asContent('The cow sat')!, after)).toEqual({
			merged: after,
			outdated: false
		});
	});

	it('carries a change of formatting alone, and its marks with the words it writes', () => {
		const before = line('The cat sat');
		const after = line('The cat sat', [{ type: 'emph', start: 4, end: 7 }]);
		expect(valueChanges(before, after)).toEqual([{ at: 4, end: 7, from: 4, to: 7 }]);
		const { merged } = planValue(before, line('The cat sat down'), after);
		expect(merged.text).toBe('The cat sat down');
		expect(merged.marks).toEqual([{ type: 'emph', start: 4, end: 7 }]);
	});
});

describe('a proposal the reader has already written', () => {
	it('is not outdated, and writes what the value already reads', () => {
		expect(plan('The cat sat', 'The dog sat', 'The dog sat')).toEqual({
			merged: asContent('The dog sat'),
			outdated: false
		});
	});
});
