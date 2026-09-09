// Mark algebra: two content classes to two PM mechanisms.
//   formatting (strong/emph/underline/strike/code/link)  ↔ PM marks
//   identity   (anchor{id}, zero-width)                  ↔ decorations (see field.ts)
// This module owns the type-name translation and the descriptor keying the mark
// diff groups by; the anchor↔decoration bridge is field.ts, the mark ops are
// encode.ts. `emph` is the content name; `em` the PM name: the one asymmetry.
import type { Mark, Schema } from 'prosemirror-model';
import type { ContentMark } from '@quillmark/wasm';
import { canonicalJson } from './reconcile.js';

/** A PM mark from a content formatting mark, or `null` for an anchor. */
export function pmMarkFromContent(schema: Schema, m: ContentMark): Mark | null {
	if (m.type === 'anchor') return null;
	if (m.type === 'emph') return schema.marks.em.create();
	if (m.type === 'link') return schema.marks.link.create({ href: m.attrs.url });
	return schema.marks[m.type].create();
}

/**
 * A content mark descriptor from a PM mark (range-free): the `{ type, … }` half
 * of a `ContentMark` / `MarkOp`. `strong`/`emph`/… collapse to their content name.
 */
export function contentDescriptorFromPM(mark: Mark): Record<string, unknown> {
	const name = mark.type.name;
	if (name === 'em') return { type: 'emph' };
	if (name === 'link') return { type: 'link', attrs: { url: mark.attrs.href } };
	// strong / underline / strike / code
	return { type: name };
}

/**
 * The range-free `{ type, … }` half of a content mark: `contentDescriptorFromPM`'s
 * content-side twin, and what a `MarkOp` carries beside its range. A payload rides
 * `attrs`, so a link's bag crosses whole rather than rebuilt from the one key this
 * package reads. An anchor keys on its type alone: its `id` is identity, not a
 * formatting family, and the diff routes anchors by id on a separate channel.
 */
export function descriptorOf(m: ContentMark): Record<string, unknown> {
	if (m.type === 'link') return { type: m.type, attrs: m.attrs };
	return { type: m.type };
}

/**
 * A stable grouping key for the mark diff: marks sharing a key union into one
 * coverage set. Payload-free formatting keys on its type, everything else on
 * type+attrs, because `applyChange`'s `remove` matches type and attrs (verified),
 * so two links differing in url are independent mark families. This is the seam's
 * own `(type, attrs)` tie-break, which is why no arm needs a case of its own.
 */
export function markKey(descriptor: Record<string, unknown>): string {
	const type = descriptor.type as string;
	if (descriptor.attrs !== undefined) return `${type}\u0000${canonicalJson(descriptor.attrs)}`;
	return type;
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
