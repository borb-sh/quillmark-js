// `@quillmark/svelte/visual`: the WYSIWYG surface.
//
// The federated VisualEditor: a thin Svelte composition over many small editors.
// Each content leaf is the codec's `createField` prose leaf; scalar fields are
// form controls; structure/cards are the editor's own. Depends on `/core` and the
// codec. Relative imports (not `$lib`): svelte-package ships this as-is.
//
// The barrel carries what a consumer story wants, and nothing else: a symbol
// earns its line when a caller outside the package needs it, and grows one when
// that caller arrives, not before.

// The theme derivation, which every control on this surface reads through `var()`.
// Imported at the barrel because a subpath is what a consumer gets: this surface
// reaches modules inside `core/` and never its entry, so a sheet hanging off that
// entry arrives only for a consumer importing `/core` for some other reason. The
// sheet rather than the entry, because the barrel needs the derivation and not
// `init`. `check:deps` holds the reach.
import '../core/theme.css';

export { default as VisualEditor } from './VisualEditor.svelte';
export type { VisualEditorProps } from './props.js';

// The prose leaf: the vanilla mount API a non-Svelte consumer (or a custom
// surface) builds on.
export { createField } from '../core/codec/index.js';
export type { CreateFieldOpts, FieldController } from '../core/codec/index.js';

// What the surface says, and how it words a diagnostic. `strings` is keyed and
// partial (unset keys take the package's English) and `DEFAULT_VISUAL_STRINGS` is
// that English, exported so a consumer can compose against it rather than restate
// it. The empty body's per-card hook is the `bodyPlaceholder` key inside it.
export { DEFAULT_VISUAL_STRINGS } from './strings.js';
export type { VisualStrings, VisualStringsInput, FormatDiagnostic } from './strings.js';
export type { BodyPlaceholder, BodyPlaceholderContext } from './structure.js';

// The `$ext.editor` write unit. A consumer seeding editor-side chrome
// state (a card title, the tips channel) goes through this rather than `storeExt`,
// which replaces the whole map and takes every sibling with it.
export { patchEditorExt } from './ext.js';

// What the editor emits. Every hook naming a place speaks the canonical `DocPath`
// the preview and the diagnostics already do, so the bridge is
// `onCaretMove={preview.focusPosition}` and nothing here translates; the conversions
// for a consumer holding an `Addr` of its own live in `/core`, beside the grammar.
export type { ActiveLeaf, CardId, ChangeSource, EditorChange } from './signals.js';
