// The one address vocabulary the surfaces speak in public: canonical `DocPath`
// strings for places, `Addr` for the document verbs. Declared here because both
// `/preview` and `/visual` name a place in their hooks, and a type declared twice
// structurally is drift with nothing to catch it: `/core` is the module both
// already import.
//
// Slogan: paths for places, indexes for structure ops. `Addr` (`{card?, field?}`,
// from `@quillmark/wasm`) is the mutator currency; the conversions at the foot of
// this module are the hop between the two. `fieldPathForAddr` and `addrForFieldPath`
// are public, because a host given a path by a hook and holding a verb that takes an
// `Addr` needs them; `cardPath` is the editor's own.
//
// The grammar is the boundary's, reached through the init gate (`core()`):
// `parseDocPath` / `formatDocPath` are on the awaited surface, and the verbs here are
// pure and sync on both sides of it.
import type { Addr, DocPathSeg, HitGranularity, PathStep } from '@quillmark/wasm';
import { core } from './lifecycle.js';

/**
 * A canonical field address: `main.<field>` / `main.body` /
 * `cards.<kind>[<i>].<field>`, cards keyed by absolute document index.
 *
 * The grammar `parseDocPath` / `formatDocPath` speak, and the one
 * `Diagnostic.path`, `ContentHit.field`, `FieldRegion.field` and
 * `session.regions()` keys already use. An alias over `string`: the boundary
 * exports the parser and the segment type, not a nominal type, so this names the
 * grammar at a signature rather than inventing a checked one.
 */
export type DocPath = string;

/**
 * A place in the document: a field and a caret within it. What the editor reports
 * when its caret moves and what the preview scrolls to, so the editor→preview hop
 * is `onCaretMove={preview.focusPosition}` and translates nothing.
 *
 * `pos` is USV, the shared content coordinate on both sides of the boundary: a
 * `ContentHit` is a `Place` with its own extras, and fits wherever one is taken.
 */
export interface Place {
	field: DocPath;
	/** The caret in USV. */
	pos: number;
}

/**
 * Where a preview click landed. What the preview surfaces and what the editor's
 * `setCaret` takes.
 *
 * **An absent `pos` is the placement rung**, not a caret at zero: the click resolved
 * a field the plate places without tracking its content (`fieldAt` answers,
 * `positionAt` does not), so there is no offset and the landing is a focus. A `Place`
 * is a landing carrying its caret, and a `ContentHit` is one too.
 */
export interface Landing {
	field: DocPath;
	/** The caret in USV, absent on the placement rung. */
	pos?: number;
	/** Whether `pos` is cluster-exact or floored to a segment start; the boundary's
	 *  own marker, carried through untouched. */
	granularity?: HitGranularity;
}

// ── Addr ↔ DocPath ──────────────────────────────────────────────────────────
// The one hop between the two vocabularies, both directions, pure and
// document-free: `kinds` is the kind of each composable card by content index
// (`doc.cards.map(c => c.kind)`), which is all the card segment needs. The editor
// mints it off its own derived card tree rather than re-reading `doc.cards`, which
// serializes every card per read and is not a thing to do per keystroke.

/**
 * A field's canonical `DocPath`, or `undefined` when `addr.card` is outside the live
 * `kinds` array (a stale address: drop it rather than mis-target). A field-less card
 * addresses its body, which is the leaf `{card: i}` names.
 *
 * - `{}` → `"main.body"`
 * - `{field}` → `"main.<field>"`
 * - `{card: i}` → `"cards.<kind>[i].body"`
 * - `{card: i, field}` → `"cards.<kind>[i].<field>"`
 *
 * `cards[i]` stands in for an unknown or blank kind. The index is the addr's own: no
 * per-kind counting, since `DocPath` addresses cards by document-array index.
 */
export function fieldPathForAddr(addr: Addr, kinds: readonly string[]): DocPath | undefined {
	const head = cardHead(addr.card, kinds);
	if (!head) return undefined;
	const tail: DocPathSeg =
		addr.field != null ? { seg: 'field', name: addr.field } : { seg: 'body' };
	return core().formatDocPath([head, tail]);
}

/**
 * A card's own path (`cards.<kind>[i]`), not a leaf's: what a structure op names,
 * where the change is the card rather than anything inside it. `undefined` for an
 * index outside `kinds`.
 */
export function cardPath(index: number, kinds: readonly string[]): DocPath | undefined {
	const head = cardHead(index, kinds);
	return head ? core().formatDocPath([head]) : undefined;
}

/**
 * The inverse: a canonical `DocPath` back to the `Addr` the document verbs take, or
 * `undefined` for a path that names no single commit address — a nested or
 * array-element path (`main.keywords[0]`, which {@link nestedAddrForFieldPath} and
 * {@link nearestAddrForFieldPath} take instead), a field-rooted one, or a malformed
 * one. A bare card and a `.body` terminal both land on the field-less `{card: i}`
 * the body leaf answers to.
 *
 * Needs no `kinds`: the path carries the absolute index, and the kind in it is
 * decoration the `Addr` has no room for.
 */
export function addrForFieldPath(path: DocPath): Addr | undefined {
	const segs = segsOf(path);
	return segs && addrForSegs(segs);
}

/**
 * The nearest ancestor a commit address can name: {@link addrForFieldPath} where the
 * path has one, else the root and its first field. `main.contact.email` and
 * `main.keywords[0]` land on their field, any deeper nesting on the top-level field
 * it hangs off. `undefined` where those two segments name nothing — a field-rooted
 * (config-space) or malformed path.
 *
 * An `Addr` reaches a root and one field, so two segments is the whole search: a
 * deeper prefix is unaddressable by arity alone. Addressability being `Addr`'s reach
 * rather than the grammar's is what makes the truncation a consumer's to make
 * (VISUAL_EDITOR §Diagnostics).
 */
export function nearestAddrForFieldPath(path: DocPath): Addr | undefined {
	const segs = segsOf(path);
	return segs && addrForSegs(segs.slice(0, 2));
}

/**
 * A nested address, split: the field's `Addr`, and the steps from it to the leaf.
 * `main.keywords[0]` is `{field: keywords, steps: [0]}`,
 * `main.vectors[0].tours[2].title` is `[0, 'tours', 2, 'title']`, and
 * `main.contact.email` is `['email']`: an index segment reads as a number and a key as
 * a string, the `PathStep` grammar `reader.getContentAt` walks. Anything
 * {@link addrForFieldPath} can name — a field, a body, a card — has no steps and lands
 * here as `undefined`; so does a body with something after it, a body holding no
 * cells. Whether the schema declares each step is the caller's to check: this module
 * holds the grammar and no schema. `regions()`, `positionAt` and `formatDocPath` all
 * spell the index segment bracketed, so there is one spelling to read and none to
 * bridge.
 */
export function nestedAddrForFieldPath(path: DocPath): NestedAddr | undefined {
	const segs = segsOf(path);
	if (!segs || segs.length < 3) return undefined;
	const field = addrForSegs(segs.slice(0, 2));
	if (field?.field == null) return undefined;
	const steps: PathStep[] = [];
	for (const seg of segs.slice(2)) {
		if (seg.seg === 'index') steps.push(seg.index);
		else if (seg.seg === 'field') steps.push(seg.name);
		else return undefined;
	}
	return { field, steps };
}

/** A nested address: the field's `Addr`, and the steps from it to the leaf. */
export interface NestedAddr {
	field: Addr;
	steps: PathStep[];
}

/** `parseDocPath`, with a malformed path as `undefined` rather than a throw. The gate
 *  is read outside the try: an uninitialized core is not a malformed path, and would
 *  otherwise leave here as one. */
function segsOf(path: DocPath): DocPathSeg[] | undefined {
	const { parseDocPath } = core();
	try {
		return parseDocPath(path);
	} catch {
		return undefined;
	}
}

/** {@link addrForFieldPath} over already-parsed segments, so the element walk reuses
 *  it for the head of a path rather than re-serializing one. */
function addrForSegs(segs: DocPathSeg[]): Addr | undefined {
	const [head, ...rest] = segs;
	if (!head) return undefined;
	let addr: Addr;
	if (head.seg === 'main') addr = {};
	else if (head.seg === 'card') addr = { card: head.index };
	else return undefined;
	if (rest.length === 0) return addr;
	if (rest.length > 1) return undefined;
	const tail = rest[0];
	if (tail.seg === 'body') return addr;
	if (tail.seg === 'field') return { ...addr, field: tail.name };
	return undefined;
}

/** The head segment a card index resolves to, or `undefined` when it is out of the
 *  live array. `null` kind is the unknown-kind form the grammar spells `cards[i]`. */
function cardHead(index: number | undefined, kinds: readonly string[]): DocPathSeg | undefined {
	if (index == null) return { seg: 'main' };
	if (!Number.isInteger(index) || index < 0 || index >= kinds.length) return undefined;
	return { seg: 'card', kind: kinds[index] || null, index };
}
