// The slash menu: the block vocabulary's keyboard door. A `/` at a word boundary opens a filtered
// list of commands; a pick consumes exactly the trigger run and runs one.
//
// A command is one lowercase kebab-case token typed after the `/`. A token is not wording, so it is
// the same in every locale and is what the query matches; the menu draws each row by its name, which
// is wording (§`SlashStrings`), with the token beside it as what to type. The hint is the door's one
// mark on screen: on the empty line a focused caret holds, it names the key (§`slashHint`).
//
// Every command but the island's is also a markdown shorthand, sharing one implementation
// (`blocks.ts`).
//
// The plugin owns the whole menu model (trigger run, query, highlighted index, commands) and the
// chrome owns only its pixels, so ↑/↓/Enter/Escape are the leaf's keymap while the caret stays in
// the contenteditable, not a focus-taking listbox that would move the selection the insert is
// measured against.
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, Selection, type Command } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { rangeAnchor, type RangeAnchor } from './anchor.js';
import { consuming, pickList, pickSubList, toCodeBlock, toHeading, wrapInQuote } from './blocks.js';
import { mintIslandId } from './islands.js';
import { islandOf, newTable } from './table.js';

/**
 * The menu as the chrome sees it: the command names the query matched, the keyboard's cursor, and
 * the trigger's anchor to hang off. `undefined` is a closed menu. An empty `items` is a live
 * trigger with nothing to offer, drawn as nothing: the run is the shape of the text and the menu
 * the shape of the match, so a query typed past the last match can narrow back into one.
 */
export interface SlashState {
	items: string[];
	index: number;
	query: string;
	/**
	 * The trigger's caret to hang off, live rather than measured (`anchor.ts`): an open menu
	 * outlives any one scroll position.
	 */
	anchor: RangeAnchor;
}

/**
 * The menu's wording: its accessible name, the empty line's hint, and each row's name. The tokens
 * a row shows beside its name are not translated: they are what is typed.
 */
export interface SlashStrings {
	slashLabel: string;
	/** Drawn on the empty line a focused caret holds, naming the key that opens the menu. */
	slashHint: string;
	/** A command's row name, by its token: `numbered-list` → `Numbered list`. */
	slashName: (command: string) => string;
	/** What the menu announces as its highlight moves, the caret never leaving the text:
	 *  the row's name and its 1-based place, `Table, 6 of 6`. */
	slashPosition: (name: string, index: number, count: number) => string;
}

const SLASH_NAMES: Record<string, string> = {
	heading: 'Heading',
	list: 'Bulleted list',
	'numbered-list': 'Numbered list',
	subparagraph: 'Subparagraph',
	quote: 'Quote',
	code: 'Code block',
	table: 'Table'
};

/** The package's English, beside the surface that draws it; the visual `strings` set extends it. */
export const DEFAULT_SLASH_STRINGS: SlashStrings = {
	slashLabel: 'Insert',
	slashHint: 'Type / to insert',
	slashName: (command) =>
		SLASH_NAMES[command] ?? command.charAt(0).toUpperCase() + command.slice(1).replace(/-/g, ' '),
	slashPosition: (name, index, count) => `${name}, ${index} of ${count}`
};

/**
 * The vocabulary a caret can run, in menu order, each name asked whether it would fire here: a row
 * that declines when picked is worse than an absent one, and asking the command keeps the menu from
 * drifting off what a pick does. So the offers narrow as the caret moves (the lists and the island
 * alone mid-paragraph; at an item's head only the list of the other kind).
 *
 * `state` is the state a pick leaves behind, the run already consumed (`blocks.ts`).
 */
export function slashItems(state: EditorState): string[] {
	return Object.keys(SLASH_COMMANDS).filter((name) => SLASH_COMMANDS[name](state, undefined));
}

/**
 * The query filter: a case-insensitive prefix of the name or of any of its words, so `/list` offers
 * both lists. A prefix and not a substring (`note` is inside `footnote` and completes nothing). An
 * empty query offers everything in the vocabulary's order.
 */
export function filterItems(items: string[], query: string): string[] {
	const q = query.trim().toLowerCase();
	if (!q) return items;
	return items.filter((name) => {
		const n = name.toLowerCase();
		return n.startsWith(q) || n.split('-').some((word) => word.startsWith(q));
	});
}

/**
 * The live trigger: where the `/` sits, what has been typed after it, and which offer the keyboard
 * is on.
 */
interface SlashRun {
	from: number;
	query: string;
	index: number;
}

type SlashMeta = { op: 'dismiss' } | { op: 'index'; index: number };

const slashKey = new PluginKey<SlashRun | null>('quill-slash');

/**
 * Where a pick placed a block island, carried on the transaction that placed it: what the cell
 * handoff cannot read back off the resulting selection.
 */
const islandKey = new PluginKey<number>('quill-slash-island');

/**
 * Whether a `/` just typed at `pos` opens a menu: only at a word boundary, so `and/or` and a URL
 * stay literal, and never in a code block.
 */
function opensAt(state: EditorState, pos: number): boolean {
	const $pos = state.doc.resolve(pos);
	if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return false;
	if ($pos.parentOffset === 0) return true;
	const before = state.doc.textBetween(pos - 1, pos);
	return /\s/.test(before);
}

/** The trigger run's text: everything between the `/` and the caret. */
function runQuery(state: EditorState, from: number): string | null {
	const { head, empty } = state.selection;
	if (!empty || head <= from) return null;
	if (state.doc.textBetween(from, from + 1) !== '/') return null;
	const text = state.doc.textBetween(from + 1, head, '￼', '￼');
	// A space ends the run: a menu that survives one is a menu that eats a sentence.
	return /[\s￼]/.test(text) ? null : text;
}

/**
 * The trigger plugin. It holds the run in PM state, so a caret move out of it, an undo or a
 * re-hydrate fail the recompute and close the menu without a listener. A dismissal edits no text;
 * only a pick does, consuming exactly the run.
 */
export function slashPlugin(
	onState: (state: SlashState | undefined) => void,
	hint?: () => string | undefined
): Plugin<SlashRun | null> {
	return new Plugin<SlashRun | null>({
		key: slashKey,
		state: {
			init: () => null,
			apply: (tr, prev, _old, next) => {
				const meta = tr.getMeta(slashKey) as SlashMeta | undefined;
				if (meta?.op === 'dismiss') return null;
				if (meta?.op === 'index' && prev) return { ...prev, index: meta.index };
				if (prev) {
					const from = tr.mapping.map(prev.from, -1);
					const query = runQuery(next, from);
					if (query === null) return null;
					// A query nothing matches keeps the run and loses the menu (§`SlashState`);
					// ending the run would leave only the bare `/` as the way back.
					return { from, query, index: query === prev.query ? prev.index : 0 };
				}
				if (!tr.docChanged || !next.selection.empty) return null;
				const head = next.selection.head;
				if (next.doc.textBetween(Math.max(0, head - 1), head) !== '/') return null;
				return opensAt(next, head - 1) ? { from: head - 1, query: '', index: 0 } : null;
			}
		},
		// A run belongs to a focused caret. A blur dispatches no transaction, so the run outlives
		// it while the chrome's outside-press layer closes the menu; refocusing the same caret
		// would leave the surface shut over keys it still claims. An item's own press never reaches
		// here: the chrome swallows its `mousedown`.
		props: {
			decorations: (state) => slashHint(state, hint?.()),
			handleDOMEvents: {
				blur: (view) => {
					if (slashKey.getState(view.state)) {
						view.dispatch(view.state.tr.setMeta(slashKey, { op: 'dismiss' } as SlashMeta));
					}
					return false;
				}
			}
		},
		view: (view) => {
			// One report per state, and only when something the chrome draws changed.
			let last = '';
			const push = () => {
				const run = slashKey.getState(view.state);
				const signature = run ? `${run.from}\0${run.query}\0${run.index}` : '';
				if (signature === last) return;
				last = signature;
				onState(run ? snapshot(view, run) : undefined);
			};
			push();
			return {
				update: push,
				destroy: () => onState(undefined)
			};
		}
	});
}

/**
 * The hint on the empty line the caret holds, wherever a `/` there would open a menu with something
 * in it: a node decoration whose attribute `prose.css` draws, so the text stays out of the
 * document. It shows only while the leaf has focus, and yields to the empty leaf's ghost where both
 * stand (`field.ts` §`ghostPlugin`).
 */
function slashHint(state: EditorState, text: string | undefined): DecorationSet | null {
	const { $from, empty } = state.selection;
	const line = $from.parent;
	if (!text || !empty || !line.isTextblock || line.content.size || line.type.spec.code) return null;
	if (!slashItems(state).length) return null;
	const at = $from.before();
	return DecorationSet.create(state.doc, [
		Decoration.node(at, at + line.nodeSize, { class: 'qm-slash-hint', 'data-slash-hint': text })
	]);
}

/**
 * The chrome's view of a live run: the filtered offers and the trigger's anchor. Nothing is
 * measured here: the leaf scrolls under an open menu, so `rangeAnchor` hands the chrome something
 * that measures on demand (`anchor.ts`).
 */
function snapshot(view: EditorView, run: SlashRun): SlashState {
	const items = offers(view.state, run);
	return {
		items,
		index: Math.min(run.index, Math.max(0, items.length - 1)),
		query: run.query,
		anchor: rangeAnchor(view, run.from, run.from)
	};
}

/**
 * The offers a live run has: the vocabulary the caret can run (§`slashItems`), narrowed by the
 * query, asked of the state a pick leaves (run consumed).
 */
function offers(state: EditorState, run: SlashRun): string[] {
	const consumed = state.apply(state.tr.delete(run.from, state.selection.head));
	return filterItems(slashItems(consumed), run.query);
}

// ── The keys ────────────────────────────────────────────────────────────────

/**
 * The menu's keys, the innermost link of the leaf's chain (`keymap.ts`). Every one declines on an
 * empty offer list rather than a dead run (§`SlashState`), so a body with no menu on screen keeps
 * Enter, Escape and the arrows as it had them. Escape has three claimants over a table (this menu,
 * the format popover, an island selection); this is the innermost that can be open over a caret in
 * text.
 */
export function slashKeymap(): Record<string, Command> {
	const move =
		(delta: number): Command =>
		(state, dispatch) => {
			const run = slashKey.getState(state);
			if (!run) return false;
			const list = offers(state, run);
			if (!list.length) return false;
			const index = (run.index + delta + list.length) % list.length;
			dispatch?.(state.tr.setMeta(slashKey, { op: 'index', index } as SlashMeta));
			return true;
		};
	return {
		ArrowDown: move(1),
		ArrowUp: move(-1),
		Enter: (state, _dispatch, view) => {
			const run = slashKey.getState(state);
			if (!run || !view) return false;
			const list = offers(state, run);
			const picked = list[Math.min(run.index, list.length - 1)];
			if (!picked) return false;
			runSlashItem(view, picked);
			return true;
		},
		// Needs no item to act on: a dismissal is a dismissal at any query.
		Escape: (state, dispatch) => {
			const run = slashKey.getState(state);
			if (!run || !offers(state, run).length) return false;
			dispatch?.(state.tr.setMeta(slashKey, { op: 'dismiss' } as SlashMeta));
			return true;
		}
	};
}

/** Move the keyboard cursor onto `name` (a pointer entering an item): one highlight lane. */
export function focusSlashItem(view: EditorView, name: string): void {
	const run = slashKey.getState(view.state);
	if (!run) return;
	const index = offers(view.state, run).indexOf(name);
	if (index < 0) return;
	view.dispatch(view.state.tr.setMeta(slashKey, { op: 'index', index } as SlashMeta));
}

/**
 * Run a command: one transaction that deletes the trigger run and applies the command's edit
 * (`blocks.ts` §`consuming`). A command that declines consumes nothing. The menu only offers what
 * would run; `slashPick` is a public seam and can pick any.
 */
export function runSlashItem(view: EditorView, name: string): void {
	const run = slashKey.getState(view.state);
	const command = SLASH_COMMANDS[name];
	if (!run || !command) return;
	const done = consuming(view.state, run.from, view.state.selection.head, command);
	if (!done) return;
	done.tr.setMeta(slashKey, { op: 'dismiss' } as SlashMeta);
	view.dispatch(done.tr.scrollIntoView());
	view.focus();
	const island = done.produced.getMeta(islandKey) as number | undefined;
	if (island !== undefined) focusFreshTable(view, island);
}

/**
 * Land the caret in the first cell of the table a pick just inserted. The NodeView mounted during
 * the dispatch, and its cells are views of their own, so the handoff is a focus via `nodeDOM`
 * rather than a selection. `pos` is the insert's own report (§`insertBlock`), not the caret's
 * neighbour, which inside a list item is the next item's text. An island with no cells matches no
 * host.
 */
function focusFreshTable(view: EditorView, pos: number): void {
	const dom = view.nodeDOM(pos) as HTMLElement | null;
	dom?.querySelector<HTMLElement>('.qm-table-cell-host .ProseMirror')?.focus();
}

/**
 * A block-level insert: the island's. It replaces an empty textblock (the common case, since the
 * trigger run was the only thing in it) and otherwise opens a block after the caret's, so a pick
 * mid-paragraph never splits the text.
 *
 * Both positions are the caret's container's, so a pick in a list item nests in that item and one
 * in a quote inside the quote; an island line carries its container path at every tier
 * (`encode.ts`).
 *
 * The transaction reports the island's position on `islandKey`, so the cell handoff does not depend
 * on where the caret lands.
 */
function insertBlock(make: (state: EditorState) => PMNode): Command {
	return (state, dispatch) => {
		const { $from } = state.selection;
		if (!$from.parent.isTextblock) return false;
		const node = make(state);
		const tr = state.tr;
		const empty = $from.parent.content.size === 0;
		const at = empty ? $from.before() : $from.after();
		if (empty) tr.replaceWith($from.before(), $from.after(), node);
		else tr.insert(at, node);
		// A block island at the end of the body leaves nowhere to type; the paragraph after it is
		// the exit and the caret's landing. Last in the doc, not the parent: an island in a
		// non-last list item has the next item, and a paragraph minted there would be an unnumbered
		// continuation (`lists.ts`). After the node, not on it: a node selection on a fresh block
		// reads as about to be replaced. A table moves the caret on into its first cell.
		const end = at + node.nodeSize;
		if (!Selection.findFrom(tr.doc.resolve(end), 1, true))
			tr.insert(end, state.schema.nodes.paragraph.create());
		tr.setSelection(Selection.near(tr.doc.resolve(end), 1));
		tr.setMeta(islandKey, at);
		dispatch?.(tr);
		return true;
	};
}

/**
 * What each command does, keyed by the name the chrome draws and a pick sends back. This table is
 * the vocabulary (§`slashItems`), in menu order, under the words a writer has (`list`,
 * `numbered-list`). `heading` is level 1, the level `# ` counts to.
 */
const SLASH_COMMANDS: Record<string, Command> = {
	heading: toHeading(1),
	list: pickList(false),
	'numbered-list': pickList(true),
	// A memo letters a bullet under an item as a subparagraph, the word its writer has.
	subparagraph: pickSubList(),
	quote: wrapInQuote(),
	code: toCodeBlock(),
	// The one command no shorthand reaches: a pipe row is not a prefix a rule can fire on.
	table: insertBlock((state) =>
		state.schema.nodes.island_block.create({
			id: mintIslandId(state.doc),
			islandType: 'table',
			...islandOf(newTable())
		})
	)
};
