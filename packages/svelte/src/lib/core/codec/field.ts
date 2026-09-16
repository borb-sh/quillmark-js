// The prose leaf: `createField` (VISUAL_EDITOR §Surface). One content field, one
// PM `EditorState`/`EditorView`, wired to the WASM edit surface. It reads the
// leaf's `Content`, decodes to a PM state, mounts a view + plugin stack (history,
// keymap, input rules, the anchor-position plugin), and `dispatchTransaction`:
//   (a) apply optimistically to the view,
//   (b) lower the tr to a `ChangeBundle` (or `overwrite` for a field not yet at
//       content rest, which has nothing to splice),
//   (c) commit via `doc.applyChange(addr, bundle)`,
//   (d) fire `onChange` when the transaction committed, then `onCaretMove` with
//       the new USV caret, which a bare selection move fires on its own.
// On an `applyChange` throw the optimistic PM state stays and the failure reports
// through `onError`: never a crash. Caret continuity across own-edits is the PM
// `StepMap`; an external content change re-hydrates through `applyExternal`, gated
// by `reconcile`.
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode, Schema } from 'prosemirror-model';
import {
	EditorState,
	NodeSelection,
	Plugin,
	PluginKey,
	Selection,
	TextSelection,
	type Command
} from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import type { Document, DocumentReader, Content, Addr, Quill } from '@quillmark/wasm';
import type { EditorErrorHandler } from '../errors.js';
import { reportError, errorMessage } from '../errors.js';
import { decode } from './decode.js';
import { usvToPM, pmToUsv, buildLineIndex, lineIndexOf, type LineIndex } from './positions.js';
import { lower, pmToContent, scanContent, scanDoc, contentEdit } from './encode.js';
import { islandPastePlugin } from './islands.js';
import { anchorsFromContent, type AnchorPos } from './marks.js';
import { createReconciler, type Reconciler } from './reconcile.js';
import { inputRulesPlugin } from './inputrules.js';
import { linebreakPlugin } from './breaks.js';
import { bodyKeymap } from './keymap.js';
import { blockSchema, inlineSchema, plaintextSchema } from './schema.js';
import { DEFAULT_TABLE_STRINGS, tableNodeView, type TableChromeStrings } from './table-view.js';
import { focusSlashItem, runSlashItem, slashPlugin, type SlashState } from './slash.js';

/** Options for {@link createField}. */
export interface CreateFieldOpts {
	doc: Document;
	/** The schema the leaf reads through: `quill.reader(doc).getContent` decodes by
	 *  declared type, which is the only thing that says whether a stored string is
	 *  markdown or literal text. */
	quill: Quill;
	addr: Addr;
	container: HTMLElement;
	/** Constrained single-textblock schema (a `richtext(inline)` field). */
	inline?: boolean;
	/** The mark-free inline schema (a `plaintext` field): literal text, no formatting
	 *  and no anchors. Implies `inline`. */
	plaintext?: boolean;
	/** Suppress the markdown-shorthand input rules. */
	noInputRules?: boolean;
	/** The island chrome's wording, read live (per render) so a consumer swapping
	 *  locale mid-session re-renders rather than freezing it at mount. Absent leaves
	 *  the package's English; an inline leaf never asks (it holds no island). */
	tableStrings?: () => TableChromeStrings;
	/**
	 * The slash menu's live state, or `undefined` when it is closed: the channel the
	 * chrome draws from (`visual/SlashMenu.svelte`).
	 *
	 * Its presence is what mounts the menu at all. The trigger and its keys are the
	 * leaf's, but a surface only a keyboard can reach (claiming Enter, Escape and the
	 * arrows with nothing on screen) is worse than no surface, so the door exists
	 * exactly where something can draw it. A constrained inline leaf never has one:
	 * it holds no island and no block to convert.
	 */
	onSlash?(state: SlashState | undefined): void;
	/** Accessible name → `aria-label` on the `contenteditable`. For a leaf nothing
	 * else names: an array element (the field label plus its 1-based index), the
	 * card body (no visible label at all). A leaf with a field label takes
	 * `labelledBy` instead: `for` cannot reach a `contenteditable`, which is not a
	 * labelable element, so the association runs the other way. */
	label?: string;
	/** The field label's own id → `aria-labelledby`, which supersedes `label`. */
	labelledBy?: string;
	/** The parked `description` → `aria-describedby`; announced after the name. */
	describedBy?: string;
	/** Ghost text shown on the empty leaf: the resolved `default:` a field ghosts,
	 * or a body's invitation. The initial value; {@link
	 * FieldController.setPlaceholder} moves it after mount. Empty/absent
	 * shows no ghost. */
	placeholder?: string;
	onFocus?(addr: Addr): void;
	/** Fired with the new USV caret after an edit or a selection move. */
	onCaretMove?(addr: Addr, pos: number): void;
	/**
	 * Fired after an edit committed to the document: the leaf's change signal, and
	 * the reason it is not `onCaretMove`. That one also fires on a bare selection
	 * move, so a host driving a recompile off it recompiles on every arrow key.
	 *
	 * Fires for every commit regardless of which branch it took (`applyChange`, the
	 * first-edit `overwrite`, the fallback `overwrite`) and for an anchor mutation,
	 * which changes no text. A commit that failed outright (`commit-lost`) does not
	 * fire it: nothing landed.
	 */
	onChange?(addr: Addr): void;
	/** Recovered failures on the commit path ({@link EditorErrorHandler}). */
	onError?: EditorErrorHandler;
}

/** The prose-leaf handle (VISUAL_EDITOR §Surface). */
export interface FieldController {
	/** The mounted `container`: the leaf's element, for a caller that has to reach the
	 *  DOM the view sits in (the arrival wash, `core/bloom.ts`) rather than re-find it. */
	readonly el: HTMLElement;
	/** Place the caret at USV `pos` (preview onPick → usvToPM → here). */
	setCaret(pos: number): void;
	/** External content change → re-hydrate this leaf (gated by reconcile). */
	applyExternal(): void;
	/**
	 * Move the empty-leaf ghost after mount: a card retyped to another kind takes
	 * its new kind's wording without remounting, which it must not do (the leaf key
	 * is the card's session id, so a remount would cost the caret).
	 *
	 * Refreshes the decoration without a transaction: a placeholder is chrome, and
	 * a transaction would fire `onCaretMove` at a moment the caret did not move.
	 */
	setPlaceholder(text: string | undefined): void;
	focus(): void;
	/** The current stored content for this addr (for tests / reconcile). */
	getContent(): Content;
	/**
	 * Insert an identity anchor `id` at USV `pos`: the seam that gives
	 * `anchor` the toggle the six formatting marks have. Zero-width; it folds into the
	 * plugin's position set and commits through the mark-diff `anchor` op, so it
	 * survives later edits like any anchor. The id is caller-supplied and must be
	 * unique + invariant (the 0.97 anchor-id policy); a duplicate id is a no-op.
	 */
	insertAnchor(id: string, pos: number): void;
	/** Remove the identity anchor `id` (the inverse of {@link insertAnchor}); a no-op if absent. */
	removeAnchor(id: string): void;
	/** Ids of the anchors within USV range `[from, to]`: a selection's anchor state. */
	anchorsInRange(from: number, to: number): string[];
	/**
	 * Move the slash menu's cursor onto the command `name`: what a pointer entering an
	 * item calls. The keyboard cursor and the pointer's highlight are one state, so the
	 * chrome moves the one the keys already drive rather than painting a second.
	 */
	slashFocus(name: string): void;
	/** Run the command `name` (a click on its item): the same path Enter takes. A no-op
	 *  with no menu open, which is the state a stale click lands in. */
	slashPick(name: string): void;
	/** The current PM selection as a USV `{ from, to }` range (the boundary currency). */
	selectionRange(): { from: number; to: number };
	destroy(): void;
}

/**
 * The ProseMirror handles a chrome surface reaches a mounted leaf through. Not part
 * of {@link FieldController}: they are PM internals, and a consumer's contract is the
 * controller's verbs. The format popover is the one caller and it needs both:
 * `view` to name the leaf's own document, `focusedView` to act on wherever the caret
 * actually is, which inside a table island is a nested cell view (`table-view.ts`).
 * The two being different is exactly what tells the popover to withhold its
 * `anchor` button: an anchor is the field's coordinate space, and a cell is not in it.
 */
export interface LeafViews {
	view: EditorView;
	focusedView(): EditorView;
	/** Every view nested inside this leaf, in mount order: one per table cell. */
	nestedViews(): EditorView[];
}

const anchorKey = new PluginKey<AnchorPos[]>('quill-anchors');

/** An anchor mutation carried on a transaction's `anchorKey` meta: the seam that
 * folds a new identity anchor (or a removal) into the plugin's position set, so
 * the next commit lowers it through the mark diff exactly as a toggled formatting
 * mark does. Ids are caller-supplied, unique, invariant (the 0.97
 * anchor-id policy); `pos` is a PM position. */
type AnchorEdit = { op: 'add'; id: string; pos: number } | { op: 'remove'; id: string };

/** Plugin-held anchor positions (PM coords), mapped through every edit's `StepMap`
 * and mutated by an {@link AnchorEdit} meta (an insert/remove at a selection).
 *
 * The `-1` is the store's rule for a point, not PM's default: `applyChange` rebases a
 * zero-width mark `before`, so text typed at an anchor's own position lands after it
 * and the mark diff has no op to spend reconciling this set with the store. */
function anchorPlugin(seed: AnchorPos[]): Plugin<AnchorPos[]> {
	return new Plugin<AnchorPos[]>({
		key: anchorKey,
		state: {
			init: () => seed,
			apply: (tr, anchors) => {
				let next = tr.docChanged
					? anchors.map((a) => ({ id: a.id, pos: tr.mapping.map(a.pos, -1) }))
					: anchors;
				const edit = tr.getMeta(anchorKey) as AnchorEdit | undefined;
				if (edit?.op === 'add') next = [...next, { id: edit.id, pos: edit.pos }];
				else if (edit?.op === 'remove') next = next.filter((a) => a.id !== edit.id);
				return next;
			}
		}
	});
}

/** Read the leaf's `Content` for `addr`: `reader.getContent` (DOCUMENT_MODEL),
 * the schema-plane read that decodes through the codec the field's declared type
 * names. A field value, or the body `Content` when `addr.field` is absent, without
 * materializing the whole card. Reads are total over the field axis, so an absent
 * field, a default-only richtext field (e.g. `tag_line`, no stored value until
 * first edited), reads `undefined`; decode an empty content rather than crash, and
 * the first edit overwrites it. Only an out-of-range `addr.card` throws, unreachable
 * here: a removed card unmounts its keyed leaf before a stale index is read.
 *
 * Bound rather than verbatim, because the storage form is not the leaf's business
 * and the verbatim read cannot answer it alone. A field the editor committed rests
 * as `Content`; a field a markdown parse left rests as the authored string, and
 * what that string means is the declared type's to say: `richtext` is markdown,
 * `plaintext` is literal text, and reading one as the other silently eats every
 * `*` the author typed. */
function readLeaf(reader: DocumentReader, addr: Addr): Content {
	return reader.getContent(addr) ?? emptyContent();
}

/** The canonical empty `Content`: one empty `para` line. The empty a prose
 * leaf (or an array's prose element) seeds from. */
export function emptyContent(): Content {
	return { text: '', lines: [{ containers: [], kind: 'para' }], marks: [], islands: [] };
}

/** Whether ops may commit here: the stored value is a `Content` object, so
 * `applyChange` splices exactly the content the leaf read and PM is showing.
 *
 * The two other rest forms both take `overwrite` instead. An unset field (`undefined`;
 * a default-only richtext field before its first edit) has nothing to splice.
 * An authored string is the trap: `applyChange` reads it as markdown whatever the
 * declared type is, so on a `plaintext` field its pre-image is not the content the
 * leaf read and a delta computed against that content lands at the wrong offsets.
 * Installing over it costs nothing either way, since content-only marks do not
 * survive markdown and a string therefore carries no anchors to pay. A body always
 * rests as `Content`. */
function opsCommittable(doc: Document, addr: Addr): boolean {
	const stored = doc.getStored(addr);
	return stored !== null && typeof stored === 'object';
}

/** The naming attributes for the `contenteditable`, shared by every prose leaf
 * (`ProseValue` takes it too, so an addressed leaf and a by-value one name their
 * regions by one rule). `aria-labelledby` supersedes `aria-label`: a leaf carrying
 * both is the ambiguity where implementations disagree about which wins, and
 * `undefined` is returned whole when a leaf takes neither, since ProseMirror reads
 * the absence, not an empty object. */
export function proseAttributes(opts: {
	label?: string;
	labelledBy?: string;
	describedBy?: string;
}): Record<string, string> | undefined {
	const attrs: Record<string, string> = {};
	if (opts.labelledBy) attrs['aria-labelledby'] = opts.labelledBy;
	else if (opts.label) attrs['aria-label'] = opts.label;
	if (opts.describedBy) attrs['aria-describedby'] = opts.describedBy;
	return Object.keys(attrs).length ? attrs : undefined;
}

export function createField(opts: CreateFieldOpts): FieldController {
	const { doc, addr, container } = opts;
	const inline = !!opts.inline || !!opts.plaintext;
	const plaintext = !!opts.plaintext;
	// The declared type picks the schema, and the schema is the whole of what
	// `plaintext` suppresses: no mark types to toggle, to paste in, or to mint a
	// shorthand with (`schema.ts`).
	const schema: Schema = plaintext ? plaintextSchema : inline ? inlineSchema : blockSchema;
	// Bound once and held: the reader is a `{quill, doc}` pair that reads live, so
	// every read below sees the commit before it.
	const reader: DocumentReader = opts.quill.reader(doc);

	// `known` is the codec's view of the stored content: kept in sync after every
	// own-edit so `reconcile` can tell an external change from the field's own.
	const reconciler: Reconciler = createReconciler(readLeaf(reader, addr));

	let index: LineIndex; // rebuilt on every structural change
	let view: EditorView;
	// The ghost's live cell: the placeholder plugin reads it per pass, so moving it
	// is an assignment plus a re-render rather than a rebuilt plugin stack.
	let placeholderText = opts.placeholder;

	// The views nested inside this leaf: one per table cell (`table-view.ts`). The
	// leaf holds the set because chrome asks the leaf, not the island, which view
	// holds the caret: the format popover raises over a cell exactly as over the
	// body, and only the leaf knows both.
	const nested = new Set<EditorView>();

	// The menu's report channel, and the whole of what a leaf holds of it: the
	// vocabulary is the codec's own constant (`slash.ts`), not a wording to derive.
	const slash = inline ? undefined : opts.onSlash;

	const seeded = buildState(reconciler.last);
	const state = seeded.state;
	index = seeded.index;

	// The clearance PM's reveal keeps around the caret, in this leaf's own line box.
	// Its default is 5px, which is a caret visible and unusable: the next line typed
	// lands past the fold, the reason the preview's own scroll clears a target by the
	// target's height (PREVIEW.md §"Follow-the-caret scroll"). Measured off the
	// mounted box rather than restated from the rung, and dropped where the
	// derivation is out of reach (jsdom), a fallback there being the scale written
	// where `check:style` cannot read it.
	const lineBox = Number.parseFloat(getComputedStyle(container).lineHeight);
	const clearance = Number.isFinite(lineBox) ? lineBox : undefined;

	view = new EditorView(container, {
		state,
		attributes: proseAttributes(opts),
		// Both terms, one line each: when a flagged dispatch moves the scrollport
		// (`scrollThreshold`) and what it leaves at the edge (`scrollMargin`).
		scrollThreshold: clearance,
		scrollMargin: clearance,
		// Islands are block-schema only, so an inline leaf mounts no node view at all.
		nodeViews: inline
			? undefined
			: {
					island_block: tableNodeView({
						strings: opts.tableStrings ?? (() => DEFAULT_TABLE_STRINGS),
						register: (cellView) => {
							nested.add(cellView);
							return () => nested.delete(cellView);
						},
						// A focus event does not bubble, so the leaf's own `focus` handler
						// never fires for a cell: without this the active address would not
						// follow a caret clicked straight into a table.
						onCellFocus: () => opts.onFocus?.(addr),
						clearance
					})
				},
		dispatchTransaction: (tr) => {
			const oldRt = reconciler.last;
			const next = view.state.apply(tr);
			view.updateState(next); // (a) optimistic
			// One walk per structural change: the index and the projection the commit
			// diffs both come off it. A selection-only transaction leaves the document
			// it was built from, so the index over it still holds.
			const scan = tr.docChanged ? scanDoc(next.doc) : undefined;
			if (scan) index = lineIndexOf(scan);

			// Commit a content edit or an anchor mutation. An anchor insert/remove is
			// zero-width, so `docChanged` is false: the `anchorKey` meta is what
			// routes it through the same commit path (the diff emits the anchor op).
			if (tr.docChanged || tr.getMeta(anchorKey)) {
				// (d) the change signal, only for what actually landed.
				const newRt = scan ? scanContent(scan) : pmToContent(next.doc);
				if (commitEdit(oldRt, newRt)) opts.onChange?.(addr);
			}
			// The caret, for both structural and selection-only changes: a host
			// following the caret wants an arrow key, and a host recompiling wants
			// `onChange`. Reported after the commit, so the edit has landed by the
			// time the caret names where it is.
			opts.onCaretMove?.(addr, pmToUsv(index, next.selection.head));
		},
		handleDOMEvents: {
			focus: () => {
				opts.onFocus?.(addr);
				return false;
			}
		}
	});

	/** The state, and the index over the document it was built from: the seed reads one
	 *  and every caller wants the same one, and `buildLineIndex` is a whole walk. */
	function buildState(rt: Content): { state: EditorState; index: LineIndex } {
		const pmDoc: PMNode = decode(rt, schema);
		const anchors = plaintext ? [] : anchorsFromContent(rt);
		// Seed anchor plugin positions in PM coords via a fresh index over pmDoc.
		const seedIndex = buildLineIndex(pmDoc);
		const seededAnchors = anchors.map((a) => ({
			id: a.id,
			pos: usvToPM(seedIndex, a.pos)
		}));
		const built = EditorState.create({
			doc: pmDoc,
			plugins: proseLeafPlugins(schema, {
				inline,
				slash,
				noInputRules: opts.noInputRules,
				// Always installed, so a leaf that mounts without a ghost can still be
				// given one later; the plugin draws nothing while the text is empty.
				placeholder: () => placeholderText,
				afterHistory: [anchorPlugin(seededAnchors)]
			})
		});
		return { state: built, index: seedIndex };
	}

	// (b)+(c): lower the edit to ops and commit, or `overwrite` a field not yet at
	// content rest. Keep the optimistic PM on throw.
	// Returns whether anything landed: the caller's change signal, which must not
	// be a property of which branch the commit took.
	function commitEdit(oldRt: Content, newRt: Content): boolean {
		// The text splice, computed once per keystroke: the gate below, both overwrite
		// fallbacks, and `lower` all read this one `edit`. The projection is the
		// caller's, off the same walk that rebuilt the index.
		const edit = contentEdit(oldRt, newRt);
		try {
			// A field not yet at content rest is the only edit that overwrites by choice:
			// `applyChange` throws on an absent declared field (verified) and mis-reads
			// an authored string (`opsCommittable`), and neither has anchors to lose.
			// Every structural edit lowers, island creation included: the island channel
			// places a slot the `delta` may not carry.
			if (!opsCommittable(doc, addr)) {
				doc.overwrite(addr, edit.newRt); // brings the field to content rest
			} else {
				// Post-edit anchors are the plugin's positions (mapped through the tr) as
				// USV; the pre-edit set is `oldRt`'s own, which `lower` reads for itself.
				const newAnchors = plaintext ? [] : readAnchorsUsv();
				doc.applyChange(addr, lower(edit, { newAnchors }));
			}
			reconciler.commit(readLeaf(reader, addr));
			return true;
		} catch (e) {
			// Bound the damage: an op path the gates missed leaves the store stale
			// while PM keeps the edit; and because the reconciler then re-diffs
			// from that stale content, every later edit re-throws and the field
			// silently stops persisting. Install the full projection instead
			// (correct store, pays this field's anchors).
			reportError(opts.onError, {
				code: 'commit-fallback',
				severity: 'error',
				message: `applyChange refused; overwrote the whole field: ${errorMessage(e)}`,
				cause: e
			});
			try {
				doc.overwrite(addr, edit.newRt);
				reconciler.commit(readLeaf(reader, addr));
				return true;
			} catch (e2) {
				// Optimistic PM stays; the store is stale for this field from here.
				reportError(opts.onError, {
					code: 'commit-lost',
					severity: 'error',
					message: `overwrite fallback failed; the stored value is stale while the editor keeps the edit: ${errorMessage(e2)}`,
					cause: e2
				});
				return false;
			}
		}
	}

	/** The anchors the plugin currently holds (PM coords); `[]` before the first apply. */
	const heldAnchors = (): AnchorPos[] => anchorKey.getState(view.state) ?? [];

	/** The plugin's anchor positions as USV, against `index` — which `dispatchTransaction`
	 *  rebuilt over the new document before the commit this reads for. */
	function readAnchorsUsv(): AnchorPos[] {
		return heldAnchors().map((a) => ({ id: a.id, pos: pmToUsv(index, a.pos) }));
	}

	const controller: FieldController = {
		el: container,
		setCaret(pos: number): void {
			const pm = usvToPM(index, pos);
			// `Selection.near`, not `TextSelection.create`: the mapped position can
			// be non-inline (before an island/rule block, or doc-level in an empty
			// nested textblock), where a raw TextSelection is invalid.
			const sel = Selection.near(view.state.doc.resolve(pm));
			// Focus first, then the caret: the order a click's own pair arrives in, and the
			// one a consumer that ends its caret follow on the arrival needs — the other
			// way round, the arrival ends the follow this call just started.
			//
			// Flagged, because PM focuses with `preventScroll` and a landing is a caret
			// move like any other: unflagged, the caret an arrow key would have revealed
			// is left off screen by the click that placed it.
			view.focus();
			view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
		},
		applyExternal(): void {
			const current = readLeaf(reader, addr);
			if (!reconciler.shouldRehydrate(current)) return; // own edit / no change
			const caretUsv = pmToUsv(index, view.state.selection.head);
			const fresh = buildState(current);
			view.updateState(fresh.state);
			index = fresh.index;
			// Best-effort caret continuity across an external change: keep the USV.
			const pm = usvToPM(index, caretUsv);
			view.dispatch(view.state.tr.setSelection(Selection.near(fresh.state.doc.resolve(pm))));
			reconciler.commit(current);
		},
		setPlaceholder(text: string | undefined): void {
			if (text === placeholderText) return;
			placeholderText = text;
			// `setProps` re-runs the decoration pass against the unchanged state: no
			// transaction, so nothing commits and no caret is reported.
			view.setProps({});
		},
		focus(): void {
			view.focus();
			// The placement rung's reveal: no caret to flag a transaction with, so the
			// trip is the element's, `nearest` and no clearance — the one the control
			// lane's own focus takes, for the landing that means the same thing there.
			view.dom.scrollIntoView({ block: 'nearest' });
		},
		getContent(): Content {
			return readLeaf(reader, addr);
		},
		insertAnchor(id: string, pos: number): void {
			if (plaintext) return; // a plaintext field carries no marks (§Inline mode)
			if (heldAnchors().some((a) => a.id === id)) return; // ids are unique + invariant (0.97 policy)
			// An anchor commits through `applyChange`, so the field is brought to content
			// rest first; else the commit's overwrite branch (value semantics) would drop
			// the just-added anchor.
			if (!opsCommittable(doc, addr)) doc.overwrite(addr, reconciler.last);
			const pm = usvToPM(index, pos);
			view.dispatch(view.state.tr.setMeta(anchorKey, { op: 'add', id, pos: pm } as AnchorEdit));
		},
		removeAnchor(id: string): void {
			if (plaintext) return;
			if (!heldAnchors().some((a) => a.id === id)) return; // absent: nothing to commit
			view.dispatch(view.state.tr.setMeta(anchorKey, { op: 'remove', id } as AnchorEdit));
		},
		anchorsInRange(from: number, to: number): string[] {
			return heldAnchors()
				.filter((a) => {
					const u = pmToUsv(index, a.pos);
					return u >= from && u <= to;
				})
				.map((a) => a.id);
		},
		slashFocus(name: string): void {
			if (slash) focusSlashItem(view, name);
		},
		slashPick(name: string): void {
			if (slash) runSlashItem(view, name);
		},
		selectionRange(): { from: number; to: number } {
			const { from, to } = view.state.selection;
			return {
				from: pmToUsv(index, from),
				to: pmToUsv(index, to)
			};
		},
		destroy(): void {
			view.destroy();
		}
	};
	// The underlying views, exposed as available (undocumented) handles: the
	// VisualEditor composes views, and tests drive edits through them.
	const handles = controller as FieldController & LeafViews;
	handles.view = view;
	handles.nestedViews = () => [...nested];
	handles.focusedView = () => {
		for (const cellView of nested) if (cellView.hasFocus()) return cellView;
		return view;
	};
	return controller;
}

/**
 * The prose-leaf plugin stack (VISUAL_EDITOR §Surface): shared by
 * {@link createField} and the by-value inline editor (`ProseValue`), so the two
 * never fork the keymap/plugin ordering. History first, then any leaf-specific
 * plugins (`afterHistory`: the addressed leaf passes its anchor-position plugin;
 * a by-value leaf passes none), then {@link linebreakPlugin}, which normalizes what
 * the rest of the stack leaves, then the markdown-shorthand input rules, the field
 * keymap over the base keymap, and last the three that answer to a block leaf's own
 * shapes: the gap cursor, {@link pastAtomPlugin}, and the island paste pass
 * (`islands.ts`).
 *
 * Every mark-shaped plugin reads the schema rather than a flag: over
 * `plaintextSchema` the shorthand rules build nothing (each is guarded on its mark
 * type) and the toggles bind no key, so a `**bold**` keeps the delimiters its author
 * typed without a second rule saying so.
 */
export function proseLeafPlugins(
	schema: Schema,
	opts: {
		inline: boolean;
		/** The slash menu's report channel; absent mounts no menu and leaves
		 *  Enter/Escape/the arrows to the links below (`keymap.ts`). */
		slash?: (state: SlashState | undefined) => void;
		noInputRules?: boolean;
		/** Read live, not captured: the ghost can move after mount
		 *  ({@link FieldController.setPlaceholder}), and a re-hydration rebuilds this
		 *  stack, so the plugin must ask rather than hold. */
		placeholder?: () => string | undefined;
		afterHistory?: Plugin[];
	}
): Plugin[] {
	const list: Plugin[] = [history(), ...(opts.afterHistory ?? []), linebreakPlugin(schema)];
	if (opts.slash) list.push(slashPlugin(opts.slash));
	if (!opts.noInputRules) list.push(inputRulesPlugin(schema));
	list.push(keymap(editorKeymap(schema, opts.inline, !!opts.slash)));
	list.push(keymap(baseKeymap));
	// All three answer to something only a block leaf holds: an inline leaf is one
	// textblock with no island and no gap to put a cursor in.
	if (!opts.inline) list.push(gapCursor(), pastAtomPlugin(), islandPastePlugin());
	if (opts.placeholder) list.push(placeholderPlugin(opts.placeholder));
	return list;
}

/**
 * A printable key over a selected atom writes past it. A selection is the subject
 * of the next command, never a thing armed for
 * replacement: Backspace deletes it, Mod-C copies it, and a character lands beside
 * it. A block island takes a new paragraph after it, an inline one the caret after
 * the image in the same line: one rule, both node types.
 *
 * PM routes text input over a non-`TextSelection` through `handleTextInput` before
 * falling back to replacing the selection, so this one prop is the whole of it.
 * Paste keeps replacing: a paste is deliberate, and it is the gesture that swaps one
 * island for another.
 */
function pastAtomPlugin(): Plugin {
	return new Plugin({
		props: {
			handleTextInput(view, _from, _to, text) {
				const { selection, schema } = view.state;
				if (!text || !(selection instanceof NodeSelection) || !selection.node.isAtom) return false;
				const tr = view.state.tr;
				const at = selection.to; // just past the node, in both coordinate senses
				if (selection.node.isInline) {
					tr.setSelection(TextSelection.create(tr.doc, at)).insertText(text);
				} else {
					const para = schema.nodes.paragraph.create(null, schema.text(text));
					tr.insert(at, para);
					tr.setSelection(TextSelection.create(tr.doc, at + para.nodeSize - 1));
				}
				view.dispatch(tr.scrollIntoView());
				return true;
			}
		}
	});
}

/**
 * The empty-leaf ghost placeholder. A node decoration stamps the sole empty
 * textblock with a class + the ghost text,
 * which CSS renders via `::before { content: attr(data-placeholder) }`: so the
 * text never enters the document, the caret path, or a `pmToContent` export. It
 * vanishes the instant the leaf holds any content (the emptiness test fails).
 *
 * `read` is called per decoration pass rather than closed over, so moving the
 * ghost is a re-render and never a document edit.
 */
function placeholderPlugin(read: () => string | undefined): Plugin {
	return new Plugin({
		props: {
			decorations(state) {
				const text = read();
				if (!text) return null;
				const { doc } = state;
				const first = doc.firstChild;
				const empty =
					doc.childCount === 1 && !!first && first.isTextblock && first.content.size === 0;
				if (!empty) return null;
				return DecorationSet.create(doc, [
					Decoration.node(0, first.nodeSize, {
						class: 'qm-prose-placeholder',
						'data-placeholder': text
					})
				]);
			}
		}
	});
}

/**
 * The field's keymap: history, mark toggles, and the body's structural keys; Enter
 * suppressed inline. The toggles are bound per mark type the schema declares, so a
 * plaintext leaf leaves Mod-b/i/u to the browser.
 *
 * Tab forks on the leaf's role, not on the caret's position. An inline/plaintext
 * leaf is a form field: Tab stays unbound, so field navigation is open for a shell
 * keymap (VISUAL_EDITOR §Settled and open). A block-schema body is a document: Tab
 * is structural, a chain each nested surface prepends to (`keymap.ts`). One key
 * never means two things within one surface.
 */
function editorKeymap(schema: Schema, inline: boolean, slash?: boolean): Record<string, Command> {
	const map: Record<string, Command> = {
		'Mod-z': undo,
		'Mod-y': redo,
		'Shift-Mod-z': redo
	};
	if (schema.marks.strong) map['Mod-b'] = toggleMark(schema.marks.strong);
	if (schema.marks.em) map['Mod-i'] = toggleMark(schema.marks.em);
	if (schema.marks.underline) map['Mod-u'] = toggleMark(schema.marks.underline);
	if (inline) {
		// One textblock only: swallow Enter so no second block is attempted. One *line*
		// only too (`Content::is_inline`), so Shift-Enter goes with it: the schema
		// declares no break node, and a declined key is the browser's, whose native
		// `<br>` is the one thing that could put a second line in a field that holds one.
		map['Enter'] = () => true;
		map['Shift-Enter'] = () => true;
	} else {
		// Each binding falls through to `baseKeymap` when no link claims the key.
		Object.assign(map, bodyKeymap(schema, slash));
	}
	return map;
}
