import { describe, it, expect } from 'vitest';
import type { Attrs } from 'prosemirror-model';
import { decode, pmToContent, blockSchema } from '$lib/core/codec';
import { normalize } from './_util.js';

// Two adjacent lists of the same type; the shape the cleanup invariant must not
// fuse (`lists.ts` §cleanup). `md('- a\n\n<!-- -->\n\n- b')` is CommonMark's spelling
// for it. The list's id is the boundary: the projection names each list node its own
// container, `decode` groups by it, and the normalizer keeps it.
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
		it(`${name}: the two lists survive the normalizer and re-decode to two`, () => {
			const stored = normalize(pmToContent(doc));
			const lists = stored.blocks.map((b) => b.path?.[0]);
			expect(lists[0]).toBe(lists[1]);
			expect(lists[2]).not.toBe(lists[0]);
			expect(decode(stored, blockSchema).childCount).toBe(2);
		});
	}
});
