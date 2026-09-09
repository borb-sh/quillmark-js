// The codec barrel: the bidirectional bridge between one content field (`Content`)
// and one ProseMirror document (CODEC.md). Decode (content → PM), lower (PM tr → a
// `ChangeBundle` for `applyChange`), the USV↔PM position map, and the `createField`
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
export { rangeAnchor } from './anchor.js';
export type { RangeAnchor } from './anchor.js';

// The prose leaf.
export {
	createField,
	emptyContent,
	proseAttributes,
	proseLeafPlugins,
	storedContentAt
} from './field.js';
export type { CreateFieldOpts, FieldController, LeafViews } from './field.js';

// The table island's chrome vocabulary: the visual tier's `strings` set extends it,
// so the island's wording is overridden beside every other key.
export { DEFAULT_TABLE_STRINGS } from './table-view.js';
export type { TableChromeStrings } from './table-view.js';

// The slash menu: the codec owns the model and the picks, the chrome the words and
// the pixels (`visual/SlashMenu.svelte` is the only off-barrel caller).
export { DEFAULT_SLASH_STRINGS } from './slash.js';
export type { SlashState, SlashStrings } from './slash.js';

// Schemas (the decode/encode target; the VisualEditor mounts them). `hasMarks` is
// what a mark surface asks before offering itself over a leaf, and `rendersHref` the
// link gate the prompt re-asks on submit (`visual/links.ts`).
export { blockSchema, inlineSchema, plaintextSchema, hasMarks, rendersHref } from './schema.js';

// Decode / encode / positions (tests + VisualEditor).
//
// The barrel carries what has an off-barrel caller, and nothing else. A symbol
// reached only by relative import within `codec/` stays off it: an export nothing
// imports is surface that still has to stay honest.
export { decode, renderContent, usvLength } from './decode.js';
export { pmToContent, contentEdit, lower } from './encode.js';
export type { ContentEdit } from './encode.js';
export { usvToPM, pmToUsv, buildLineIndex } from './positions.js';
export type { LineIndex } from './positions.js';

// Reconciliation gate.
export { createReconciler, contentEqual } from './reconcile.js';
export type { Reconciler } from './reconcile.js';

// Input rules (`createField` mounts them unless `noInputRules`/`plaintext`).
export { inputRulesPlugin } from './inputrules.js';

// The body leaf's structural keys: `createField` binds the composed chains
// (`bodyKeymap`); the suite drives both it and the list link directly.
export { bodyKeymap } from './keymap.js';
export { listKeymap } from './lists.js';
