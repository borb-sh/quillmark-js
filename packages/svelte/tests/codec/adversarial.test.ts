// USV↔UTF-16 drift (an astral char is 1 USV but 2 UTF-16 units) carried through a real
// Document's `applyChange`, so a miscounted offset surfaces as wrong stored text rather
// than as a unit-test artifact. That end-to-end route is what these add; the position
// map's own inverse is positions.test.ts, over a strictly wider corpus.
import { describe, it, expect } from 'vitest';
import type { Content, ContentMark } from '@quillmark/wasm';
import { contentEdit, lower } from '$lib/core/codec';
import { freshDoc } from './_util.js';

function rt(text: string, marks: ContentMark[] = []): Content {
	return { text, lines: [{ containers: [], kind: 'para' }], marks, islands: [] };
}

describe('codec adversarial — lower∘apply through a real core.Document (independent)', () => {
	it('text delta counts USV code points, so an insert after an astral char lands correctly', () => {
		const doc = freshDoc();
		doc.overwrite({}, rt('a😀b')); // 3 USV, 4 UTF-16
		const oldRt = doc.main.body;

		const bundle = lower(contentEdit(oldRt, rt('a😀Xb'))); // insert 'X' at USV index 2
		// The delta must be USV-coordinate: retain 2 ('a' + the emoji as one unit),
		// not retain 3 (its UTF-16 width): the exact drift CODEC.md warns about.
		expect(bundle.delta?.ops).toEqual([{ retain: 2 }, { insert: 'X' }, { retain: 1 }]);

		doc.applyChange({}, bundle);
		expect(doc.main.body.text).toBe('a😀Xb');
	});

	it('a formatting mark added after an astral char lowers to the right USV range', () => {
		const doc = freshDoc();
		doc.overwrite({}, rt('a😀bold')); // USV: a=0, 😀=1, b=2,o=3,l=4,d=5
		const withMark = rt('a😀bold', [{ start: 2, end: 6, type: 'strong' } as ContentMark]);
		const bundle = lower(contentEdit(doc.main.body, withMark));
		doc.applyChange({}, bundle);
		const marks = doc.main.body.marks;
		const strong = marks.find((m) => m.type === 'strong');
		expect(strong, 'strong mark present').toBeTruthy();
		// 'bold' is USV [2,6) even though the emoji is 2 UTF-16 units before it.
		expect([strong!.start, strong!.end]).toEqual([2, 6]);
	});
});
