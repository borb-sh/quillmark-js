// The href logic behind the link prompt, off the component: the parts carrying a
// data consequence are functions with tests rather than event handlers.
//
// `link` is the one mark carrying a value, which is what keeps it off `toggleMark`:
// that command matches by type (`rangeHasMark(from, to, markType)`), so a second
// href over a range already holding one removes the mark rather than replacing it.
// `setLink` spells the mark ops out for that reason, and puts the pair in one
// transaction so the mark diff lowers it as one link family exchanged for another
// (`codec/marks.ts` keys a link on type+url).
import type { Command, EditorState } from 'prosemirror-state';
import { rendersHref, storableUrl } from '../core/codec/index.js';

/** A scheme: a letter, then letters, digits, `+`, `-` or `.`, then `:` (RFC 3986). */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Rooted at the page rather than at a host: an absolute path, a query, a fragment,
 *  or a protocol-relative host. Every one of them means relative on purpose. */
const ROOTED = /^[/#?]/;
/** A bare mail address: one `@`, no scheme and no path. */
const ADDRESS = /^[^\s/@]+@[^\s/@]+$/;
/** A host carrying a port, which spells a scheme to `SCHEME` and is not one: what
 *  follows the colon is digits, and no scheme the mark renders takes a port. */
const HOST_PORT = /^[a-z0-9.-]+:\d+([/?#]|$)/i;

/**
 * The href a typed value stands for. A value with no scheme names a host, and
 * stored verbatim it is a relative href resolving against whatever page the editor
 * is embedded in, so it takes `https://`. A bare address takes `mailto:` instead,
 * the host prefix reading `jane@example.com` as `example.com` with `jane` for
 * userinfo — a wrong destination this normalization would itself have minted.
 *
 * A rooted value is left alone, being the spelling that asks for the embedding
 * page, and so is anything already carrying a scheme the link mark renders.
 *
 * `localhost:5173` names a host too, and `SCHEME` reads its host as the scheme: a
 * colon followed by a port is a host with a port, so it takes the host prefix rather
 * than the refusal a scheme nothing renders gets.
 *
 * `''` for a blank value and for a scheme the mark renders inert, both being nothing
 * to apply: `setLink` declines an empty href, so the refusal lands at the prompt's
 * own exit rather than storing a link that draws as plain text.
 */
export function normalizeHref(raw: string): string {
	const value = storableUrl(raw.trim());
	if (!value) return '';
	if (!rendersHref(value) && !HOST_PORT.test(value)) return '';
	if (SCHEME.test(value) && rendersHref(value)) return value;
	if (ROOTED.test(value)) return value;
	return ADDRESS.test(value) ? `mailto:${value}` : `https://${value}`;
}

/**
 * The href under the selection: the first link mark it touches, `''` where it
 * touches none. A selection may span several links; the prompt holds one value, so
 * the first is both what it seeds with and what an apply writes over the whole
 * range.
 */
export function hrefInSelection(state: EditorState): string {
	const type = state.schema.marks.link;
	if (!type) return '';
	const { from, to } = state.selection;
	let href = '';
	state.doc.nodesBetween(from, to, (node) => {
		if (href) return false;
		const mark = type.isInSet(node.marks);
		if (mark) href = String(mark.attrs.href ?? '');
	});
	return href;
}

/** Write `href` over the selection, replacing whatever link it already carries. */
export function setLink(href: string): Command {
	return (state, dispatch) => {
		const type = state.schema.marks.link;
		const { from, to, empty } = state.selection;
		if (!type || empty || !href) return false;
		if (dispatch)
			dispatch(state.tr.removeMark(from, to, type).addMark(from, to, type.create({ href })));
		return true;
	};
}

/** Drop every link the selection carries. */
export const clearLink: Command = (state, dispatch) => {
	const type = state.schema.marks.link;
	const { from, to, empty } = state.selection;
	if (!type || empty || !state.doc.rangeHasMark(from, to, type)) return false;
	if (dispatch) dispatch(state.tr.removeMark(from, to, type));
	return true;
};
