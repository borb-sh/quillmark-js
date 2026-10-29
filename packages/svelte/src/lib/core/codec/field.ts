// The prose leaf: `createField` (VISUAL_EDITOR §Surface). One content field, one PM view wired to
// the WASM edit surface.
//
// `dispatchTransaction` applies the transaction optimistically, lowers it to a `ChangeBundle` (or
// `overwrite` for a field not yet at content rest, which has nothing to splice), commits via
// `doc.applyChange` (a `text` leaf's whole text through the typed writer), then fires `onChange` if
// it committed and `onCaretMove`. A throw keeps the optimistic PM state and reports through
// `onError`. An external change re-hydrates through `applyExternal`, gated by `reconcile` except
// where the hold it re-evaluates flips, as one replace step outside history.
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Slice, type Node as PMNode, type Schema } from 'prosemirror-model';
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
import type {
	Document,
	DocumentReader,
	DocumentWriter,
	Content,
	Addr,
	Delta,
	Quill
} from '@quillmark/wasm';
import type { EditorErrorHandler } from '../errors.js';
import { core } from '../lifecycle.js';
import { reportError, errorMessage } from '../errors.js';
import { decode, fitsLeaf } from './decode.js';
import { usvToPM, pmToUsv, buildLineIndex, lineIndexOf, type LineIndex } from './positions.js';
import { lower, pmToContent, scanContent, scanDoc, contentEdit } from './encode.js';
import { capPlugin, type TextCap } from './cap.js';
import { islandPastePlugin } from './islands.js';
import { anchorsFromContent, type AnchorPos } from './marks.js';
import { contentEqual, createReconciler, type Reconciler } from './reconcile.js';
import { inputRulesPlugin, undoRuleKeymap } from './inputrules.js';
import { linebreakPlugin } from './breaks.js';
import { bodyKeymap } from './keymap.js';
import { blockSchema, isBlockSchema, isInlineSchema, leafSchema, plainSchema } from './schema.js';
import { linkPastePlugin } from './link-paste.js';
import { linePastePlugin } from './line-paste.js';
import { listPastePlugin } from './list-paste.js';
import { markdownPastePlugin } from './markdown-paste.js';
import { wordPastePlugin } from './word-paste.js';
import { nestingPlugin } from './nesting.js';
import { undoStepPlugin } from './undo.js';
import { tablePastePlugin } from './table-paste.js';
import { tableCopyPlugin } from './table-copy.js';
import { taskPlugin } from './tasks.js';
import { DEFAULT_TABLE_STRINGS, tableNodeView, type TableChromeStrings } from './table-view.js';
import {
	DEFAULT_SLASH_STRINGS,
	focusSlashItem,
	runSlashItem,
	slashPlugin,
	type SlashState,
	type SlashStrings
} from './slash.js';

/** Options for {@link createField}. */
export interface CreateFieldOpts {
	doc: Document;
	/**
	 * The schema the leaf reads through: the declared type decides whether a stored string is
	 * markdown or literal text.
	 */
	quill: Quill;
	addr: Addr;
	container: HTMLElement;
	/** Constrained single-textblock schema (a one-line field). */
	inline?: boolean;
	/** A mark-free schema (a `text` field): literal text, no formatting and no
	 *  anchors, in paragraphs and hard breaks or, with `inline`, one textblock. */
	plaintext?: boolean;
	/** The id of the note the caller draws inside `container` for a held leaf →
	 *  `aria-describedby` while it holds. */
	heldNoteId?: string;
	/**
	 * Fired when the leaf holds or releases, and at mount when it mounts held. A one-line or `text`
	 * leaf is held over a value its schema cannot hold (`fitsLeaf`): the decode would join lines
	 * and drop containers and islands. Any leaf is held over what is read and not edited: a font
	 * family, a footnote, an equation (CODEC §Decode). A held leaf draws on the block schema,
	 * read-only, and commits nothing. Judged on each mount and re-hydrate ({@link
	 * FieldController.applyExternal}).
	 */
	onHold?(held: boolean): void;
	/** Suppress the markdown-shorthand input rules. */
	noInputRules?: boolean;
	/**
	 * The island chrome's wording, read live so a locale swap re-renders. Absent leaves the
	 * package's English.
	 */
	tableStrings?: () => TableChromeStrings;
	/**
	 * The slash menu's live state, or `undefined` when it is closed: the channel the chrome draws
	 * from (`visual/SlashMenu.svelte`). Its presence is what mounts the menu, so the keys never
	 * claim Enter, Escape and the arrows with nothing on screen. A constrained inline leaf never
	 * has one.
	 */
	onSlash?(state: SlashState | undefined): void;
	/** The slash surface's wording, read per decoration pass; read only beside {@link onSlash}. */
	slashStrings?: () => SlashStrings;
	/**
	 * Accessible name → `aria-label` on the `contenteditable`, for a leaf nothing else names (an
	 * array element, the card body). A leaf with a field label takes `labelledBy` instead: `for`
	 * cannot reach a `contenteditable`.
	 */
	label?: string;
	/** The field label's own id → `aria-labelledby`, which supersedes `label`. */
	labelledBy?: string;
	/** The parked `description` → `aria-describedby`; announced after the name. */
	describedBy?: string;
	/**
	 * The resolved `default:` where it prints: the content an unset field's leaf holds, marked
	 * `data-default`. Nothing is written until an edit, which commits the whole leaf with the edit
	 * in it. Initial value; {@link FieldController.setFallback} moves it.
	 */
	fallback?: Content;
	/** Ghost text shown on the empty leaf: the `none` an unset optional field prints, or
	 * a body's invitation. The initial value; {@link FieldController.setPlaceholder}
	 * moves it after mount. Empty/absent shows no ghost. */
	placeholder?: string;
	/** The schema's `max:` on the field: a character count no edit takes the leaf past
	 *  (`cap.ts`). */
	cap?: TextCap;
	/** The placeholder goes at the leaf's first edit: the edit answers the leaf, and
	 * emptied it holds an empty answer, which prints empty. Absent, the placeholder
	 * returns whenever the leaf is empty. */
	placeholderUntilEdit?: boolean;
	/** An edit leaving the leaf empty removes the field: an optional cell (`t?`), whose
	 * unanswered `none` is what the empty leaf draws and an empty answer would hide. */
	emptyUnsets?: boolean;
	onFocus?(addr: Addr): void;
	/** Fired with the new USV caret after an edit or a selection move. */
	onCaretMove?(addr: Addr, pos: number): void;
	/**
	 * Fired after an edit committed to the document: the leaf's change signal. Unlike `onCaretMove`
	 * it does not fire on a bare selection move. Fires for every commit branch and for an anchor
	 * mutation (which changes no text); a commit that failed outright (`commit-lost`) does not fire
	 * it.
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
	/** External content change → re-hydrate this leaf (gated by reconcile), and
	 *  re-evaluate its hold against the value now stored. The change lands as one step outside
	 *  history, so the caret and undo stay the leaf's own; a hold that flips rebuilds the view.
	 *  `delta` is the writer's own receipt for the change (`doc.reviseContent`): given, the
	 *  selection maps through it rather than through the step the leaf diffs for itself, which
	 *  cannot tell where a character typed into a run of the same character went. */
	applyExternal(delta?: Delta): void;
	/**
	 * Move the empty-leaf ghost after mount (a card retyped to another kind takes its new wording;
	 * a remount would cost the caret). Refreshes the decoration without a transaction, which would
	 * fire `onCaretMove` with no caret move.
	 */
	setPlaceholder(text: string | undefined): void;
	/** Move the default an unset leaf holds after mount: a retype or a quill swap
	 *  re-seats an unset leaf on the new kind's default, and leaves a written one be. */
	setFallback(content: Content | undefined): void;
	focus(): void;
	/** The current stored content for this addr (for tests / reconcile). */
	getContent(): Content;
	/**
	 * Insert an identity anchor `id` at USV `pos`. Zero-width; it folds into the plugin's position
	 * set and commits through the mark-diff `anchor` op. The id is caller-supplied and must be
	 * unique and invariant; a duplicate id is a no-op.
	 */
	insertAnchor(id: string, pos: number): void;
	/** Remove the identity anchor `id` (the inverse of {@link insertAnchor}); a no-op if absent. */
	removeAnchor(id: string): void;
	/** Ids of the anchors within USV range `[from, to]`: a selection's anchor state. */
	anchorsInRange(from: number, to: number): string[];
	/**
	 * Move the slash menu's cursor onto the command `name` (a pointer entering an item): the
	 * keyboard cursor and the pointer highlight are one state.
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
 * The ProseMirror handles a chrome surface reaches a mounted leaf through; not part of {@link
 * FieldController}. The format popover needs both: `view` names the leaf's own document,
 * `focusedView` acts wherever the caret is, which inside a table island is a nested cell view
 * (`table-view.ts`). Their differing is what tells the popover to withhold its `anchor` button: a
 * cell is not in the field's coordinate space.
 */
export interface LeafViews {
	view: EditorView;
	focusedView(): EditorView;
	/** Every view nested inside this leaf, in mount order: one per table cell. */
	nestedViews(): EditorView[];
}

const anchorKey = new PluginKey<AnchorPos[]>('quill-anchors');

/** The meta on a transaction that draws a change the store already holds ({@link
 *  FieldController.applyExternal}). */
const remoteKey = new PluginKey('quill-remote');

/**
 * An anchor mutation carried on a transaction's `anchorKey` meta, folded into the plugin's position
 * set so the next commit lowers it through the mark diff like a toggled mark. `pos` is a PM
 * position.
 */
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

/**
 * Read the leaf's `Content` for `addr` through `reader.getContent` (DOCUMENT_MODEL): the body when
 * `addr.field` is absent. Bound by the declared type rather than a verbatim read, since a string a
 * markdown parse left means markdown for `richtext` and literal text for `text`; reading one as the
 * other eats every `*` the author typed. An absent field (a default-only richtext field before its
 * first edit) reads `undefined` and decodes empty; the first edit overwrites it. Only an
 * out-of-range `addr.card` throws, unreachable since a removed card unmounts its keyed leaf.
 */
function readLeaf(reader: DocumentReader, addr: Addr): Content {
	return reader.getContent(addr) ?? emptyContent();
}

/** The canonical empty `Content`: one empty `para` line. */
export function emptyContent(): Content {
	return { text: '', lines: [{ containers: [], kind: 'para' }], marks: [], islands: [] };
}

/** Whether `rt` is the empty leaf: {@link emptyContent}, nothing typed and no shape left. */
export function isEmptyContent(rt: Content): boolean {
	return contentEqual(rt, emptyContent());
}

/**
 * Whether ops may commit here: the stored value is a `Content` object, so `applyChange` splices
 * exactly what PM shows. The other rest forms take `overwrite`: an unset field has nothing to
 * splice, and an authored string carries no anchors to pay. A body always rests as `Content`; a
 * `text` leaf commits through the writer ({@link createField}).
 */
function opsCommittable(doc: Document, addr: Addr): boolean {
	const stored = doc.getStored(addr);
	return stored !== null && typeof stored === 'object';
}

/**
 * The naming attributes for the `contenteditable`, shared with `ProseValue`. `aria-labelledby`
 * supersedes `aria-label`, and `undefined` is returned whole when a leaf takes neither, since
 * ProseMirror reads the absence.
 */
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

/** A held leaf's attributes, described by its note as well. A non-editable view is no
 *  textbox to assistive tech or to Tab, so a held leaf states both itself. */
export function heldAttributes(
	opts: { label?: string; labelledBy?: string; describedBy?: string },
	noteId: string | undefined
): Record<string, string> {
	const describedBy = [opts.describedBy, noteId].filter(Boolean).join(' ') || undefined;
	return {
		...proseAttributes({ ...opts, describedBy }),
		role: 'textbox',
		'aria-readonly': 'true',
		'aria-multiline': 'true',
		tabindex: '0'
	};
}

export function createField(opts: CreateFieldOpts): FieldController {
	const { doc, addr, container } = opts;
	const inline = !!opts.inline;
	const plaintext = !!opts.plaintext;
	// The declared type picks the schema; `plaintext` suppresses every mark (`schema.ts`).
	const schema: Schema = leafSchema({ plaintext, inline });
	const block = isBlockSchema(schema);
	// Bound once: the reader reads live, so every read sees the commit before it.
	const reader: DocumentReader = opts.quill.reader(doc);
	const writer: DocumentWriter = opts.quill.writer(doc);

	let fallback = opts.fallback;
	/** What the leaf holds: the stored content, else the default an unset field shows. */
	const shown = (): Content => reader.getContent(addr) ?? fallback ?? emptyContent();
	/** Whether the leaf holds a default nobody has written: the `data-default` mark. */
	const unwritten = (): boolean => !!fallback && doc.getStored(addr) == null;
	let defaulted = unwritten();

	// `known` is the codec's view of what the leaf holds: kept in sync after every
	// own-edit so `reconcile` can tell an external change from the field's own.
	const reconciler: Reconciler = createReconciler(shown());

	let index: LineIndex; // rebuilt on every structural change
	let view: EditorView;
	// The ghost's live cell: the ghost plugin reads it per pass, so moving it is an
	// assignment plus a re-render rather than a rebuilt plugin stack.
	let placeholderText = opts.placeholder;

	// The views nested inside this leaf, one per table cell (`table-view.ts`): chrome asks the leaf
	// which view holds the caret.
	const nested = new Set<EditorView>();

	// The menu's report channel; the vocabulary is the codec's own constant (`slash.ts`).
	const slash = block ? opts.onSlash : undefined;

	// Judged of the value being mounted rather than read off a diagnostic: a routed set
	// can predate the value it arrives with, and `validation::not_plain` stands in for
	// `not_single_line` on a one-line `text` field.
	const holds = (rt: Content): boolean => !fitsLeaf(rt, { inline, plaintext, islands: true });
	let held = holds(reconciler.last);
	const named = proseAttributes(opts) ?? {};
	const defaultNamed = { ...named, 'data-default': '' };
	const heldNamed = heldAttributes(opts, opts.heldNoteId);

	const seeded = buildState(reconciler.last);
	const state = seeded.state;
	index = seeded.index;

	// The clearance PM's reveal keeps around the caret, in this leaf's own line box: PM's 5px
	// default leaves the next typed line past the fold. Measured off the mounted box and dropped
	// where the derivation is out of reach (jsdom).
	const lineBox = Number.parseFloat(getComputedStyle(container).lineHeight);
	const clearance = Number.isFinite(lineBox) ? lineBox : undefined;

	// Prepended, so what the caller draws inside `container` (a held leaf's note)
	// follows the text it is about.
	view = new EditorView((dom) => container.prepend(dom), {
		state,
		editable: () => !held,
		attributes: () => (held ? heldNamed : defaulted ? defaultNamed : named),
		// Both terms, one line each: when a flagged dispatch moves the scrollport
		// (`scrollThreshold`) and what it leaves at the edge (`scrollMargin`).
		scrollThreshold: clearance,
		scrollMargin: clearance,
		// Islands are block-schema only, so any other leaf mounts no node view at all.
		nodeViews: block
			? {
					island_block: tableNodeView({
						strings: opts.tableStrings ?? (() => DEFAULT_TABLE_STRINGS),
						register: (cellView) => {
							nested.add(cellView);
							return () => nested.delete(cellView);
						},
						// A focus event does not bubble, so the leaf's `focus` handler never fires
						// for a cell.
						onCellFocus: () => opts.onFocus?.(addr),
						clearance
					})
				}
			: undefined,
		dispatchTransaction: (tr) => {
			const oldRt = reconciler.last;
			const next = view.state.apply(tr);
			// A filtered transaction (`nesting.ts`) leaves the state as it was.
			if (next === view.state) return;
			// A change the store already holds: drawn, never lowered back into it.
			if (tr.getMeta(remoteKey)) {
				view.updateState(next);
				index = lineIndexOf(scanDoc(next.doc));
				return;
			}
			// An edit takes a held default: the commit below writes the whole leaf, so the
			// mark goes in the same update that draws the edit.
			if (!held && (tr.docChanged || tr.getMeta(anchorKey))) defaulted = false;
			view.updateState(next); // (a) optimistic
			// One walk per structural change; a selection-only transaction leaves the document, so
			// the index still holds.
			const scan = tr.docChanged ? scanDoc(next.doc) : undefined;
			if (scan) index = lineIndexOf(scan);

			// Commit a content edit or an anchor mutation; an anchor edit is zero-width
			// (`docChanged` false), so the `anchorKey` meta routes it.
			if (!held && (tr.docChanged || tr.getMeta(anchorKey))) {
				// (d) the change signal, only for what actually landed.
				const newRt = scan ? scanContent(scan) : pmToContent(next.doc);
				if (commitEdit(oldRt, newRt)) opts.onChange?.(addr);
			}
			// The caret, for structural and selection-only changes, reported after the commit.
			opts.onCaretMove?.(addr, pmToUsv(index, next.selection.head));
		},
		handleDOMEvents: {
			focus: () => {
				opts.onFocus?.(addr);
				return false;
			}
		}
	});

	/**
	 * The state, and the index over the document it was built from (`buildLineIndex` is a whole
	 * walk).
	 */
	function buildState(rt: Content): { state: EditorState; index: LineIndex } {
		if (held) {
			const pmDoc = decode(rt, blockSchema);
			return {
				state: EditorState.create({ doc: pmDoc }),
				index: buildLineIndex(pmDoc)
			};
		}
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
				slashHint: () => (opts.slashStrings?.() ?? DEFAULT_SLASH_STRINGS).slashHint,
				noInputRules: opts.noInputRules,
				// Always installed, so a leaf that mounts without a ghost can still be
				// given one later; the plugin draws nothing while the text is empty.
				placeholder: () => placeholderText,
				placeholderUntilEdit: opts.placeholderUntilEdit,
				cap: opts.cap,
				afterHistory: [anchorPlugin(seededAnchors)]
			})
		});
		return { state: built, index: seedIndex };
	}

	/**
	 * Draw a change the store already holds as one replace step over the range where the decoded
	 * value differs, outside history: the caret and the anchors map through it, and undo skips it
	 * the way it skips any step not the leaf's own. Returns false where the step would not land
	 * the decoded document exactly, and the caller rebuilds instead.
	 */
	function applyRemote(rt: Content, delta: Delta | undefined): boolean {
		const fresh = decode(rt, schema);
		const old = view.state.doc;
		const start = old.content.findDiffStart(fresh.content);
		if (start == null) return true;
		let { a: endA, b: endB } = old.content.findDiffEnd(fresh.content)!;
		const overlap = start - Math.min(endA, endB);
		if (overlap > 0) {
			endA += overlap;
			endB += overlap;
		}
		let tr;
		try {
			tr = view.state.tr.replace(start, endA, fresh.slice(start, endB));
		} catch {
			return false;
		}
		if (!tr.doc.eq(fresh)) return false;
		if (delta) {
			const { anchor, head } = view.state.selection;
			const at = buildLineIndex(fresh);
			const mapped = (pm: number) => usvToPM(at, core().mapPos(delta, pmToUsv(index, pm), 'after'));
			const $anchor = tr.doc.resolve(mapped(anchor));
			const $head = tr.doc.resolve(mapped(head));
			tr.setSelection(
				$anchor.pos === $head.pos ? Selection.near($head) : TextSelection.between($anchor, $head)
			);
		}
		view.dispatch(tr.setMeta('addToHistory', false).setMeta(remoteKey, true));
		return true;
	}

	// (b)+(c): lower the edit to ops and commit, or `overwrite` a field not yet at content rest.
	// Keeps the optimistic PM on throw. Returns whether anything landed, independent of which
	// branch ran.
	function commitEdit(oldRt: Content, newRt: Content): boolean {
		if (opts.emptyUnsets && heldAnchors().length === 0 && isEmptyContent(newRt))
			return commitUnset();
		if (plaintext) return commitPlain(newRt.text);
		// The text splice, computed once per keystroke and shared by the gate, both overwrite
		// fallbacks and `lower`.
		const edit = contentEdit(oldRt, newRt);
		try {
			// Only a field not yet at content rest overwrites by choice: `applyChange` throws on an
			// absent declared field, and neither it nor an authored string has anchors to lose
			// (`opsCommittable`). Every structural edit lowers; the island channel places a slot
			// the `delta` may not carry.
			if (!opsCommittable(doc, addr)) {
				doc.overwrite(addr, edit.newRt); // brings the field to content rest
			} else {
				// Post-edit anchors are the plugin's positions (mapped through the tr) as
				// USV; the pre-edit set is `oldRt`'s own, which `lower` reads for itself.
				doc.applyChange(addr, lower(edit, { newAnchors: readAnchorsUsv() }));
			}
			reconciler.commit(readLeaf(reader, addr));
			return true;
		} catch (e) {
			// Bound the damage: after an op path the gates missed, the reconciler re-diffs from
			// stale content and every later edit would re-throw. Install the full projection
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

	/**
	 * A `text` leaf's commit: its whole text through the typed writer, resting the field as that
	 * literal string (CODEC §Inline mode). The content-object rest form would emit markdown
	 * (escaped `*`, backslash breaks) and read back changed. A refusal lands nothing and has no
	 * fallback; the next edit writes the whole text again.
	 */
	function commitPlain(text: string): boolean {
		try {
			const name = addr.field;
			if (name === undefined) throw new Error('a text leaf names a field');
			(addr.card === undefined ? writer : writer.card(addr.card)).set(name, text);
			reconciler.commit(readLeaf(reader, addr));
			return true;
		} catch (e) {
			reportError(opts.onError, {
				code: 'commit-lost',
				severity: 'error',
				message: `the typed writer refused the text; the stored value is stale while the editor keeps the edit: ${errorMessage(e)}`,
				cause: e
			});
			return false;
		}
	}

	/** An emptied optional leaf's commit: the field removed, back to unanswered. */
	function commitUnset(): boolean {
		try {
			doc.removeField(addr);
			reconciler.commit(readLeaf(reader, addr));
			return true;
		} catch (e) {
			reportError(opts.onError, {
				code: 'commit-lost',
				severity: 'error',
				message: `the field could not be removed; the stored value is stale while the editor keeps the edit: ${errorMessage(e)}`,
				cause: e
			});
			return false;
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
			// `Selection.near`: the mapped position can be non-inline, where a raw TextSelection is
			// invalid.
			const sel = Selection.near(view.state.doc.resolve(pm));
			// Focus first, then the caret, the order a click arrives in: the other way round the
			// arrival ends the follow this call just started. Flagged, since PM focuses with
			// `preventScroll` and an unflagged landing leaves the caret off screen.
			view.focus();
			view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
		},
		applyExternal(delta?: Delta): void {
			const current = shown();
			const flipped = holds(current) !== held;
			const wasDefaulted = defaulted;
			defaulted = unwritten();
			if (!flipped && !reconciler.shouldRehydrate(current)) {
				// Own edit / no change; a default written as itself changes the mark alone.
				if (defaulted !== wasDefaulted) view.setProps({});
				return;
			}
			if (flipped) held = !held;
			else if (!held && applyRemote(current, delta)) {
				reconciler.commit(current);
				return;
			}
			const headUsv = pmToUsv(index, view.state.selection.head);
			const caretUsv = delta ? core().mapPos(delta, headUsv, 'after') : headUsv;
			const fresh = buildState(current);
			index = fresh.index;
			// Best-effort caret continuity across an external change: keep the USV. Set
			// rather than dispatched, so a leaf the caret is not in reports no caret move.
			const sel = Selection.near(fresh.state.doc.resolve(usvToPM(index, caretUsv)));
			view.updateState(fresh.state.apply(fresh.state.tr.setSelection(sel)));
			reconciler.commit(current);
			if (flipped) opts.onHold?.(held);
		},
		setPlaceholder(text: string | undefined): void {
			if (text === placeholderText) return;
			placeholderText = text;
			// `setProps` re-runs the decoration pass against the unchanged state: no
			// transaction, so nothing commits and no caret is reported.
			view.setProps({});
		},
		setFallback(content: Content | undefined): void {
			if (content === fallback || (content && fallback && contentEqual(content, fallback))) return;
			fallback = content;
			controller.applyExternal();
		},
		focus(): void {
			view.focus();
			// The placement rung's reveal: no caret to flag a transaction with, so the trip is the
			// element's, `nearest`, no clearance.
			view.dom.scrollIntoView({ block: 'nearest' });
		},
		getContent(): Content {
			return readLeaf(reader, addr);
		},
		insertAnchor(id: string, pos: number): void {
			// A text field carries no marks (§Inline mode), and a held one commits nothing.
			if (plaintext || held) return;
			if (heldAnchors().some((a) => a.id === id)) return; // ids are unique + invariant (0.97 policy)
			// An anchor commits through `applyChange`, so the field is brought to content rest
			// first or the overwrite branch would drop it.
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
	// The underlying views, exposed for VisualEditor and tests.
	const handles = controller as FieldController & LeafViews;
	handles.view = view;
	handles.nestedViews = () => [...nested];
	handles.focusedView = () => {
		for (const cellView of nested) if (cellView.hasFocus()) return cellView;
		return view;
	};
	if (held) opts.onHold?.(true);
	return controller;
}

/**
 * The prose-leaf plugin stack (VISUAL_EDITOR §Surface), shared by {@link createField} and
 * `ProseValue` so the two never fork the plugin ordering. History first with the step-splitting
 * plugin (`undo.ts`), then `afterHistory` plugins (the addressed leaf's anchor plugin), {@link
 * linebreakPlugin}, the markdown-shorthand input rules and their Backspace, the field keymap over
 * the base keymap, the URL paste that links a selection (`link-paste.ts`), and last the block
 * leaf's own shapes: the gap cursor, {@link pastAtomPlugin}, the island paste (`islands.ts`), table
 * paste (`table-paste.ts`), markdown paste (`markdown-paste.ts`) and the task checkbox
 * (`tasks.ts`). A one-line leaf's paste joins its lines (`line-paste.ts`).
 *
 * Mark-shaped plugins read the schema rather than a flag: over a mark-free schema the shorthand
 * rules build nothing, the toggles bind no key and a pasted URL stays text.
 */
export function proseLeafPlugins(
	schema: Schema,
	opts: {
		inline: boolean;
		/** The slash menu's report channel; absent mounts no menu (`keymap.ts`). */
		slash?: (state: SlashState | undefined) => void;
		/** The empty line's hint, read live; drawn only beside `slash`. */
		slashHint?: () => string | undefined;
		noInputRules?: boolean;
		/** Read live: the ghost can move after mount and a re-hydration rebuilds this stack. */
		placeholder?: () => string | undefined;
		/** {@link CreateFieldOpts.placeholderUntilEdit}. */
		placeholderUntilEdit?: boolean;
		/** {@link CreateFieldOpts.cap}. Ahead of every other paste handler, which a paste
		 *  it cuts never reaches. */
		cap?: TextCap;
		afterHistory?: Plugin[];
	}
): Plugin[] {
	const list: Plugin[] = [
		history(),
		undoStepPlugin(),
		...(opts.cap ? [capPlugin(opts.cap)] : []),
		...(opts.afterHistory ?? []),
		linebreakPlugin(schema)
	];
	if (opts.slash) list.push(slashPlugin(opts.slash, opts.slashHint));
	if (!opts.noInputRules) list.push(inputRulesPlugin(schema), undoRuleKeymap());
	list.push(keymap(editorKeymap(schema, opts.inline, !!opts.slash)));
	list.push(keymap(baseKeymap));
	if (schema.marks.link) list.push(linkPastePlugin(schema.marks.link));
	// Each answers to something only the block schema holds.
	if (isBlockSchema(schema))
		list.push(
			gapCursor(),
			pastAtomPlugin(),
			islandPastePlugin(),
			tablePastePlugin(),
			tableCopyPlugin(),
			markdownPastePlugin(),
			wordPastePlugin(),
			listPastePlugin(),
			taskPlugin(),
			nestingPlugin()
		);
	if (schema === plainSchema) list.push(plainClipboardPlugin());
	if (isInlineSchema(schema)) list.push(linePastePlugin());
	if (opts.placeholder) list.push(ghostPlugin(opts));
	return list;
}

/**
 * A plain leaf's clipboard text is literal, one line per `\n` both ways; upstream's defaults split
 * pasted text on any run of newlines and write a copy's blocks joined by a blank line.
 */
function plainClipboardPlugin(): Plugin {
	const { paragraph } = plainSchema.nodes;
	return new Plugin({
		props: {
			clipboardTextParser: (text) =>
				new Slice(
					Fragment.from(
						text
							.split(/\r\n?|\n/)
							.map((line) => paragraph.create(null, line ? plainSchema.text(line) : null))
					),
					1,
					1
				),
			clipboardTextSerializer: (slice) =>
				slice.content.textBetween(0, slice.content.size, '\n', '\n')
		}
	});
}

/**
 * A printable key over a selected atom writes past it: a selection is the subject of the next
 * command, not armed for replacement. A block island takes the empty paragraph after it, or a new
 * one; an inline one the caret after the image. Only a paragraph is reused. PM routes text input
 * over a non-`TextSelection` through `handleTextInput`, so this one prop is the whole of it. Paste
 * keeps replacing, as the gesture that swaps one island for another.
 */
function pastAtomPlugin(): Plugin {
	return new Plugin({
		props: {
			handleTextInput(view, _from, _to, text) {
				const { selection, schema } = view.state;
				if (!text || !(selection instanceof NodeSelection) || !selection.node.isAtom) return false;
				const tr = view.state.tr;
				const at = selection.to; // just past the node, in both coordinate senses
				const after = tr.doc.resolve(at).nodeAfter;
				if (selection.node.isInline) {
					tr.setSelection(TextSelection.create(tr.doc, at)).insertText(text);
				} else if (after?.type === schema.nodes.paragraph && after.content.size === 0) {
					tr.setSelection(TextSelection.create(tr.doc, at + 1)).insertText(text);
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
 * The empty leaf's ghost: a node decoration stamps the sole empty textblock with a class and the
 * ghost text, which `prose.css` draws from the attribute, so the text never enters the document or
 * a `pmToContent` export. Under `placeholderUntilEdit` it is stamped only until the state's first
 * edit. An inline leaf's ghost keeps to one line (`qm-prose-placeholder-line`). The text is read
 * per decoration pass, so moving the ghost is a re-render.
 */
function ghostPlugin(opts: {
	inline: boolean;
	placeholder?: () => string | undefined;
	placeholderUntilEdit?: boolean;
}): Plugin<boolean> {
	const key = new PluginKey<boolean>('qm-ghost');
	return new Plugin<boolean>({
		key,
		state: {
			init: () => false,
			apply: (tr, edited) => edited || tr.docChanged
		},
		props: {
			decorations(state) {
				const edited = key.getState(state);
				const text = edited && opts.placeholderUntilEdit ? undefined : opts.placeholder?.();
				if (!text) return null;
				const { doc } = state;
				const first = doc.firstChild;
				const empty =
					doc.childCount === 1 && !!first && first.isTextblock && first.content.size === 0;
				if (!empty) return null;
				const attrs: Record<string, string> = {
					class: opts.inline
						? 'qm-prose-placeholder qm-prose-placeholder-line'
						: 'qm-prose-placeholder'
				};
				attrs['data-placeholder'] = text;
				return DecorationSet.create(doc, [Decoration.node(0, first.nodeSize, attrs)]);
			}
		}
	});
}

/**
 * The field's keymap: history, mark toggles (bound per mark type the schema declares), and the
 * body's structural keys; Enter suppressed inline.
 *
 * Tab forks on the leaf's role: a one-line or `text` leaf is a form field, Tab unbound so field
 * navigation is open for a shell keymap (VISUAL_EDITOR §Settled and open); a block-schema body
 * takes Tab structurally, a chain each nested surface prepends to (`keymap.ts`).
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
	if (schema.marks.strike) map['Mod-Shift-x'] = toggleMark(schema.marks.strike);
	if (schema.marks.code) map['Mod-e'] = toggleMark(schema.marks.code);
	if (inline) {
		// One textblock only: swallow Enter, and Shift-Enter with it (the schema declares no break
		// node; a declined key is the browser's native `<br>`).
		map['Enter'] = () => true;
		map['Shift-Enter'] = () => true;
	} else {
		// Each binding falls through to `baseKeymap` when no link claims the key.
		Object.assign(map, bodyKeymap(schema, slash));
	}
	return map;
}
