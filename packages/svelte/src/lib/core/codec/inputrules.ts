// Input rules: the markdown-shorthand plugin the codec owns (`**`/`__`→strong,
// `*`/`_`→em, `~~`→strike, `` ` ``→code, `# `→heading, `- `/`1. `/`1) `→lists,
// `> `→blockquote, `---`→divider, a typed URL→link), and the fence, which fires on Enter
// rather than as typed.
// Mark rules are hand-rolled (prosemirror-inputrules ships only node rules); every
// block rule is one regexp over a command in `blocks.ts`, which is the slash menu's
// implementation too. These produce transactions the codec already lowers: they add no
// new lowering surface.
//
// A rule declines only where what it would mint is unrepresentable, or is a shape
// another gesture owns — never on how a quill renders it. What a quill typesets is not
// knowable here (a quill this build has not seen is the open-sets case, CODEC §"Open
// sets"), and a construct that arrives through `importMarkdown` must stay authorable or
// a document opens carrying a shape the editor refuses to make. So one rule answers
// otherwise: `- ` / `1. ` at the head of an existing item retypes the item's list, where
// a wrap would nest and Tab owns the nesting.
import { InputRule, inputRules, undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { MarkType, Schema } from 'prosemirror-model';
import type { Command, EditorState, Plugin, Transaction } from 'prosemirror-state';
import { rendersHref } from './urls.js';
import {
	consuming,
	insertDivider,
	toCodeBlock,
	toHeading,
	wrapInList,
	wrapInQuote
} from './blocks.js';

/**
 * A mark input rule: when `regexp` (ending in the closing delimiter) matches
 * before the caret, wrap capture group 1 in `markType` and drop the delimiters.
 * `delimLen` is the delimiter length (opening == closing for every rule here).
 * `match[0]` anatomy is `prefix? open captured close`: the em rule's
 * `(?:^|[^*])` guard consumes one non-delimiter prefix char into the match, so
 * positions are derived from the known delimiter/capture lengths, never from
 * `indexOf` (which both deletes that prefix char and mis-anchors when it
 * happens to equal the captured text). `[start, end)` spans `match[0]` minus
 * the just-typed text (not yet inserted when the rule fires), so the trailing
 * delete covers only the closing-delimiter chars actually in the doc.
 */
function markInputRule(regexp: RegExp, markType: MarkType, delimLen: number): InputRule {
	return new InputRule(
		regexp,
		(
			state: EditorState,
			match: RegExpMatchArray,
			start: number,
			end: number
		): Transaction | null => {
			const captured = match[1];
			if (captured == null) return null;
			const tr = state.tr;
			const prefixLen = match[0].length - (captured.length + 2 * delimLen);
			const openStart = start + prefixLen;
			const contentStart = openStart + delimLen;
			const contentEnd = contentStart + captured.length;
			// Delete trailing delimiter, then leading, then mark the surviving content.
			if (end > contentEnd) tr.delete(contentEnd, end);
			tr.delete(openStart, contentStart);
			tr.addMark(openStart, openStart + captured.length, markType.create());
			tr.removeStoredMark(markType); // don't let the mark bleed into the next char
			return tr;
		}
	);
}

/** A typed URL, closed by the space after it: a scheme `rendersHref` follows, or a bare
 *  `www.`, less the punctuation around it. */
const TYPED_URL = /(?:^|[\s(["'])((?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s.]\S*?)([.,;:!?)\]'"]*)\s$/i;

/** The link a typed URL takes, as a paste over a selection does (`link-paste.ts`): the
 *  URL's own text, with a bare `www.` read as `https://`. The space that closed it is
 *  typed after the link. Declined over a span already linked or set as code. */
function autolinkRule(link: MarkType, code: MarkType | undefined): InputRule {
	return new InputRule(
		TYPED_URL,
		(state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
			const [whole, url, trail] = match as unknown as [string, string, string];
			const from = start + whole.length - 1 - trail.length - url.length;
			const to = from + url.length;
			const href = /^www\./i.test(url) ? `https://${url}` : url;
			if (!rendersHref(href) || state.doc.rangeHasMark(from, to, link)) return null;
			if (code && state.doc.rangeHasMark(from, to, code)) return null;
			return state.tr.addMark(from, to, link.create({ href })).insertText(whole.slice(-1), end);
		}
	);
}

/** A block shorthand: the regexp that fires it, and the command it runs in the match's
 *  place. Every one is `^`-anchored, so the command's own head-of-a-textblock guard is
 *  the same position the regexp already stands at. The caret it places is scrolled to
 *  here: `consuming` rebuilds the transaction, so a flag the command set is not on it. */
function blockRule(regexp: RegExp, command: (match: RegExpMatchArray) => Command): InputRule {
	return new InputRule(
		regexp,
		(state: EditorState, match: RegExpMatchArray, start: number, end: number) =>
			consuming(state, start, end, command(match))?.tr.scrollIntoView() ?? null
	);
}

/** The full markdown-shorthand rule set for a block schema. */
export function markdownInputRules(schema: Schema): InputRule[] {
	const rules: InputRule[] = [];
	const m = schema.marks;

	// Inline marks. Non-greedy capture between matching delimiters. Built only where the
	// schema has the mark: the inline schema omits them, and a `text` one declares none
	// at all. An underscore pair opens only past a word, so `snake_case_name` stays text.
	if (m.strong) rules.push(markInputRule(/\*\*([^*]+)\*\*$/, m.strong, 2));
	if (m.strong) rules.push(markInputRule(/(?:^|[^\w])__([^_]+)__$/, m.strong, 2));
	if (m.em) rules.push(markInputRule(/(?:^|[^*])\*([^*]+)\*$/, m.em, 1));
	if (m.em) rules.push(markInputRule(/(?:^|[^\w])_([^_]+)_$/, m.em, 1));
	if (m.strike) rules.push(markInputRule(/~~([^~]+)~~$/, m.strike, 2));
	if (m.code) rules.push(markInputRule(/`([^`]+)`$/, m.code, 1));
	if (m.link) rules.push(autolinkRule(m.link, m.code));

	// Block shorthands. Each command answers for the schema it is run against, so a
	// schema without the node declines rather than being guarded here.
	rules.push(blockRule(/^(#{1,6})\s$/, (match) => toHeading(match[1].length)));
	rules.push(blockRule(/^---$/, insertDivider));
	// `- ` / `1. ` / `1) ` at the start of a block, here or nested inside an item; at the
	// start of an item's own first block the command retypes the item's list instead.
	rules.push(blockRule(/^\s*([-+*])\s$/, () => wrapInList(false)));
	rules.push(
		blockRule(/^(\d+)[.)]\s$/, (match) =>
			wrapInList(
				true,
				{ start: +match[1] },
				(node) => node.childCount + (node.attrs.start as number) === +match[1]
			)
		)
	);
	rules.push(blockRule(/^\s*>\s$/, wrapInQuote));
	return rules;
}

/** The input-rules plugin the field mounts by default (opt-out via createField). */
export function inputRulesPlugin(schema: Schema): Plugin {
	return inputRules({ rules: markdownInputRules(schema) });
}

/** A fence's opening line: three backticks, then the language, if one is typed. */
const FENCE = /^```([^\s`]*)$/;

/**
 * Enter at the end of a paragraph that is a fence's opening line → a code block carrying
 * the language typed after the backticks. The one shorthand Enter fires rather than its
 * last character: on the third backtick the language is not typed yet. It records itself
 * as the input-rules plugin's last rule, so the Backspace after takes it back like any
 * other shorthand.
 */
const fenceOnEnter: Command = (state, dispatch) => {
	const { $from, empty } = state.selection;
	const line = $from.parent;
	if (!empty || line.type !== state.schema.nodes.paragraph) return false;
	if ($from.parentOffset !== line.content.size || line.childCount !== 1 || !line.firstChild!.isText)
		return false;
	const match = FENCE.exec(line.textContent);
	if (!match) return false;
	const done = consuming(state, $from.start(), $from.pos, toCodeBlock({ lang: match[1] || null }));
	if (!done) return false;
	if (dispatch) {
		const tr = done.tr.scrollIntoView();
		const rules = state.plugins.find((plugin) => plugin.spec.isInputRules);
		if (rules) tr.setMeta(rules, { transform: tr, from: $from.pos, to: $from.pos, text: '' });
		dispatch(tr);
	}
	return true;
};

/** Backspace on the press right after a rule fired takes the rule back and leaves the
 *  text it consumed, the way a writer who meant the literal `# ` says so; and Enter fires
 *  the fence. Mounted ahead of every other keymap: each declines on any other press. */
export function undoRuleKeymap(): Plugin {
	return keymap({ Backspace: undoInputRule, Enter: fenceOnEnter });
}
