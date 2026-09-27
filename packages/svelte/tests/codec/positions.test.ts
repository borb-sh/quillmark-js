// The position map, the UTF-16/USV seam. For every USV offset the map is a clean
// inverse, and offsets land on the right code point. The shapes the keymaps reach are
// asserted by the generated chain (`roundtrip.test.ts`); these are the text and the leaf
// blocks it does not generate.
import { describe, it, expect } from 'vitest';
import { decode, blockSchema, buildLineIndex, usvToPM, pmToUsv } from '$lib/core/codec';
import type { Content } from '@quillmark/wasm';
import { md, assertPositionInverse } from './_util.js';

/** A synthetic single-para content over `text` (valid: one line, no marks). */
function para(text: string): Content {
	return { text, lines: [{ containers: [], kind: 'para' }], marks: [], islands: [] };
}

/** Decode, then assert the map is a clean inverse over every offset. */
function assertInverse(rt: Content) {
	assertPositionInverse(decode(rt, blockSchema));
}

describe('positions: UTF-16 / USV inverse', () => {
	it('holds over astral chars (emoji, CJK) in one paragraph', () => {
		assertInverse(para('a😀b🎉c'));
		assertInverse(para('café ☕ x')); // a BMP symbol beside ASCII
		assertInverse(para('日本語テキスト'));
		assertInverse(para('mix 😀 と 漢字 x'));
		assertInverse(para('👨‍👩‍👧‍👦 family zwj'));
	});

	it('holds across leaf blocks (image island, table island, rule)', () => {
		assertInverse(md('before 😀\n\n![alt](img.png)\n\nafter 🎉')); // inline island slot
		assertInverse(md('para\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntail')); // block island line
		assertInverse(md('above\n\n---\n\nbelow')); // horizontal rule
	});

	it('lands on the right code point across an emoji', () => {
		// "a😀b": USV a=0, 😀=1, b=2. The caret between 😀 and b is USV 2.
		const rt = para('a😀b');
		const doc = decode(rt, blockSchema);
		const index = buildLineIndex(doc);
		// PM: doc>paragraph, content start at 1. "a"=[1,2], "😀"=[2,4] (2 UTF-16), "b"=[4,5].
		expect(usvToPM(index, 0)).toBe(1); // before 'a'
		expect(usvToPM(index, 1)).toBe(2); // before '😀'
		expect(usvToPM(index, 2)).toBe(4); // before 'b'; skipped the surrogate pair
		expect(usvToPM(index, 3)).toBe(5); // after 'b'
		// Inverse: the PM position after the emoji is USV 2, not 3 (no surrogate drift).
		expect(pmToUsv(index, 4)).toBe(2);
	});

	it('maps a caret at a line boundary to the end of the previous line', () => {
		const rt = md('AB\n\nCD');
		const doc = decode(rt, blockSchema);
		const index = buildLineIndex(doc);
		// USV: A0 B1 \n2 C3 D4. Position 2 (the newline) = end of line 0.
		const pm = usvToPM(index, 2);
		expect(pmToUsv(index, pm)).toBe(2);
		// Position 3 = start of line 1.
		const pm3 = usvToPM(index, 3);
		expect(pmToUsv(index, pm3)).toBe(3);
		expect(pm3).toBeGreaterThan(pm);
	});
});
