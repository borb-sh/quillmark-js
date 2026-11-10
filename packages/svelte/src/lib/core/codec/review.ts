// Review, drawn in the leaf's own flow: what a writer other than the reader changed here, and what
// one proposes to change. An item names an anchor the leaf holds, so its place is the document's
// and rides every edit; nothing is measured from outside the view.
//
// A change is a mark over the text that was written, or a wedge where text was only taken out. A
// proposal is the paragraph it would rewrite, read as an edit of itself: the words that would go
// struck, the words that would come tinted in their place, and what it adds beyond the paragraph
// set in flow under it. None of it enters the document while it is proposed: the struck words are
// the leaf's own text under a decoration, and every added word is a widget.
//
// A proposal is an edit of the paragraph as it stood when the proposal arrived. What the reader
// writes in the paragraph since is theirs: the proposal's stretches ride past it, and only the
// words it would rewrite are struck, as the reader has them now.
//
// Taking a proposal is the leaf's own edit, made from the plan the drawing was made from, so the
// words that land are the words that were drawn. It goes down the lane a keystroke takes: one
// transaction, one undo step, one commit.
import { closeHistory, isHistoryTransaction, undo } from 'prosemirror-history';
import { DOMSerializer, Fragment, Mark, type Node as PMNode, type Schema } from 'prosemirror-model';
import { keydownHandler } from 'prosemirror-keymap';
import {
	Plugin,
	PluginKey,
	Selection,
	type EditorState,
	type Transaction
} from 'prosemirror-state';
import { Step, StepResult } from 'prosemirror-transform';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { arriving, HARD_BREAK, ISLAND_SLOT } from './islands.js';
import type { AnchorPos } from './marks.js';
import { remoteKey } from './remote.js';
import { wordDiff, type DiffHunk } from './review-diff.js';
import { REVIEW_KEYS } from './shortcuts.js';

/**
 * One item of review over a prose leaf, by the anchor that places it.
 *
 * `changed` marks the anchor's range as written by someone else; a point anchor marks where text
 * was only removed. `proposed` reads the paragraphs the anchor touches as rewritten to `after`,
 * Markdown, where `''` proposes their removal. Its blocks pair with the paragraphs in order, each
 * drawn as an edit of the one it pairs with while the two are one kind of block; past the first
 * that is not, the paragraphs left are struck whole and the blocks left are added after the
 * outermost block holding the last paragraph, or as the next items of its list. A point anchor
 * proposes new blocks the same way after the paragraph holding it, or before the leaf's first
 * where the point opens the leaf; in an empty paragraph it proposes that paragraph's text. A
 * paragraph takes one proposal that rewrites it and one that adds after it, and a later item of
 * either kind naming it draws nothing.
 */
export type TextReview =
	| { id: string; state: 'changed'; anchor: string }
	| { id: string; state: 'proposed'; anchor: string; after: string };

/** What a reader did with an item: took a proposal, which the leaf has written by the time it
 *  says so, turned one down, asked for a change back, or undid an answer, so the item is open
 *  again with whatever was written for it taken back. */
export type ReviewAction = 'accept' | 'dismiss' | 'revert' | 'reopen';

/** What brought an item under attention: the pointer over it, or the caret in it. */
export type ReviewVia = 'pointer' | 'caret';

/** The words the leaf draws on a proposal's two buttons, and the names of what has no words. */
export interface ReviewStrings {
	reviewAccept: string;
	reviewDismiss: string;
	/** The two buttons' tooltips, which name their chords (`REVIEW_KEYS`). */
	reviewAcceptTitle: string;
	reviewDismissTitle: string;
	/** The accessible name of a proposal's two buttons as a group. */
	reviewProposal: string;
	/** The accessible name of the wedge standing where text was removed. */
	reviewGone: string;
	/** The label before the buttons of a proposal whose paragraph the reader rewrote since. */
	reviewOutdated: string;
}

export const DEFAULT_REVIEW_STRINGS: ReviewStrings = {
	reviewAccept: 'Accept',
	reviewDismiss: 'Dismiss',
	reviewAcceptTitle: 'Accept',
	reviewDismissTitle: 'Dismiss',
	reviewProposal: 'Proposed change',
	reviewGone: 'Text removed here',
	reviewOutdated: 'Edited since'
};

/** What the plugin reads and reports through; every reader is live. */
export interface ReviewChannel {
	items(): readonly TextReview[];
	/** The item under attention, drawn a step stronger. */
	lit(): string | undefined;
	strings(): ReviewStrings;
	anchors(state: EditorState): readonly AnchorPos[];
	/** `after` as a document under the leaf's schema; `undefined` where it does not parse. */
	parse(markdown: string): PMNode | undefined;
	/** The item whose card is up, and the way to lower it. */
	shown(): string | undefined;
	dismiss(): void;
	/** A reader's answer, `chord` where a key gave it. */
	act(id: string, action: ReviewAction, chord?: boolean): void;
	/** The leaf is writing a taken proposal, and is done. */
	writing?(on: boolean): void;
	/** The item the pointer or the caret is in, `undefined` once it has left. */
	point(id: string | undefined, via: ReviewVia): void;
	/** What the leaf draws and what it holds and does not draw, on each change of either. */
	drew(report: ReviewReport): void;
}

/** Why a listed item whose anchor the leaf holds draws nothing: `after` is not Markdown the
 *  leaf's schema holds, an earlier item has the paragraph, or the text already reads as
 *  proposed. */
export type LeafUndrawn = 'parse' | 'taken' | 'applied';

/** What a leaf draws of the items it was handed. */
export interface ReviewReport {
	/** The ids drawn, in the order the items were listed. */
	ids: readonly string[];
	/** The drawn proposals whose paragraph the reader has rewritten past their stretch since. */
	outdated: readonly string[];
	/** The items whose anchor the leaf holds and which it does not draw, each with why. */
	undrawn: readonly { id: string; reason: LeafUndrawn }[];
}

/** An answer the leaf holds: a proposal taken or turned down here, drawn no more. */
type Answer = 'accept' | 'dismiss';

/** The leaf's review state: the count of its own edits, so the caret's report can tell typing
 *  from arriving, the items answered here, and the item the caret was put into by its id, which
 *  the chords answer while the caret stays where it was put. */
interface ReviewState {
	edits: number;
	answered: ReadonlyMap<string, Answer>;
	entered: string | undefined;
	/** The accepts an undo or a redo took back or gave again, for the plugin view to report. */
	replayed: readonly { id: string; to: 'accept' | undefined }[];
}

/** What a transaction tells the review state: an answer given or taken back, the ids of
 *  answered items the host's list no longer holds, or the item the caret is put into. */
interface ReviewMeta {
	answer?: { id: string; to: Answer | undefined };
	prune?: readonly string[];
	entered?: string;
}

const reviewKey = new PluginKey<ReviewState>('quill-review');

/**
 * Taking a proposal, as a step of the transaction that writes it. It changes no content, and it
 * is a step and not a transaction's meta so that the leaf's history carries the answer with the
 * words: undoing the accept inverts it and the proposal draws again, and a redo, an undo event
 * grown by typing, the depth cap and a rebase over a remote edit each move it with its words.
 */
class ReviewAnswer extends Step {
	constructor(
		readonly id: string,
		readonly to: 'accept' | undefined
	) {
		super();
	}
	apply(doc: PMNode): StepResult {
		return StepResult.ok(doc);
	}
	invert(): Step {
		return new ReviewAnswer(this.id, this.to ? undefined : 'accept');
	}
	map(): Step {
		return this;
	}
	toJSON() {
		return { stepType: 'quillReviewAnswer', id: this.id, to: this.to ?? null };
	}
	static fromJSON(_schema: Schema, json: { id: string; to: 'accept' | null }): ReviewAnswer {
		return new ReviewAnswer(json.id, json.to ?? undefined);
	}
}
Step.jsonID('quillReviewAnswer', ReviewAnswer);

function answering(state: ReviewState, id: string, to: Answer | undefined): ReviewState {
	if (state.answered.get(id) === to) return state;
	const answered = new Map(state.answered);
	if (to) answered.set(id, to);
	else answered.delete(id);
	return { ...state, answered };
}

function applyReview(tr: Transaction, state: ReviewState): ReviewState {
	let next = state.replayed.length ? { ...state, replayed: [] } : state;
	if (tr.docChanged && !tr.getMeta(remoteKey)) next = { ...next, edits: next.edits + 1 };
	const history = isHistoryTransaction(tr);
	for (const step of tr.steps) {
		if (!(step instanceof ReviewAnswer)) continue;
		next = answering(next, step.id, step.to);
		// Reported whether or not the answer is still held: the host's list may have dropped it.
		if (history) next = { ...next, replayed: [...next.replayed, { id: step.id, to: step.to }] };
	}
	const meta = tr.getMeta(reviewKey) as ReviewMeta | undefined;
	if (meta?.answer) next = answering(next, meta.answer.id, meta.answer.to);
	for (const id of meta?.prune ?? []) next = answering(next, id, undefined);
	if (meta?.entered !== undefined) next = { ...next, entered: meta.entered };
	else if (next.entered !== undefined && (tr.docChanged || tr.selectionSet))
		next = { ...next, entered: undefined };
	return next;
}

/** A block the document holds no blocks inside: a textblock, a rule, a block island. */
interface Leaf {
	node: PMNode;
	pos: number;
	/** The containers it sits in, outermost first. */
	chain: string;
}

function leavesOf(doc: PMNode): Leaf[] {
	const out: Leaf[] = [];
	const walk = (node: PMNode, start: number, chain: string): void => {
		node.forEach((child, offset) => {
			const pos = start + offset;
			if (child.isTextblock || child.isAtom) out.push({ node: child, pos, chain });
			else walk(child, pos + 1, `${chain}/${child.type.name}`);
		});
	};
	walk(doc, 0, '');
	return out;
}

/** A textblock's text with one character a leaf node, so an offset in it is a position in it. */
function textOf(block: PMNode): string {
	return block.textBetween(0, block.content.size, undefined, (leaf) =>
		leaf.type.name === 'hard_break' ? HARD_BREAK : ISLAND_SLOT
	);
}

/** Whether `b` is `a` rewritten in place: one kind of block, in the nesting `a` stands in as far
 *  as `b` spells one, so their difference is their words'. A block proposed bare keeps the
 *  containers it is in. Two atoms are in place only where they are equal. */
function inPlace(a: Leaf, b: Leaf): boolean {
	if (a.node.type !== b.node.type || !a.chain.endsWith(b.chain)) return false;
	const { id: _a, block: _ab, ...x } = a.node.attrs;
	const { id: _b, block: _bb, ...y } = b.node.attrs;
	return JSON.stringify(x) === JSON.stringify(y);
}

/** The span of `leaf` a caret can stand in: a textblock's content, an atom's two sides. */
function reach(leaf: Leaf): [number, number] {
	return leaf.node.isTextblock
		? [leaf.pos + 1, leaf.pos + leaf.node.nodeSize - 1]
		: [leaf.pos, leaf.pos + leaf.node.nodeSize];
}

/** `doc`'s blocks from its `from`th leaf on, in the containers they sat in. A numbered list
 *  that lost its head keeps counting from where the kept items stood. */
function tail(doc: PMNode, from: number): PMNode[] {
	let seen = 0;
	const keep = (node: PMNode): PMNode | undefined => {
		if (node.isTextblock || node.isAtom) return seen++ >= from ? node : undefined;
		const kids: PMNode[] = [];
		let dropped = 0;
		node.forEach((child) => {
			const kept = keep(child);
			if (kept) kids.push(kept);
			else if (!kids.length) dropped++;
		});
		if (!kids.length) return undefined;
		const attrs =
			node.type.name === 'ordered_list'
				? { ...node.attrs, start: (node.attrs.start as number) + dropped }
				: node.attrs;
		return node.type.create(attrs, kids);
	};
	const out: PMNode[] = [];
	doc.forEach((child) => {
		const kept = keep(child);
		if (kept) out.push(kept);
	});
	return out;
}

/** One drawn item: where the caret counts as in it, whether it is a proposal, and whether it
 *  is one that only adds after its paragraph. */
interface Span {
	id: string;
	proposed: boolean;
	adds?: boolean;
	from: number;
	to: number;
}

/** One piece of what taking a proposal writes, by its place in the document it was drawn over:
 *  `content` in place of `[from, to)`. `lift` takes a whole block out, and with it every
 *  container that held nothing else. */
interface Piece {
	from: number;
	to: number;
	content: Fragment;
	lift?: boolean;
}

interface Drawn {
	set: DecorationSet;
	spans: Span[];
	/** Each drawn proposal's pieces, by its id. */
	plans: Map<string, Piece[]>;
	outdated: string[];
	undrawn: { id: string; reason: LeafUndrawn }[];
}

/**
 * The edit that takes a proposal: its pieces, last first, so each still stands where it was
 * read. `undefined` where the pieces no longer make a document the schema holds.
 */
function taking(state: EditorState, plan: readonly Piece[]): Transaction | undefined {
	const tr = state.tr;
	try {
		for (const piece of [...plan].sort((a, b) => b.from - a.from)) {
			let { from, to } = piece;
			if (piece.lift) {
				const $at = tr.doc.resolve(from);
				for (let d = $at.depth; d > 0 && $at.node(d).childCount === 1; d--) {
					from = $at.before(d);
					to = $at.after(d);
				}
				// A leaf holds a block at the least: its last one is emptied where it stands.
				if (from === 0 && to === tr.doc.content.size) {
					tr.replaceWith(from, to, tr.doc.type.createAndFill()!.content);
					continue;
				}
			}
			tr.replaceWith(from, to, arriving(tr.doc, piece.content));
		}
		tr.doc.check();
	} catch {
		return undefined;
	}
	return tr.docChanged ? closeHistory(tr) : undefined;
}

/** A hunk between two paired textblocks. `format` marks one whose words stay and whose
 *  formatting changes. */
interface Hunk extends DiffHunk {
	format?: true;
}

/** The marks on each offset of a textblock's content. */
function marksOf(block: PMNode): (readonly Mark[])[] {
	const out: (readonly Mark[])[] = [];
	block.forEach((child) => {
		for (let k = 0; k < child.nodeSize; k++) out.push(child.marks);
	});
	return out;
}

/** The runs of `[at, end)` in `a` whose marks differ from the same words in `b`, which stand
 *  `shift` further on. */
function formatRuns(
	a: (readonly Mark[])[],
	b: (readonly Mark[])[],
	at: number,
	end: number,
	shift: number,
	after: string
): Hunk[] {
	const out: Hunk[] = [];
	let run = -1;
	for (let i = at; i <= end; i++) {
		const differs = i < end && !Mark.sameSet(a[i], b[i + shift]);
		if (differs && run < 0) run = i;
		else if (!differs && run >= 0) {
			out.push({ at: run, end: i, insert: after.slice(run + shift, i + shift), format: true });
			run = -1;
		}
	}
	return out;
}

/** The hunks between two paired textblocks: their words', and inside the words they keep,
 *  each run whose formatting differs. */
function hunksOf(a: PMNode, b: PMNode): Hunk[] {
	const before = textOf(a);
	const after = textOf(b);
	const words = before === after ? [] : wordDiff(before, after);
	const ma = marksOf(a);
	const mb = marksOf(b);
	const out: Hunk[] = [];
	let kept = 0;
	let shift = 0;
	for (const hunk of words) {
		out.push(...formatRuns(ma, mb, kept, hunk.at, shift, after), hunk);
		shift += hunk.insert.length - (hunk.end - hunk.at);
		kept = hunk.end;
	}
	out.push(...formatRuns(ma, mb, kept, before.length, shift, after));
	return out;
}

/** One stretch of a held block a proposal rewrites: `[at, end)` of the block as it stands, and
 *  the words that would stand there. */
interface Rewrite {
	at: number;
	end: number;
	content: Fragment;
}

/**
 * What `to` rewrites of a block that read `was` when the proposal arrived and reads `now`. Each
 * stretch the proposal changes in `was` is carried through what was written since: words typed
 * at its edge stay outside it, and where a word it would rewrite was itself rewritten, the stretch
 * covers the rewriting. A stretch that already reads as proposed is left out.
 *
 * Where the reader rewrote words reaching past a stretch the proposal changes, the block is
 * `outdated`: the stretch carried onto words it was never computed against would write a sentence
 * nobody proposed, so the whole block as it now reads gives way to the whole proposed one.
 */
function rewrites(
	was: PMNode,
	now: PMNode,
	to: PMNode
): { outdated: boolean; stretches: Rewrite[] } {
	const since = was === now ? [] : wordDiff(textOf(was), textOf(now));
	const hunks = hunksOf(was, to);
	const past = since.some((s) =>
		hunks.some((h) => s.at < h.end && h.at < s.end && !(h.at <= s.at && s.end <= h.end))
	);
	if (past)
		return {
			outdated: true,
			stretches: [{ at: 0, end: now.content.size, content: to.content }]
		};
	const text = since.length ? textOf(now) : '';
	const nowMarks = since.length ? marksOf(now) : [];
	const toMarks = since.length ? marksOf(to) : [];
	const formatted = (at: number, end: number, start: number): boolean =>
		nowMarks.slice(at, end).every((marks, i) => Mark.sameSet(marks, toMarks[start + i]));
	const through = (pos: number, edge: 'start' | 'end'): number => {
		let moved = pos;
		for (const hunk of since) {
			const grew = hunk.insert.length - (hunk.end - hunk.at);
			if (
				hunk.at === hunk.end ? (edge === 'start' ? hunk.at <= pos : hunk.at < pos) : hunk.end <= pos
			)
				moved += grew;
			else if (hunk.at < pos && pos < hunk.end)
				return hunk.at + (moved - pos) + (edge === 'end' ? hunk.insert.length : 0);
		}
		return moved;
	};
	const out: Rewrite[] = [];
	// Where each insert starts in the proposed block: its hunk's start in the block it was
	// made on, moved by what the hunks before it added and took.
	let shift = 0;
	for (const hunk of hunks) {
		const start = hunk.at + shift;
		shift += hunk.insert.length - (hunk.end - hunk.at);
		const at = through(hunk.at, 'start');
		const end = Math.max(at, through(hunk.end, 'end'));
		if (
			since.length &&
			text.slice(at, end) === hunk.insert &&
			(!hunk.format || formatted(at, end, start))
		)
			continue;
		out.push({ at, end, content: to.content.cut(start, start + hunk.insert.length) });
	}
	return { outdated: false, stretches: out };
}

/** An answer to an item: from a button, from a chord, or `quiet` from a host's call, which moves
 *  neither the caret nor the focus. False where it could not be given, and the item stands. */
type Act = (
	id: string,
	action: ReviewAction,
	how?: { chord?: boolean; quiet?: boolean }
) => boolean;

/** A chord as `aria-keyshortcuts` spells it, `Mod` as either platform's. */
const ariaKeys = (chord: string): string =>
	['Meta', 'Control'].map((mod) => chord.replace('Mod', mod).replaceAll('-', '+')).join(' ');

function button(
	act: Act,
	id: string,
	action: 'accept' | 'dismiss',
	label: string,
	title: string,
	keys: string
): HTMLButtonElement {
	const el = document.createElement('button');
	el.type = 'button';
	el.tabIndex = -1;
	el.className = `qm-review-act qm-review-${action}`;
	el.textContent = label;
	el.title = title;
	el.setAttribute('aria-keyshortcuts', ariaKeys(keys));
	// The press keeps the caret where it is: the answer is about the text, not a move off it.
	el.addEventListener('mousedown', (e) => e.preventDefault());
	el.addEventListener('click', (e) => {
		e.preventDefault();
		act(id, action);
	});
	return el;
}

/** A proposal's two buttons: a run at the end of its last line, or a row of their own under a
 *  block that has no line to end. */
function chip(
	strings: ReviewStrings,
	act: Act,
	id: string,
	row: boolean,
	outdated: boolean
): HTMLElement {
	const el = document.createElement(row ? 'div' : 'span');
	el.className = ['qm-review-chip', row && 'qm-review-chip-row', outdated && 'qm-review-outdated']
		.filter(Boolean)
		.join(' ');
	el.contentEditable = 'false';
	el.setAttribute('data-qm-review', id);
	el.setAttribute('role', 'group');
	el.setAttribute('aria-label', strings.reviewProposal);
	const acts = document.createElement('span');
	acts.className = 'qm-review-acts';
	if (outdated) {
		const label = document.createElement('span');
		label.className = 'qm-review-outdated-label';
		label.textContent = strings.reviewOutdated;
		acts.append(label);
	}
	acts.append(
		button(act, id, 'accept', strings.reviewAccept, strings.reviewAcceptTitle, REVIEW_KEYS.accept),
		button(
			act,
			id,
			'dismiss',
			strings.reviewDismiss,
			strings.reviewDismissTitle,
			REVIEW_KEYS.dismiss
		)
	);
	// The space a run of answers stands off its line by, which a wrapped run leaves behind.
	el.append(row ? '' : ' ', acts);
	return el;
}

/** The last textblock's element under `el`, where a run can be appended to its last line. */
function lastLine(el: HTMLElement): HTMLElement | undefined {
	let at: HTMLElement = el;
	for (;;) {
		if (/^(P|H[1-6]|CODE)$/.test(at.tagName)) return at;
		const last = at.lastElementChild;
		if (!(last instanceof HTMLElement)) return undefined;
		at = last;
	}
}

/** The blocks a proposal covered when it arrived, by its id, with the `after` it then held and
 *  the anchor it named. */
type Bases = Map<string, { after: string; anchor: string; blocks: PMNode[] }>;

function draw(state: EditorState, channel: ReviewChannel, act: Act, bases: Bases): Drawn {
	const { answered } = reviewKey.getState(state)!;
	const listed = channel.items();
	const anchors = new Map(channel.anchors(state).map((a) => [a.id, a]));
	// A base outlives its item's answer and its leaving the list while its anchor stands, so a
	// proposal brought back by an undo draws against the paragraph it first drew over.
	if (bases.size) {
		const ids = new Set(listed.map((item) => item.id));
		for (const [id, base] of bases) if (!ids.has(id) && !anchors.has(base.anchor)) bases.delete(id);
	}
	const items = answered.size ? listed.filter((item) => !answered.has(item.id)) : listed;
	const plans = new Map<string, Piece[]>();
	const undrawn: Drawn['undrawn'] = [];
	const outdated: string[] = [];
	if (!items.length) return { set: DecorationSet.empty, spans: [], plans, outdated, undrawn };
	const { doc } = state;
	const lit = channel.lit();
	const strings = channel.strings();
	const serializer = DOMSerializer.fromSchema(state.schema);
	const decos: Decoration[] = [];
	const spans: Span[] = [];
	let leaves: Leaf[] | undefined;
	/** The paragraphs a proposal rewrites, and the places a proposal that only adds adds at:
	 *  a paragraph's end, or `-1` for the head of the leaf. */
	const taken = new Set<number>();
	const adding = new Set<number>();

	for (const item of items) {
		const anchor = anchors.get(item.anchor);
		if (!anchor) continue;
		const on = item.id === lit;
		const name = { 'data-qm-review': item.id };

		if (item.state === 'changed') {
			if (anchor.end > anchor.start) {
				decos.push(
					Decoration.inline(anchor.start, anchor.end, {
						class: on ? 'qm-review-changed qm-review-lit' : 'qm-review-changed',
						...name
					})
				);
			} else {
				decos.push(
					Decoration.widget(
						anchor.start,
						() => {
							const el = document.createElement('span');
							el.className = on ? 'qm-review-gone qm-review-lit' : 'qm-review-gone';
							el.contentEditable = 'false';
							el.setAttribute('data-qm-review', item.id);
							el.setAttribute('role', 'img');
							el.setAttribute('aria-label', strings.reviewGone);
							return el;
						},
						{ side: -1, key: `gone:${item.id}:${on}` }
					)
				);
			}
			spans.push({ id: item.id, proposed: false, from: anchor.start, to: anchor.end });
			continue;
		}

		leaves ??= leavesOf(doc);
		const point = anchor.start === anchor.end;
		const cover: number[] = [];
		let beside = -1;
		leaves.forEach((leaf, i) => {
			const [lo, hi] = reach(leaf);
			if (point) {
				if (beside < 0 && lo <= anchor.start && anchor.start <= hi) beside = i;
			} else if (
				(lo < anchor.end && hi > anchor.start) ||
				(lo === hi && anchor.start <= lo && lo <= anchor.end)
			)
				cover.push(i);
		});
		let ahead = false;
		if (point) {
			if (beside < 0) continue;
			const leaf = leaves[beside];
			if (leaf.node.isTextblock && !leaf.node.content.size) cover.push(beside);
			else ahead = beside === 0 && anchor.start === reach(leaf)[0];
		}
		if (!point && !cover.length) continue;
		const place = ahead ? -1 : beside;
		if (cover.length ? cover.some((i) => taken.has(i)) : adding.has(place)) {
			undrawn.push({ id: item.id, reason: 'taken' });
			continue;
		}

		const proposed = item.after.trim() ? channel.parse(item.after) : undefined;
		if (item.after.trim() && !proposed) {
			undrawn.push({ id: item.id, reason: 'parse' });
			continue;
		}
		const next = proposed ? leavesOf(proposed) : [];
		const covered = cover.map((i) => leaves![i]);
		let paired = 0;
		while (
			paired < covered.length &&
			paired < next.length &&
			inPlace(covered[paired], next[paired])
		)
			paired++;
		const added = proposed && paired < next.length ? tail(proposed, paired) : [];
		if (!covered.length && !added.length) continue;
		const plan: Piece[] = [];
		const mark = decos.length;
		let stale = false;
		const seen = bases.get(item.id);
		const base =
			seen?.after === item.after && seen.blocks.length === covered.length
				? seen.blocks
				: covered.map((leaf) => leaf.node);
		bases.set(item.id, { after: item.after, anchor: item.anchor, blocks: base });

		covered.forEach((leaf, k) => {
			const [lo, hi] = reach(leaf);
			const whole = k >= paired;
			decos.push(
				Decoration.node(leaf.pos, leaf.pos + leaf.node.nodeSize, {
					class: ['qm-review-held', whole && 'qm-review-out', on && 'qm-review-lit']
						.filter(Boolean)
						.join(' ')
				})
			);
			if (whole)
				plan.push({
					from: leaf.pos,
					to: leaf.pos + leaf.node.nodeSize,
					content: Fragment.empty,
					lift: true
				});
			if (!leaf.node.isTextblock) return;
			const strike = (from: number, to: number): void => {
				if (to > from)
					decos.push(
						Decoration.inline(from, to, { nodeName: 'del', class: 'qm-review-del', ...name })
					);
			};
			if (whole) return strike(lo, hi);
			const to = next[k].node;
			const was = base[k].type === leaf.node.type ? base[k] : leaf.node;
			const { outdated: past, stretches } = rewrites(was, leaf.node, to);
			stale ||= past;
			stretches.forEach(({ at, end, content }, n) => {
				strike(lo + at, lo + end);
				plan.push({ from: lo + at, to: lo + end, content });
				if (!content.size) return;
				decos.push(
					Decoration.widget(
						lo + end,
						() => {
							const el = document.createElement('ins');
							el.className = 'qm-review-ins';
							el.contentEditable = 'false';
							el.setAttribute('data-qm-review', item.id);
							el.append(serializer.serializeFragment(content));
							return el;
						},
						{ side: -1, key: `ins:${item.id}:${n}:${content.toString()}` }
					)
				);
			});
		});

		if (!plan.length && !added.length) {
			decos.length = mark;
			undrawn.push({ id: item.id, reason: 'applied' });
			continue;
		}
		if (cover.length) for (const i of cover) taken.add(i);
		else adding.add(place);
		plans.set(item.id, plan);
		if (stale) outdated.push(item.id);

		const last = covered.at(-1) ?? leaves[beside];
		const $last = doc.resolve(last.pos);
		/** Past the outermost block holding the last one, or the head of the leaf. */
		const outer = ahead ? 0 : $last.depth ? $last.after(1) : last.pos + last.node.nodeSize;
		const row = (): void => {
			decos.push(
				Decoration.widget(outer, () => chip(strings, act, item.id, true, stale), {
					side: ahead ? -1 : 9999,
					key: `chip:${item.id}:row:${stale}`,
					stopEvent: () => true
				})
			);
		};
		if (added.length) {
			// A proposal that continues the list its paragraph is in adds items to that list.
			const listed =
				!ahead &&
				$last.parent.type.name === 'list_item' &&
				added[0].type === $last.node($last.depth - 1).type;
			const pieces: { at: number; node: PMNode }[] = [];
			if (listed) {
				const at = $last.after($last.depth);
				added[0].forEach((li) => pieces.push({ at, node: li }));
			}
			for (const node of listed ? added.slice(1) : added) pieces.push({ at: outer, node });
			for (const piece of pieces) {
				const held = plan.at(-1);
				if (held && !held.lift && held.from === piece.at && held.to === piece.at)
					held.content = held.content.addToEnd(piece.node);
				else plan.push({ from: piece.at, to: piece.at, content: Fragment.from(piece.node) });
			}
			const closing = pieces.length - 1;
			const chipped = endsInLine(pieces[closing].node);
			pieces.forEach((piece, n) => {
				const holds = chipped && n === closing;
				decos.push(
					Decoration.widget(
						piece.at,
						() => {
							const el = serializer.serializeNode(piece.node) as HTMLElement;
							el.classList.add('qm-review-add');
							if (on) el.classList.add('qm-review-lit');
							el.contentEditable = 'false';
							el.setAttribute('data-qm-review', item.id);
							if (holds) lastLine(el)?.append(chip(strings, act, item.id, false, stale));
							return el;
						},
						{
							side: ahead ? -1000 + n : 1 + n,
							key: `add:${item.id}:${n}:${on}:${piece.node.toString()}`,
							stopEvent: (e) => (e.target as Element | null)?.closest?.('.qm-review-chip') != null
						}
					)
				);
			});
			if (!chipped) row();
		} else if (last.node.isTextblock) {
			decos.push(
				Decoration.widget(reach(last)[1], () => chip(strings, act, item.id, false, stale), {
					side: 1,
					key: `chip:${item.id}:${stale}`,
					stopEvent: () => true
				})
			);
		} else row();

		// What a proposal only adds to has the caret anywhere in the block it adds from.
		spans.push({
			id: item.id,
			proposed: true,
			adds: !covered.length,
			from: reach(covered[0] ?? last)[0],
			to: reach(last)[1]
		});
	}
	return { set: DecorationSet.create(doc, decos), spans, plans, outdated, undrawn };
}

/** Whether a block's last leaf is a textblock, so its last line can carry a run. */
function endsInLine(node: PMNode): boolean {
	let at: PMNode = node;
	while (!at.isTextblock && !at.isAtom && at.lastChild) at = at.lastChild;
	return at.isTextblock;
}

/** The item the caret is in: the one it was put into by its id while it holds the caret, else
 *  the one that holds it closest, so a change inside a paragraph a proposal covers is the change
 *  while the caret is in its words, and of a proposal that rewrites a paragraph and one that adds
 *  after it, the one that rewrites. `proposed` asks for a proposal alone. */
function spanAt(
	spans: readonly Span[],
	pos: number,
	entered: string | undefined,
	proposed = false
): Span | undefined {
	let best: Span | undefined;
	for (const s of spans) {
		if (s.from > pos || pos > s.to || (proposed && !s.proposed)) continue;
		if (s.id === entered) return s;
		const size = s.to - s.from;
		const held = best && best.to - best.from;
		if (!best || size < held! || (size === held && best.adds && !s.adds)) best = s;
	}
	return best;
}

/** The handle the leaf keeps on its review layer. */
export interface ReviewLayer {
	plugin: Plugin;
	/** Draw again from the channel: the items or the lit one moved. */
	refresh(view: EditorView): void;
	/** The elements item `id` draws, in document order. */
	elements(view: EditorView, id: string): HTMLElement[];
	/** Put the caret in item `id` and take the focus, so the item's chords answer. False for
	 *  an item the leaf does not draw. */
	enter(view: EditorView, id: string): boolean;
	/** Answer item `id` as its button would, moving neither the caret nor the focus. False
	 *  where the leaf does not draw it or cannot write it. */
	answer(id: string, action: ReviewAction): boolean;
	/** Open a dismissal of item `id` again and say so, the dismissal still held here or
	 *  already pruned by the host taking the item off its list. */
	reopen(view: EditorView, id: string): void;
	/** Undo the leaf's newest history step: an accept's, which reopens its item. */
	undo(view: EditorView): boolean;
}

/**
 * The leaf's review layer. The decorations are a function of the document, the anchors and the
 * channel's items, kept until one of them moves. The caret's report holds off while the reader
 * types inside an item: an item is news on arriving in it, and noise under every keystroke.
 */
export function reviewLayer(channel: ReviewChannel): ReviewLayer {
	let memo:
		| {
				doc: PMNode;
				review: ReviewState;
				anchors: readonly AnchorPos[];
				items: readonly TextReview[];
				lit: string | undefined;
				strings: ReviewStrings;
				drawn: Drawn;
		  }
		| undefined;
	const NOTHING = JSON.stringify({ ids: [], outdated: [], undrawn: [] } satisfies ReviewReport);
	let reported = NOTHING;
	let host: EditorView | undefined;
	const bases: Bases = new Map();
	/** Answer an item. Taking a proposal writes it first, and one that can no longer be written
	 *  stays as it is. A proposal taken by a press while the focus is elsewhere leaves the caret
	 *  after what landed, in a focused leaf: the edit is the reader's, and so is its undo. */
	const act: Act = (id, action, how = {}) => {
		const view = host;
		if (!view || !drawn(view.state).spans.some((span) => span.id === id)) return false;
		if (action === 'accept') {
			const plan = drawn(view.state).plans.get(id);
			const tr = plan && taking(view.state, plan);
			if (!tr || !plan) return false;
			const away = !how.quiet && !view.hasFocus();
			if (away) {
				const end = tr.mapping.map(Math.max(...plan.map((piece) => piece.to)), 1);
				tr.setSelection(Selection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size)), -1));
			}
			channel.writing?.(true);
			try {
				view.dispatch(tr.step(new ReviewAnswer(id, 'accept')));
			} finally {
				channel.writing?.(false);
			}
			if (away) view.focus();
		} else {
			view.dispatch(
				view.state.tr
					.setMeta(reviewKey, { answer: { id, to: 'dismiss' } } satisfies ReviewMeta)
					.setMeta('addToHistory', false)
			);
		}
		channel.act(id, action, how.chord);
		return true;
	};
	const drawn = (state: EditorState): Drawn => {
		const review = reviewKey.getState(state)!;
		const anchors = channel.anchors(state);
		const items = channel.items();
		const lit = channel.lit();
		const strings = channel.strings();
		if (
			memo &&
			memo.doc === state.doc &&
			memo.review === review &&
			memo.anchors === anchors &&
			memo.items === items &&
			memo.lit === lit &&
			memo.strings === strings
		)
			return memo.drawn;
		const next = draw(state, channel, act, bases);
		memo = { doc: state.doc, review, anchors, items, lit, strings, drawn: next };
		return next;
	};
	/** Tell the channel what the leaf draws, where that moved. */
	const report = (state: EditorState): void => {
		const { spans, outdated, undrawn } = drawn(state);
		const next: ReviewReport = { ids: spans.map((s) => s.id), outdated, undrawn };
		const joined = JSON.stringify(next);
		if (joined === reported) return;
		reported = joined;
		channel.drew(next);
	};

	let hovered: string | undefined;
	const hover = (id: string | undefined): void => {
		if (id === hovered) return;
		hovered = id;
		channel.point(id, 'pointer');
	};
	const idAt = (target: EventTarget | null): string | undefined =>
		(target instanceof Element ? target.closest('[data-qm-review]') : null)?.getAttribute(
			'data-qm-review'
		) ?? undefined;

	let caret: string | undefined;
	/** The item the reader typed in, quiet until the caret has left it. */
	let muted: string | undefined;
	const follow = (view: EditorView, typed: boolean): void => {
		const { selection } = view.state;
		const at =
			view.hasFocus() && selection.empty
				? spanAt(drawn(view.state).spans, selection.head, reviewKey.getState(view.state)?.entered)
						?.id
				: undefined;
		if (at !== muted) muted = undefined;
		if (typed && at) muted = at;
		const next = at === muted ? undefined : at;
		if (next === caret) return;
		caret = next;
		channel.point(next, 'caret');
	};

	const answer =
		(action: 'accept' | 'dismiss') =>
		(state: EditorState): boolean => {
			const span = spanAt(
				drawn(state).spans,
				state.selection.head,
				reviewKey.getState(state)?.entered,
				action === 'accept'
			);
			if (!span) return false;
			act(span.id, span.proposed ? action : 'revert', {
				chord: true
			});
			return true;
		};
	/** Escape lowers the card over the item the caret is in, before it is anything else's. */
	const lower = (state: EditorState): boolean => {
		const id = channel.shown();
		if (id === undefined || !drawn(state).spans.some((span) => span.id === id)) return false;
		channel.dismiss();
		return true;
	};

	const plugin = new Plugin<ReviewState>({
		key: reviewKey,
		state: {
			init: () => ({ edits: 0, answered: new Map(), entered: undefined, replayed: [] }),
			apply: applyReview
		},
		props: {
			decorations: (state) => drawn(state).set,
			handleKeyDown: keydownHandler({
				[REVIEW_KEYS.accept]: answer('accept'),
				[REVIEW_KEYS.dismiss]: answer('dismiss'),
				Escape: lower
			}),
			handleDOMEvents: {
				mouseover: (_view, e) => {
					hover(idAt(e.target));
					return false;
				},
				mouseleave: () => {
					hover(undefined);
					return false;
				},
				focus: (view) => {
					follow(view, false);
					return false;
				},
				blur: (view) => {
					// The focus has not left yet when a blur fires.
					queueMicrotask(() => {
						if (!view.isDestroyed) follow(view, false);
					});
					return false;
				}
			}
		},
		view: (view) => {
			host = view;
			report(view.state);
			return {
				update(view, prev) {
					const review = reviewKey.getState(view.state);
					if (review && review !== reviewKey.getState(prev))
						for (const { id, to } of review.replayed) channel.act(id, to ?? 'reopen');
					report(view.state);
					follow(view, reviewKey.getState(prev)?.edits !== reviewKey.getState(view.state)?.edits);
				},
				destroy() {
					if (hovered !== undefined) channel.point(undefined, 'pointer');
					if (caret !== undefined) channel.point(undefined, 'caret');
					if (reported !== NOTHING) channel.drew({ ids: [], outdated: [], undrawn: [] });
					host = undefined;
				}
			};
		}
	});

	return {
		plugin,
		refresh(view) {
			// An answer is held until a list arrives without its item.
			const answered = reviewKey.getState(view.state)?.answered;
			const listed = new Set(channel.items().map((item) => item.id));
			const prune = [...(answered?.keys() ?? [])].filter((id) => !listed.has(id));
			if (!prune.length) return view.setProps({});
			view.dispatch(
				view.state.tr
					.setMeta(reviewKey, { prune } satisfies ReviewMeta)
					.setMeta('addToHistory', false)
			);
		},
		elements(view, id) {
			return [...view.dom.querySelectorAll<HTMLElement>('[data-qm-review]')].filter(
				(el) => el.getAttribute('data-qm-review') === id
			);
		},
		answer: (id, action) => act(id, action, { quiet: true }),
		reopen(view, id) {
			if (reviewKey.getState(view.state)?.answered.get(id) === 'dismiss')
				view.dispatch(
					view.state.tr
						.setMeta(reviewKey, { answer: { id, to: undefined } } satisfies ReviewMeta)
						.setMeta('addToHistory', false)
				);
			channel.act(id, 'reopen');
		},
		undo: (view) => undo(view.state, view.dispatch),
		enter(view, id) {
			const span = drawn(view.state).spans.find((s) => s.id === id);
			if (!span) return false;
			const { doc, tr } = view.state;
			view.dispatch(
				tr
					.setSelection(Selection.near(doc.resolve(span.to), -1))
					.setMeta(reviewKey, { entered: id } satisfies ReviewMeta)
			);
			view.focus();
			return true;
		}
	};
}
