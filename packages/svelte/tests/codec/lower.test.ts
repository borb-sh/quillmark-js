// Lowering: `lower ∘ apply` matches the optimistic PM up to normalization, and
// formatting / anchor / unknown marks each survive decode→lower→apply→decode. Uses a
// real Document so `applyChange` actually runs; PM transactions are built on a DOM-free
// EditorState, so this suite runs under node.
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { baseKeymap, joinTextblockBackward } from 'prosemirror-commands';
import {
	blockSchema,
	bodyKeymap,
	buildLineIndex,
	contentEdit,
	decode,
	lower,
	pmToContent,
	pmToUsv,
	usvToPM
} from '$lib/core/codec';
import {
	contentDescriptorFromPM,
	descriptorOf,
	markKey,
	pmMarkFromContent
} from '$lib/core/codec/marks.js';
import type { Content, ContentMark, TableProps } from '@quillmark/wasm';
import { isAnchorMark, isLinkMark } from '@quillmark/wasm';
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

interface AnchorOpts {
	newAnchors?: { id: string; pos: number }[];
}

/** The stored position of the identity anchor `id`. */
function anchorAt(stored: Content, id: string): number | undefined {
	return stored.marks.find((mark) => isAnchorMark(mark) && mark.attrs.id === id)?.start;
}

/** Install `rt`, build a PM tr, lower+apply, and assert the store matches PM. */
function lowerApply(rt: Content, mkTr: (state: EditorState) => Transaction, opts: AnchorOpts = {}) {
	const doc = freshDoc();
	doc.overwrite({}, rt);
	const oldRt = doc.main.body; // normalized starting content
	const state = EditorState.create({ doc: decode(oldRt, blockSchema) });
	const tr = mkTr(state);
	const newDoc = tr.doc;
	const bundle = lower(contentEdit(oldRt, pmToContent(newDoc)), opts);
	doc.applyChange({}, bundle);
	const stored = doc.main.body;
	expect(contentEqual(stored, normalize(pmToContent(newDoc))), 'stored matches optimistic PM').toBe(
		true
	);
	return { doc, stored, bundle, newDoc };
}

describe('lower ∘ apply matches PM', () => {
	it('text insert', () => {
		lowerApply(md('hello world'), (s) => s.tr.insertText('X', 4));
	});
	it('text delete', () => {
		lowerApply(md('hello world'), (s) => s.tr.delete(2, 5));
	});
	it('text insert with an astral char', () => {
		lowerApply(md('hello world'), (s) => s.tr.insertText('😀', 6));
	});
	it('Enter — split a paragraph', () => {
		const { stored } = lowerApply(md('one two three'), (s) => s.tr.split(5));
		expect(stored.lines).toHaveLength(2);
	});
	it('joining Backspace — merge two paragraphs', () => {
		const { stored } = lowerApply(md('first\n\nsecond'), (s) => {
			// Delete the block boundary between the two paragraphs.
			const boundary = s.doc.child(0).nodeSize; // pos at end of para0 / before para1
			return s.tr.delete(boundary - 1, boundary + 1);
		});
		expect(stored.lines).toHaveLength(1);
	});
	it('heading toggle via setBlockType', () => {
		const { stored } = lowerApply(md('a title line'), (s) =>
			s.tr.setBlockType(0, s.doc.content.size, blockSchema.nodes.heading, { level: 2 })
		);
		expect(stored.lines[0].kind).toBe('heading');
	});
	it('multi-op: insert then delete elsewhere', () => {
		lowerApply(md('alpha beta gamma'), (s) => s.tr.insertText('ZZ', 6).delete(0, 2));
	});
	it('Shift+Enter — a hard break lowers via setContinues', () => {
		const { stored, bundle } = lowerApply(md('one two'), (s) =>
			keyTr(caretAt(s, 4), 'Shift-Enter')
		);
		expect(stored.lines).toHaveLength(2);
		expect(!!stored.lines[1].continues).toBe(true);
		expect(bundle.lineOps?.some((op) => op.op === 'setContinues')).toBe(true);
	});
	it('Enter inside a code block — a code-interior line lowers via setContinues', () => {
		const { stored, bundle } = lowerApply(md('```\nab\n```'), (s) => s.tr.insertText('\n', 2));
		expect(stored.lines).toHaveLength(2);
		expect(!!stored.lines[1].continues).toBe(true);
		expect(stored.lines[1].kind).toBe('code');
		expect(bundle.lineOps?.some((op) => op.op === 'setContinues')).toBe(true);
	});
	it('a join landing a fence’s newline in a paragraph — the projection stays total', () => {
		// The merge lands the fence's own `\n` inside a `paragraph`:
		// `joinTextblocksAround` is a bare `replaceStep`, so no `clearIncompatible`
		// pass rewrites it. The projection has to count it as the line boundary it is,
		// or it carries more segments than lines and the bundle under-specifies the
		// store — `applyChange` takes it, and the field diverges from the leaf.
		// Upstream's command directly: no gesture reaches this shape, the leaf's chain
		// refusing a join at a fence's edge (`code.ts`), and the projection is total
		// whatever produces one.
		const { stored } = lowerApply(md('- a\n\n- ```\n  alpha\n  beta\n  ```'), (s) => {
			let out: Transaction | undefined;
			joinTextblockBackward(atHead(s, 1), (tr) => {
				out = tr;
			});
			if (!out) throw new Error('no join');
			return out;
		});
		expect(stored.lines).toHaveLength(2);
		expect(stored.lines.map((l) => l.kind)).toEqual(['para', 'para']);
		expect(!!stored.lines[1].continues).toBe(true);
		expect(stored.text).toBe('aalpha\nbeta');
	});
	it('the press itself keeps each block whole', () => {
		const { stored } = lowerApply(md('- a\n\n- ```\n  alpha\n  beta\n  ```'), (s) =>
			keyTr(atHead(s, 1), 'Backspace')
		);
		expect(stored.lines.map((l) => l.kind)).toEqual(['para', 'code', 'code']);
		expect(stored.text).toBe('a\nalpha\nbeta');
	});
	it('a splice that joins one boundary and opens another restates every line', () => {
		// A range from inside the fence to inside the heading, deleted. Both blocks
		// survive, so both sides carry the same line metadata they did — and that is
		// not "nothing to do": the delete takes the `\n` between them and the insert
		// opens one a character earlier, so what the store's join/split inheritance
		// leaves on the second line is the fence's kind, not the heading's.
		const { stored, bundle } = lowerApply(md('```\nab\n```\n\n# *cd*'), (s) =>
			s.tr.setSelection(TextSelection.create(s.doc, 2, 6)).deleteSelection()
		);
		expect(stored.lines.map((l) => l.kind)).toEqual(['code', 'heading']);
		expect(bundle.lineOps?.some((op) => op.op === 'setKind')).toBe(true);
	});
});

describe('formatting marks round-trip', () => {
	it('addMark strong', () => {
		const { stored } = lowerApply(md('make this bold'), (s) =>
			s.tr.addMark(5, 9, blockSchema.marks.strong.create())
		);
		expect(stored.marks.some((m) => m.type === 'strong')).toBe(true);
	});
	it('removeMark strong', () => {
		const { stored } = lowerApply(md('**all bold** here'), (s) =>
			s.tr.removeMark(1, 5, blockSchema.marks.strong)
		);
		// The removed sub-range is not fully covered.
		const strong = stored.marks.filter((m) => m.type === 'strong');
		expect(strong.every((m) => m.start >= 4)).toBe(true);
	});
	it('link add carries href → attrs.url', () => {
		const { stored } = lowerApply(md('go to site'), (s) =>
			s.tr.addMark(6, 10, blockSchema.marks.link.create({ href: 'http://x' }))
		);
		const link = stored.marks.find(isLinkMark);
		expect(link?.attrs.url).toBe('http://x');
	});
});

describe('unknown mark round-trip (verbatim)', () => {
	const unknownRt: Content = {
		text: 'abcdef ghi',
		lines: [{ containers: [], kind: 'para' }],
		marks: [{ start: 0, end: 6, type: 'sub', attrs: { x: 1 } } as never],
		islands: []
	};
	it('survives decode → pmToContent verbatim', () => {
		const back = pmToContent(decode(unknownRt, blockSchema));
		const u = back.marks.find((m) => m.type === 'sub') as { attrs: unknown } | undefined;
		expect(u).toBeTruthy();
		expect(u!.attrs).toEqual({ x: 1 });
	});
	it('survives decode → lower(edit) → apply → decode', () => {
		const { stored } = lowerApply(unknownRt, (s) => s.tr.insertText('Z', 8));
		const u = stored.marks.find((m) => m.type === 'sub') as { attrs: unknown } | undefined;
		expect(u).toBeTruthy();
		expect(u!.attrs).toEqual({ x: 1 });
	});

	// The mark diff groups a WASM read against a PM projection with one key. The two
	// descriptors are produced by different functions, so a mark that keys differently
	// on the two sides lands in neither group: `lower` then emits a full-range `remove`
	// and a full-range `add` for a mark nothing touched, on every keystroke.
	describe('both descriptor producers key one mark alike', () => {
		const mark = (m: Record<string, unknown>) => ({ start: 0, end: 3, ...m }) as never;
		const cases: Record<string, ContentMark> = {
			strong: mark({ type: 'strong' }),
			emph: mark({ type: 'emph' }),
			code: mark({ type: 'code' }),
			link: mark({ type: 'link', attrs: { url: 'http://x' } }),
			'unknown with attrs': mark({ type: 'sub', attrs: { x: 1 } }),
			'unknown with null attrs': mark({ type: 'sub', attrs: null }),
			'unknown with no attrs key': mark({ type: 'sub' })
		};

		for (const [name, m] of Object.entries(cases)) {
			it(name, () => {
				const pm = pmMarkFromContent(blockSchema, m);
				expect(pm, 'every case here projects to a PM mark').not.toBeNull();
				expect(markKey(contentDescriptorFromPM(pm!))).toBe(markKey(descriptorOf(m)));
			});
		}

		it('an attrs bag keys by value, not by key order', () => {
			expect(markKey(descriptorOf(mark({ type: 'sub', attrs: { a: 1, b: { c: 2, d: 3 } } })))).toBe(
				markKey(descriptorOf(mark({ type: 'sub', attrs: { b: { d: 3, c: 2 }, a: 1 } })))
			);
		});

		it('different attrs stay different families', () => {
			expect(markKey(descriptorOf(mark({ type: 'sub', attrs: { x: 1 } })))).not.toBe(
				markKey(descriptorOf(mark({ type: 'sub', attrs: { x: 2 } })))
			);
		});
	});
});

describe('unknown line kind and container round-trip (verbatim)', () => {
	// The open block vocabulary, from the codec's side: a `kind` and a
	// `container` this build does not know. Both render as their nearest safe
	// neighbor (a paragraph; nothing) and both must come back out unchanged; an
	// edit anywhere in the field restates every line's metadata, so a carrier that
	// only survives decode would still lose them on the first keystroke.
	const openRt: Content = {
		text: 'a callout line\ninside an aside',
		lines: [
			{ containers: [], kind: 'callout', attrs: { tone: 'warn' } } as never,
			{ containers: [{ container: 'aside', attrs: { side: 'left' } } as never], kind: 'para' }
		],
		marks: [],
		islands: []
	};
	/** The line at `i`, minus the envelope: what a `setKind` restates. */
	const kindOf = (rt: Content, i: number) => {
		const { containers: _c, continues: _k, ...kind } = rt.lines[i];
		return kind;
	};

	it('decodes to a paragraph carrying the kind, wrapped in an unknown container', () => {
		const doc = decode(openRt, blockSchema);
		expect(doc.child(0).type.name).toBe('paragraph');
		expect(doc.child(0).attrs.unknown).toEqual({ kind: 'callout', attrs: { tone: 'warn' } });
		expect(doc.child(1).type.name).toBe('unknown_container');
		expect(doc.child(1).attrs).toEqual({ container: 'aside', attrs: { side: 'left' } });
	});
	it('survives decode → pmToContent verbatim', () => {
		const back = pmToContent(decode(openRt, blockSchema));
		expect(kindOf(back, 0)).toEqual({ kind: 'callout', attrs: { tone: 'warn' } });
		expect(back.lines[1].containers).toEqual([
			{ container: 'aside', attrs: { side: 'left' }, instance: 0 }
		]);
	});
	it('survives decode → lower(edit) → apply → decode', () => {
		const { stored } = lowerApply(openRt, (s) => s.tr.insertText('Z', 2));
		expect(kindOf(stored, 0)).toEqual({ kind: 'callout', attrs: { tone: 'warn' } });
		expect(stored.lines[1].containers).toEqual([
			{ container: 'aside', attrs: { side: 'left' }, instance: 0 }
		]);
	});
});

describe('identity anchor round-trip (op-based, survives edits)', () => {
	const anchorRt: Content = {
		text: 'hello world',
		lines: [{ containers: [], kind: 'para' }],
		marks: [{ start: 6, end: 6, type: 'anchor', attrs: { id: 'a1' } } as never],
		islands: []
	};

	it('an anchor survives an edit before it (auto-rebase, no op needed)', () => {
		const doc = freshDoc();
		doc.overwrite({}, anchorRt);
		const oldRt = doc.main.body;
		const state = EditorState.create({ doc: decode(oldRt, blockSchema) });
		const tr = state.tr.insertText('XX', 1); // insert before the anchor at USV 6
		const bundle = lower(contentEdit(oldRt, pmToContent(tr.doc)), {
			newAnchors: [{ id: 'a1', pos: 8 }] // rebased +2
		});
		doc.applyChange({}, bundle);
		const anchor = doc.main.body.marks.find(isAnchorMark);
		expect(anchor?.attrs.id).toBe('a1');
		expect(anchor?.start).toBe(8);
	});

	it('an anchor survives a code-block-interior edit (the payoff: op path, not install)', () => {
		// Adding an interior line to a code block lowers via `setContinues`, not
		// `install`, so this field's anchor rebases through the splice instead of
		// being dropped.
		const doc = freshDoc();
		const codeRt: Content = {
			text: 'abc',
			lines: [{ containers: [], kind: 'code' }],
			marks: [{ start: 3, end: 3, type: 'anchor', attrs: { id: 'c1' } } as never],
			islands: []
		};
		doc.overwrite({}, codeRt);
		const oldRt = doc.main.body;
		const state = EditorState.create({ doc: decode(oldRt, blockSchema) });
		const tr = state.tr.insertText('\n', 2); // a code-interior line before the anchor
		const edit = contentEdit(oldRt, pmToContent(tr.doc));
		const bundle = lower(edit, {
			newAnchors: [{ id: 'c1', pos: 4 }] // the \n inserts before it → +1
		});
		doc.applyChange({}, bundle);
		const body = doc.main.body;
		expect(body.lines).toHaveLength(2);
		expect(!!body.lines[1].continues).toBe(true);
		const anchor = body.marks.find(isAnchorMark);
		expect(anchor?.attrs.id).toBe('c1');
	});

	// The two associativities agree everywhere but at the anchor's own position, which
	// is where an anchor sits: a point pinned to a boundary.
	describe('an insertion at the anchor’s own position', () => {
		/** The anchor's position as the field's plugin holds it: PM-mapped through the
		 *  transaction with `bias`, read back in USV. */
		function projected(oldDoc: PMNode, tr: Transaction, pos: number, bias: 1 | -1): number {
			const pm = usvToPM(buildLineIndex(oldDoc), pos);
			return pmToUsv(buildLineIndex(tr.doc), tr.mapping.map(pm, bias));
		}

		/** Lower an edit against a held anchor and apply it, with the post-edit anchor
		 *  the plugin's `bias` produces. Returns where the store put it, against where
		 *  the projection did. */
		function commit(rt: Content, pos: number, bias: 1 | -1, mkTr: (s: EditorState) => Transaction) {
			const doc = freshDoc();
			doc.overwrite({}, rt);
			const oldRt = doc.main.body;
			const oldDoc = decode(oldRt, blockSchema);
			const tr = mkTr(EditorState.create({ doc: oldDoc }));
			const after = projected(oldDoc, tr, pos, bias);
			const bundle = lower(contentEdit(oldRt, pmToContent(tr.doc)), {
				newAnchors: [{ id: 'a1', pos: after }]
			});
			doc.applyChange({}, bundle);
			return { stored: anchorAt(doc.main.body, 'a1'), projected: after, bundle };
		}

		/** The inline island entry an image projects: a slot the island channel places. */
		const imageEntry = () => ({ ...md('![a](u)').islands[0], id: 'isl-9' });

		// Which bias the plugin maps with is `field.ts`'s to choose; whichever it picks,
		// the store has to land where the projection put it. Both are asserted, so the
		// pair holds through a retune of a dial neither owns.
		for (const bias of [-1, 1] as const) {
			it(`the delta channel lands the store where the projection put it (bias ${bias})`, () => {
				const { stored, projected } = commit(anchorRt, 6, bias, (s) =>
					s.tr.insertText('X', usvToPM(buildLineIndex(s.doc), 6))
				);
				expect(stored).toBe(projected);
			});

			it(`the island channel lands the store where the projection put it (bias ${bias})`, () => {
				const { stored, projected, bundle } = commit(anchorRt, 6, bias, (s) =>
					s.tr.insert(
						usvToPM(buildLineIndex(s.doc), 6),
						blockSchema.nodes.island_inline.create(imageEntry())
					)
				);
				expect(bundle.islandOps, 'the slot rides the island channel').toMatchObject([
					{ op: 'insert', at: 6 }
				]);
				expect(stored).toBe(projected);
			});
		}

		it('agreement is silent: a projection matching the engine’s rebase emits no anchor op', () => {
			const { bundle } = commit(anchorRt, 6, -1, (s) =>
				s.tr.insertText('X', usvToPM(buildLineIndex(s.doc), 6))
			);
			expect(bundle.markOps ?? []).toEqual([]);
		});
	});
});

describe('the island channel — an island edit lowers op-wise', () => {
	// A block island between two paragraphs: `￼` on its own `island` line.
	const TABLE_MD = 'para\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntail';

	/** The block island node and its position: the projection the table NodeView hands
	 *  the codec, built here directly so the lowering is under test on its own. */
	function islandOf(doc: PMNode): { pos: number; node: PMNode } {
		let found: { pos: number; node: PMNode } | undefined;
		doc.descendants((node, pos) => {
			if (node.type.name === 'island_block') found = { node, pos };
			return !found;
		});
		if (!found) throw new Error('no island node in the projection');
		return found;
	}

	/** Retype the island's first header cell: an edit to `props` alone, which the
	 *  text does not see (cell text lives in the entry, never in `Content.text`). */
	function retypeCell(state: EditorState, text: string): Transaction {
		const { pos, node } = islandOf(state.doc);
		const props = JSON.parse(JSON.stringify(node.attrs.props)) as TableProps;
		props.header[0].text = text;
		return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, props });
	}

	/** Install `rt`, project it, and lower the edit `mkTr` makes. */
	function lowerEdit(
		rt: Content,
		mkTr: (state: EditorState) => Transaction,
		opts: AnchorOpts = {}
	) {
		const doc = freshDoc();
		doc.overwrite({}, rt);
		const oldRt = doc.main.body;
		const state = EditorState.create({ doc: decode(oldRt, blockSchema) });
		const newDoc = mkTr(state).doc;
		return { doc, oldRt, newDoc, bundle: lower(contentEdit(oldRt, pmToContent(newDoc)), opts) };
	}

	/** The stored anchor `id`'s position, or `undefined` if it is gone. */
	it('a cell edit lowers to `set` and reaches the store', () => {
		const { doc, bundle } = lowerEdit(md(TABLE_MD), (s) => retypeCell(s, 'HEAD'));
		// The text is untouched: an island edit is not a splice.
		expect(bundle.delta).toBeUndefined();
		expect(bundle.islandOps).toHaveLength(1);
		expect(bundle.islandOps?.[0]).toMatchObject({ op: 'set', id: 'isl-0', type: 'table' });
		doc.applyChange({}, bundle);
		expect((doc.main.body.islands[0].props as TableProps).header[0].text).toBe('HEAD');
	});

	it('every anchor in the field survives a cell edit', () => {
		const rt = md(TABLE_MD);
		rt.marks.push({ start: 2, end: 2, type: 'anchor', attrs: { id: 'a1' } } as never);
		const { doc, bundle } = lowerEdit(rt, (s) => retypeCell(s, 'HEAD'), {
			newAnchors: [{ id: 'a1', pos: 2 }]
		});
		doc.applyChange({}, bundle);
		expect(anchorAt(doc.main.body, 'a1')).toBe(2);
	});

	it('a degraded island keeps its class: `loss` is authored, never re-stamped', () => {
		const rt = md(TABLE_MD);
		rt.islands[0].loss = 'degraded';
		const { doc, oldRt, bundle } = lowerEdit(rt, (s) => retypeCell(s, 'HEAD'));
		expect(oldRt.islands[0].loss).toBe('degraded'); // the node carried it out
		doc.applyChange({}, bundle);
		expect(doc.main.body.islands[0].loss).toBe('degraded');
	});

	it('a block island lowers to delta → islandOps → lineOps, and anchors survive', () => {
		const rt = md('one\n\ntwo');
		rt.marks.push({ start: 1, end: 1, type: 'anchor', attrs: { id: 'a1' } } as never);
		const entry = {
			id: 'isl-0',
			islandType: 'table',
			loss: 'lossless',
			props: { header: [{ text: 'h', marks: [] }], rows: [], aligns: ['none'] }
		};
		const { doc, bundle } = lowerEdit(
			rt,
			(s) => s.tr.insert(s.doc.child(0).nodeSize, blockSchema.nodes.island_block.create(entry)),
			{ newAnchors: [{ id: 'a1', pos: 1 }] }
		);
		// The delta opens the line, the island op places the slot, the line op tags it.
		expect(bundle.delta?.ops).toContainEqual({ insert: '\n' });
		expect(bundle.islandOps).toEqual([
			expect.objectContaining({ op: 'insert', at: 4, id: 'isl-0', type: 'table' })
		]);
		expect(bundle.lineOps).toContainEqual({ op: 'setKind', line: 1, kind: 'island' });
		doc.applyChange({}, bundle);
		expect(doc.main.body.text).toBe('one\n￼\ntwo');
		expect(doc.main.body.islands.map((i) => i.id)).toEqual(['isl-0']);
		expect(anchorAt(doc.main.body, 'a1')).toBe(1);
	});

	it('a splice spanning an existing slot re-places it through the channel', () => {
		// Two edits either side of the island collapse into one splice whose insert
		// would carry `￼` (`IslandSlotInInsert`); the slot moves to the channel and
		// the delta commits the text alone.
		const { doc, bundle } = lowerEdit(md(TABLE_MD), (s) =>
			s.tr.insertText('X', 2).insertText('Y', 11)
		);
		const inserts = bundle.delta?.ops.filter((op) => 'insert' in op) as { insert: string }[];
		expect(inserts.every((op) => !op.insert.includes('￼'))).toBe(true);
		expect(bundle.islandOps).toEqual([expect.objectContaining({ op: 'insert', id: 'isl-0' })]);
		doc.applyChange({}, bundle);
		expect(doc.main.body.text).toBe('pXara\n￼\ntaYil');
		expect(doc.main.body.islands.map((i) => i.id)).toEqual(['isl-0']);
	});

	it('a text edit beside an island emits no island op', () => {
		const { bundle } = lowerApply(md(TABLE_MD), (s) => s.tr.insertText('X', 2));
		expect(bundle.islandOps).toBeUndefined();
	});

	it('deleting an island needs no op: the delta that drops its slot drops the entry', () => {
		const { doc, bundle } = lowerEdit(md(TABLE_MD), (s) => s.tr.delete(6, 7));
		expect(bundle.islandOps).toBeUndefined();
		doc.applyChange({}, bundle);
		expect(doc.main.body.islands).toHaveLength(0);
	});
});
