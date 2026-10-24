// The VisualEditor's public props, declared once and read by both halves of the
// surface: `VisualEditor` (the door, which re-keys on `doc`) and
// `VisualEditorInner` (the editor, which mounts once per key). A component cannot
// export a type without a module script, and a type imported across the two would
// make the pair circular, so the shape lives beside them instead.
import type { Document, Quill, Addr, Diagnostic, FontFace } from '@quillmark/wasm';
import type { Place } from '../core/address.js';
import type { EditorErrorHandler } from '../core/errors.js';
import type { ActiveLeaf, EditorChange } from './signals.js';
import type { FormatDiagnostic, VisualStringsInput } from './strings.js';

export interface VisualEditorProps {
	doc: Document;
	/**
	 * The schema this document is edited against. Borrowed for the surface's lifetime,
	 * whoever handed it over: a quill from `@quillmark/quiver`'s `getQuill` is the
	 * quiver's, shared with every other caller for that ref, and freeing it hands the
	 * next caller a freed handle. A host wanting one of its own mints it from
	 * `.toTree()`. The editor frees nothing it is passed.
	 */
	quill: Quill;
	/**
	 * The font registry: the faces a render of `quill` sets type in,
	 * `engine.fontFaces(quill)`. The formatting popover offers their families, a run set
	 * in one draws in its face, and a paste keeps a family they hold. Absent, the popover
	 * offers sizes alone, and a run a document already sets in a family draws in the
	 * surface's own face.
	 */
	fonts?: readonly FontFace[];
	/**
	 * The active leaf: its canonical `DocPath` and the session key of the card holding
	 * it, which is what a host tracking the active card keeps across a reorder
	 * (`CardId`).
	 *
	 * It fires for a form control as for a prose leaf, which makes it the other half of
	 * the preview bridge: a control has no caret coordinate to report, so
	 * `onActiveLeafChange={preview.endFollow}` is what stops the pane following the leaf
	 * the focus left.
	 */
	onActiveLeafChange?: (active: ActiveLeaf) => void;
	/**
	 * A caret move in the active leaf, carrying the canonical `DocPath` the
	 * preview also speaks: `onCaretMove={preview.focusPosition}` is the whole
	 * editor→preview bridge, no translation and no `doc.cards` read on the
	 * keystroke path (the editor mints the path off its derived card tree, which
	 * already holds every kind).
	 *
	 * A selection signal, not a change signal: an arrow key fires it and commits
	 * nothing. One keystroke fires `onChange` first and this second, so the edit
	 * has landed by the time the caret names where it is.
	 *
	 * A place, so consecutive duplicates do not arrive: landing the caret where it
	 * already sits reports nothing, and a place left and returned to reports twice.
	 */
	onCaretMove?: (at: Place) => void;
	/**
	 * Every edit that lands on the document: a prose commit, a scalar/array/object
	 * write, a card operation. The signal a host recompiles off; `source` is what
	 * moved.
	 *
	 * **The lane split is the default, not a tuning exercise.** `'structure'` arrives
	 * once per gesture and recompiles at once; `'prose'` and `'field'` arrive per
	 * keystroke and wait for the burst to settle. Recompiling structure on the debounce
	 * makes a card insert look dropped, and recompiling prose at once compiles the
	 * document on every character.
	 */
	onChange?: (change: EditorChange) => void;
	/**
	 * Failures the editor recovered from: a commit the boundary refused (also
	 * pinned as a diagnostic on its field), a card operation that threw, a
	 * `validate`/`resolve` that threw, a prose commit that fell back. None of them
	 * stop editing; without this hook each is a `console.error` an app cannot
	 * route. Reaches the prose leaves too, so one handler covers the surface.
	 */
	onError?: EditorErrorHandler;
	/**
	 * External diagnostics, routed by `.path` and merged with `quill.validate`
	 * and local commit errors (VISUAL_EDITOR §Diagnostics). Warnings do not draw.
	 */
	diagnostics?: Diagnostic[];
	/**
	 * Consumer policy hook: given a field `addr` and an enum option,
	 * return `false` to mark that option unavailable; `enumDisallowed` decides how
	 * the control then draws it. The stored payload is untouched either way: the
	 * schema is unchanged, this is runtime policy. Absent → every schema option is
	 * offered. It reaches a field's own enum control; an enum inside an object
	 * subform has no `Addr` to pass and is offered whole.
	 */
	enumOptionAllowed?: (addr: Addr, value: string) => boolean;
	/**
	 * How an `enumOptionAllowed: false` option draws: `'disable'` (the default) greys
	 * it in place, `'hide'` leaves it out of the list. One policy for the surface, not
	 * a per-option verdict, and the selected value is drawn under either (disabled
	 * when refused), so the control always shows what the document says
	 * (VISUAL_EDITOR §"Enum policy").
	 */
	enumDisallowed?: 'hide' | 'disable';
	/**
	 * Every word the surface says, keyed and partial: unset keys take the package's
	 * English. Several are accessible names rather than decoration, so this is what
	 * a product shipping in another language replaces. The empty body's per-card
	 * wording is the `bodyPlaceholder` key here rather than a prop of its own.
	 */
	strings?: VisualStringsInput;
	/**
	 * A boundary `Diagnostic` → the text shown under its field. Returning
	 * `undefined` takes the diagnostic's own message, which is the arm the parse and
	 * render lanes need: their parameters exist only inside that English string.
	 */
	formatDiagnostic?: FormatDiagnostic;
	/** Appended to the root's own class: the surface is a mounted element the
	 * consumer positions, so it needs a handle for layout it owns. */
	class?: string;
	/** Merged onto the root. Free because the derivation moved off this attribute
	 *  and onto `data-qm-root` (core/theme.css). */
	style?: string;
}
