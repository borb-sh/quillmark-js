// The PM schema: the codec owns it; decode/encode target it. Nodes mirror the
// content block kinds (para/heading/code/rule/island) and its container nesting
// (list_item/quote → lists/blockquote); marks mirror the content formatting set.
// Every content vocabulary is closed, so the schema names each member and nothing
// else: a value outside one never reaches a read and throws on a write.
// `blockSchema` is the full field; `inlineSchema` is the constrained
// single-textblock form for `richtext(inline)` (one paragraph, no block split, no
// containers, no islands) and `plaintextSchema` is that one without marks: same
// decode/lower/position machinery, narrower shape. Anchors are not marks here
// (decorations).
//
// `toDOM` and `parseDOM` are one tier, not two halves of a rendering: a copy and a
// paste inside one body run the whole document through them (CODEC §"Markdown at the
// edges"), so every attribute written here is read back here. Foreign HTML spells
// none of those names, so what a paste takes off the web is unchanged; the one rule
// that widens that door on purpose is the fence's.
import { Schema } from 'prosemirror-model';
import type { MarkSpec, NodeSpec } from 'prosemirror-model';
import { islandBlockSpec, islandInlineSpec } from './islands.js';

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

// ── Marks (the block and inline schemas share them; plaintext declares none) ─
const marks: Record<string, MarkSpec> = {
	// Order matters: it fixes mark-set sort order and parse precedence. `link`
	// last so it wraps outermost.
	strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
	em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
	underline: { parseDOM: [{ tag: 'u' }], toDOM: () => ['u', 0] },
	strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }], toDOM: () => ['s', 0] },
	code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
	link: {
		attrs: { href: { default: '' } },
		inclusive: false,
		parseDOM: [
			{ tag: 'a[href]', getAttrs: (el) => ({ href: el.getAttribute('href') }) },
			{ tag: 'span[data-qm-href]', getAttrs: (el) => ({ href: el.getAttribute('data-qm-href') }) }
		],
		// A refused href draws as a bare span: the text stands, unstyled and
		// unclickable, and the mark keeps its value for encode. The value rides on the
		// span rather than going with the tag — an `href` no renderer will follow is one
		// the document still holds, and a copy is not the explicit conversion allowed to
		// lose it.
		toDOM: (mark) => {
			const href = mark.attrs.href as string;
			return rendersHref(href) ? ['a', { href }, 0] : ['span', { 'data-qm-href': href }, 0];
		}
	}
};

// ── The fence's language ────────────────────────────────────────────────────
// The one attribute no keystroke in the visual editor mints: the shorthand fires on
// the third backtick, before a language could be typed, and a slash command is a name
// (VISUAL_EDITOR §"Settled and open"). A paste is the gesture that does, and this is
// what reads it — a fence copied off a highlighted page arrives carrying the language
// that page stated, one copied inside the body keeps its own.

/** A `language-x` / `lang-x` token in a class list. */
const LANG_CLASS = /(?:^|\s)lang(?:uage)?-(\S+)/;

/** The language a `<pre>` states: `data-lang`, which is what `toDOM` writes, else the
 *  class convention on the `pre` or on the `code` it wraps. `null` where it states
 *  none, which is also what an empty value is. */
function fenceLang(pre: HTMLElement): string | null {
	const stated = pre.getAttribute('data-lang');
	if (stated) return stated;
	for (const el of [pre, pre.firstElementChild]) {
		const match = el && LANG_CLASS.exec(el.getAttribute('class') ?? '');
		if (match) return match[1]!;
	}
	return null;
}

// ── Block nodes ─────────────────────────────────────────────────────────────
const blockNodes: Record<string, NodeSpec> = {
	doc: { content: 'block+' },
	paragraph: {
		content: 'inline*',
		group: 'block',
		parseDOM: [{ tag: 'p' }],
		toDOM: () => ['p', 0]
	},
	heading: {
		// No `hard_break`: a heading is a block of one line, so the mint clears a
		// `continues` on the line after one and answers a heading holding a break with
		// two headings. Forbidding it here is what keeps the PM document a projection
		// of some content — a break the schema admitted would draw a shape the store
		// does not hold, and the leaf would go on drawing it.
		content: '(text | island_inline)*',
		group: 'block',
		defining: true,
		attrs: { level: { default: 1 } },
		parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
		toDOM: (node) => [`h${node.attrs.level as number}`, 0]
	},
	code_block: {
		content: 'text*',
		group: 'block',
		code: true,
		defining: true,
		marks: '',
		whitespace: 'pre',
		attrs: { lang: { default: null } },
		parseDOM: [
			{
				tag: 'pre',
				preserveWhitespace: 'full',
				getAttrs: (el) => ({ lang: fenceLang(el) })
			}
		],
		toDOM: (node) => [
			'pre',
			node.attrs.lang ? { 'data-lang': node.attrs.lang as string } : {},
			['code', 0]
		]
	},
	blockquote: {
		content: 'block+',
		group: 'block',
		defining: true,
		parseDOM: [{ tag: 'blockquote' }],
		toDOM: () => ['blockquote', 0]
	},
	horizontal_rule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
	ordered_list: {
		content: 'list_item+',
		group: 'block',
		attrs: { start: { default: 1 } },
		parseDOM: [
			{
				tag: 'ol',
				getAttrs: (el) => {
					// A list stating no `start` starts at one, the absence `toDOM` writes for
					// it; `Number(null)` would read that absence as zero. A value the store
					// would normalize away reads as that absence too: the leaf re-hydrates
					// only on an external change (CODEC §Reconciliation), so a PM doc keeping
					// one disagrees with the store for the rest of the session. Zero is not
					// one — `0.` is an ordinal `importMarkdown` produces and the store keeps.
					const stated = el.getAttribute('start');
					const start = stated ? Number(stated) : 1;
					return { start: Number.isSafeInteger(start) && start >= 0 ? start : 1 };
				}
			}
		],
		toDOM: (node) =>
			node.attrs.start === 1 ? ['ol', 0] : ['ol', { start: node.attrs.start as number }, 0]
	},
	bullet_list: {
		content: 'list_item+',
		group: 'block',
		parseDOM: [{ tag: 'ul' }],
		toDOM: () => ['ul', 0]
	},
	list_item: {
		content: 'block+',
		defining: true,
		parseDOM: [{ tag: 'li' }],
		toDOM: () => ['li', 0]
	},
	island_block: islandBlockSpec
};

// ── Inline nodes ────────────────────────────────────────────────────────────
const inlineLeafNodes: Record<string, NodeSpec> = {
	text: { group: 'inline' },
	// `linebreakReplacement` is what makes a join across a `code_block`'s edge
	// lossless: `Transform.join` and `setBlockType` convert its `\n`s to breaks
	// rather than flattening them to spaces, and a break is a `continues` line.
	hard_break: {
		inline: true,
		group: 'inline',
		selectable: false,
		linebreakReplacement: true,
		parseDOM: [{ tag: 'br' }],
		toDOM: () => ['br']
	},
	island_inline: islandInlineSpec
};

/** The full field schema: every block kind, container, mark, and island. */
export const blockSchema = new Schema({
	nodes: { ...blockNodes, ...inlineLeafNodes },
	marks
});

// ── The constrained inline nodes (both inline schemas) ──────────────────────
// `doc: "paragraph"` (exactly one child) is what makes an Enter a no-op at the
// model level: there is no second block for a split to land.
const inlineNodes: Record<string, NodeSpec> = {
	doc: { content: 'paragraph' },
	paragraph: { content: 'inline*', toDOM: () => ['p', 0] },
	text: { group: 'inline' }
};

/** The constrained inline schema: one paragraph, no block splitting, no
 *  containers, no islands, and the full mark set (a `richtext(inline)` field, and
 *  a table cell, which is the same content unit). */
export const inlineSchema = new Schema({ nodes: inlineNodes, marks });

/**
 * The inline schema with no mark types at all: a `plaintext` field, whose value is
 * literal text the boundary refuses to coerce back once it carries a mark.
 *
 * Declaring none is what makes that structural rather than a rule each path
 * restates: `toggleMark` has no type to apply, the mark input rules build nothing,
 * a paste parses its marks away, and `decode` drops any a stray content arrives
 * carrying (CODEC §Inline mode).
 */
export const plaintextSchema = new Schema({ nodes: inlineNodes, marks: {} });

/** Whether `schema` can carry formatting at all: false for {@link plaintextSchema}
 *  alone. What a mark command asks before it offers itself. */
export function hasMarks(schema: Schema): boolean {
	return Object.keys(schema.marks).length > 0;
}

/** True for the constrained inline schema (no block containers); decode branches on it. */
export function isInlineSchema(schema: Schema): boolean {
	return !schema.nodes.blockquote;
}
