import { describe, expect, it } from 'vitest';
import { removedCards } from '$lib/visual/removed.js';

describe('removedCards', () => {
	it('puts a card back under the card it stood below, wherever that card is now', () => {
		const r = removedCards<string>();
		const gone = r.remove('b', 'B', ['a', 'b', 'c'], 1);
		expect(r.place(gone, ['x', 'c', 'a'])).toBe(3);
	});

	it('falls back to the card above it, then to the index it left', () => {
		const r = removedCards<string>();
		const gone = r.remove('a', 'A', ['a', 'b'], 0);
		expect(r.place(gone, ['x', 'b'])).toBe(1);
		expect(r.place(gone, ['x'])).toBe(0);
		const last = r.remove('z', 'Z', ['y', 'z'], 1);
		expect(r.place(last, [])).toBe(0);
	});

	it('renames a restored card in the removals that named it', () => {
		const r = removedCards<string>();
		const b = r.remove('b', 'B', ['a', 'b', 'c'], 1);
		const c = r.remove('c', 'C', ['a', 'c'], 1);
		const a = r.remove('a', 'A', ['a'], 0);
		r.restored(a, 'a2');
		expect(c.above).toBe('a2');
		expect(r.place(c, ['a2'])).toBe(1);
		r.restored(c, 'c2');
		expect(b.below).toBe('c2');
		expect(r.place(b, ['a2', 'c2'])).toBe(1);
	});
});
