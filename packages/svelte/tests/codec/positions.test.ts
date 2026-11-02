// The position map between PM positions and content offsets, both UTF-16. For every
// offset off a surrogate pair's middle the map is a clean inverse, and offsets land on
// the right code point. The shapes the keymaps reach are
// asserted by the generated chain (`roundtrip.test.ts`); these are the text and the leaf
// blocks it does not generate.
import { describe, it, expect } from 'vitest';
import { decode, blockSchema, buildLineIndex, offsetToPM, pmToOffset } from '$lib/core/codec';
import type { Content } from '@quillmark/wasm';
import { md, assertPositionInverse } from './_util.js';

/** A synthetic single-para content over `text`. */
function para(text: string): Content {
	return { text, blocks: [{ id: 'b0', kind: 'para' }] };
}

/** Decode, then assert the map is a clean inverse over every offset. */
function assertInverse(rt: Content) {
	assertPositionInverse(decode(rt, blockSchema));
}

describe('positions: PM / content inverse', () => {
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
		// "a😀b": a=0, 😀=1 (two units), b=3. The caret between 😀 and b is 3.
		const rt = para('a😀b');
		const doc = decode(rt, blockSchema);
		const index = buildLineIndex(doc);
		// PM: doc>paragraph, content start at 1. "a"=[1,2], "😀"=[2,4], "b"=[4,5].
		expect(offsetToPM(index, 0)).toBe(1);
		expect(offsetToPM(index, 1)).toBe(2);
		expect(offsetToPM(index, 3)).toBe(4);
		expect(offsetToPM(index, 4)).toBe(5);
		expect(pmToOffset(index, 4)).toBe(3);
	});

	it('maps a caret at a block boundary to the end of the previous block', () => {
		const rt = md('AB\n\nCD');
		const doc = decode(rt, blockSchema);
		const index = buildLineIndex(doc);
		// A0 B1 \n2 C3 D4. Position 2 (the newline) = end of block 0.
		const pm = offsetToPM(index, 2);
		expect(pmToOffset(index, pm)).toBe(2);
		// Position 3 = start of block 1.
		const pm3 = offsetToPM(index, 3);
		expect(pmToOffset(index, pm3)).toBe(3);
		expect(pm3).toBeGreaterThan(pm);
	});
});
