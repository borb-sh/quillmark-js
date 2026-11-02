// Astral characters (one USV, two UTF-16 units) carried through a real Document's
// `apply`, so a miscounted offset surfaces as wrong stored text rather than as a
// unit-test artifact. The boundary speaks UTF-16, PM's own unit, so the editor counts
// nothing; the position map's own inverse is positions.test.ts.
import { describe, it, expect } from 'vitest';
import type { Content, ContentMark } from '@quillmark/wasm';
import { lower } from '$lib/core/codec';
import { freshDoc } from './_util.js';

function rt(text: string, marks: ContentMark[] = []): Content {
	return { text, blocks: [{ id: 'b0', kind: 'para' }], ...(marks.length && { marks }) };
}

describe('codec adversarial — lower∘apply through a real core.Document', () => {
	it('an insert after an astral char lands whole', () => {
		const doc = freshDoc();
		doc.replace({}, rt('a😀b'));
		doc.apply({}, lower(doc.main.body, rt('a😀Xb'))!);
		expect(doc.main.body.text).toBe('a😀Xb');
	});

	it('a formatting mark after an astral char lands over the right range', () => {
		const doc = freshDoc();
		doc.replace({}, rt('a😀bold'));
		const change = lower(doc.main.body, rt('a😀bold', [{ start: 3, end: 7, type: 'strong' }]));
		doc.apply({}, change!);
		const strong = doc.main.body.marks?.find((m) => m.type === 'strong');
		expect([strong?.start, strong?.end]).toEqual([3, 7]);
		expect(doc.main.body.text.slice(3, 7)).toBe('bold');
	});
});
