// Lowering: `lower ∘ apply` lands the projection of the optimistic PM, and formatting,
// anchors and islands each survive decode→lower→apply→decode. Uses a real Document so
// `apply` actually runs; PM transactions are built on a DOM-free EditorState, so this
// suite runs under node.
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { baseKeymap, joinTextblockBackward } from 'prosemirror-commands';
import {
	blockSchema,
	bodyKeymap,
	buildLineIndex,
	decode,
	lower,
	pmToContent,
	pmToOffset,
	offsetToPM
} from '$lib/core/codec';
import {
	contentDescriptorFromPM,
	descriptorOf,
	markKey,
	pmMarkFromContent
} from '$lib/core/codec/marks.js';
import type {
	Change,
	Content,
	ContentAnchor,
	ContentMark,
	ContentMarkKind,
	TableProps
} from '@quillmark/wasm';
import { freshDoc, normalize, contentEqual, md, textblocks } from './_util.js';

/** The transaction one key press produces, through the leaf's chain falling through
 *  to the base keymap: a case whose subject is what a *gesture* stores, not what a
 *  hand-built transaction does. */
function keyTr(state: EditorState, key: string): Transaction {
	let out: Transaction | undefined;
	const claim = (tr: Transaction) => {
		out = tr;
	};
	const keys = bodyKeymap(blockSchema);
	if (!keys[key]?.(state, claim)) baseKeymap[key]?.(state, claim);
	if (!out) throw new Error(`no command claimed ${key}`);
	return out;
}

/** A state with the caret at PM position `pos`: where a key is pressed mid-block. */
function caretAt(state: EditorState, pos: number): EditorState {
	return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

/** A state with the caret at the head of the `index`-th textblock. */
function atHead(state: EditorState, index: number): EditorState {
	const block = textblocks(state.doc)[index];
	return state.apply(state.tr.setSelection(TextSelection.create(state.doc, block.start)));
}

/** The stored start of the anchor `id`. */
function anchorAt(stored: Content, id: string): number | undefined {
	return stored.anchors?.find((a) => a.id === id)?.start;
}

/** Install `rt`, build a PM tr, and lower the projection the leaf would hold, with
 *  `anchors` (the stored ones where absent) as the leaf holds them after the edit. */
function lowerEdit(
	rt: Content,
	mkTr: (state: EditorState) => Transaction,
	anchors?: ContentAnchor[]
) {
	const doc = freshDoc();
	doc.replace({}, rt);
	const oldRt = doc.main.body;
	const state = EditorState.create({ doc: decode(oldRt, blockSchema) });
	const newDoc = mkTr(state).doc;
	const projected = pmToContent(newDoc, anchors ?? oldRt.anchors ?? []);
	return { doc, oldRt, newDoc, projected, change: lower(oldRt, projected) };
}

/** {@link lowerEdit}, applied, asserting the store holds the projection. */
function lowerApply(
	rt: Content,
	mkTr: (state: EditorState) => Transaction,
	anchors?: ContentAnchor[]
) {
	const { doc, projected, change, newDoc } = lowerEdit(rt, mkTr, anchors);
	if (change) doc.apply({}, change);
	const stored = doc.main.body;
	expect(contentEqual(stored, normalize(projected)), 'stored matches optimistic PM').toBe(true);
	return { doc, stored, change, newDoc };
}

/** The steps of `change` of one kind. */
function stepsOf(change: Change | null, kind: string): unknown[] {
	return (change?.steps ?? []).filter((step) => kind in step);
}

describe('lower ∘ apply matches PM', () => {
	it('Enter — split a paragraph', () => {
		const { stored } = lowerApply(md('one two three'), (s) => s.tr.split(5));
		expect(stored.blocks).toHaveLength(2);
	});
	it('joining Backspace — merge two paragraphs', () => {
		const { stored } = lowerApply(md('first\n\nsecond'), (s) => {
			const boundary = s.doc.child(0).nodeSize;
			return s.tr.delete(boundary - 1, boundary + 1);
		});
		expect(stored.blocks).toHaveLength(1);
	});
	it('heading toggle via setBlockType', () => {
		const { stored } = lowerApply(md('a title line'), (s) =>
			s.tr.setBlockType(0, s.doc.content.size, blockSchema.nodes.heading, { level: 2 })
		);
		expect(stored.blocks[0].kind).toBe('heading');
	});
	it('Shift+Enter — a hard break is a U+2028 in its block', () => {
		const { stored } = lowerApply(md('one two'), (s) => keyTr(caretAt(s, 4), 'Shift-Enter'));
		expect(stored.blocks).toHaveLength(1);
		expect(stored.text).toBe('one\u2028 two');
	});
	it('Enter inside a code block — a code-interior line is a U+2028', () => {
		const { stored } = lowerApply(md('```\nab\n```'), (s) => s.tr.insertText('\n', 2));
		expect(stored.blocks.map((b) => b.kind)).toEqual(['code']);
		expect(stored.text).toBe('a\u2028b');
	});
	it('a join landing a fence’s newline in a paragraph — the projection stays total', () => {
		// The merge lands the fence's own `\n` inside a `paragraph`:
		// `joinTextblocksAround` is a bare `replaceStep`, so no `clearIncompatible`
		// pass rewrites it. The projection reads it as the hard break it is. Upstream's
		// command directly: no gesture reaches this shape, the leaf's chain refusing a
		// join at a fence's edge (`code.ts`), and the projection is total whatever
		// produces one.
		const { stored } = lowerApply(md('- a\n\n- ```\n  alpha\n  beta\n  ```'), (s) => {
			let out: Transaction | undefined;
			joinTextblockBackward(atHead(s, 1), (tr) => {
				out = tr;
			});
			if (!out) throw new Error('no join');
			return out;
		});
		expect(stored.blocks.map((b) => b.kind)).toEqual(['para']);
		expect(stored.text).toBe('aalpha\u2028beta');
	});
	it('the press itself keeps each block whole', () => {
		const { stored } = lowerApply(md('- a\n\n- ```\n  alpha\n  beta\n  ```'), (s) =>
			keyTr(atHead(s, 1), 'Backspace')
		);
		expect(stored.blocks.map((b) => b.kind)).toEqual(['para', 'code']);
		expect(stored.text).toBe('a\nalpha\u2028beta');
	});
	it('a splice that joins one boundary and opens another keeps each block its kind', () => {
		const { stored } = lowerApply(md('```\nab\n```\n\n# *cd*'), (s) =>
			s.tr.setSelection(TextSelection.create(s.doc, 2, 6)).deleteSelection()
		);
		expect(stored.blocks.map((b) => b.kind)).toEqual(['code', 'heading']);
	});
	it('an edit that changes nothing lowers to no change', () => {
		const { change } = lowerEdit(md('same'), (s) => s.tr);
		expect(change).toBeNull();
	});
});

describe('formatting marks round-trip', () => {
	it('addMark strong', () => {
		const { stored } = lowerApply(md('make this bold'), (s) =>
			s.tr.addMark(5, 9, blockSchema.marks.strong.create())
		);
		expect(stored.marks?.some((m) => m.type === 'strong')).toBe(true);
	});
	it('removeMark strong', () => {
		const { stored } = lowerApply(md('**all bold** here'), (s) =>
			s.tr.removeMark(1, 5, blockSchema.marks.strong)
		);
		const strong = (stored.marks ?? []).filter((m) => m.type === 'strong');
		expect(strong.every((m) => m.start >= 4)).toBe(true);
	});
	it('link add carries href → attrs.url', () => {
		const { stored } = lowerApply(md('go to site'), (s) =>
			s.tr.addMark(6, 10, blockSchema.marks.link.create({ href: 'http://x' }))
		);
		const link = stored.marks?.find((m) => m.type === 'link');
		expect(link?.type === 'link' && link.attrs.url).toBe('http://x');
	});
	it('a font family over part of a run carries its name', () => {
		const { stored } = lowerApply(md('set in face'), (s) =>
			s.tr.addMark(8, 12, blockSchema.marks.font_family.create({ name: 'Tinos' }))
		);
		expect(stored.marks).toEqual([
			{ start: 7, end: 11, type: 'font_family', attrs: { name: 'Tinos' } }
		]);
	});
	it('a second family over a family replaces it under its range', () => {
		const { stored } = lowerApply(md('<qm-span family="Tinos">whole run</qm-span>'), (s) =>
			s.tr.addMark(1, 6, blockSchema.marks.font_family.create({ name: 'Carlito' }))
		);
		expect(stored.marks).toEqual([
			{ start: 0, end: 5, type: 'font_family', attrs: { name: 'Carlito' } },
			{ start: 5, end: 9, type: 'font_family', attrs: { name: 'Tinos' } }
		]);
	});
	it('removing the family leaves the text in the surrounding face', () => {
		const { stored } = lowerApply(md('<qm-span family="Tinos">whole run</qm-span>'), (s) =>
			s.tr.removeMark(1, 10, blockSchema.marks.font_family)
		);
		expect(stored.marks ?? []).toEqual([]);
	});
});

// The projection's marks are compared against the store's read. The two descriptors
// are produced by different functions, so a mark that keys differently on the two
// sides would read as a change on every keystroke.
describe('both descriptor producers key one mark alike', () => {
	const mark = (m: ContentMarkKind): ContentMark => ({ start: 0, end: 3, ...m });
	const cases: Record<string, ContentMark> = {
		strong: mark({ type: 'strong' }),
		emph: mark({ type: 'emph' }),
		code: mark({ type: 'code' }),
		link: mark({ type: 'link', attrs: { url: 'http://x' } }),
		font_family: mark({ type: 'font_family', attrs: { name: 'Tinos' } })
	};

	for (const [name, m] of Object.entries(cases)) {
		it(name, () => {
			const pm = pmMarkFromContent(blockSchema, m);
			expect(pm, 'every case here projects to a PM mark').not.toBeNull();
			expect(markKey(contentDescriptorFromPM(pm!))).toBe(markKey(descriptorOf(m)));
		});
	}

	it('different attrs stay different families', () => {
		expect(markKey(descriptorOf(mark({ type: 'link', attrs: { url: 'http://x' } })))).not.toBe(
			markKey(descriptorOf(mark({ type: 'link', attrs: { url: 'http://y' } })))
		);
	});
});

describe('anchors land where the projection puts them', () => {
	const anchorRt: Content = {
		text: 'hello world',
		blocks: [{ id: 'b0', kind: 'para' }],
		anchors: [{ id: 'a1', start: 6, end: 6 }]
	};

	it('an anchor survives an edit before it', () => {
		const { stored } = lowerApply(anchorRt, (s) => s.tr.insertText('XX', 1), [
			{ id: 'a1', start: 8, end: 8 }
		]);
		expect(anchorAt(stored, 'a1')).toBe(8);
	});

	it('an anchor survives a code-block-interior edit', () => {
		const codeRt: Content = {
			text: 'abc',
			blocks: [{ id: 'b0', kind: 'code' }],
			anchors: [{ id: 'c1', start: 3, end: 3 }]
		};
		const { stored } = lowerApply(codeRt, (s) => s.tr.insertText('\n', 2), [
			{ id: 'c1', start: 4, end: 4 }
		]);
		expect(stored.text).toBe('a\u2028bc');
		expect(anchorAt(stored, 'c1')).toBe(4);
	});

	it('a range anchor keeps its extent through an edit inside it', () => {
		const rangeRt: Content = { ...anchorRt, anchors: [{ id: 'r1', start: 0, end: 5 }] };
		const { stored } = lowerApply(rangeRt, (s) => s.tr.insertText('XX', 3), [
			{ id: 'r1', start: 0, end: 7 }
		]);
		expect(stored.anchors).toEqual([{ id: 'r1', start: 0, end: 7 }]);
	});

	// The two associativities agree everywhere but at the anchor's own position, which
	// is where a point anchor sits.
	describe('an insertion at the anchor’s own position', () => {
		/** The anchor's position as the field's plugin holds it: PM-mapped through the
		 *  transaction with `bias`, read back in content offsets. */
		function projected(oldDoc: PMNode, tr: Transaction, pos: number, bias: 1 | -1): number {
			const pm = offsetToPM(buildLineIndex(oldDoc), pos);
			return pmToOffset(buildLineIndex(tr.doc), tr.mapping.map(pm, bias));
		}

		function commit(pos: number, bias: 1 | -1, mkTr: (s: EditorState) => Transaction) {
			let after = -1;
			const { stored } = lowerApply(
				anchorRt,
				(s) => {
					const tr = mkTr(s);
					after = projected(s.doc, tr, pos, bias);
					return tr;
				},
				undefined
			);
			return { stored, after };
		}

		/** The node attrs an image island projects from. */
		const imageAttrs = () => {
			const { type, ...rest } = md('![a](u)').islands![0];
			return { ...rest, islandType: type, id: 'isl-9' };
		};

		for (const bias of [-1, 1] as const) {
			it(`a text insert lands the store where the projection put it (bias ${bias})`, () => {
				const doc = freshDoc();
				doc.replace({}, anchorRt);
				const oldRt = doc.main.body;
				const state = EditorState.create({ doc: decode(oldRt, blockSchema) });
				const tr = state.tr.insertText('X', offsetToPM(buildLineIndex(state.doc), 6));
				const at = projected(state.doc, tr, 6, bias);
				const change = lower(oldRt, pmToContent(tr.doc, [{ id: 'a1', start: at, end: at }]));
				doc.apply({}, change!);
				expect(anchorAt(doc.main.body, 'a1')).toBe(at);
			});

			it(`an island insert lands the store where the projection put it (bias ${bias})`, () => {
				const doc = freshDoc();
				doc.replace({}, anchorRt);
				const oldRt = doc.main.body;
				const state = EditorState.create({ doc: decode(oldRt, blockSchema) });
				const tr = state.tr.insert(
					offsetToPM(buildLineIndex(state.doc), 6),
					blockSchema.nodes.island_inline.create(imageAttrs())
				);
				const at = projected(state.doc, tr, 6, bias);
				const change = lower(oldRt, pmToContent(tr.doc, [{ id: 'a1', start: at, end: at }]));
				doc.apply({}, change!);
				expect(doc.main.body.islands?.map((i) => i.id)).toEqual(['isl-9']);
				expect(anchorAt(doc.main.body, 'a1')).toBe(at);
			});
		}

		it('the helper reads the plugin’s mapping', () => {
			const { after } = commit(6, -1, (s) => s.tr.insertText('X', 1));
			expect(after).toBe(7);
		});
	});
});

describe('islands — an island edit lowers and lands', () => {
	// A block island between two paragraphs: `￼` alone in its block.
	const TABLE_MD = 'para\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntail';

	/** The block island node and its position. */
	function islandNode(doc: PMNode): { pos: number; node: PMNode } {
		let found: { pos: number; node: PMNode } | undefined;
		doc.descendants((node, pos) => {
			if (node.type.name === 'island_block') found = { node, pos };
			return !found;
		});
		if (!found) throw new Error('no island node in the projection');
		return found;
	}

	/** The slot id of the table's first header cell. */
	function headSlot(props: TableProps): string {
		return props.rows[0].cells[props.columns[0]];
	}

	/** Retype the island's first header cell: an edit to its slot alone, which the
	 *  field's text does not see. */
	function retypeCell(state: EditorState, text: string): Transaction {
		const { pos, node } = islandNode(state.doc);
		const slots = structuredClone(node.attrs.slots) as Record<string, Content>;
		slots[headSlot(node.attrs.props as TableProps)].text = text;
		return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, slots });
	}

	it('a cell edit touches no text of the field and reaches the store', () => {
		const { stored, change } = lowerApply(md(TABLE_MD), (s) => retypeCell(s, 'HEAD'));
		expect(stepsOf(change, 'splice')).toEqual([]);
		const island = stored.islands![0];
		expect(island.slots![headSlot(island.props as TableProps)].text).toBe('HEAD');
	});

	it('every anchor in the field survives a cell edit', () => {
		const rt: Content = { ...md(TABLE_MD), anchors: [{ id: 'a1', start: 2, end: 2 }] };
		const { stored } = lowerApply(rt, (s) => retypeCell(s, 'HEAD'));
		expect(anchorAt(stored, 'a1')).toBe(2);
	});

	it('a block island inserted between paragraphs opens its own block', () => {
		const rt: Content = { ...md('one\n\ntwo'), anchors: [{ id: 'a1', start: 1, end: 1 }] };
		const attrs = {
			id: 'isl-0',
			islandType: 'table',
			props: { columns: ['k0'], rows: [{ id: 'r0', cells: { k0: 's0' } }] },
			slots: { s0: { text: 'h', blocks: [{ id: 'b0', kind: 'para' }] } }
		};
		const { stored } = lowerApply(rt, (s) =>
			s.tr.insert(s.doc.child(0).nodeSize, blockSchema.nodes.island_block.create(attrs))
		);
		expect(stored.text).toBe('one\n￼\ntwo');
		expect(stored.blocks.map((b) => b.kind)).toEqual(['para', 'para', 'para']);
		expect(stored.islands?.map((i) => i.id)).toEqual(['isl-0']);
		expect(anchorAt(stored, 'a1')).toBe(1);
	});

	it('edits either side of an island keep the island', () => {
		const { stored } = lowerApply(md(TABLE_MD), (s) => s.tr.insertText('X', 2).insertText('Y', 11));
		expect(stored.text).toBe('pXara\n￼\ntaYil');
		expect(stored.islands?.map((i) => i.id)).toEqual(['isl-0']);
	});

	it('a text edit beside an island touches no island', () => {
		const { change } = lowerApply(md(TABLE_MD), (s) => s.tr.insertText('X', 2));
		expect(stepsOf(change, 'island')).toEqual([]);
		expect(stepsOf(change, 'nested')).toEqual([]);
	});

	it('deleting an island drops its entry', () => {
		const { stored } = lowerApply(md(TABLE_MD), (s) => s.tr.delete(6, 7));
		expect(stored.islands ?? []).toHaveLength(0);
	});
});
