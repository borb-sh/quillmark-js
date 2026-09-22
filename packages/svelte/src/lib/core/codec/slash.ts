// The slash menu: the block vocabulary's keyboard door. A `/` at a word boundary opens
// a filtered list of commands; a pick consumes exactly the trigger run and runs one.
//
// A command is a name and nothing else, in the shape a chat client's slash commands
// take: one lowercase kebab-case token typed after the `/`. A token is not wording, so
// it is the same in every locale and `SlashStrings` carries only the menu's accessible
// name.
//
// Every command but the island's is also a markdown shorthand, and the two doors share
// one implementation (`blocks.ts`).
//
// The plugin owns the whole menu model (the trigger run, the query, the highlighted
// index, and the commands themselves) and the chrome owns only its pixels. That split
// is what keeps the keys where they belong:
// the menu is keyboard-first, so ↑/↓/Enter/Escape are the leaf's keymap while the
// caret stays in the contenteditable, not a focus-taking listbox that would move
// the selection the insert is measured against.
import type { Node as PMNode } from 'prosemirror-model';
import {
	EditorState,
	Plugin,
	PluginKey,
	Selection,
	type Command,
	type Transaction
} from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { rangeAnchor, type RangeAnchor } from './anchor.js';
import { consuming, toCodeBlock, toHeading, wrapInList, wrapInQuote } from './blocks.js';
import { mintIslandId } from './islands.js';
import { newTable } from './table.js';

/** The menu as the chrome sees it: the command names the query matched, the keyboard's
 *  cursor, and the trigger's anchor to hang off. `undefined` is a closed menu.
 *
 *  An empty `items` is a live trigger with nothing to offer, and nothing is drawn over
 *  it. The run is the shape of the text (a `/` at a boundary, no whitespace since) and
 *  the menu the shape of the match; splitting the two is what lets a query typed past
 *  the last match narrow back into one. */
export interface SlashState {
	items: string[];
	index: number;
	query: string;
	/** The trigger's caret to hang off, live rather than measured (`anchor.ts`): an
	 *  open menu outlives any one scroll position of the leaf. */
	anchor: RangeAnchor;
}

/** The menu's wording, which is its accessible name and nothing else: the offers are
 *  command names, and a name is not translated. */
export interface SlashStrings {
	slashLabel: string;
}

/** The package's English, beside the surface that draws it: the same rule the island
 *  chrome's wording follows, and the visual `strings` set extends both. */
export const DEFAULT_SLASH_STRINGS: SlashStrings = {
	slashLabel: 'Insert'
};

/**
 * The vocabulary a caret can run, in menu order: the names `SLASH_COMMANDS` is keyed
 * by, each asked whether it would fire here. A row that declines when picked is worse
 * than an absent one, and asking the command rather than restating its guards is what
 * keeps the menu from drifting off what the shorthand does. So the offers narrow as the
 * caret moves: the island alone mid-paragraph, no list at an item's head.
 *
 * `state` is the state a pick leaves behind — the run already consumed — since that is
 * the caret every command answers for (`blocks.ts`).
 */
export function slashItems(state: EditorState): string[] {
	return Object.keys(SLASH_COMMANDS).filter((name) => SLASH_COMMANDS[name](state, undefined));
}

/** The query filter: a case-insensitive prefix of the name or of any of its words, which
 *  is how a command line completes and how a two-word name stays reachable by the noun a
 *  writer has — `/list` offers both lists. A prefix and not a substring: `note` is inside
 *  `footnote` and completes nothing. An empty query offers everything, and the
 *  vocabulary's order survives, so the menu never reorders under a keystroke. */
export function filterItems(items: string[], query: string): string[] {
	const q = query.trim().toLowerCase();
	if (!q) return items;
	return items.filter((name) => {
		const n = name.toLowerCase();
		return n.startsWith(q) || n.split('-').some((word) => word.startsWith(q));
	});
}

/** The live trigger: where the `/` sits, what has been typed after it, and which
 *  offer the keyboard is on. */
interface SlashRun {
	from: number;
	query: string;
	index: number;
}

type SlashMeta = { op: 'dismiss' } | { op: 'index'; index: number };

const slashKey = new PluginKey<SlashRun | null>('quill-slash');

/** Where a pick placed a block island, carried on the transaction that placed it: the
 *  one thing the cell handoff cannot read back off the resulting selection. */
const islandKey = new PluginKey<number>('quill-slash-island');

/** Whether a `/` just typed at `pos` opens a menu. A word boundary (the start of a
 *  textblock, or after whitespace) rather than anywhere, so `and/or` and a URL stay
 *  literal prose. A code block is prose the surface must not reinterpret at all. */
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
 * The trigger plugin. It holds the run in PM state, so every ordinary dismissal is
 * free: a caret move out of it, an undo, or a re-hydrate all fail the recompute
 * below and close the menu without a listener of their own. A dismissal edits no
 * text; only a pick does, and it consumes exactly the run.
 */
export function slashPlugin(
	onState: (state: SlashState | undefined) => void
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
					// A query nothing matches keeps the run and loses the menu (§`SlashState`).
					// Ending the run here instead keys the only way back on the bare `/`, a state
					// the writer has to delete through character by character.
					return { from, query, index: query === prev.query ? prev.index : 0 };
				}
				if (!tr.docChanged || !next.selection.empty) return null;
				const head = next.selection.head;
				if (next.doc.textBetween(Math.max(0, head - 1), head) !== '/') return null;
				return opensAt(next, head - 1) ? { from: head - 1, query: '', index: 0 } : null;
			}
		},
		// A run belongs to a focused caret. Losing the focus is the one dismissal the
		// recompute above cannot see: a blur dispatches no transaction, so the run outlives
		// it while the chrome's own outside-press layer closes the menu. A click back onto
		// the same caret restores neither, the run being unchanged: the reporter below
		// emits nothing, and the surface stays shut over keys it still claims, where Enter
		// inserts with no menu on screen. An item's own press never reaches here: the
		// chrome swallows its `mousedown`, so the caret never blurs.
		props: {
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
			// One report per state, and only when something the chrome draws changed:
			// the plugin state advances on every keystroke in the leaf.
			let last = '';
			const push = () => {
				const run = slashKey.getState(view.state);
				const signature = run ? `${run.from} ${run.query} ${run.index}` : '';
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

/** The chrome's view of a live run: the filtered offers and the trigger's anchor.
 *
 * Nothing is measured here. This runs on the keystroke that changed the run, and a
 * menu outlives its keystroke: the leaf scrolls under an open one, and a rect taken
 * now would strand it. `rangeAnchor` hands the chrome something that measures on
 * demand instead, which is also what absorbs an unmeasurable position (`anchor.ts`). */
function snapshot(view: EditorView, run: SlashRun): SlashState {
	const items = offers(view.state, run);
	return {
		items,
		index: Math.min(run.index, Math.max(0, items.length - 1)),
		query: run.query,
		anchor: rangeAnchor(view, run.from, run.from)
	};
}

/** The offers a live run has: the vocabulary the caret can run (§`slashItems`),
 *  narrowed by the query. The run is consumed first, since that is the state a pick
 *  leaves and so the one every command is asked about. */
function offers(state: EditorState, run: SlashRun): string[] {
	const consumed = state.apply(state.tr.delete(run.from, state.selection.head));
	return filterItems(slashItems(consumed), run.query);
}

// ── The keys ────────────────────────────────────────────────────────────────

/**
 * The menu's keys, the innermost link of the leaf's chain (`keymap.ts`). Every one
 * declines on an empty offer list rather than on a dead run (§`SlashState`): a key an
 * undrawn run claimed would be a key lost to a surface nobody can see. So a body with
 * no menu on screen keeps Enter, Escape and the arrows exactly as it had them.
 *
 * Escape is the contended key: a table gives it three claimants (this menu, the
 * format popover, an island selection). Innermost first, and this is the innermost
 * of the three that can be open over a caret in text.
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
		Enter: (state, dispatch, view) => {
			const run = slashKey.getState(state);
			if (!run || !view) return false;
			const list = offers(state, run);
			const picked = list[Math.min(run.index, list.length - 1)];
			if (!picked) return false;
			runSlashItem(view, picked);
			return true;
		},
		// The one key needing no item to act on, so its empty-list decline is a rule here
		// rather than a consequence: a dismissal is a dismissal at any query.
		Escape: (state, dispatch) => {
			const run = slashKey.getState(state);
			if (!run || !offers(state, run).length) return false;
			dispatch?.(state.tr.setMeta(slashKey, { op: 'dismiss' } as SlashMeta));
			return true;
		}
	};
}

/** Move the keyboard cursor onto `name`: what a pointer entering an item calls, so the
 *  highlight has one lane rather than a hover painting a second one. */
export function focusSlashItem(view: EditorView, name: string): void {
	const run = slashKey.getState(view.state);
	if (!run) return;
	const index = offers(view.state, run).indexOf(name);
	if (index < 0) return;
	view.dispatch(view.state.tr.setMeta(slashKey, { op: 'index', index } as SlashMeta));
}

/**
 * Run a command: one transaction that deletes the trigger run and applies the command's
 * own edit (`blocks.ts` §`consuming`). A command that declines consumes nothing. The
 * menu never picks one, offering only what would run; `slashPick` is a public seam and
 * can.
 */
export function runSlashItem(view: EditorView, name: string): void {
	const run = slashKey.getState(view.state);
	const command = SLASH_COMMANDS[name];
	if (!run || !command) return;
	const done = consuming(view.state, run.from, view.state.selection.head, command);
	if (!done) return;
	done.tr.setMeta(slashKey, { op: 'dismiss' } as SlashMeta);
	view.dispatch(done.tr);
	view.focus();
	const island = done.produced.getMeta(islandKey) as number | undefined;
	if (island !== undefined) focusFreshTable(view, island);
}

/**
 * Land the caret in the first cell of the table a pick just inserted. The NodeView
 * mounted during the dispatch above, and its cells are views of their own, so the
 * handoff is a focus rather than a selection: `nodeDOM` is PM's own answer to "the
 * DOM of the node at this position", not a reconstruction from geometry.
 *
 * `pos` is the insert's own report (§`insertBlock`), never the caret's neighbour:
 * where the caret lands is a question about what follows the island, and inside a list
 * item that is the next item's text. An island with no cells matches no host, so no
 * island-type test is needed here.
 */
function focusFreshTable(view: EditorView, pos: number): void {
	const dom = view.nodeDOM(pos) as HTMLElement | null;
	dom?.querySelector<HTMLElement>('.qm-table-cell-host .ProseMirror')?.focus();
}

/**
 * A block-level insert: the island's. It replaces an empty textblock (the common case,
 * since the trigger run was the only thing in it) and otherwise opens a block after the
 * caret's, so a pick mid-paragraph never splits the text.
 *
 * Both positions are the caret's container's, so the island lands where the caret was
 * writing: a pick in a list item nests it in that item, one in a quote inside the quote.
 * The nesting holds at every tier rather than at this one alone — an island line carries
 * its container path like any other (`encode.ts`), markdown indents the table to the
 * item's content column, the reference quill typesets it — and it is what a memo's
 * numbered paragraph wants when its point is a table.
 *
 * The transaction reports the island's position on `islandKey`: where the caret lands
 * is a question about what follows the island, and the cell handoff must not depend on
 * the answer.
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
		// A block island at the end of the body leaves nowhere to type; the paragraph
		// after it is the exit, and it is where the caret lands. Nowhere in the doc
		// rather than nowhere in the parent: an island in a non-last list item has the
		// next item to type in, and a paragraph minted inside that item is the unnumbered
		// continuation the reference quill typesets (`lists.ts`). After the node
		// rather than on it: an atom the selection cannot enter would take a node
		// selection, and a fresh block painted as selected reads as a thing about to be
		// replaced. A table moves the caret on from there, into its first cell.
		const end = at + node.nodeSize;
		if (!Selection.findFrom(tr.doc.resolve(end), 1, true))
			tr.insert(end, state.schema.nodes.paragraph.create());
		tr.setSelection(Selection.near(tr.doc.resolve(end), 1));
		tr.setMeta(islandKey, at);
		dispatch?.(tr);
		return true;
	};
}

/** What each command does, keyed by the name the chrome draws and a pick sends back.
 *  This table is the vocabulary (§`slashItems`): a name with no command here is a row
 *  the menu cannot run, and a command with no row is a door nothing opens.
 *
 *  In menu order, under the words a writer has rather than the schema's: `list` and
 *  `numbered-list`, not `bullet_list` and `ordered_list`. `heading` is level 1, the
 *  level `# ` counts to. */
const SLASH_COMMANDS: Record<string, Command> = {
	heading: toHeading(1),
	list: wrapInList(false),
	'numbered-list': wrapInList(true),
	quote: wrapInQuote(),
	code: toCodeBlock(),
	// The one command no shorthand reaches: a pipe row is not a prefix a rule can fire on.
	// An insert rather than a turn, so it is also the only one a caret mid-paragraph is
	// offered.
	table: insertBlock((state) =>
		state.schema.nodes.island_block.create({
			id: mintIslandId(state.doc),
			islandType: 'table',
			props: newTable()
		})
	)
};
