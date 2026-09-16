// URLs at the model's edge. A link's `href` and an image island's `url` are the two
// values a document carries that a renderer follows, and both enter the model from
// outside it — a paste's markup, the link prompt. One module because the two rules are
// one rule: what renders, and what the store will take.

// ── The href gate ───────────────────────────────────────────────────────────
// An `href` is an attribute value and not markup, so the markdown → typed node → DOM
// path that keeps a document's text from becoming tags never reaches it: what the
// mark carries is what `toDOM` emits, and `renderContent` paints marks outside a
// `contenteditable` (the tips card), where a click is a plain one.
//
// An allowlist, because the set a document can spell is open: naming the dangerous
// schemes instead loses to the first one this has not heard of. It holds what the
// surface has a caller for; a scheme reaching it later is a line.
const RENDERED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp']);

/** A scheme and its colon: a letter, then letters, digits, `+`, `-` or `.` (RFC 3986). */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** Dropped before the scheme is read, so a tab spliced into `javascript:` is tested
 *  as what it navigates to. Wider than the URL parser's own tab/newline rule: no
 *  scheme carries a control character, and the strip decides without rewriting. */
const IGNORED = /[\u0000-\u0020]/g;

/**
 * Whether a link carrying `href` renders as one. A value with no scheme is relative
 * to the embedding page and has none to refuse.
 *
 * A refused href is unchanged: it stays on the mark and round-trips, so a document
 * survives an editor that declines to make it clickable.
 */
export function rendersHref(href: string): boolean {
	const scheme = SCHEME.exec(href.replace(IGNORED, ''));
	return scheme === null || RENDERED_SCHEMES.has(scheme[1]!.toLowerCase());
}

/**
 * A url the store will take: the one character class the authored lane refuses, a CR
 * or an LF, percent-encoded. CommonMark admits no line ending in a link destination,
 * so `MarkOp.add` of a `link`, an `image` island op and `overwrite` all throw on one —
 * and both of a leaf's commit lanes throwing is a field that stops persisting for the
 * session, since the PM doc still holds the mark on the next keystroke.
 *
 * Applied where a value enters the model from outside it (a paste's `href`, the link
 * prompt), which is the only door that can produce one: `importMarkdown` mints none,
 * and `toMarkdown` writes the same `%0A` / `%0D`.
 */
export function storableUrl(url: string): string {
	return url.replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
