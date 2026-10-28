// The PM schema: the codec owns it; decode/encode target it. Nodes mirror the content block kinds
// (para/heading/code/rule/island) and container nesting (list_item/quote); marks mirror the content
// formatting set. Each set is closed upstream, so the schema names its whole vocabulary.
// `blockSchema` is the full field; `inlineSchema` the single-textblock form for a one-line
// `richtext`; `plaintextSchema` that without marks, for a one-line `text`; `plainSchema` a `text`
// field declaring `multiline: true` (paragraphs and hard breaks only); `cellSchema` the inline form
// with hard breaks, for a table cell. Anchors are not marks here (decorations).
//
// `toDOM` and `parseDOM` are one tier: a copy and a paste inside one body run the whole document
// through them (CODEC §"Markdown at the edges"), so every attribute written here is read back here.
// Foreign HTML spells none of this package's `data-qm-*` names; the rules that widen that door on
// purpose are the fence's and a span's styled marks, a `<table>` being the block leaf's clipboard
// parser's (`table-paste.ts`).
import { Schema } from 'prosemirror-model';
import type { MarkSpec, NodeSpec, NodeType, TagParseRule } from 'prosemirror-model';
import { islandBlockSpec, islandInlineSpec } from './islands.js';
import { taskBody, taskChecked, taskDOM } from './tasks.js';
import { rendersHref, storableUrl } from './urls.js';

// ── Marks spelled as style ──────────────────────────────────────────────────
// A word processor writes formatting as a span's inline style rather than a tag: Google Docs spells
// all four marks below that way, and wraps a whole copy in a `<b>` stating a regular weight. Read
// off a `<span>` alone (the same style on a cell or heading is that block's face). An underline
// inside a link is the link's own: Docs underlines every one, and Chrome inlines the computed
// decoration on a copy.

/** Whether `el`'s inline style states a bold weight. */
const bold = (el: HTMLElement): boolean => /^(?:bold(?:er)?|[6-9]\d\d)$/.test(el.style.fontWeight);

/** The text decoration `el` states, as a shorthand or a longhand. */
const decoration = (el: HTMLElement): string =>
	`${el.style.textDecoration} ${el.style.textDecorationLine}`;

/**
 * A mark a `<span>` carries where `styled` holds of it. Not consuming, so every mark a span states
 * matches, and so do the span's own rules.
 */
const styledSpan = (styled: (el: HTMLElement) => boolean): TagParseRule => ({
	tag: 'span',
	consuming: false,
	getAttrs: (el) => styled(el) && null
});

/** `s` as a CSS string literal. */
const cssString = (s: string): string => `"${s.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\a ')}"`;

// ── Marks (the block and inline schemas share them; plaintext declares none) ─
const marks: Record<string, MarkSpec> = {
	// Order matters: it fixes mark-set sort order and parse precedence. `link`
	// last so it wraps outermost.
	strong: {
		parseDOM: [
			{ tag: 'strong' },
			{ tag: 'b', getAttrs: (el) => (!el.style.fontWeight || bold(el)) && null },
			styledSpan(bold)
		],
		toDOM: () => ['strong', 0]
	},
	em: {
		parseDOM: [
			{ tag: 'em' },
			{ tag: 'i' },
			styledSpan((el) => /^(?:italic|oblique)\b/.test(el.style.fontStyle))
		],
		toDOM: () => ['em', 0]
	},
	underline: {
		parseDOM: [
			{ tag: 'u' },
			styledSpan((el) => /\bunderline\b/.test(decoration(el)) && !el.closest('a'))
		],
		toDOM: () => ['u', 0]
	},
	strike: {
		parseDOM: [
			{ tag: 's' },
			{ tag: 'del' },
			styledSpan((el) => /\bline-through\b/.test(decoration(el)))
		],
		toDOM: () => ['s', 0]
	},
	code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
	// One family a character, PM's default exclusion of a mark by its own type: a second family
	// replaces the first, as the store's keyed `add` does. A family the page cannot draw falls to
	// the root's face. A span styling `font-family` is the source's face, never a mark.
	font_family: {
		attrs: { name: { default: '' } },
		parseDOM: [
			{
				tag: 'span[data-qm-family]',
				getAttrs: (el) => {
					const name = el.getAttribute('data-qm-family');
					return name ? { name } : false;
				}
			}
		],
		toDOM: (mark) => {
			const name = mark.attrs.name as string;
			return [
				'span',
				{ 'data-qm-family': name, style: `font-family: ${cssString(name)}, var(--_qm-font)` },
				0
			];
		}
	},
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
		// A refused href draws as a bare span, unstyled and unclickable, and the mark keeps its
		// value for encode: a copy is not the explicit conversion allowed to lose it.
		toDOM: (mark) => {
			const href = mark.attrs.href as string;
			return rendersHref(href) ? ['a', { href }, 0] : ['span', { 'data-qm-href': href }, 0];
		}
	}
};

// ── The fence's language ────────────────────────────────────────────────────
// Minted by the fence shorthand (`inputrules.ts`) and by a paste: a fence copied off a highlighted
// page carries the page's language, one copied inside the body keeps its own.

/** A `language-x` / `lang-x` token in a class list. */
const LANG_CLASS = /(?:^|\s)lang(?:uage)?-(\S+)/;

/**
 * The language a `<pre>` states: `data-lang` (what `toDOM` writes), else the class convention on
 * the `pre` or its `code`. `null` for none or an empty value.
 */
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
	// A heading holds no `hard_break`: the store clears a `continues` after one and markdown has no
	// syntax for a break inside it. Declaring it out makes that structural rather than a rule each
	// door holds.
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
					// A list stating no `start` starts at one, the absence `toDOM` writes;
					// `Number(null)` would read it as zero. A value the store would normalize away
					// reads as that absence too, since a PM doc keeping one would disagree with the
					// store for the session (CODEC §Reconciliation). Zero is not one: `0.` is an
					// ordinal `importMarkdown` produces.
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
	// `checked` is a task item's, `null` on every other item (`tasks.ts`).
	list_item: {
		content: 'block+',
		defining: true,
		attrs: { checked: { default: null } },
		parseDOM: [
			{
				tag: 'li',
				getAttrs: (el) => ({ checked: taskChecked(el) }),
				contentElement: taskBody
			}
		],
		toDOM: (node) =>
			node.attrs.checked === null ? ['li', 0] : taskDOM(node.attrs.checked as boolean)
	},
	island_block: islandBlockSpec
};

// ── Inline nodes ────────────────────────────────────────────────────────────
const inlineLeafNodes: Record<string, NodeSpec> = {
	text: { group: 'inline' },
	// `linebreakReplacement` makes a join across a `code_block`'s edge lossless: `Transform.join`
	// and `setBlockType` convert its `\n`s to breaks, which are `continues` lines.
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

// `doc: "paragraph"` (exactly one child) makes Enter a no-op at the model level: no second block
// for a split to land.
const inlineNodes: Record<string, NodeSpec> = {
	doc: { content: 'paragraph' },
	paragraph: { content: 'inline*', toDOM: () => ['p', 0] },
	text: { group: 'inline' }
};

/**
 * The constrained inline schema: one paragraph, no containers or islands, the full mark set (a
 * `richtext(inline)` field).
 */
export const inlineSchema = new Schema({ nodes: inlineNodes, marks });

/**
 * The inline schema with no mark types: a `plaintext(inline)` field, whose value is literal text
 * the boundary refuses to coerce back once it carries a mark. Declaring none makes that structural:
 * `toggleMark` has no type, the mark input rules build nothing, a paste parses marks away, and
 * `decode` drops any a stray content carries (CODEC §Inline mode).
 */
export const plaintextSchema = new Schema({ nodes: inlineNodes, marks: {} });

/**
 * A table cell: the inline schema plus `hard_break`, which a `TableCell` stores as a `\n` in its
 * `text`. Still one paragraph; a break is Shift-Enter's (`breaks.ts`). Declaring it routes `decode`
 * through the plain path, folding a cell's `continues` lines into that paragraph.
 */
export const cellSchema = new Schema({
	nodes: { ...inlineNodes, hard_break: inlineLeafNodes.hard_break },
	marks
});

/**
 * A `text` field declaring `multiline: true`: paragraphs and hard breaks, no marks, islands or
 * containers, the shape `Content::is_plain` admits. A paragraph and a break both store one `\n`, so
 * a paragraph here is a line (`data-qm-line`): `prose.css` draws a run of them at the leading.
 */
export const plainSchema = new Schema({
	nodes: {
		doc: { content: 'paragraph+' },
		paragraph: { ...blockNodes.paragraph, toDOM: () => ['p', { 'data-qm-line': '' }, 0] },
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

/** Whether `schema` can carry formatting at all: false for the two mark-free schemas.
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

/**
 * Whether `type` can hold a within-block line break, which a heading cannot (§`heading`); a `\n`
 * landing in a textblock and decode's continued segments turn on it (`breaks.ts`).
 */
export function takesLineBreak(type: NodeType): boolean {
	const br = type.schema.nodes.hard_break;
	return !!br && type.contentMatch.matchType(br) !== null;
}
