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
	DEFAULT_LEAVE_STRINGS,
	DEFAULT_SHORTCUT_STRINGS,
	DEFAULT_SLASH_STRINGS,
	DEFAULT_TABLE_STRINGS,
	type LeaveStrings,
	type ShortcutStrings,
	type SlashStrings,
	type TableChromeStrings
} from '../core/codec/index.js';
import type { BodyPlaceholder } from './structure.js';

/**
 * The island, the insert menu, the shortcut list and the leave hint's keys come from the
 * codec, which owns all four models (a NodeView inside the leaf, the trigger the leaf's keymap
 * drives, the keymaps' own tables, and the plugin that names the way out). Extending
 * rather than restating them is what keeps one English list: a consumer overrides an
 * island handle's name beside the card controls' and the codec still has a default
 * for a leaf mounted directly.
 */
export interface VisualStrings
	extends TableChromeStrings, SlashStrings, ShortcutStrings, LeaveStrings {
	// ── Card controls (accessible names: the buttons are glyphs) ───────────────
	cardMoveUp: string;
	cardMoveDown: string;
	cardDelete: string;
	/** The card-title input's own word in its accessible name, which {@link cardAction}
	 *  completes with the card's title: `Card title, Findings`. */
	cardTitle: string;
	/**
	 * A card control's accessible name, the control's own word and the card it is on, by
	 * the title the header shows: `Delete card, Findings`. An action alone stays the
	 * tooltip. Parametric, so word order stays the translator's.
	 */
	cardAction: (action: string, card: string) => string;

	/** A closed panel's header, spoken after its name (`Layout, has an issue`) when a field
	 *  inside holds a diagnostic: the leading separator is part of the wording. */
	groupFlagged: string;

	/** The same header where a field inside holds an item of review. */
	groupReviewed: string;

	// ── Review ───────────────────────────────────────────────────────────────
	/** The answer card's two buttons. */
	reviewAccept: string;
	reviewDismiss: string;
	/** The answer card's accessible name. */
	reviewProposal: string;
	/** The answer card's note on a change whose place no longer holds what its writer read. */
	reviewOutdated: string;
	/** Where the current change stands in the review and what it is to, for a screen reader:
	 *  `Change 2 of 5, Subtitle`. `name` is the field's label, the body's, or the card's title
	 *  after its tag, and empty where nothing names it. */
	reviewPosition: (at: number, of: number, name: string) => string;
	/** The tag on a card proposed new, and the mark on one proposed taken out. */
	reviewNewCard: string;
	reviewRemoveCard: string;
	/** A value that was, or would be, nothing. */
	reviewEmpty: string;
	/** Where a proposal adds a list member past the last, on the answer card. */
	reviewNewItem: string;
	/** A control under a proposal, described to assistive tech beside its name: the value it
	 *  shows is the proposed one, and `current` the value the field holds now. */
	reviewCurrently: (current: string) => string;
	/** A switch's two values, as a row words them. */
	reviewOn: string;
	reviewOff: string;

	// ── Structural undo (the toast a removal raises) ─────────────────────────
	/** The toast's notice, named for what went: `Authors 2 removed`. */
	undoRemoved: (what: string) => string;
	/** The toast's button, which puts it back. */
	undoAction: string;
	/** The standing control that puts a removed card back, named for it: `Restore Findings`. */
	undoRestore: (what: string) => string;

	// ── The add affordance ────────────────────────────────────────────────────
	/** The trailing strip's visible words and every strip's accessible name. Words alone,
	 * as every add control's string is: the control draws its own `+`. One string over
	 * one kind and many: the trigger seeds a card, and which kind is the menu's word
	 * to say or the schema's to have already settled. */
	addCard: string;

	// ── Array control ─────────────────────────────────────────────────────────
	/** A list's add chip: its words after the `+` the chip draws, and its accessible name. */
	arrayAdd: string;
	arrayRemove: string;
	/** The drag handle on an `object` row: its tooltip, which draws the keys that move the
	 *  row beside it. */
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
	/** What a screen reader hears once the errors the fields draw have changed and come to
	 *  rest: each error's field label and its text, in the page's order, and none once the
	 *  last has cleared. */
	diagAnnounced: (issues: readonly { field: string; message: string }[]) => string;

	// ── Where a field stands against its default (the label row's end) ───────
	/** The tag on a field whose `default:` is what prints. */
	fieldDefault: string;
	/** The button that unsets a field written over its `default:`; its accessible name
	 *  is this word and then the field's label. */
	fieldReset: string;

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
	/** A held item's disclosure, named for the item: it opens and closes its details. */
	matrixDetails: (title: string) => string;
	/** An added item's name at rest, a press on which edits it. */
	matrixRename: (title: string) => string;

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
	/** A field's guidance marker, named for the field it is about: `Subject guidance`.
	 *  Parametric, so word order stays the translator's. */
	fieldGuidance: (label: string) => string;

	// ── Formatting popover ────────────────────────────────────────────────────
	formatGroup: string;
	/** A mark or list button's name: its accessible name and its tooltip. The name alone:
	 *  the button's shortcut is read off its binding, drawn beside the name in the tooltip
	 *  and stated to assistive tech as `aria-keyshortcuts`. */
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
	/** The anchor button's name. The popover withholds the button, so nothing draws this. */
	formatAnchor: string;
	/** The link prompt's address input: its accessible name. */
	linkAddress: string;
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

/** The platform test `prosemirror-keymap` resolves `Mod` by, so what is printed is what
 *  the keymap binds. */
const APPLE = /Mac|iP(hone|[oa]d)/;
const platformHere = (): string => (typeof navigator === 'undefined' ? '' : navigator.platform);

/** A binding in `prosemirror-keymap` notation, apart: its modifiers and its key, a letter
 *  in capitals as a keycap and `aria-keyshortcuts` both spell it. */
function parseBinding(binding: string): { mods: Set<string>; key: string } {
	const parts = binding.split('-');
	const key = parts.pop() ?? '';
	return { mods: new Set(parts), key: /^[a-z]$/.test(key) ? key.toUpperCase() : key };
}

/** What a named key prints as. */
const KEY_GLYPH: Readonly<Record<string, string>> = {
	ArrowUp: '↑',
	ArrowDown: '↓',
	ArrowLeft: '←',
	ArrowRight: '→',
	Enter: '↵',
	Backspace: '⌫'
};
/** Apple's marks for the modifiers, in the order its menus print them. */
const APPLE_MODS: readonly (readonly [string, string])[] = [
	['Ctrl', '⌃'],
	['Alt', '⌥'],
	['Shift', '⇧'],
	['Mod', '⌘']
];

/**
 * A binding as the writer's platform prints it, for the hint beside a control's name:
 * `Mod-b` is `⌘B` on Apple's and `Ctrl+B` elsewhere, `Mod-Shift-7` is `⇧⌘7` or
 * `Ctrl+Shift+7`, `Alt-ArrowUp` is `⌥↑` or `Alt+↑`.
 */
export function keycap(binding: string, platform = platformHere()): string {
	const { mods, key } = parseBinding(binding);
	const cap = KEY_GLYPH[key] ?? key;
	if (APPLE.test(platform))
		return APPLE_MODS.map(([mod, mark]) => (mods.has(mod) ? mark : '')).join('') + cap;
	const names = [
		mods.has('Mod') || mods.has('Ctrl') ? 'Ctrl' : '',
		mods.has('Alt') ? 'Alt' : '',
		mods.has('Shift') ? 'Shift' : ''
	];
	return [...names.filter(Boolean), cap].join('+');
}

/**
 * The same binding as `aria-keyshortcuts` spells it, which is where a control states its
 * shortcut to assistive tech, its name staying its name: `Mod-b` is `Meta+B` on Apple's
 * and `Control+B` elsewhere.
 */
export function keyshortcut(binding: string, platform = platformHere()): string {
	const { mods, key } = parseBinding(binding);
	const names = [
		mods.has('Mod') ? (APPLE.test(platform) ? 'Meta' : 'Control') : '',
		mods.has('Ctrl') ? 'Control' : '',
		mods.has('Alt') ? 'Alt' : '',
		mods.has('Shift') ? 'Shift' : ''
	];
	return [...names.filter(Boolean), key].join('+');
}

/** How many fields `diagAnnounced` names before it counts the rest, so a host's batch over
 *  a whole document is still one sentence. */
const FIELDS_NAMED = 3;

/** The package's English. Every key, so the merge below is total. */
export const DEFAULT_VISUAL_STRINGS: VisualStrings = {
	...DEFAULT_TABLE_STRINGS,
	...DEFAULT_SLASH_STRINGS,
	...DEFAULT_SHORTCUT_STRINGS,
	...DEFAULT_LEAVE_STRINGS,
	cardMoveUp: 'Move up',
	cardMoveDown: 'Move down',
	cardDelete: 'Delete card',
	cardTitle: 'Card title',
	cardAction: (action, card) => `${action}, ${card}`,
	groupFlagged: ', has an issue',
	groupReviewed: ', has changes to review',
	reviewAccept: 'Accept',
	reviewDismiss: 'Dismiss',
	reviewProposal: 'Proposed change',
	reviewOutdated: 'Changed since proposed',
	reviewPosition: (at, of, name) => `Change ${at} of ${of}${name ? `, ${name}` : ''}`,
	reviewNewCard: 'New card',
	reviewRemoveCard: 'Proposed removal',
	reviewEmpty: 'Empty',
	reviewNewItem: 'New item',
	reviewCurrently: (current) => `Proposed change, currently ${current}`,
	reviewOn: 'On',
	reviewOff: 'Off',
	undoRemoved: (what) => `${what} removed`,
	undoAction: 'Undo',
	undoRestore: (what) => `Restore ${what}`,
	addCard: 'Add card',
	arrayAdd: 'Add',
	arrayRemove: 'Remove',
	arrayDrag: 'Drag to move',
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
	diagAnnounced: (issues) => {
		if (issues.length === 0) return 'No issues.';
		if (issues.length === 1) return `${issues[0].field}: ${issues[0].message}`;
		const fields = [...new Set(issues.map((issue) => issue.field))];
		const named = fields.slice(0, FIELDS_NAMED).join(', ');
		const rest = fields.length - FIELDS_NAMED;
		return `${issues.length} issues: ${named}${rest > 0 ? `, and ${rest} more` : ''}.`;
	},
	fieldDefault: 'Default',
	fieldReset: 'Reset',
	enumUnsetTag: 'Default',
	enumReset: 'Reset to default',
	enumClear: 'Clear',
	matrixHeld: (held, total) => `${held} of ${total} selected`,
	matrixAdd: (list) => (list ? `Add to ${list}…` : 'Add…'),
	matrixItemTitle: (list, index) => `${list ? `${list} item` : 'Item'} ${index}`,
	matrixRemove: (title) => `Remove ${title}`,
	matrixDetails: (title) => `${title} details`,
	matrixRename: (title) => `Rename ${title}`,
	dateToday: 'Today',
	optionalGhost: 'None',
	proseHeld: "This field has formatting it can't edit here. It is kept as it is.",
	fieldGuidance: (label) => `${label} guidance`,
	formatGroup: 'Formatting',
	formatBold: 'Bold',
	formatEmphasis: 'Italic',
	formatUnderline: 'Underline',
	formatStrikethrough: 'Strikethrough',
	formatCode: 'Code',
	formatLink: 'Link',
	formatNumberedList: 'Numbered list',
	formatBulletedList: 'Bulleted list',
	formatFont: 'Font',
	fontDefault: 'Default font',
	fontMixed: 'Mixed fonts',
	formatAnchor: 'Anchor',
	linkAddress: 'Link address',
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
