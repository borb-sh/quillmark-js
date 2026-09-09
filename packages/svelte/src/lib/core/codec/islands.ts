// Islands: the `U+FFFC` slot + `ContentIsland` entry ↔ a PM leaf node. A slot
// inside a `para` line is an inline island (an image); an `island`-kind line is a
// block island (a table). The node carries `id`, `islandType`, and the opaque
// `props` verbatim, so an unknown island type round-trips untouched.
//
// A props-aware consumer reads the shape straight off the boundary:
// `ContentIsland.props` is the typed union (`TableProps` for `table`,
// `ImageProps` for `image`; DOCUMENT_MODEL §Stability seams), so the codec
// reads it rather than hand-rolling a shape or guard. The open `type` arm means
// a discriminant check does not auto-narrow `props`; key off `type` and read
// `props` as the matching upstream type.
import { Fragment, Slice, type Node as PMNode, type NodeSpec } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { ContentIsland, TableCell, TableProps } from '@quillmark/wasm';

/** The `U+FFFC` object-replacement char that occupies one island slot in `text`. */
export const ISLAND_SLOT = '￼';

// The four island node attributes carry the content entry verbatim: `id` is the
// stable identity (rebases like an anchor), `islandType` the discriminator, `props`
// the opaque payload the codec preserves byte-for-byte across a round-trip, and
// `loss` how faithfully markdown can carry it. `loss` is authored, not derived:
// `applyChange` stores the class an island op gives it and re-derives nothing, so
// an entry that did not carry its own would promote a degraded table to lossless
// on the first cell edit. The default under-claims, so a node no decode produced
// does not over-claim; decode always supplies the stored value.
const islandAttrs = {
	id: { default: '' },
	props: { default: null },
	loss: { default: 'unrepresentable' }
};

/** The island vocabulary is closed, so a node's `islandType` default is a member of
 *  it and not an empty placeholder: a node minted without one still has to project to
 *  a storable entry. Each spec defaults to the type its slot carries — a block island
 *  is a table, an inline one an image. */
const blockAttrs = { ...islandAttrs, islandType: { default: 'table' } };
const inlineAttrs = { ...islandAttrs, islandType: { default: 'image' } };

// All four attributes cross the DOM: a copy and a paste inside one body run the document
// through `toDOM`/`parseDOM` (CODEC §"Markdown at the edges"), and an island is a leaf
// whose tags alone say only `[table]`. `props` crosses as JSON, the form the payload has
// at the boundary. The names are `data-qm-*` like every other carrier's, and the id is
// what the rule requires: an island is a leaf, so a rule reading a tag someone else
// chose would swallow that element's whole subtree.

/** The DOM an island node writes and reads back, for either spec. */
function islandDOM(node: PMNode): Record<string, string> {
	return {
		'data-qm-island': node.attrs.islandType as string,
		'data-qm-island-id': node.attrs.id as string,
		'data-qm-island-loss': node.attrs.loss as string,
		'data-qm-island-props': JSON.stringify(node.attrs.props ?? null)
	};
}

/** An island node's attributes off that DOM, or `false` where the id is absent. A
 *  `props` that is not the JSON written above reads as `null`, and one of the wrong
 *  shape is `undefined` at its reader (§`tablePropsOfNode`): the entry survives as an
 *  island of its type rather than taking the paste down with it. */
function islandAttrsFromDOM(el: HTMLElement): IslandNodeAttrs | false {
	const id = el.getAttribute('data-qm-island-id');
	if (id == null) return false;
	const raw = el.getAttribute('data-qm-island-props');
	let props: unknown = null;
	try {
		props = raw == null ? null : JSON.parse(raw);
	} catch {
		props = null;
	}
	// A type outside the vocabulary declines the rule, so a paste carrying one arrives
	// as the text around it rather than as a node no write can store.
	const islandType = el.getAttribute('data-qm-island') ?? '';
	if (!ISLAND_TYPES.has(islandType)) return false;
	return {
		id,
		islandType,
		props,
		loss: (el.getAttribute('data-qm-island-loss') ?? 'unrepresentable') as ContentIsland['loss']
	};
}

/** Block island node (a table): one `island`-kind content line. Atom, unselectable content. */
export const islandBlockSpec: NodeSpec = {
	group: 'block',
	atom: true,
	selectable: true,
	attrs: blockAttrs,
	parseDOM: [{ tag: 'div[data-qm-island]', getAttrs: (el) => islandAttrsFromDOM(el) }],
	toDOM: (node) => ['div', islandDOM(node), `[${node.attrs.islandType as string}]`]
};

/** Inline island node (an image): a `U+FFFC` slot inside a `para` line. */
export const islandInlineSpec: NodeSpec = {
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	attrs: inlineAttrs,
	parseDOM: [{ tag: 'span[data-qm-island]', getAttrs: (el) => islandAttrsFromDOM(el) }],
	toDOM: (node) => ['span', islandDOM(node), `[${node.attrs.islandType as string}]`]
};

/** A PM island node's attributes: the content entry, spelled the way a node spec
 *  spells it (`islandType`, because `type` on a PM node is the node type). `loss`
 *  reads its class off the entry rather than restating the union, which the public
 *  entry point does not name (DOCUMENT_MODEL §Stability seams). */
export interface IslandNodeAttrs {
	id: string;
	islandType: string;
	props: unknown;
	loss: ContentIsland['loss'];
}

/** The island types the content model names, closed. A value outside it never reaches
 *  a read and throws on a write, so it is what the DOM parse admits. */
const ISLAND_TYPES = new Set<string>(['table', 'image']);

/** Build a content island entry from a PM island node's attrs (block or inline).
 *  The pair crosses as one: an attr bag is untyped, and both producers correlate it —
 *  a decode carries a typed entry through, and the DOM parse admits only a named type
 *  ({@link islandAttrsFromDOM}). A malformed `props` under a named type survives to
 *  the reader that draws the placeholder for it ({@link tablePropsOfNode}). */
export function islandEntryFromNode(attrs: IslandNodeAttrs): ContentIsland {
	return {
		id: attrs.id,
		type: attrs.islandType,
		props: attrs.props,
		loss: attrs.loss
	} as ContentIsland;
}

/** The `TableProps` shape, over a value that reached the node off the DOM rather than
 *  out of a decode: the rectangle every reader indexes (`table.ts`), down to the `text`
 *  a row's emptiness is read off. */
function isTableProps(props: unknown): props is TableProps {
	if (typeof props !== 'object' || props === null) return false;
	const { header, rows, aligns } = props as Record<string, unknown>;
	const cells = (v: unknown): boolean =>
		Array.isArray(v) &&
		v.every(
			(c) => typeof c === 'object' && c !== null && typeof (c as TableCell).text === 'string'
		);
	return (
		cells(header) && Array.isArray(aligns) && Array.isArray(rows) && rows.every((row) => cells(row))
	);
}

/** A node's `TableProps`, or `undefined` for any other island and for a payload of the
 *  wrong shape. The type says which reader, the shape says whether it can read — a
 *  node's attrs reach here off the DOM as well as out of a decode, so the discriminant
 *  narrowing the union is not on its own proof the payload is well-formed; every caller
 *  draws the placeholder for `undefined` (`table-view.ts` §`render`). */
export function tablePropsOfNode(node: PMNode): TableProps | undefined {
	const entry = islandEntryFromNode(node.attrs as IslandNodeAttrs);
	return entry.type === 'table' && isTableProps(entry.props) ? entry.props : undefined;
}

/**
 * A minter over one document: the positional `isl-{n}` sequence continued past the
 * highest id the field already holds, handing out consecutive ids, so a caller placing
 * several islands at once keeps one minter for the lot. A minted id is this tier's to
 * produce and it is part of the document's canonical bytes (CODEC §Islands), so it is a
 * counter over the projection in hand — never a UUID, never a clock reading, and never a
 * re-numbering of the ids already there, which are identities.
 *
 * Reads the PM doc rather than the stored content because that is what the caller (an
 * insert command, a paste) holds and what the commit will project: an id minted against
 * a stale content could collide with one the same transaction places.
 */
export function islandMinter(doc: PMNode): () => string {
	return islandState(doc).mint;
}

/** The ids a document holds and the minter continuing past them, off one sweep: both
 *  are the same walk under the same predicate, and the paste pass wants both. */
function islandState(doc: PMNode): { held: Set<string>; mint: () => string } {
	const held = new Set<string>();
	let next = 0;
	doc.descendants((node) => {
		if (!isIsland(node)) return true;
		const id = node.attrs.id as string;
		held.add(id);
		const m = /^isl-(\d+)$/.exec(id);
		if (m) next = Math.max(next, Number(m[1]) + 1);
		return false;
	});
	return { held, mint: () => `isl-${next++}` };
}

/** The next island id for a field: one draw from {@link islandMinter}, which is what a
 *  command placing exactly one island wants. */
export function mintIslandId(doc: PMNode): string {
	return islandMinter(doc)();
}

/** Either island node: the test the sweep and the paste pass share, so a third island
 *  shape is one arm rather than two. */
function isIsland(node: PMNode): boolean {
	return node.type.name === 'island_block' || node.type.name === 'island_inline';
}

/** `fragment` with every island whose id is already `taken` re-minted, or `null` where
 *  none was: an untouched paste stays the slice it arrived as. Every surviving id joins
 *  the set, so a slice carrying one id twice comes apart in the same pass. */
function remintIslands(
	fragment: Fragment,
	taken: Set<string>,
	mint: () => string
): Fragment | null {
	const out: PMNode[] = [];
	let changed = false;
	fragment.forEach((node) => {
		if (!isIsland(node)) {
			const inner = node.isLeaf ? null : remintIslands(node.content, taken, mint);
			changed ||= inner !== null;
			out.push(inner ? node.copy(inner) : node);
			return;
		}
		let id = node.attrs.id as string;
		if (taken.has(id)) {
			do id = mint();
			while (taken.has(id));
			changed = true;
		}
		taken.add(id);
		out.push(
			id === node.attrs.id ? node : node.type.create({ ...node.attrs, id }, null, node.marks)
		);
	});
	return changed ? Fragment.fromArray(out) : null;
}

/**
 * The paste's island pass: an id the field already holds is re-minted on the way in.
 *
 * An id is an identity in the content and unique across the field, so two islands
 * wearing one is a projection the store has no shape for. A copy rather than a cut is
 * where that arrives, and a paste out of a second field is the other; a cut pasted back
 * collides with nothing and keeps the identity it had.
 *
 * The test is the document as it stands, which a drag moving a selection over an island
 * reads one too many: the original is still there when the slice is transformed and gone
 * when it lands, so that island arrives under a fresh id. A fresh id costs it nothing a
 * duplicate would cost the whole field.
 *
 * A plugin prop rather than a view option: the leaf mounts the codec's plugin stack, and
 * which nodes carry an identity is the codec's to know.
 */
export function islandPastePlugin(): Plugin {
	return new Plugin({
		props: {
			transformPasted: (slice, view) => {
				const { held, mint } = islandState(view.state.doc);
				const content = remintIslands(slice.content, held, mint);
				return content ? new Slice(content, slice.openStart, slice.openEnd) : slice;
			}
		}
	});
}
