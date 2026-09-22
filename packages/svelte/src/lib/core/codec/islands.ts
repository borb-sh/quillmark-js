// Islands: the `U+FFFC` slot + `ContentIsland` entry ↔ a PM leaf node. Every slot sits
// in a `para` line; the island's type says which node it is, a `table` a block alone on
// its line and an `image` inline. The node carries `id`, `islandType` and `props` verbatim.
//
// A props-aware consumer reads the shape straight off the boundary:
// `ContentIsland.props` is the typed union (`TableProps` for `table`,
// `ImageProps` for `image`; DOCUMENT_MODEL §Stability seams), so the codec
// reads it rather than hand-rolling a shape. `type` is a closed set, so a
// discriminant check narrows it; `props` still crosses the DOM as opaque JSON,
// which is what §`tablePropsOfNode` guards.
import { Fragment, Slice, type Node as PMNode, type NodeSpec } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { ContentIsland, TableCell, TableProps } from '@quillmark/wasm';
import { storableUrl } from './urls.js';

/** The `U+FFFC` object-replacement char that occupies one island slot in `text`. */
export const ISLAND_SLOT = '￼';

// The three island node attributes carry the content entry verbatim: `id` is the
// stable identity (rebases like an anchor), `islandType` the discriminator, and `props`
// the payload the codec preserves byte-for-byte across a round-trip. `islandType` and
// `props` declare no default: a node standing for an island holds one, so the pair is
// supplied at every `create`.
const islandAttrs = {
	id: { default: '' },
	islandType: {},
	props: {}
};

// All three attributes cross the DOM: a copy and a paste inside one body run the document
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
		'data-qm-island-props': JSON.stringify(node.attrs.props ?? null)
	};
}

/** The island types the content model names, each with whether its markup is a block,
 *  which decides the node its slot decodes to. A `Record` over the boundary's own union,
 *  so a member added upstream is a missing key here rather than a silent refusal at the
 *  one door with no decode behind it. */
const BLOCK_ISLAND: Record<ContentIsland['type'], boolean> = { table: true, image: false };

/** Whether an island of `type` is block markup: a `table` stands alone on its line. */
export function isBlockIsland(type: ContentIsland['type']): boolean {
	return BLOCK_ISLAND[type];
}

/** An island node's attributes off that DOM, or `false` where the id is absent or the
 *  type is one the content vocabulary does not name — a name no read produces and no
 *  write takes, so the element's text arrives as text. A `props` that is not the JSON
 *  written above reads as `null`, and one of the wrong shape is `undefined` at its
 *  reader (§`tablePropsOfNode`): the entry survives as an island of its type rather
 *  than taking the paste down with it. */
function islandAttrsFromDOM(el: HTMLElement): IslandNodeAttrs | false {
	const id = el.getAttribute('data-qm-island-id');
	// Asserted off an untrusted attribute and checked against the set on the next line.
	const type = el.getAttribute('data-qm-island') as ContentIsland['type'] | null;
	if (id == null || type == null || !Object.hasOwn(BLOCK_ISLAND, type)) return false;
	const raw = el.getAttribute('data-qm-island-props');
	let props: unknown = null;
	try {
		props = raw == null ? null : JSON.parse(raw);
	} catch {
		props = null;
	}
	return { id, islandType: type, props: storableProps(type, props) };
}

/** `props` with the one key the authored lane refuses made storable: an `image`'s `url`
 *  carrying a line ending, which `IslandOp` and `overwrite` throw on. The rest crosses
 *  opaque, as it did on the way out. */
function storableProps(type: ContentIsland['type'], props: unknown): unknown {
	if (type !== 'image' || typeof props !== 'object' || props === null) return props;
	const url = (props as { url?: unknown }).url;
	return typeof url === 'string' ? { ...props, url: storableUrl(url) } : props;
}

/** Block island node (a table): a `U+FFFC` slot alone on its `para` line. Atom, unselectable content. */
export const islandBlockSpec: NodeSpec = {
	group: 'block',
	atom: true,
	selectable: true,
	attrs: islandAttrs,
	parseDOM: [{ tag: 'div[data-qm-island]', getAttrs: (el) => islandAttrsFromDOM(el) }],
	toDOM: (node) => ['div', islandDOM(node), `[${node.attrs.islandType || 'island'}]`]
};

/** Inline island node (an image): a `U+FFFC` slot inside a `para` line. */
export const islandInlineSpec: NodeSpec = {
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	attrs: islandAttrs,
	parseDOM: [{ tag: 'span[data-qm-island]', getAttrs: (el) => islandAttrsFromDOM(el) }],
	toDOM: (node) => ['span', islandDOM(node), `[${node.attrs.islandType || 'island'}]`]
};

/** A PM island node's attributes: the content entry, spelled the way a node spec
 *  spells it (`islandType`, because `type` on a PM node is the node type). `islandType`
 *  reads its set off the entry rather than restating it (DOCUMENT_MODEL §Stability
 *  seams). */
export interface IslandNodeAttrs {
	id: string;
	islandType: ContentIsland['type'];
	props: unknown;
}

/** Build a content island entry from a PM island node's attrs (block or inline). The
 *  cast pairs a closed `type` with a `props` that crossed the DOM as opaque JSON. The
 *  store is lenient about a table's shape — it fills what it can and keeps the rest —
 *  so a payload the arm does not hold is stored rather than refused, and `undefined` at
 *  its reader is what the surface draws the placeholder for (§`tablePropsOfNode`). */
export function islandEntryFromNode(attrs: IslandNodeAttrs): ContentIsland {
	return {
		id: attrs.id,
		type: attrs.islandType,
		props: attrs.props
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
 *  wrong shape: the boundary's own guard over the entry the node carries, so a `props`
 *  that crossed the DOM is read once here rather than at each reader. The type says
 *  which reader, the shape says whether it can read; every caller draws the placeholder
 *  for `undefined` (`table-view.ts` §`render`). */
export function tablePropsOfNode(node: PMNode): TableProps | undefined {
	const attrs = node.attrs as IslandNodeAttrs;
	return attrs.islandType === 'table' && isTableProps(attrs.props) ? attrs.props : undefined;
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
