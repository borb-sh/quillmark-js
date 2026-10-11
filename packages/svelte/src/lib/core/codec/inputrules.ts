// Input rules: the markdown-shorthand plugin the codec owns (`**`→strong, `*`→em,
// `~~`→strike, `` ` ``→code, `# `→heading, `- `/`1. `→lists, `> `→blockquote,
// `---`→divider, a fence→code block).
// Mark rules are hand-rolled (prosemirror-inputrules ships only node rules); every
// block rule is one regexp over a command in `blocks.ts`, which is the slash menu's
// implementation too. These produce transactions the codec already lowers: they add no
// new lowering surface.
//
// A rule declines only where what it would mint is unrepresentable, or is a shape
// another gesture owns — never on how a quill renders it. What a quill typesets is not
// knowable here (a quill this build has not seen is the open-sets case, CODEC §"Open
// sets"), and a construct that arrives through `importMarkdown` must stay authorable or
// a document opens carrying a shape the editor refuses to make. So one guard survives:
// `- ` / `1. ` at the head of an existing item, where Tab owns the nesting.
import { InputRule, inputRules, undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { MarkType, Schema } from 'prosemirror-model';
import type { Command, EditorState, Plugin, Transaction } from 'prosemirror-state';
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
	// schema has the mark: the inline schema omits them, and a plaintext one declares none
	// at all.
	if (m.strong) rules.push(markInputRule(/\*\*([^*]+)\*\*$/, m.strong, 2));
	if (m.em) rules.push(markInputRule(/(?:^|[^*])\*([^*]+)\*$/, m.em, 1));
	if (m.strike) rules.push(markInputRule(/~~([^~]+)~~$/, m.strike, 2));
	if (m.code) rules.push(markInputRule(/`([^`]+)`$/, m.code, 1));

	// Block shorthands. Each command answers for the schema it is run against, so a
	// schema without the node declines rather than being guarded here.
	rules.push(blockRule(/^(#{1,6})\s$/, (match) => toHeading(match[1].length)));
	rules.push(blockRule(/^```$/, toCodeBlock));
	rules.push(blockRule(/^---$/, insertDivider));
	// `- ` / `1. ` at the start of a block, here or nested inside an item — but not at
	// the start of an item's own first block, where the command declines.
	rules.push(blockRule(/^\s*([-+*])\s$/, () => wrapInList(false)));
	rules.push(
		blockRule(/^(\d+)\.\s$/, (match) =>
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

/** Backspace on the press right after a rule fired takes the rule back and leaves the
 *  text it consumed, the way a writer who meant the literal `# ` says so. Mounted ahead
 *  of every other keymap: it declines on any other press. */
export function undoRuleKeymap(): Plugin {
	return keymap({ Backspace: undoInputRule });
}
