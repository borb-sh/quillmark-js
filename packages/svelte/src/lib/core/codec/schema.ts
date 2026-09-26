// The PM schema: the codec owns it; decode/encode target it. Nodes mirror the
// content block kinds (para/heading/code/rule/island) and its container nesting
// (list_item/quote → lists/blockquote); marks mirror the content formatting set.
// Each set is closed upstream, so the schema names its whole vocabulary and carries
// nothing inert. `blockSchema` is the full field; `inlineSchema` is the constrained
// single-textblock form for `richtext(inline)` (one paragraph, no block split, no
// containers, no islands) and `plaintextSchema` is that one without marks, for
// `plaintext(inline)`; `plainSchema` is a `plaintext` field without `inline`,
// paragraphs and hard breaks and nothing else. Same decode/lower/position machinery,
// narrower shapes. Anchors are not marks here (decorations).
//
// `toDOM` and `parseDOM` are one tier, not two halves of a rendering: a copy and a
// paste inside one body run the whole document through them (CODEC §"Markdown at the
// edges"), so every attribute written here is read back here. Foreign HTML spells none
// of this package's `data-qm-*` names, so what a paste takes off the web is unchanged;
// the one rule that widens that door on purpose is the fence's.
import { Schema } from 'prosemirror-model';
import type { MarkSpec, NodeSpec, NodeType } from 'prosemirror-model';
import { islandBlockSpec, islandInlineSpec } from './islands.js';
import { rendersHref, storableUrl } from './urls.js';

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
			{ tag: 'a[href]', getAttrs: (el) => ({ href: storableUrl(el.getAttribute('href') ?? '') }) },
			{
				tag: 'span[data-qm-href]',
				getAttrs: (el) => ({ href: storableUrl(el.getAttribute('data-qm-href') ?? '') })
			}
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
	// A heading holds no `hard_break`: it is a block of one line, so the store clears a
	// `continues` after one and markdown has no syntax for a break inside it. Declaring
	// it out is what makes that structural — a paste parses the `<br>` away and a
	// conversion onto a heading drops it, rather than each door holding the rule.
	heading: {
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
 * The inline schema with no mark types at all: a `plaintext(inline)` field, whose
 * value is literal text the boundary refuses to coerce back once it carries a mark.
 *
 * Declaring none is what makes that structural rather than a rule each path
 * restates: `toggleMark` has no type to apply, the mark input rules build nothing,
 * a paste parses its marks away, and `decode` drops any a stray content arrives
 * carrying (CODEC §Inline mode).
 */
export const plaintextSchema = new Schema({ nodes: inlineNodes, marks: {} });

/**
 * A `plaintext` field without `inline`: paragraphs and hard breaks, no marks, no
 * islands, no containers, which is the shape `Content::is_plain` admits. Mark-free
 * for the reason {@link plaintextSchema} is.
 */
export const plainSchema = new Schema({
	nodes: {
		doc: { content: 'paragraph+' },
		paragraph: blockNodes.paragraph,
		text: inlineLeafNodes.text,
		hard_break: inlineLeafNodes.hard_break
	},
	marks: {}
});

/** The schema a leaf of the declared type mounts: `inline` narrows either type to one
 *  textblock, and `plaintext` takes its marks away. */
export function leafSchema(opts: { plaintext?: boolean; inline?: boolean }): Schema {
	if (opts.plaintext) return opts.inline ? plaintextSchema : plainSchema;
	return opts.inline ? inlineSchema : blockSchema;
}

/** Whether `schema` can carry formatting at all: false for the two plaintext schemas.
 *  What a mark command asks before it offers itself. */
export function hasMarks(schema: Schema): boolean {
	return Object.keys(schema.marks).length > 0;
}

/** True for the one-line schemas, which declare no `hard_break`; decode branches on it. */
export function isInlineSchema(schema: Schema): boolean {
	return !schema.nodes.hard_break;
}

/** True for {@link blockSchema}, the one holding blocks past the paragraph: what a
 *  leaf's island, gap-cursor and slash machinery mounts on. */
export function isBlockSchema(schema: Schema): boolean {
	return !!schema.nodes.blockquote;
}

/** Whether `type` can hold a within-block line break, which a heading cannot (§`heading`).
 *  What a `\n` landing in a textblock is rewritten to turns on it (`breaks.ts`), and so
 *  does what decode puts between a block's continued segments. */
export function takesLineBreak(type: NodeType): boolean {
	const br = type.schema.nodes.hard_break;
	return !!br && type.contentMatch.matchType(br) !== null;
}
