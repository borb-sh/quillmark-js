// The codec barrel: the bidirectional bridge between one content field (`Content`)
// and one ProseMirror document (INVARIANTS §"The codec"). Decode (content → PM), lower (PM doc → a
// `Change` for `apply`), the UTF-16↔PM position map, and the `createField`
// prose leaf. Consumed by the VisualEditor and the codec test suite.

// ProseMirror's structural base styles and the gap cursor's, then the retint of the
// hues they mint. Imported here because `createField` is what mounts a view: a
// consumer reaching the codec directly gets them with it, and the order is what makes
// the retint win.
import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-gapcursor/style/gapcursor.css';
import './prose.css';

// What a floating surface anchors to. The visual tier's own surfaces mint one over a
// selection (`visual/FormatPopover.svelte`), so it is reached off-barrel.
export { markAnchor, rangeAnchor } from './anchor.js';
export type { RangeAnchor } from './anchor.js';

// The prose leaf.
export {
	createField,
	emptyContent,
	heldAttributes,
	isEmptyContent,
	proseAttributes,
	proseLeafPlugins
} from './field.js';
export type { CreateFieldOpts, FieldController, LeafProjection, LeafViews } from './field.js';
export { capCount } from './cap.js';
export { joinLines, pastedLines } from './line-paste.js';
export type { TextCap } from './cap.js';

// The table island's chrome vocabulary: the visual tier's `strings` set extends it,
// so the island's wording is overridden beside every other key.
export { DEFAULT_TABLE_STRINGS } from './table-view.js';
export type { TableChromeStrings } from './table-view.js';

// The slash menu: the codec owns the model and the picks, the chrome the words and
// the pixels (`visual/SlashMenu.svelte` is the only off-barrel caller).
export { DEFAULT_SLASH_STRINGS } from './slash.js';
export type { SlashState, SlashStrings } from './slash.js';

// The body's way out by the keyboard: the codec owns the keys and the hint's element,
// the visual tier's `strings` set its wording.
export { DEFAULT_LEAVE_STRINGS } from './leave.js';
export type { LeaveStrings } from './leave.js';

// The review layer a leaf draws over its blocks: the visual tier's `ReviewItem` narrows to the
// leaf's own.
export type { BlockPlace, LeafUndrawn, ReviewAction, ReviewReport, TextReview } from './review.js';
export { wordDiff } from './review-diff.js';
export { valueDiffPlugin } from './value-diff.js';
export type { ValueProposal, ValueState } from './value-diff.js';
export { asContent, planValue, valueChanges } from './value-plan.js';
export type { ValuePlan, ValueChange } from './value-plan.js';
export type { DiffHunk } from './review-diff.js';

// The rich editor's shortcuts as a host lists them, read off the tables the keymaps bind from;
// the visual tier's `strings` set extends their wording, and the formatting popover binds its
// link chord from `FIELD_KEYS`.
export {
	DEFAULT_SHORTCUT_STRINGS,
	FIELD_KEYS,
	LIST_KEYS,
	REVIEW_KEYS,
	editorShortcuts
} from './shortcuts.js';
export type { EditorShortcut, ShortcutScope, ShortcutStrings } from './shortcuts.js';

// Schemas (the decode/encode target; the VisualEditor mounts them). `hasMarks` is
// what a mark surface asks before offering itself over a leaf.
export {
	blockSchema,
	inlineSchema,
	plaintextSchema,
	plainSchema,
	leafSchema,
	hasMarks
} from './schema.js';

// The url edge: `rendersHref` is the link gate the prompt re-asks on submit, and
// `storableUrl` the encode the store's own refusal requires of the value it takes
// (`visual/links.ts`).
export { rendersHref, storableUrl } from './urls.js';

// Decode / encode / positions (tests + VisualEditor).
//
// The barrel carries what has an off-barrel caller, and nothing else. A symbol
// reached only by relative import within `codec/` stays off it: an export nothing
// imports is surface that still has to stay honest.
export { decode, fitsInline, fitsLeaf, fitsPlain, renderContent, usvLength } from './decode.js';
export { pmToContent, lower } from './encode.js';
export { offsetToPM, pmToOffset, buildLineIndex } from './positions.js';

// Reconciliation gate.
export { createReconciler, contentEqual, valueEqual } from './reconcile.js';

// Input rules (`createField` mounts them unless `noInputRules`, or over a mark-free schema).
export { inputRulesPlugin } from './inputrules.js';

// The body leaf's structural keys: `createField` binds the composed chains
// (`bodyKeymap`); the suite drives both it and the list link directly.
export { bodyKeymap } from './keymap.js';
export { breakKeymap } from './breaks.js';
export { BODY_KEYS } from './shortcuts.js';
export { listKeymap } from './lists.js';

// The list toggle the keymap binds to Mod-Shift-7/8, and the selection toolbar's list
// buttons run (`visual/FormatPopover.svelte`).
export { toggleList } from './list-toggle.js';
