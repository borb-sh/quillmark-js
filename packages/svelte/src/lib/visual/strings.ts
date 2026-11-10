// Every word the visual surface says, in one place, so a product shipping in
// another language can replace them. Keyed and partial: a consumer sets the keys
// it has translations for and the rest take the package's English, which is what
// makes wording an override rather than a fork.
//
// Several of these are accessible names rather than decoration — the card
// controls, the add trigger — so an untranslated surface is
// not merely inconsistent, it reads the wrong language to a screen reader. That is
// why this exists as a seam and not as a list of literals to grep for.
//
// A key is a plain string where the text is fixed and a function where it is not:
// a parametric string cannot be assembled from fragments and stay translatable,
// since the word order is the translator's to choose.
//
// The strings reach the tree through context, not props. They are ambient,
// read-only, and wanted eight components deep (a card's controls, a field's
// optional ghost, the formatting popover, the tips card); threading them by hand
// would put a `strings` prop on every component between the root and each leaf,
// which is a prop that means nothing to any of them.
import { getContext, setContext } from 'svelte';
import type { Diagnostic } from '@quillmark/wasm';
import {
	DEFAULT_REVIEW_STRINGS,
	DEFAULT_SHORTCUT_STRINGS,
	DEFAULT_SLASH_STRINGS,
	DEFAULT_TABLE_STRINGS,
	type ReviewStrings,
	type ShortcutStrings,
	type SlashStrings,
	type TableChromeStrings
} from '../core/codec/index.js';
import type { BodyPlaceholder } from './structure.js';

/**
 * The island, the insert menu, the shortcut list and the review layer's keys come from the
 * codec, which owns all four models (a NodeView inside the leaf, the trigger the leaf's keymap
 * drives, the keymaps' own tables, and the decorations a leaf draws its review with). Extending
 * rather than restating them is what keeps one English list: a consumer overrides an
 * island handle's name beside the card controls' and the codec still has a default
 * for a leaf mounted directly.
 */
export interface VisualStrings
	extends TableChromeStrings, SlashStrings, ShortcutStrings, ReviewStrings {
	// ── Card controls (accessible names: the buttons are glyphs) ───────────────
	cardMoveUp: string;
	cardMoveDown: string;
	cardDelete: string;
	/** The card-title input's accessible name. */
	cardTitle: string;
	/**
	 * A card control's accessible name, the action and the card it acts on, by the title
	 * the header shows: `Delete card, Findings`. The action alone stays the tooltip.
	 * Parametric, so word order stays the translator's.
	 */
	cardAction: (action: string, card: string) => string;

	/** A closed panel's header, spoken after its name (`Layout, has an issue`) when a field
	 *  inside holds a diagnostic: the leading separator is part of the wording. */
	groupFlagged: string;

	/** The same header where a field inside holds an item of review. */
	groupReviewed: string;

	// ── Review (the card over a change, the row under a field) ───────────────
	/** The card's button, and the row's: takes the change back. */
	reviewUndo: string;
	/** Its tooltip, which names the chord. */
	reviewUndoTitle: string;
	/** The card's accessible name. */
	reviewChange: string;
	/** The toast over a field's proposal taken, beside its way back. */
	reviewAccepted: string;
	/** Before what a change replaced: `Was  the old words`. */
	reviewWas: string;
	/** The whole of the card over text that replaced nothing. */
	reviewAdded: string;
	/** Before the text a change took out, or the whole of the card where the host kept none. */
	reviewRemoved: string;
	/** A value that was, or would be, nothing: `Was  Empty`. */
	reviewEmpty: string;
	/** A switch's two values, as a card and a row word them. */
	reviewOn: string;
	reviewOff: string;

	// ── Structural undo (the toast a removal raises) ─────────────────────────
	/** The toast's notice, named for what went: `Authors 2 removed`. */
	undoRemoved: (what: string) => string;
	/** The toast's button, which puts it back. */
	undoAction: string;

	// ── The add affordance ────────────────────────────────────────────────────
	/** The trailing strip's visible words, drawn after a `+`, and every
	 * strip's accessible name. One string over
	 * one kind and many: the trigger seeds a card, and which kind is the menu's word
	 * to say or the schema's to have already settled. */
	addCard: string;

	// ── Array control ─────────────────────────────────────────────────────────
	arrayAdd: string;
	arrayRemove: string;
	/** The drag handle on an `object` row: its tooltip, which names the keys that move
	 *  the row too. */
	arrayDrag: string;
	/** What a list's standing row ghosts, the row that is not an element yet: the words
	 *  say what typing there does. */
	arrayStanding: string;
	/**
	 * A row control's accessible name, the action and the row it acts on: `Remove
	 * Authors 2`. The action alone stays the tooltip. Parametric, so word order stays
	 * the translator's.
	 */
	arrayRowAction: (action: string, row: string) => string;
	/**
	 * The count beside the add chip on an array declaring `max:`, the carrier a
	 * disabled chip has no other way to state: `2 / 3`. Parametric, so a translator
	 * spells the separator.
	 */
	arrayCount: (count: number, max: number) => string;
	/**
	 * The count beside the label of a `text` or `richtext` field declaring `max:`, the
	 * carrier of a keystroke the cap refuses: `12 / 40`. Parametric, so a translator
	 * spells the separator.
	 */
	textCount: (count: number, max: number) => string;
	/**
	 * An `object` array element's title, open or collapsed: the 1-based index, the label
	 * standing over the list already. Parametric, so word order stays the translator's.
	 */
	elementItem: (index: number) => string;
	/**
	 * An `object` array element's accessible name: the label and {@link elementItem},
	 * so the words the row draws are inside the name it is spoken by.
	 */
	elementUntitled: (label: string, index: number) => string;

	// ── Diagnostics ───────────────────────────────────────────────────────────
	// A validation error a field draws, worded for whoever fills the form rather than for
	// the quill's author: the label above it names the field, so no path. Each reads the
	// diagnostic's `args`, below a consumer's `formatDiagnostic` and above the message.
	/** `validation::type_mismatch`: the value is not the declared type (`args.expected`). */
	diagTypeMismatch: (expected: string) => string;
	/** `validation::format_violation`: the value misses a string format (`args.format`). */
	diagFormatViolation: (format: string) => string;

	// ── Enum control ──────────────────────────────────────────────────────────
	/** The tag on the `default:` member's row ({@link EnumField}). */
	enumUnsetTag: string;
	/** The row under a stored value that clears it back to the `default:`. */
	enumReset: string;
	/** The same row where no `default:` prints: no `default:`, a blank one, or an `enum?`. */
	enumClear: string;

	// ── Matrix control ────────────────────────────────────────────────────────
	/** The count in the matrix's label row: how many of its items are ticked. */
	matrixHeld: (held: number, total: number) => string;
	/** An open matrix's add box at rest, naming the list it adds to: `Add to Staff…`. The box
	 *  draws its own `+`. `list` is empty for a matrix mounted with no label. */
	matrixAdd: (list: string) => string;
	/** An added item's title input, named for the list it stands in and its 1-based
	 *  place among the added items; also what an untitled item is called. */
	matrixItemTitle: (list: string, index: number) => string;
	/** An added item's remove control, named for the item. */
	matrixRemove: (title: string) => string;

	// ── Date control ──────────────────────────────────────────────────────────
	/** The date field's toggle, pressed while the field holds `today`: the render
	 *  date rather than a written one. */
	dateToday: string;

	// ── Field chrome ──────────────────────────────────────────────────────────
	/** What an unset optional cell (`t?`) ghosts at rest: the `none` it prints
	 *  unanswered, in the product's words. */
	optionalGhost: string;
	/** Under a prose leaf holding more structure than it can edit (paragraphs, a list or
	 *  an island in a one-line leaf, an island in any subform cell), which it draws
	 *  read-only rather than lose. */
	proseHeld: string;

	// ── Formatting popover ────────────────────────────────────────────────────
	formatGroup: string;
	formatBold: string;
	formatEmphasis: string;
	formatUnderline: string;
	formatStrikethrough: string;
	formatCode: string;
	formatLink: string;
	formatNumberedList: string;
	formatBulletedList: string;
	/** The font picker's accessible name; drawn only where the host hands the editor a
	 *  font library or the selection sets a family. */
	formatFont: string;
	/** The picker's option that sets no family: the text takes the surrounding face. */
	fontDefault: string;
	/** What the picker reads over a selection setting more than one family. */
	fontMixed: string;
	/** The anchor button's accessible name. The popover withholds the button, so
	 *  nothing draws this or the title below. */
	formatAnchor: string;
	/** Its hover title, which says what an anchor is; the name above only says what. */
	formatAnchorTitle: string;
	linkPlaceholder: string;
	linkApply: string;
	/** Drawn only where the selection carries a link. */
	linkRemove: string;
	linkCancel: string;

	// ── Tips card ─────────────────────────────────────────────────────────────
	tipsLabel: string;
	tipsDismiss: string;
	tipsNext: string;
	tipsDot: (index: number, count: number) => string;

	// ── The unknown-kind recovery shell ───────────────────────────────────────
	/** The whole sentence, since a translator orders the kind within it. */
	unknownKind: (kind: string) => string;
	retypeLabel: string;
	retypePlaceholder: string;
	noCardKinds: string;

	// ── The card body ─────────────────────────────────────────────────────────
	/** The body leaf's accessible name: no label names it, the body being the one
	 *  surface in a card that is paper ({@link Card}). */
	bodyLabel: string;
	/**
	 * The flat built-in invitation: the package's own words, kept to the one thing
	 * true of every body so it claims nothing about the card it sits in.
	 */
	bodyGhost: string;
	/**
	 * Per-CARD wording, in place of {@link VisualStrings.bodyGhost}; `undefined`
	 * takes it. A body `default:` and the kind's `body.example` both outrank it
	 * (`resolveBodyGhost`). Pure and uncached ({@link BodyPlaceholder}).
	 */
	bodyPlaceholder: BodyPlaceholder;
}

/**
 * The hook that turns a boundary `Diagnostic` into displayed text.
 *
 * A formatter reads the whole `Diagnostic`, including `args`: the facts `message`
 * interpolates, keyed by name. What it can re-word tracks what that type carries per
 * lane (INVARIANTS §Diagnostics for why each lands where it does):
 *
 * - **`validation::enum_violation`, `type_mismatch`, `format_violation`**: the
 *   constraint re-words from the quill's schema at `path`, the offending value from
 *   `args` (`value` / `sourceToken` / `actual`, Quillmark testifying to what it
 *   saw) and never from the document at `path`: validation runs post-coercion, so
 *   the validator read a value the document does not hold and a sentence built from
 *   `path` names a spelling the user never typed.
 * - **`edit::field_coercion_failed`**: re-words from the app's own control state, the
 *   refused value being in neither document (unchanged on throw) nor schema.
 * - **`parse::yaml_error_with_location`, `invalid_structure`**: does not re-word. No
 *   `path`; `args` names the block (`blockIndex`) and `location` places the failure in
 *   the document's own coordinates, Quillmark prose riding under no key: the parser's own
 *   text, its column and its caret snippet exist only inside `message`.
 * - **`LiveSession.warnings`**: does not re-word. Backend text, an external feed.
 *
 * The last two are the boundary's shape, not a gap in it, so the fallback arm is
 * permanent: returning `undefined` renders `d.message` unchanged. `code` is optional
 * at this pin, so that arm is reachable by type and not only in principle.
 *
 * Displayed text is that message or this replacement and nothing beside it: `hint` is
 * the tail of the message it accompanies, so rendering it too ships a two-language
 * diagnostic.
 */
export type FormatDiagnostic = (d: Diagnostic) => string | undefined;

/**
 * A `Mod` chord as the writer's platform prints it: `⌘B` on Apple's, `Ctrl+B`
 * elsewhere, and `Shift-7` as `⇧⌘7` or `Ctrl+Shift+7`. The platform test is the one
 * `prosemirror-keymap` resolves `Mod` by, so a tooltip names the chord the keymap binds.
 */
export function chord(
	key: string,
	platform = typeof navigator === 'undefined' ? '' : navigator.platform
): string {
	const shift = key.startsWith('Shift-');
	const bare = shift ? key.slice('Shift-'.length) : key;
	if (/Mac|iP(hone|[oa]d)/.test(platform)) return `${shift ? '⇧' : ''}⌘${bare}`;
	return `Ctrl+${shift ? 'Shift+' : ''}${bare}`;
}

/** An `Alt` chord as the writer's platform prints it: `⌥↑` on Apple's, `Alt+↑` elsewhere,
 *  on the test {@link chord} reads. */
export function alt(
	key: string,
	platform = typeof navigator === 'undefined' ? '' : navigator.platform
): string {
	return /Mac|iP(hone|[oa]d)/.test(platform) ? `⌥${key}` : `Alt+${key}`;
}

/** The package's English. Every key, so the merge below is total. */
export const DEFAULT_VISUAL_STRINGS: VisualStrings = {
	...DEFAULT_TABLE_STRINGS,
	...DEFAULT_SLASH_STRINGS,
	...DEFAULT_SHORTCUT_STRINGS,
	cardMoveUp: 'Move up',
	cardMoveDown: 'Move down',
	cardDelete: 'Delete card',
	cardTitle: 'Card title',
	cardAction: (action, card) => `${action}, ${card}`,
	groupFlagged: ', has an issue',
	groupReviewed: ', has changes to review',
	...DEFAULT_REVIEW_STRINGS,
	reviewAcceptTitle: `Accept (${chord('↵')})`,
	reviewDismissTitle: `Dismiss (${chord('.')})`,
	reviewUndo: 'Undo',
	reviewUndoTitle: `Undo (${chord('.')})`,
	reviewChange: 'Change',
	reviewAccepted: 'Change accepted',
	reviewWas: 'Was',
	reviewAdded: 'Added',
	reviewRemoved: 'Removed',
	reviewEmpty: 'Empty',
	reviewOn: 'On',
	reviewOff: 'Off',
	undoRemoved: (what) => `${what} removed`,
	undoAction: 'Undo',
	addCard: 'Add card',
	arrayAdd: '+ Add',
	arrayRemove: 'Remove',
	arrayDrag: `Drag to move (${alt('↑/↓')})`,
	arrayStanding: 'Add an item…',
	arrayRowAction: (action, row) => `${action} ${row}`,
	arrayCount: (count, max) => `${count} / ${max}`,
	textCount: (count, max) => `${count} / ${max}`,
	elementItem: (index) => `Item ${index}`,
	elementUntitled: (label, index) => `${label}, item ${index}`,
	diagTypeMismatch: (expected) =>
		expected === 'boolean'
			? 'Needs to be on or off.'
			: expected === 'integer'
				? 'Needs a whole number, like 12.'
				: expected === 'number'
					? 'Needs a number, like 12.'
					: `Needs a ${expected} value.`,
	diagFormatViolation: (format) =>
		format === 'date'
			? 'Not a real date. Check the day and month, or press Today.'
			: format === 'datetime'
				? 'Not a real date and time. Check the day, month and time.'
				: `Doesn't match the ${format} format.`,
	enumUnsetTag: 'Default',
	enumReset: 'Reset to default',
	enumClear: 'Clear',
	matrixHeld: (held, total) => `${held} of ${total} selected`,
	matrixAdd: (list) => (list ? `Add to ${list}…` : 'Add…'),
	matrixItemTitle: (list, index) => `${list ? `${list} item` : 'Item'} ${index}`,
	matrixRemove: (title) => `Remove ${title}`,
	dateToday: 'Today',
	optionalGhost: 'None',
	proseHeld: "This field has formatting it can't edit here. It is kept as it is.",
	formatGroup: 'Formatting',
	formatBold: `Bold (${chord('B')})`,
	formatEmphasis: `Italic (${chord('I')})`,
	formatUnderline: `Underline (${chord('U')})`,
	formatStrikethrough: `Strikethrough (${chord('Shift-X')})`,
	formatCode: `Code (${chord('E')})`,
	formatLink: `Link (${chord('K')})`,
	formatNumberedList: `Numbered list (${chord('Shift-7')})`,
	formatBulletedList: `Bulleted list (${chord('Shift-8')})`,
	formatFont: 'Font',
	fontDefault: 'Default font',
	fontMixed: 'Mixed fonts',
	formatAnchor: 'Anchor',
	formatAnchorTitle: 'Anchor — an identity handle over the selection',
	linkPlaceholder: 'https://…',
	linkApply: 'Apply',
	linkRemove: 'Remove',
	linkCancel: 'Cancel',
	tipsLabel: 'Editor tips',
	tipsDismiss: 'Dismiss',
	tipsNext: 'Next',
	tipsDot: (index, count) => `Tip ${index} of ${count}`,
	unknownKind: (kind) => `Unknown card type ${kind}. Its content is kept.`,
	retypeLabel: 'Change to',
	retypePlaceholder: 'Choose a type…',
	noCardKinds: 'This document declares no card types — delete this card to remove it.',
	bodyLabel: 'Body',
	bodyGhost: 'Write…',
	bodyPlaceholder: () => undefined
};

/** A consumer's wording: any subset, the rest the package's. */
export type VisualStringsInput = Partial<VisualStrings>;

/** Fill a partial override to the whole key set. */
export function mergeStrings(custom: VisualStringsInput | undefined): VisualStrings {
	return custom ? { ...DEFAULT_VISUAL_STRINGS, ...custom } : DEFAULT_VISUAL_STRINGS;
}

const KEY = Symbol('qm.wording');

/**
 * Everything the surface says, as the tree reads it. Getters rather than values,
 * so a consumer swapping locale mid-session re-renders rather than freezing the
 * wording at mount. The two seams travel together because a product needs both or
 * neither: wording it cannot apply to the diagnostics beside it is half a
 * translation.
 */
export interface Wording {
	readonly strings: VisualStrings;
	readonly formatDiagnostic: FormatDiagnostic | undefined;
}

export function setWording(channel: Wording): void {
	setContext(KEY, channel);
}

/**
 * The wording for a component under a mounted editor. Falls to the package's
 * English off-tree, so a component rendered outside the editor (a test, a consumer
 * composing one directly) still has every key.
 */
export function wording(): Wording {
	return (
		getContext<Wording>(KEY) ?? { strings: DEFAULT_VISUAL_STRINGS, formatDiagnostic: undefined }
	);
}

/** A diagnostic's displayed text: the consumer's formatter, else the package's wording for
 *  a validation code whose `args` carry what it needs, else its message. The last arm is
 *  permanent, not a courtesy ({@link FormatDiagnostic}). */
export function diagnosticText(
	d: Diagnostic,
	format: FormatDiagnostic | undefined,
	strings?: VisualStrings
): string {
	return (format ? format(d) : undefined) ?? (strings && builtIn(d, strings)) ?? d.message;
}

function builtIn(d: Diagnostic, strings: VisualStrings): string | undefined {
	const args = (d.args ?? {}) as Record<string, unknown>;
	const str = (k: string): string | undefined =>
		typeof args[k] === 'string' ? (args[k] as string) : undefined;
	switch (d.code) {
		case 'validation::type_mismatch': {
			const expected = str('expected');
			return expected ? strings.diagTypeMismatch(expected) : undefined;
		}
		case 'validation::format_violation': {
			const format = str('format');
			return format ? strings.diagFormatViolation(format) : undefined;
		}
		default:
			return undefined;
	}
}
