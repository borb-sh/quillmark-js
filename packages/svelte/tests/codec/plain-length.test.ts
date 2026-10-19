// The count a `text` or `richtext` cap measures (`plainLength`), as the engine takes it
// (canon `SCHEMAS.md` §Cardinality): USVs of the plain text, an island's slot nothing, a
// line break one, trailing line breaks none, a one-line `text`'s trailing whitespace
// none. The counter the editor draws against `max:` has to agree with the warning the
// engine raises, which `String.length` does not: it counts UTF-16 units.
import { describe, it, expect } from 'vitest';
import type { Content } from '@quillmark/wasm';
import { plainLength } from '$lib/core/codec';
import { ISLAND_SLOT } from '$lib/core/codec/islands.js';

const content = (text: string, islands: Content['islands'] = []): Content => ({
	text,
	lines: [{ containers: [], kind: 'para' }],
	marks: [],
	islands
});

describe('plainLength', () => {
	it('counts code points, so an astral character is one', () => {
		expect(plainLength(content('ab😀'))).toBe(3);
		expect('ab😀'.length).toBe(4);
	});

	it('counts a line break as one and trailing breaks as none', () => {
		expect(plainLength(content('a\nb'))).toBe(3);
		expect(plainLength(content('a\nb\n\n'))).toBe(3);
		expect(plainLength(content('a\r\n'))).toBe(1);
	});

	it("counts nothing for an island's slot", () => {
		expect(plainLength(content(`a${ISLAND_SLOT}b`))).toBe(2);
	});

	it("sheds a one-line text's trailing whitespace and keeps a richtext's", () => {
		expect(plainLength(content('ab  '), true)).toBe(2);
		expect(plainLength(content('ab  '))).toBe(4);
	});

	it('is zero on the empty leaf', () => {
		expect(plainLength(content(''))).toBe(0);
	});
});
