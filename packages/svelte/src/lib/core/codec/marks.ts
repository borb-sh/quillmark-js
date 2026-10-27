// Mark algebra: two content classes to two PM mechanisms.
//   formatting (strong/emph/underline/strike/code/link)  ↔ PM marks
//   identity   (anchor{id}, zero-width)                  ↔ decorations (see field.ts)
// This module owns the type-name translation and the descriptor keying the mark
// diff groups by; the anchor↔decoration bridge is field.ts, the mark ops are
// encode.ts. `emph` is the content name; `em` the PM name: the one asymmetry.
import type { Mark, Schema } from 'prosemirror-model';
import type { ContentMark, ContentMarkKind } from '@quillmark/wasm';
import { canonicalJson } from './reconcile.js';

/** A PM mark from a content formatting mark, or `null` for an anchor or a font family,
 *  which no PM mark draws and whose leaf is held (`decode.ts` §`fitsLeaf`). Exhaustive over
 *  the closed mark vocabulary, so a member added upstream is a compile error here rather
 *  than an index into a PM mark this schema does not declare. */
export function pmMarkFromContent(schema: Schema, m: ContentMark): Mark | null {
	switch (m.type) {
		case 'anchor':
		case 'font_family':
			return null;
		case 'emph':
			return schema.marks.em.create();
		case 'link':
			return schema.marks.link.create({ href: m.attrs.url });
		case 'strong':
		case 'underline':
		case 'strike':
		case 'code':
			return schema.marks[m.type].create();
		default: {
			const unreached: never = m;
			return unreached;
		}
	}
}

/**
 * A content mark descriptor from a PM mark (range-free): the `{ type, … }` half
 * of a `ContentMark` / `MarkOp`. `em` collapses to `emph` and a link's `href` rides
 * out as the `url` its payload spells; the other four are their own content name,
 * which is what the cast claims.
 */
export function contentDescriptorFromPM(mark: Mark): ContentMarkKind {
	const name = mark.type.name;
	if (name === 'em') return { type: 'emph' };
	if (name === 'link') return { type: 'link', attrs: { url: mark.attrs.href as string } };
	return { type: name as 'strong' | 'underline' | 'strike' | 'code' };
}

/**
 * The range-free `{ type, … }` half of a content mark: `contentDescriptorFromPM`'s
 * content-side twin, and what a `MarkOp` carries beside its range. Lifted off the
 * range envelope rather than rebuilt arm by arm, so a payload crosses whole and an
 * arm added upstream reaches this by construction.
 */
export function descriptorOf(m: ContentMark): ContentMarkKind {
	const { start: _start, end: _end, ...kind } = m;
	return kind;
}

/**
 * A stable grouping key for the mark diff: marks sharing a key union into one
 * coverage set. Payload-free formatting keys on its type, everything else on
 * type+attrs, because `applyChange`'s `remove` matches type and attrs (verified),
 * so two links differing in url are independent mark families. This is the seam's
 * own `(type, attrs)` tie-break, which is why no arm needs a case of its own.
 */
export function markKey(descriptor: ContentMarkKind): string {
	if ('attrs' in descriptor) return `${descriptor.type}\u0000${canonicalJson(descriptor.attrs)}`;
	return descriptor.type;
}

/** A held anchor position: an identity id at a USV content offset (zero-width). */
export interface AnchorPos {
	id: string;
	pos: number;
}

/**
 * The identity anchors of a `Content` as `{ id, pos }` in USV: the seed for the
 * field's anchor-position plugin and the `oldAnchors` the mark diff rebases.
 * Anchors are zero-width, so `start` is the position.
 */
export function anchorsFromContent(rt: { marks: ContentMark[] }): AnchorPos[] {
	const out: AnchorPos[] = [];
	for (const m of rt.marks) if (m.type === 'anchor') out.push({ id: m.attrs.id, pos: m.start });
	return out;
}
