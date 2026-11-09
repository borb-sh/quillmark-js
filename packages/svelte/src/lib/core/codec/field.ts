// The prose leaf: `createField` (INVARIANTS §Surface). One content field, one PM view wired to
// the WASM edit surface.
//
// `dispatchTransaction` applies the transaction optimistically, lowers it to a `Change` (or
// `replace` for a field not yet at content rest, which has nothing to change), commits via
// `doc.apply` (a `text` leaf's whole text through the typed writer), then fires `onChange` if it
// committed and `onCaretMove`. A throw keeps the optimistic PM state and reports through `onError`.
// An external change re-hydrates through `applyExternal`, gated by `reconcile` except where the
// hold it re-evaluates flips.
import { baseKeymap } from 'prosemirror-commands';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, isHistoryTransaction, redo, undo } from 'prosemirror-history';
import type { StepMap } from 'prosemirror-transform';
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
import { revealProps } from './reveal.js';
import type {
	Document,
	DocumentReader,
	DocumentWriter,
	Change,
	Content,
	Addr,
	Quill
} from '@quillmark/wasm';
import { core } from '../lifecycle.js';
import type { EditorErrorHandler } from '../errors.js';
import { reportError, errorMessage } from '../errors.js';
import { decode, fitsLeaf } from './decode.js';
import {
	offsetToPM,
	pmToOffset,
	buildLineIndex,
	lineIndexOf,
	mapThroughDelta,
	type Delta,
	type LineIndex
} from './positions.js';
import { lower, pmToContent, scanContent, scanDoc } from './encode.js';
import { capPlugin, type TextCap } from './cap.js';
import { islandPastePlugin } from './islands.js';
import { anchorsFromContent, type AnchorPos } from './marks.js';
import { contentEqual, createReconciler, type Reconciler } from './reconcile.js';
import { inputRulesPlugin, undoRuleKeymap } from './inputrules.js';
import { linebreakPlugin } from './breaks.js';
import { bodyKeymap } from './keymap.js';
import { FIELD_KEYS, markKeymap } from './shortcuts.js';
import { remoteKey } from './remote.js';
import { blockSchema, isBlockSchema, isInlineSchema, leafSchema, plainSchema } from './schema.js';
import { linkPastePlugin } from './link-paste.js';
import { dragMovePlugin } from './drag-move.js';
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
	 * family, a footnote, an equation (INVARIANTS §Decode). A held leaf draws on the block schema,
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
	/** Fired with the new caret offset after an edit or a selection move. */
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

/** The prose-leaf handle (INVARIANTS §Surface). */
export interface FieldController {
	/** The mounted `container`: the leaf's element, for a caller that has to reach the
	 *  DOM the view sits in (the arrival wash, `core/bloom.ts`) rather than re-find it. */
	readonly el: HTMLElement;
	/** Place the caret at content offset `pos` (preview onPick → offsetToPM → here). */
	setCaret(pos: number): void;
	/**
	 * External content change → re-hydrate this leaf (gated by reconcile), and re-evaluate its
	 * hold against the value now stored. Where the hold stands, the difference lands as one
	 * step outside the undo history, so the leaf keeps its own undo and its caret; `delta`, the
	 * change's text delta over what the leaf held, places the caret where the change moved it.
	 */
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
	 * Insert an identity anchor `id` over content offsets `[pos, end)`, a point where `end` is
	 * absent. It folds into the plugin's set and commits with the next change. The id is
	 * caller-supplied and must be unique and invariant; a duplicate id is a no-op.
	 */
	insertAnchor(id: string, pos: number, end?: number): void;
	/** Remove the identity anchor `id` (the inverse of {@link insertAnchor}); a no-op if absent. */
	removeAnchor(id: string): void;
	/** Ids of the anchors touching content range `[from, to]`: a selection's anchor state. */
	anchorsInRange(from: number, to: number): string[];
	/**
	 * Move the slash menu's cursor onto the command `name` (a pointer entering an item): the
	 * keyboard cursor and the pointer highlight are one state.
	 */
	slashFocus(name: string): void;
	/** Run the command `name` (a click on its item): the same path Enter takes. A no-op
	 *  with no menu open, which is the state a stale click lands in. */
	slashPick(name: string): void;
	/** The current PM selection as a content `{ from, to }` range (the boundary currency). */
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

const anchorKey = new PluginKey<AnchorState>('quill-anchors');

/**
 * An anchor mutation carried on a transaction's `anchorKey` meta, folded into the plugin's set so
 * the next commit lands it with the change. Positions are PM positions.
 */
type AnchorEdit =
	| { op: 'add'; id: string; start: number; end: number }
	| { op: 'remove'; id: string }
	| { op: 'reset'; anchors: AnchorPos[] };

/**
 * An anchor a deletion swallowed, held until the undo that puts its text back: where the deletion
 * landed, how much of the deleted slice stood before and after the anchor, and the anchor's own
 * length, so only a history step that re-inserts that slice whole restores it. A ghost a later
 * deletion swallows is wrapped the same way (`inner`), and the undo of that deletion unwraps it.
 */
interface Ghost {
	id: string;
	at: number;
	lead: number;
	len: number;
	trail: number;
	inner?: Ghost;
}

/** The plugin's state: the anchors the leaf holds, and the ghosts of ranges deletions swallowed.
 *  History keeps 100 events, so ghosts past that many are the oldest and go. */
interface AnchorState {
	anchors: AnchorPos[];
	ghosts: Ghost[];
}
const GHOSTS = 100;

/**
 * Plugin-held anchors (PM coords), mapped through every edit's `StepMap` and mutated by an {@link
 * AnchorEdit} meta. The store's rule, so the commit has nothing to reconcile: a range keeps its
 * edges, text typed at either landing outside it, and a point stays left of text typed at it. A
 * range whose text is wholly deleted goes, and comes back with its text when history puts the
 * deleted slice back ({@link Ghost}); a point never goes. A range draws as a span carrying
 * `data-qm-anchor`, its id, for a host to style and measure; a point draws nothing.
 */
function anchorPlugin(seed: AnchorPos[]): Plugin<AnchorState> {
	return new Plugin<AnchorState>({
		key: anchorKey,
		state: {
			init: () => ({ anchors: seed, ghosts: [] }),
			apply: (tr, held) => {
				let { anchors, ghosts } = held;
				if (tr.docChanged) {
					const undoing = isHistoryTransaction(tr);
					for (const map of tr.mapping.maps)
						({ anchors, ghosts } = mapAnchors(map, anchors, ghosts, undoing));
				}
				const edit = tr.getMeta(anchorKey) as AnchorEdit | undefined;
				if (edit?.op === 'add')
					anchors = [...anchors, { id: edit.id, start: edit.start, end: edit.end }];
				else if (edit?.op === 'remove') {
					anchors = anchors.filter((a) => a.id !== edit.id);
					ghosts = ghosts.filter((g) => g.id !== edit.id);
				} else if (edit?.op === 'reset') anchors = edit.anchors;
				return { anchors, ghosts: ghosts.slice(-GHOSTS) };
			}
		},
		props: {
			decorations: (state) => {
				const ranged = anchorKey.getState(state)?.anchors.filter((a) => a.end > a.start) ?? [];
				return ranged.length
					? DecorationSet.create(
							state.doc,
							ranged.map((a) =>
								Decoration.inline(a.start, a.end, { 'data-qm-anchor': a.id }, { id: a.id })
							)
						)
					: DecorationSet.empty;
			}
		}
	});
}

/** The replaced range of `map` holding `[from, to]`, where one does. */
function rangeOf(
	map: StepMap,
	from: number,
	to: number
): { oldStart: number; oldEnd: number; newStart: number; newEnd: number } | undefined {
	let hit: { oldStart: number; oldEnd: number; newStart: number; newEnd: number } | undefined;
	map.forEach((oldStart, oldEnd, newStart, newEnd) => {
		if (!hit && oldStart <= from && to <= oldEnd) hit = { oldStart, oldEnd, newStart, newEnd };
	});
	return hit;
}

/** One step's map over the anchors and ghosts: a range the step deletes whole becomes a ghost,
 *  and under a history step a ghost whose slice comes back whole becomes its anchor again. */
function mapAnchors(
	map: StepMap,
	anchors: AnchorPos[],
	ghosts: Ghost[],
	undoing: boolean
): AnchorState {
	const nextAnchors: AnchorPos[] = [];
	const nextGhosts: Ghost[] = [];
	for (const g of ghosts) {
		const range = rangeOf(map, g.at, g.at);
		if (!range) {
			nextGhosts.push({ ...g, at: map.map(g.at, -1) });
			continue;
		}
		const { oldStart, oldEnd, newStart, newEnd } = range;
		if (undoing && newEnd - newStart === g.lead + g.len + g.trail) {
			if (g.inner) nextGhosts.push({ ...g.inner, at: newStart + g.lead });
			else nextAnchors.push({ id: g.id, start: newStart + g.lead, end: newStart + g.lead + g.len });
			continue;
		}
		if (oldEnd === oldStart) {
			nextGhosts.push({ ...g, at: map.map(g.at, -1) });
			continue;
		}
		nextGhosts.push({
			id: g.id,
			at: newStart,
			lead: g.at - oldStart,
			len: 0,
			trail: oldEnd - g.at,
			inner: g
		});
	}
	for (const a of anchors) {
		if (a.start === a.end) {
			const at = map.map(a.start, -1);
			nextAnchors.push({ id: a.id, start: at, end: at });
			continue;
		}
		const start = map.map(a.start, 1);
		const end = map.map(a.end, -1);
		if (start < end) {
			nextAnchors.push({ id: a.id, start, end });
			continue;
		}
		const range = rangeOf(map, a.start, a.end);
		nextGhosts.push(
			range
				? {
						id: a.id,
						at: range.newStart,
						lead: a.start - range.oldStart,
						len: a.end - a.start,
						trail: range.oldEnd - a.end
					}
				: { id: a.id, at: start, lead: 0, len: a.end - a.start, trail: 0 }
		);
	}
	return { anchors: nextAnchors, ghosts: nextGhosts };
}

/** An anchor in content offsets at its PM positions over `index`. */
function toPM(index: LineIndex, a: AnchorPos): AnchorPos {
	return { id: a.id, start: offsetToPM(index, a.start), end: offsetToPM(index, a.end) };
}

/**
 * Read the leaf's `Content` for `addr` through `reader.getContent` (INVARIANTS §"A content field is read through the schema"): the body when
 * `addr.field` is absent. Bound by the declared type rather than a verbatim read, since a string a
 * markdown parse left means markdown for `richtext` and literal text for `text`; reading one as the
 * other eats every `*` the author typed. An absent field (a default-only richtext field before its
 * first edit) reads `undefined` and decodes empty; the first edit overwrites it. Only an
 * out-of-range `addr.card` throws, unreachable since a removed card unmounts its keyed leaf.
 */
function readLeaf(reader: DocumentReader, addr: Addr): Content {
	return reader.getContent(addr) ?? emptyContent();
}

/** `addr` as a content write takes it: a card named by its `$id`, which a write requires. */
function writeAddr(doc: Document, addr: Addr): Addr {
	if (typeof addr.card !== 'number') return addr;
	return { ...addr, card: doc.card(addr.card).id ?? addr.card };
}

/** The canonical empty `Content`: one empty `para` block. */
export function emptyContent(): Content {
	return { text: '', blocks: [{ id: 'b0', kind: 'para' }] };
}

/** Whether `rt` is the empty leaf: {@link emptyContent}, nothing typed and no shape left. */
export function isEmptyContent(rt: Content): boolean {
	return contentEqual(rt, emptyContent());
}

/**
 * Whether a change may commit here: the stored value is a `Content` object, so `apply` changes
 * exactly what PM shows. The other rest forms take `replace`: an unset field has nothing to change,
 * and an authored string carries no anchors to pay. A body always rests as `Content`; a `text` leaf
 * commits through the writer ({@link createField}).
 */
function changeCommittable(doc: Document, addr: Addr): boolean {
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

/** A plain leaf's value as the literal text its `text` field takes: a paragraph break a blank
 *  line and a hard break a lone `\n`, as the engine spells a `codec: "plain"` value. */
function literalOf(rt: Content): string {
	return core().exportMarkdown({ ...rt, codec: 'plain' }) as string;
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
		...revealProps(clearance),
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
				const anchors = plaintext ? [] : readAnchors();
				const newRt = scan ? scanContent(scan, anchors) : pmToContent(next.doc, anchors);
				if (commitEdit(oldRt, newRt)) opts.onChange?.(addr);
			}
			// The caret, for structural and selection-only changes, reported after the commit.
			opts.onCaretMove?.(addr, pmToOffset(index, next.selection.head));
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
		const seededAnchors = anchors.map((a) => toPM(seedIndex, a));
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

	// (b)+(c): lower the edit to a change and commit, or `replace` a field not yet at content rest.
	// Keeps the optimistic PM on throw. Returns whether anything landed, independent of which
	// branch ran.
	function commitEdit(oldRt: Content, newRt: Content): boolean {
		const at = writeAddr(doc, addr);
		if (opts.emptyUnsets && heldAnchors().length === 0 && isEmptyContent(newRt))
			return commitUnset();
		if (plaintext) return commitPlain(literalOf(newRt));
		try {
			// Only a field not yet at content rest replaces by choice: neither an absent declared
			// field nor an authored string has anchors to lose (`changeCommittable`).
			if (!changeCommittable(doc, addr)) doc.replace(at, newRt);
			else {
				const change = lower(oldRt, newRt);
				if (change) {
					const asked = askCore(oldRt, change);
					doc.apply(at, change);
					if (asked.size) adopt();
				}
			}
			reconciler.commit(readLeaf(reader, addr));
			return true;
		} catch (e) {
			// Bound the damage: after a change the store refused, the reconciler re-diffs from stale
			// content and every later edit would re-throw. Replace with the full projection, which
			// carries each anchor where its text survives.
			reportError(opts.onError, {
				code: 'commit-fallback',
				severity: 'error',
				message: `apply refused; replaced the whole field: ${errorMessage(e)}`,
				cause: e
			});
			try {
				doc.replace(at, newRt);
				reconciler.commit(readLeaf(reader, addr));
				return true;
			} catch (e2) {
				// Optimistic PM stays; the store is stale for this field from here.
				reportError(opts.onError, {
					code: 'commit-lost',
					severity: 'error',
					message: `replace fallback failed; the stored value is stale while the editor keeps the edit: ${errorMessage(e2)}`,
					cause: e2
				});
				return false;
			}
		}
	}

	/**
	 * Each block id the projection minted for a block the store does not hold, swapped in
	 * `change` for a placeholder the write fills, so the store is the one minter of block ids:
	 * placeholder → projected id.
	 */
	function askCore(oldRt: Content, change: Change): Map<string, string> {
		const held = new Set(oldRt.blocks.map((b) => b.id));
		const asked = new Map<string, string>();
		const named = new Map<string, string>();
		for (const step of change.steps) {
			if (!('splice' in step)) continue;
			for (const b of step.splice.blocks ?? []) {
				if (held.has(b.id)) continue;
				const p = `?${asked.size}`;
				asked.set(p, b.id);
				named.set(b.id, p);
				b.id = p;
			}
		}
		for (const step of change.steps)
			if ('setBlock' in step && named.has(step.setBlock.id))
				step.setBlock.id = named.get(step.setBlock.id)!;
		return asked;
	}

	/** Each block node takes the id the store holds for the block it projects to. */
	function adopt(): void {
		const stored = (readLeaf(reader, addr) as Content).blocks.map((b) => b.id);
		const nodes: { pos: number; key: string; id: unknown }[] = [];
		view.state.doc.descendants((node, pos) => {
			if (node.type.name === 'island_block') {
				nodes.push({ pos, key: 'block', id: node.attrs.block });
				return false;
			}
			if (node.isTextblock || node.type.name === 'horizontal_rule') {
				nodes.push({ pos, key: 'id', id: node.attrs.id });
				return false;
			}
			return true;
		});
		if (nodes.length !== stored.length) return;
		const tr = view.state.tr;
		nodes.forEach((n, i) => {
			if (n.id !== stored[i]) tr.setNodeAttribute(n.pos, n.key, stored[i]);
		});
		if (tr.docChanged) view.updateState(view.state.apply(tr.setMeta('addToHistory', false)));
	}

	/**
	 * A `text` leaf's commit: its whole text through the typed writer, resting the field as that
	 * literal string (INVARIANTS §"Inline mode"). The content-object rest form would emit markdown
	 * (escaped `*`, backslash breaks) and read back changed. A refusal lands nothing and has no
	 * fallback; the next edit writes the whole text again.
	 */
	function commitPlain(text: string): boolean {
		try {
			const name = addr.field;
			if (name === undefined) throw new Error('a text leaf names a field');
			if (typeof addr.card === 'string') throw new Error('a text leaf names its card by index');
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

	/**
	 * Land `rt` as one replace over the span where it differs from the leaf, outside history and
	 * past the filters (`remote.ts`), with the anchors reset to the ones `rt` holds. False where
	 * the replace does not fit, which a rebuild answers instead.
	 */
	function landRemote(rt: Content, delta: Delta | undefined): boolean {
		const before = view.state;
		const next = decode(rt, schema);
		const tr = before.tr.setMeta('addToHistory', false).setMeta(remoteKey, true);
		const start = before.doc.content.findDiffStart(next.content);
		try {
			if (start != null) {
				let { a: endA, b: endB } = before.doc.content.findDiffEnd(next.content)!;
				const overlap = start - Math.min(endA, endB);
				if (overlap > 0) {
					endA += overlap;
					endB += overlap;
				}
				tr.replace(start, endA, next.slice(start, endB));
			}
			if (!tr.doc.eq(next)) return false;
			const after = buildLineIndex(tr.doc);
			if (delta && before.selection instanceof TextSelection) {
				const at = (pm: number) => offsetToPM(after, mapThroughDelta(delta, pmToOffset(index, pm)));
				tr.setSelection(
					TextSelection.between(
						tr.doc.resolve(at(before.selection.anchor)),
						tr.doc.resolve(at(before.selection.head))
					)
				);
			}
			if (!plaintext)
				tr.setMeta(anchorKey, {
					op: 'reset',
					anchors: anchorsFromContent(rt).map((a) => toPM(after, a))
				} as AnchorEdit);
			view.updateState(before.apply(tr));
			index = view.state.doc.eq(tr.doc) ? after : buildLineIndex(view.state.doc);
			return true;
		} catch {
			return false;
		}
	}

	/** The anchors the plugin currently holds (PM coords); `[]` before the first apply. */
	const heldAnchors = (): AnchorPos[] => anchorKey.getState(view.state)?.anchors ?? [];

	/** The plugin's anchors as content offsets, against `index` — which `dispatchTransaction`
	 *  rebuilt over the new document before the commit this reads for. */
	function readAnchors(): AnchorPos[] {
		return heldAnchors().map((a) => ({
			id: a.id,
			start: pmToOffset(index, a.start),
			end: pmToOffset(index, a.end)
		}));
	}

	const controller: FieldController = {
		el: container,
		setCaret(pos: number): void {
			const pm = offsetToPM(index, pos);
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
			if (!flipped && !held && landRemote(current, delta)) {
				reconciler.commit(current);
				if (defaulted !== wasDefaulted) view.setProps({});
				return;
			}
			if (flipped) held = !held;
			const caret = pmToOffset(index, view.state.selection.head);
			const fresh = buildState(current);
			index = fresh.index;
			// Best-effort caret continuity across an external change: keep the offset. Set
			// rather than dispatched, so a leaf the caret is not in reports no caret move.
			const sel = Selection.near(fresh.state.doc.resolve(offsetToPM(index, caret)));
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
		insertAnchor(id: string, pos: number, end: number = pos): void {
			// A text field carries no anchors (§Inline mode), and a held one commits nothing.
			if (plaintext || held) return;
			if (heldAnchors().some((a) => a.id === id)) return; // ids are unique and invariant
			const at = toPM(index, { id, start: Math.min(pos, end), end: Math.max(pos, end) });
			view.dispatch(view.state.tr.setMeta(anchorKey, { op: 'add', ...at } as AnchorEdit));
		},
		removeAnchor(id: string): void {
			if (plaintext) return;
			if (!heldAnchors().some((a) => a.id === id)) return; // absent: nothing to commit
			view.dispatch(view.state.tr.setMeta(anchorKey, { op: 'remove', id } as AnchorEdit));
		},
		anchorsInRange(from: number, to: number): string[] {
			return heldAnchors()
				.filter((a) => pmToOffset(index, a.end) >= from && pmToOffset(index, a.start) <= to)
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
				from: pmToOffset(index, from),
				to: pmToOffset(index, to)
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
 * The prose-leaf plugin stack (INVARIANTS §Surface), shared by {@link createField} and
 * `ProseValue` so the two never fork the plugin ordering. History first with the step-splitting
 * plugin (`undo.ts`), then `afterHistory` plugins (the addressed leaf's anchor plugin), {@link
 * linebreakPlugin}, the markdown-shorthand input rules and their Backspace, the field keymap over
 * the base keymap, the URL paste that links a selection (`link-paste.ts`), the drag that moves
 * between leaves (`drag-move.ts`), and last the block
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
	list.push(dragMovePlugin());
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
 * A plain leaf's clipboard text is literal both ways, spelled as the engine spells a `text` value:
 * a lone `\n` a hard break, a blank line a paragraph boundary, and a run of `\n` its pairs as
 * paragraph boundaries, an odd one over a hard break before them. Upstream's defaults split pasted
 * text on any run of newlines and write a copy's breaks as nothing.
 */
function plainClipboardPlugin(): Plugin {
	const { paragraph, hard_break } = plainSchema.nodes;
	const line = (text: string) =>
		paragraph.create(
			null,
			text
				.split('\n')
				.flatMap((part, i) => [
					...(i ? [hard_break.create()] : []),
					...(part ? [plainSchema.text(part)] : [])
				])
		);
	return new Plugin({
		props: {
			clipboardTextParser: (text) => {
				const paragraphs: string[] = [''];
				for (const piece of text.replace(/\r\n?/g, '\n').split(/(\n+)/)) {
					if (!piece.startsWith('\n')) {
						paragraphs[paragraphs.length - 1] += piece;
						continue;
					}
					if (piece.length % 2) paragraphs[paragraphs.length - 1] += '\n';
					for (let k = 0; k < piece.length >> 1; k++) paragraphs.push('');
				}
				return new Slice(Fragment.from(paragraphs.map(line)), 1, 1);
			},
			clipboardTextSerializer: (slice) =>
				slice.content.textBetween(0, slice.content.size, '\n\n', '\n')
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
 * navigation is open for a shell keymap (INVARIANTS §Chrome); a block-schema body
 * takes Tab structurally, a chain each nested surface prepends to (`keymap.ts`).
 */
function editorKeymap(schema: Schema, inline: boolean, slash?: boolean): Record<string, Command> {
	const map: Record<string, Command> = {
		[FIELD_KEYS.undo]: undo,
		[FIELD_KEYS.redo]: redo,
		[FIELD_KEYS.redoAlt]: redo,
		...markKeymap(schema)
	};
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
