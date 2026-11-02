// Mark algebra: formatting and identity to two PM mechanisms.
//   formatting (strong/emph/underline/strike/code/font_family/link, and an `x-` mark) ↔ PM marks
//   identity   (a content anchor, a range or a point)                       ↔ plugin-held positions (field.ts)
// This module owns the type-name translation and the descriptor keying the projection merges by.
// `emph` is the content name; `em` the PM name: the one asymmetry. An `x-` mark rides the `ext`
// mark, holding its name and attributes as written.
import type { Mark, Schema } from 'prosemirror-model';
import type { ContentMark, ContentMarkKind } from '@quillmark/wasm';
import { canonicalJson } from './reconcile.js';

/** A PM mark from a content formatting mark, or `null` where the schema declares none for it. An
 *  `x-` type rides `ext`. */
export function pmMarkFromContent(schema: Schema, m: ContentMark): Mark | null {
	switch (m.type) {
		case 'font_family':
			return schema.marks.font_family.create({ name: m.attrs.name });
		case 'emph':
			return schema.marks.em.create();
		case 'link':
			return schema.marks.link.create({ href: m.attrs.url });
		case 'strong':
		case 'underline':
		case 'strike':
		case 'code':
			return schema.marks[m.type].create();
		default:
			return schema.marks.ext?.create({ type: m.type, attrs: m.attrs ?? null }) ?? null;
	}
}

/**
 * A content mark descriptor from a PM mark (range-free): the `{ type, … }` half
 * of a `ContentMark` / `MarkOp`. `em` collapses to `emph` and a link's `href` rides
 * out as the `url` its payload spells; a font family's `name` is its own, and the
 * other four are their own content name, which is what the cast claims.
 */
export function contentDescriptorFromPM(mark: Mark): ContentMarkKind {
	const name = mark.type.name;
	if (name === 'em') return { type: 'emph' };
	if (name === 'link') return { type: 'link', attrs: { url: mark.attrs.href as string } };
	if (name === 'font_family')
		return { type: 'font_family', attrs: { name: mark.attrs.name as string } };
	if (name === 'ext') {
		const type = mark.attrs.type as `x-${string}`;
		const attrs = mark.attrs.attrs as Record<string, unknown> | null;
		return attrs && Object.keys(attrs).length ? { type, attrs } : { type };
	}
	return { type: name as 'strong' | 'underline' | 'strike' | 'code' };
}

/**
 * The range-free `{ type, … }` half of a content mark: `contentDescriptorFromPM`'s
 * content-side twin, and what a splice's mark carries beside its range. Lifted off the
 * range envelope rather than rebuilt arm by arm, so a payload crosses whole and an
 * arm added upstream reaches this by construction.
 */
export function descriptorOf(m: ContentMark): ContentMarkKind {
	const { start: _start, end: _end, ...kind } = m;
	return kind;
}

/**
 * A stable grouping key for marks: marks sharing a key union into one coverage set.
 * Payload-free formatting keys on its type, everything else on type+attrs, so two
 * links differing in url are independent mark families: the store's own `(type,
 * attrs)` union rule, which is why no arm needs a case of its own.
 */
export function markKey(descriptor: ContentMarkKind): string {
	if ('attrs' in descriptor) return `${descriptor.type}\u0000${canonicalJson(descriptor.attrs)}`;
	return descriptor.type;
}

/** A held anchor: an identity id over `[start, end)` content offsets, a point where they meet. */
export interface AnchorPos {
	id: string;
	start: number;
	end: number;
}

/** The identity anchors of a `Content`: the seed for the field's anchor plugin. */
export function anchorsFromContent(rt: { anchors?: AnchorPos[] }): AnchorPos[] {
	return (rt.anchors ?? []).map(({ id, start, end }) => ({ id, start, end }));
}
