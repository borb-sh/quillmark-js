// The block link: the cases that are about the body, or about the caret's own line,
// rather than about the surface either stands in — the body's very start, the one
// position no surface owns and the only route to a block above a first block a gap
// cursor will not sit beside; a selection spanning two textblocks, which upstream's
// `splitBlock` computes against the pre-delete document; and a Delete on an empty
// line, which upstream joins the block below into. Driven through `bodyKeymap` over
// `baseKeymap`, so the link is under test at its place in the chain rather than on
// its own.
import { describe, it, expect } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { blockSchema, bodyKeymap, decode } from '$lib/core/codec';
import { md, atBlock, startOf, keyDriver, shape, textblocks } from './_util.js';

const { expectPress, press } = keyDriver(bodyKeymap(blockSchema));

/** A state over `markdown` with the caret at `offset` in the `index`-th textblock. */
function at(markdown: string, index: number, offset: number): EditorState {
	const doc = decode(md(markdown), blockSchema);
	const block = textblocks(doc)[index];
	return EditorState.create({
		doc,
		selection: TextSelection.create(doc, block.start + offset)
	});
}

// Hand-built nodes for the empty-block shapes: markdown spells neither an empty
// paragraph nor an empty item, so these cases cannot come from `md()`.
const n = blockSchema.nodes;
const p = (text?: string) => n.paragraph.create(null, text ? blockSchema.text(text) : undefined);
const li = (...blocks: PMNode[]) => n.list_item.create(null, blocks);
const ul = (...items: PMNode[]) => n.bullet_list.create(null, items);
const quote = (...blocks: PMNode[]) => n.blockquote.create(null, blocks);
const docOf = (...blocks: PMNode[]) => n.doc.create(null, blocks);

describe('a first block a gap cursor declines gets a paragraph above it', () => {
	it('a fence that opens the body', () => {
		expectPress(startOf('```\ncode\n```', 0), 'Enter', 'doc(paragraph, code_block("code"))');
	});

	it('a quote that opens the body', () => {
		expectPress(startOf('> quoted', 0), 'Enter', 'doc(paragraph, blockquote(paragraph("quoted")))');
	});

	it('a list that opens the body', () => {
		expectPress(
			startOf('- a\n- b', 0),
			'Enter',
			'doc(paragraph, bullet_list(list_item(paragraph("a")), list_item(paragraph("b"))))'
		);
	});

	it('a fence in an item that opens the body', () => {
		expectPress(
			startOf('- ```\n  code\n  ```', 0),
			'Enter',
			'doc(paragraph, bullet_list(list_item(code_block("code"))))'
		);
	});

	it('an empty fence that opens the body becomes the paragraph', () => {
		expectPress(startOf('```\n\n```', 0), 'Enter', 'doc(paragraph)');
	});

	it("an empty fence in an item that opens the body becomes the item's paragraph", () => {
		expectPress(startOf('- ```\n  \n  ```', 0), 'Enter', 'doc(bullet_list(list_item(paragraph)))');
	});

	it('the caret stays with the text it pushed down', () => {
		const next = press(startOf('```\ncode\n```', 0), 'Enter');
		expect(next.selection.$from.parent.type.name).toBe('code_block');
		expect(next.selection.$from.parentOffset).toBe(0);
	});
});

describe('everywhere else the key keeps its meaning', () => {
	it('a paragraph that opens the body splits', () => {
		expectPress(startOf('head', 0), 'Enter', 'doc(paragraph, paragraph("head"))');
	});

	it('a heading that opens the body splits', () => {
		expectPress(startOf('# head', 0), 'Enter', 'doc(paragraph, heading("head"))');
	});

	it('a fence below a block takes a newline — there is a block above to reach', () => {
		expectPress(
			at('head\n\n```\ncode\n```', 1, 0),
			'Enter',
			'doc(paragraph("head"), code_block("\\ncode"))'
		);
	});

	it('an empty fence below a block takes a newline — there is a block above to reach', () => {
		expectPress(
			at('head\n\n```\n\n```', 1, 0),
			'Enter',
			'doc(paragraph("head"), code_block("\\n"))'
		);
	});

	it('mid-fence takes a newline', () => {
		expectPress(at('```\ncode\n```', 0, 2), 'Enter', 'doc(code_block("co\\nde"))');
	});

	it('an empty first item still exits the list', () => {
		expectPress(
			startOf('- \n- b', 0),
			'Enter',
			'doc(paragraph, bullet_list(list_item(paragraph("b"))))'
		);
	});

	it('a list under a rule is still the list link', () => {
		expectPress(
			at('---\n\n- a', 0, 0),
			'Enter',
			'doc(horizontal_rule, paragraph, bullet_list(list_item(paragraph("a"))))'
		);
	});
});

describe('Enter over a selection spanning two textblocks', () => {
	/** A state over `markdown` selecting `[from, to]` in PM coordinates. */
	function span(markdown: string, from: number, to: number): EditorState {
		const doc = decode(md(markdown), blockSchema);
		return EditorState.create({
			doc,
			selection: TextSelection.between(doc.resolve(from), doc.resolve(to))
		});
	}

	// The shape is the selection's own delete plus a split at the caret it leaves:
	// upstream throws here instead, retyping a `list_item` to a paragraph.
	it("a range from a heading's head into a list", () => {
		expectPress(
			span('# head\n\n1. item\n2. two', 1, 10),
			'Enter',
			'doc(ordered_list(list_item(paragraph, paragraph("tem")), list_item(paragraph("two"))))'
		);
	});

	it("a range from a heading's head into a nested list", () => {
		expectPress(
			span('# head\n\n1. - # a\n\n   x', 1, 12),
			'Enter',
			'doc(ordered_list(list_item(bullet_list(list_item(heading, paragraph)), paragraph("x"))))'
		);
	});

	it('a range across two paragraphs', () => {
		expectPress(span('a\n\nb', 1, 5), 'Enter', 'doc(paragraph, paragraph)');
	});

	it('a range inside one textblock is still the ordinary split', () => {
		expectPress(span('head line', 1, 5), 'Enter', 'doc(paragraph, paragraph(" line"))');
	});
});

describe('Delete on an empty line takes the line', () => {
	it('the line between two lists goes, and both lists stand', () => {
		expectPress(
			atBlock(docOf(ul(li(p('a'))), p(), ul(li(p('b')))), 1),
			'Delete',
			'doc(bullet_list(list_item(paragraph("a"))), bullet_list(list_item(paragraph("b"))))'
		);
	});

	// Enter on an empty middle item splits the list around a fresh paragraph; Delete
	// closes that gap, the caret already standing on it.
	it('closes the gap an empty item’s Enter opened', () => {
		const gap = press(atBlock(docOf(ul(li(p('a')), li(p()), li(p('c')))), 1), 'Enter');
		expect(shape(gap)).toBe(
			'doc(bullet_list(list_item(paragraph("a"))), paragraph, bullet_list(list_item(paragraph("c"))))'
		);
		expectPress(
			gap,
			'Delete',
			'doc(bullet_list(list_item(paragraph("a"))), bullet_list(list_item(paragraph("c"))))'
		);
	});

	it('a quote below the line keeps its wrapper', () => {
		expectPress(atBlock(docOf(p(), quote(p('b'))), 0), 'Delete', 'doc(blockquote(paragraph("b")))');
	});

	it('a heading below the line keeps its level', () => {
		expectPress(
			atBlock(docOf(p(), n.heading.create({ level: 2 }, blockSchema.text('b'))), 0),
			'Delete',
			'doc(heading("b"))'
		);
	});

	// Taken, not eaten: the island stands and the selection lands on it, which is the
	// state `atoms.ts` draws before a press that would take it (CODEC §"A delete against
	// an island"). So the table goes on the press after, never on this one.
	it('an island below the line stands, armed for the press after', () => {
		const next = expectPress(
			atBlock(
				docOf(
					p(),
					n.island_block.create({
						id: 'isl-0',
						islandType: 'table',
						props: { header: [], rows: [], aligns: [] }
					})
				),
				0
			),
			'Delete',
			'doc(island_block)'
		);
		expect(next.selection).toBeInstanceOf(NodeSelection);
		expect((next.selection as NodeSelection).node.type.name).toBe('island_block');
	});

	it('an item’s continuation line goes, and the item below stays an item', () => {
		expectPress(
			atBlock(docOf(ul(li(p('a'), p()), li(p('b')))), 1),
			'Delete',
			'doc(bullet_list(list_item(paragraph("a")), list_item(paragraph("b"))))'
		);
	});

	it('a quote’s last line goes, and the prose below stays outside it', () => {
		expectPress(
			atBlock(docOf(quote(p('a'), p()), p('b')), 1),
			'Delete',
			'doc(blockquote(paragraph("a")), paragraph("b"))'
		);
	});

	it('the caret lands on the line that moved up', () => {
		const next = press(atBlock(docOf(p(), ul(li(p('b')))), 0), 'Delete');
		expect(next.selection.$from.parent.textContent).toBe('b');
		expect(next.selection.$from.parentOffset).toBe(0);
	});
});

describe('and declines where the line is a construct, or the last of them', () => {
	// The list link spends the empty item on the seam below (`lists.ts`), ahead of the
	// base keymap, which unmarks the item below to fill it instead.
	it('an empty item is the list keys’, the line being the whole of the item', () => {
		expectPress(
			atBlock(docOf(ul(li(p()), li(p('b')))), 0),
			'Delete',
			'doc(bullet_list(list_item(paragraph("b"))))'
		);
	});

	it('an empty quote is not a line in one', () => {
		expectPress(
			atBlock(docOf(quote(p()), p('b')), 0),
			'Delete',
			'doc(blockquote(paragraph, paragraph("b")))'
		);
	});

	it('with nothing after it the key is inert — a line with no next line', () => {
		expectPress(atBlock(docOf(p('a'), p()), 1), 'Delete', 'doc(paragraph("a"), paragraph)');
	});

	it('a line with text in it is the ordinary join', () => {
		expectPress(at('a\n\nb', 0, 1), 'Delete', 'doc(paragraph("ab"))');
	});
});
