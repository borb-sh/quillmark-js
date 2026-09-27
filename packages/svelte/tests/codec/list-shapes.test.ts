import { describe, it, expect } from 'vitest';
import type { Attrs } from 'prosemirror-model';
import { decode, pmToContent, blockSchema } from '$lib/core/codec';
import { normalize } from './_util.js';

// Two adjacent lists of the same type; the shape the cleanup invariant must not
// fuse (`lists.ts` §cleanup). `md('- a\n\n<!-- -->\n\n- b')` is CommonMark's spelling
// for it. `instance` is the boundary: the projection mints one for a second sibling of
// the same run shape, `decode` breaks its run on it, and the normalizer keeps it — which
// is what restarts the second run's `ordinal`s, gapless from 0 within a run.
describe('adjacent same-type lists keep their boundary', () => {
	const item = (t: string) =>
		blockSchema.nodes.list_item.create(
			null,
			blockSchema.nodes.paragraph.create(null, blockSchema.text(t))
		);
	const pair = (listType: 'bullet_list' | 'ordered_list', attrs: Attrs | null) =>
		blockSchema.nodes.doc.create(null, [
			blockSchema.nodes[listType].create(attrs, [item('a'), item('b')]),
			blockSchema.nodes[listType].create(attrs, [item('c')])
		]);

	for (const [name, doc] of Object.entries({
		bullet: pair('bullet_list', null),
		ordered: pair('ordered_list', { start: 1 })
	})) {
		it(`${name}: the ordinal reset survives the normalizer and re-decodes to two`, () => {
			const stored = normalize(pmToContent(doc));
			expect(
				stored.lines.map((l) => (l.containers[0] as { attrs: { ordinal: number } }).attrs.ordinal)
			).toEqual([0, 1, 0]);
			expect(decode(stored, blockSchema).childCount).toBe(2);
		});
	}
});
