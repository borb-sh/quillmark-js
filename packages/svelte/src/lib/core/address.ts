// The one address vocabulary the surfaces speak in public: canonical `DocPath` strings for places,
// `Addr` (from `@quillmark/wasm`) for the document verbs. Declared here because both `/preview` and
// `/visual` name a place in their hooks, and a type declared twice is drift with nothing to catch
// it.
//
// Paths for places, indexes for structure ops. `fieldPathForAddr` and `addrForFieldPath` are public
// for a host holding both a hook's path and a verb that takes an `Addr`; `cardPath` is the editor's
// own. The grammar is the boundary's, reached through `core()`.
import type { Addr, DocPathSeg, HitGranularity, PathStep } from '@quillmark/wasm';
import { core } from './lifecycle.js';

/**
 * A canonical field address: `main.<field>` / `main.body` / `cards.<kind>[<i>].<field>`, cards
 * keyed by absolute document index. The grammar `parseDocPath` / `formatDocPath` speak, and the one
 * `Diagnostic.path`, `ContentHit.field`, `FieldRegion.field` and `session.regions()` keys use. An
 * alias over `string`: the boundary exports no nominal type.
 */
export type DocPath = string;

/**
 * A place in the document: a field and a caret within it. What the editor reports when its caret
 * moves and what the preview scrolls to, so `onCaretMove={preview.focusPosition}` translates
 * nothing. `pos` is USV, the coordinate shared on both sides of the boundary; a `ContentHit` is a
 * `Place` with extras.
 */
export interface Place {
	field: DocPath;
	/** The caret in USV. */
	pos: number;
}

/**
 * Where a preview click landed: what the preview surfaces and the editor's `setCaret` takes. **An
 * absent `pos` is the placement rung**, not a caret at zero: the click resolved a field the plate
 * places without tracking its content (`fieldAt` answers, `positionAt` does not), so the landing is
 * a focus.
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
// The one hop between the two vocabularies, pure and document-free: `kinds` is the kind of each
// card by content index (`doc.cards.map(c => c.kind)`). The editor mints it off its own derived
// card tree, since `doc.cards` serializes every card per read.

/**
 * A field's canonical `DocPath`, or `undefined` when `addr.card` is outside the live `kinds` array
 * (a stale address: drop it rather than mis-target). A field-less card addresses its body.
 *
 * - `{}` → `"main.body"`
 * - `{field}` → `"main.<field>"`
 * - `{card: i}` → `"cards.<kind>[i].body"`
 * - `{card: i, field}` → `"cards.<kind>[i].<field>"`
 *
 * `steps` descend from the field to a leaf inside it, the inverse of {@link
 * nestedAddrForFieldPath}: `{field: 'keywords'}` with `[0]` is `"main.keywords[0]"`. A body holds
 * no cells, so a field-less address with steps is `undefined`. `cards[i]` stands in for an unknown
 * or blank kind; the index is the addr's own, `DocPath` addressing cards by document-array index.
 */
export function fieldPathForAddr(
	addr: Addr,
	kinds: readonly string[],
	steps: readonly PathStep[] = []
): DocPath | undefined {
	const head = cardHead(addr.card, kinds);
	if (!head) return undefined;
	if (addr.field == null)
		return steps.length ? undefined : core().formatDocPath([head, { seg: 'body' }]);
	const segs: DocPathSeg[] = [head, { seg: 'field', name: addr.field }];
	for (const step of steps)
		segs.push(
			typeof step === 'number' ? { seg: 'index', index: step } : { seg: 'field', name: step }
		);
	return core().formatDocPath(segs);
}

/**
 * A card's own path (`cards.<kind>[i]`), what a structure op names. `undefined` for an index
 * outside `kinds`.
 */
export function cardPath(index: number, kinds: readonly string[]): DocPath | undefined {
	const head = cardHead(index, kinds);
	return head ? core().formatDocPath([head]) : undefined;
}

/**
 * The inverse: a canonical `DocPath` back to the `Addr` the document verbs take, or `undefined` for
 * a path that names no single commit address: a nested or array-element path (see {@link
 * nestedAddrForFieldPath} and {@link nearestAddrForFieldPath}), a field-rooted one, or a malformed
 * one. A bare card and a `.body` terminal both land on the field-less `{card: i}`. Needs no
 * `kinds`: the path carries the absolute index.
 */
export function addrForFieldPath(path: DocPath): Addr | undefined {
	const segs = segsOf(path);
	return segs && addrForSegs(segs);
}

/**
 * The nearest ancestor a commit address can name: {@link addrForFieldPath} where the path has one,
 * else the root and its first field (`main.contact.email` and `main.keywords[0]` land on their
 * field). `undefined` for a field-rooted (config-space) or malformed path. An `Addr` reaches a root
 * and one field, so the truncation is a consumer's to make (VISUAL_EDITOR §Diagnostics).
 */
export function nearestAddrForFieldPath(path: DocPath): Addr | undefined {
	const segs = segsOf(path);
	return segs && addrForSegs(segs.slice(0, 2));
}

/**
 * A nested address, split: the field's `Addr`, and the steps from it to the leaf (the `PathStep`
 * grammar `reader.getContentAt` walks). `main.keywords[0]` is `{field: keywords, steps: [0]}`,
 * `main.contact.email` is `['email']`, `main.vectors[0].tours[2].title` is `[0, 'tours', 2,
 * 'title']`. Anything {@link addrForFieldPath} can name has no steps and lands here as `undefined`,
 * as does a body with something after it. Whether the schema declares each step is the caller's to
 * check.
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

/**
 * `parseDocPath`, with a malformed path as `undefined` rather than a throw. The gate is read
 * outside the try: an uninitialized core is not a malformed path.
 */
function segsOf(path: DocPath): DocPathSeg[] | undefined {
	const { parseDocPath } = core();
	try {
		return parseDocPath(path);
	} catch {
		return undefined;
	}
}

/** {@link addrForFieldPath} over already-parsed segments. */
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

/**
 * The head segment a card index resolves to, or `undefined` when out of the live array. A falsy
 * kind is the unknown-kind form `cards[i]`.
 */
function cardHead(index: number | undefined, kinds: readonly string[]): DocPathSeg | undefined {
	if (index == null) return { seg: 'main' };
	if (!Number.isInteger(index) || index < 0 || index >= kinds.length) return undefined;
	return { seg: 'card', kind: kinds[index] || null, index };
}
