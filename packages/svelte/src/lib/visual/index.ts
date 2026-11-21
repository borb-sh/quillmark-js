// `@quillmark/svelte/visual`: the WYSIWYG surface.
//
// The federated VisualEditor: a thin Svelte composition over many small editors.
// Each content leaf is the codec's prose leaf; scalar fields are form controls;
// structure/cards are the editor's own. Depends on `/core` and the
// codec. Relative imports (not `$lib`): svelte-package ships this as-is.
//
// The barrel carries what a consumer story wants, and nothing else: a symbol
// earns its line when a caller outside the package needs it, and grows one when
// that caller arrives, not before.

// The theme derivation, which every control on this surface reads through `var()`.
// Imported at the barrel because a subpath is what a consumer gets: this surface
// reaches modules inside `core/` and never its entry, which carries no sheet.
// `check:deps` holds the reach.
import '../core/theme.css';

export { default as VisualEditor } from './VisualEditor.svelte';
export type { VisualEditorProps } from './props.js';

// What the surface says, and how it words a diagnostic. `strings` is keyed and
// partial: unset keys take the package's English. The empty body's per-card hook
// is the `bodyPlaceholder` key inside it.
export type { VisualStrings, VisualStringsInput, FormatDiagnostic } from './strings.js';
export type { BodyPlaceholder, BodyPlaceholderContext } from './structure.js';

// The prose leaf's shortcuts, for a host's shortcut list: read off the keymaps' own tables and
// worded by the same `strings` (pass the editor's, or none for the package's English).
export { editorShortcuts } from '../core/codec/index.js';
export type { EditorShortcut, ShortcutScope } from '../core/codec/index.js';

// Review: what a host hands the editor to draw of another writer's proposals, and
// what the editor says back. The chords that answer an item are in `editorShortcuts`.
export type {
	BlockProposal,
	CardProposal,
	FieldProposal,
	ReviewDrawn,
	ReviewEvent,
	ReviewItem,
	ReviewLabel,
	ReviewProjection,
	ReviewUndrawn
} from './review.js';
export type { BlockPlace } from '../core/codec/index.js';
export { proposalsBetween, reviewRevised } from './proposals.js';
export type { Proposed, ProposalsOpts } from './proposals.js';
export type { ReviewAction } from '../core/codec/index.js';
export { REVIEW_KEYS } from '../core/codec/index.js';
export { reviewKeysHeard } from './hears.js';
export type { ReviewKeyName } from './hears.js';

// The `$ext.editor` write unit. A consumer seeding editor-side chrome
// state (a card title, the tips channel) goes through this rather than `storeExt`,
// which replaces the whole map and takes every sibling with it.
export { patchEditorExt } from './ext.js';

// What the editor emits. Every hook naming a place speaks the canonical `DocPath`
// the preview and the diagnostics already do, so the bridge is
// `onCaretMove={preview.focusPosition}` and nothing here translates.
export type { ActiveLeaf, CardId, CardOp, ChangeSource, EditorChange } from './signals.js';
