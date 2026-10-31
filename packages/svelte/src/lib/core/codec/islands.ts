// Islands: the `U+FFFC` slot + `ContentIsland` entry ↔ a PM leaf node. Every slot sits in a `para`
// line; the island's type says which node it is, a `table` a block alone on its line and every
// other type inline. The node carries `id`, `islandType` and `props` verbatim.
//
// `ContentIsland.props` is the typed union at the boundary (DOCUMENT_MODEL §Stability seams), so a
// discriminant check narrows it; `props` still crosses the DOM as opaque JSON, which
// §`tablePropsOfNode` guards.
import {
	Fragment,
	Slice,
	type DOMOutputSpec,
	type Node as PMNode,
	type NodeSpec
} from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type {
	ContentIsland,
	FootnoteProps,
	MathProps,
	TableCell,
	TableProps
} from '@quillmark/wasm';
import { storableUrl } from './urls.js';

/** The `U+FFFC` object-replacement char that occupies one island slot in `text`. */
export const ISLAND_SLOT = '￼';

// The three island node attributes carry the content entry verbatim: `id` is the stable identity
// (rebases like an anchor), `islandType` the discriminator, `props` the payload preserved
// byte-for-byte. `islandType` and `props` declare no default: a node standing for an island holds
// one.
const islandAttrs = {
	id: { default: '' },
	islandType: {},
	props: {}
};

// All three attributes cross the DOM, since a copy and a paste inside one body run the document
// through `toDOM`/`parseDOM` (CODEC §"Markdown at the edges") and an island's tags alone say only
// `[table]`. `props` crosses as JSON. The names are `data-qm-*`, and the id is required: an island
// is a leaf, so a rule reading someone else's tag would swallow that element's whole subtree.

/** The DOM an island node writes and reads back, for either spec. */
function islandDOM(node: PMNode): Record<string, string> {
	return {
		'data-qm-island': node.attrs.islandType as string,
		'data-qm-island-id': node.attrs.id as string,
		'data-qm-island-props': JSON.stringify(node.attrs.props ?? null)
	};
}

/**
 * The island types the content model names, each with whether its markup is a block (deciding the
 * node its slot decodes to) and whether a leaf edits it. A `Record` over the boundary's union, so a
 * member added upstream is a missing key here. A footnote and an equation are read, not edited
 * (CODEC §Decode): a leaf holding one is held.
 */
const ISLANDS: Record<ContentIsland['type'], { block: boolean; edited: boolean }> = {
	table: { block: true, edited: true },
	image: { block: false, edited: true },
	footnote: { block: false, edited: false },
	math: { block: false, edited: false }
};

/** Whether an island of `type` is block markup: a `table` stands alone on its line. */
export function isBlockIsland(type: ContentIsland['type']): boolean {
	return ISLANDS[type].block;
}

/** Whether a leaf edits an island of `type`; one holding any other is held (`fitsLeaf`). */
export function isEditedIsland(type: ContentIsland['type']): boolean {
	return ISLANDS[type].edited;
}

/**
 * An island node's attributes off that DOM, or `false` where the id is absent or the type is one no
 * leaf edits (an unknown name, a footnote, an equation), so the element's text arrives as text. A
 * `props` that is not the JSON written above reads as `null`, one of the wrong shape `undefined` at
 * its reader (§`tablePropsOfNode`): the entry survives as an island of its type.
 */
function islandAttrsFromDOM(el: HTMLElement): IslandNodeAttrs | false {
	const id = el.getAttribute('data-qm-island-id');
	// Asserted off an untrusted attribute and checked against the set on the next line.
	const type = el.getAttribute('data-qm-island') as ContentIsland['type'] | null;
	if (id == null || type == null || !Object.hasOwn(ISLANDS, type) || !isEditedIsland(type))
		return false;
	const raw = el.getAttribute('data-qm-island-props');
	let props: unknown = null;
	try {
		props = raw == null ? null : JSON.parse(raw);
	} catch {
		props = null;
	}
	return { id, islandType: type, props: storableProps(type, props) };
}

/**
 * `props` with the one key the authored lane refuses made storable: an `image`'s `url` carrying a
 * line ending, which `IslandOp` and `overwrite` throw on.
 */
function storableProps(type: ContentIsland['type'], props: unknown): unknown {
	if (type !== 'image' || typeof props !== 'object' || props === null) return props;
	const url = (props as { url?: unknown }).url;
	return typeof url === 'string' ? { ...props, url: storableUrl(url) } : props;
}

/** Block island node (a table): a `U+FFFC` slot alone on its `para` line. Atom. */
export const islandBlockSpec: NodeSpec = {
	group: 'block',
	atom: true,
	selectable: true,
	attrs: islandAttrs,
	parseDOM: [{ tag: 'div[data-qm-island]', getAttrs: (el) => islandAttrsFromDOM(el) }],
	toDOM: (node) => ['div', islandDOM(node), `[${node.attrs.islandType || 'island'}]`]
};

/** Inline island node (an image, a footnote, an equation): a `U+FFFC` slot inside a `para` line. */
export const islandInlineSpec: NodeSpec = {
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	attrs: islandAttrs,
	parseDOM: [{ tag: 'span[data-qm-island]', getAttrs: (el) => islandAttrsFromDOM(el) }],
	toDOM: inlineIslandDOM
};

/**
 * An inline island's DOM: a footnote its reference mark (number drawn by `prose.css`, note as
 * title), an equation its TeX between dollars, an image its tag.
 */
function inlineIslandDOM(node: PMNode): DOMOutputSpec {
	const attrs = node.attrs as IslandNodeAttrs;
	const dom = islandDOM(node);
	const props = attrs.props as Partial<FootnoteProps & MathProps> | null;
	if (attrs.islandType === 'footnote')
		return ['sup', typeof props?.text === 'string' ? { ...dom, title: props.text } : dom];
	if (attrs.islandType === 'math' && typeof props?.tex === 'string') {
		const fence = props.display ? '$$' : '$';
		return ['span', dom, `${fence}${props.tex}${fence}`];
	}
	return ['span', dom, `[${attrs.islandType || 'island'}]`];
}

/**
 * A PM island node's attributes: the content entry, with `islandType` because `type` on a PM node
 * is the node type; its set comes off the entry (DOCUMENT_MODEL §Stability seams).
 */
export interface IslandNodeAttrs {
	id: string;
	islandType: ContentIsland['type'];
	props: unknown;
}

/**
 * Build a content island entry from a PM island node's attrs. The cast pairs a closed `type` with a
 * `props` that crossed the DOM as opaque JSON. The store is lenient about a table's shape, so a
 * payload the arm does not hold is stored, and `undefined` at its reader draws the placeholder
 * (§`tablePropsOfNode`).
 */
export function islandEntryFromNode(attrs: IslandNodeAttrs): ContentIsland {
	return {
		id: attrs.id,
		type: attrs.islandType,
		props: attrs.props
	} as ContentIsland;
}

/**
 * The `TableProps` shape over a value that reached the node off the DOM: the rectangle every reader
 * indexes (`table.ts`), down to the `text` a row's emptiness is read off.
 */
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

/**
 * A node's `TableProps`, or `undefined` for any other island and for a payload of the wrong shape:
 * the boundary's guard, so a `props` that crossed the DOM is read once here. Every caller draws the
 * placeholder for `undefined` (`table-view.ts` §`render`).
 */
export function tablePropsOfNode(node: PMNode): TableProps | undefined {
	const attrs = node.attrs as IslandNodeAttrs;
	return attrs.islandType === 'table' && isTableProps(attrs.props) ? attrs.props : undefined;
}

/**
 * A minter over one document: the positional `isl-{n}` sequence continued past the highest id the
 * field holds, so a caller placing several islands keeps one minter. A minted id is part of the
 * document's canonical bytes (CODEC §Islands): a counter over the projection in hand, never a UUID
 * or clock reading, and never a re-numbering of existing ids.
 *
 * Reads the PM doc rather than stored content because that is what the caller holds and the commit
 * will project; a stale content could collide with an id the same transaction places.
 */
function islandMinter(doc: PMNode): () => string {
	return islandState(doc).mint;
}

/**
 * The ids a document holds and the minter continuing past them, off one sweep for the paste pass.
 */
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

/** The next island id for a field: one draw from {@link islandMinter}. */
export function mintIslandId(doc: PMNode): string {
	return islandMinter(doc)();
}

/** Either island node: the test the sweep and the paste pass share. */
function isIsland(node: PMNode): boolean {
	return node.type.name === 'island_block' || node.type.name === 'island_inline';
}

/**
 * `fragment` with every island whose id is empty or already `taken` minted afresh, or `null` where
 * none was, so an untouched paste stays the slice it arrived as. Every surviving id joins the set,
 * so a slice carrying one id twice comes apart in the same pass.
 */
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
		if (!id || taken.has(id)) {
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
 * The paste's island pass: an id the field already holds is re-minted on the way in, and an island
 * arriving with none (a table read off foreign markup, `table-paste.ts`) takes its first.
 *
 * Ids are unique across the field, so two islands wearing one is a projection the store has no
 * shape for. That arrives by a copy or a paste from a second field; a cut pasted back collides with
 * nothing and keeps its identity.
 *
 * The test is the document as it stands, so a drag moving a selection over an island sees the
 * original still there and mints a fresh id for the arrival, which costs nothing next to a
 * duplicate.
 *
 * A plugin prop rather than a view option: which nodes carry an identity is the codec's to know.
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
