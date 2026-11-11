// Review, drawn in the leaf's own flow: what a writer other than the reader proposes to change
// here. An item names blocks by the ids the leaf's nodes carry, so its place is the document's and
// rides every edit; nothing is measured from outside the view.
//
// A proposal is the paragraph it would rewrite, read as an edit of itself: the words that would go
// struck, the words that would come tinted in their place, and what it adds beyond the paragraph
// set in flow under it. None of it enters the document while it is proposed: the struck words are
// the leaf's own text under a decoration, and every added word is a widget. A proposal taken is
// plain text, the leaf's like any other.
//
// A proposal is an edit of the paragraph as its writer read it, or as it stood when it arrived. What the reader
// writes in the paragraph since is theirs: the proposal's stretches ride past it, and only the
// words it would rewrite are struck, as the reader has them now.
//
// Taking a proposal is the leaf's own edit, made from the plan the drawing was made from, so the
// words that land are the words that were drawn. It goes down the lane a keystroke takes: one
// transaction, one undo step, one commit.
import { closeHistory, isHistoryTransaction, undo } from 'prosemirror-history';
import { DOMSerializer, Fragment, Mark, type Node as PMNode, type Schema } from 'prosemirror-model';
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
import { remoteKey } from './remote.js';
import { wordDiff, type DiffHunk } from './review-diff.js';

/**
 * One proposal over a prose leaf, by the blocks that place it.
 *
 * It reads the blocks `replace` names by id as rewritten to `after`, Markdown, where `''`
 * proposes their removal. Its blocks pair with the paragraphs in order, each drawn as an edit of the one
 * it pairs with while the two are one kind of block; past the first that is not, the paragraphs
 * left are struck whole and the blocks left are added after the outermost block holding the last
 * paragraph, or as the next items of its list. One that names where it adds, by `insert`, proposes new blocks the same way after the block it names, or before the leaf's
 * first; in a leaf that holds one empty paragraph it proposes that paragraph's text. A paragraph
 * takes one proposal that rewrites it and one that adds after it, and a later item of either kind
 * naming it draws nothing.
 *
 * `before` is the blocks `replace` names as the proposal's writer read them, Markdown: the
 * proposal is an edit of those, carried onto the blocks as they stand. Without it the proposal is
 * an edit of the blocks as they stood when the leaf first drew it.
 */
export type TextReview =
	| { id: string; replace: readonly string[]; before?: string; after: string }
	| { id: string; insert: BlockPlace; after: string };

/** Where a proposal adds blocks: after or before the block with the id, or at the leaf's end. */
export type BlockPlace = { after: string } | { before: string } | 'end';

/** What a reader did with a proposal: took it, which the leaf has written by the time it says
 *  so, turned it down, or undid an answer, so the item is open again with whatever was written
 *  for it taken back by the leaf's own undo. */
export type ReviewAction = 'accept' | 'dismiss' | 'reopen';

/** What brought an item under attention: the pointer over it, or the caret in it. */
export type ReviewVia = 'pointer' | 'caret';

/** What the plugin reads and reports through; every reader is live. */
export interface ReviewChannel {
	items(): readonly TextReview[];
	/** The item under attention, drawn a step stronger. */
	lit(): string | undefined;
	/** `after` as a document under the leaf's schema; `undefined` where it does not parse. */
	parse(markdown: string): PMNode | undefined;
	/** An answer the leaf gave or took back. */
	act(id: string, action: ReviewAction): void;
	/** The leaf is writing a taken proposal, and is done. */
	writing?(on: boolean): void;
	/** The item the pointer or the caret is in, `undefined` once it has left. */
	point(id: string | undefined, via: ReviewVia): void;
	/** What the leaf draws and what it holds and does not draw, on each change of either. */
	drew(report: ReviewReport): void;
}

/** Why a listed item the leaf holds draws nothing: `after` is not Markdown the leaf's schema
 *  holds, an earlier item has the paragraph, the text already reads as proposed, or no block it
 *  names by id stands in the leaf. */
export type LeafUndrawn = 'parse' | 'taken' | 'applied' | 'block';

/** What a leaf draws of the items it was handed. */
export interface ReviewReport {
	/** The ids drawn, in the order the items were listed. */
	ids: readonly string[];
	/** The drawn proposals the reader's own writing meets: words both changed, or a block one
	 *  names gone or no longer the block it read. */
	outdated: readonly string[];
	/** The items the leaf holds and does not draw, each with why: by the blocks it names,
	 *  which only the leaf holding its field is handed. */
	undrawn: readonly { id: string; reason: LeafUndrawn }[];
}

/** An answer the leaf holds: a proposal taken or turned down here, drawn no more. */
type Answer = 'accept' | 'dismiss';

/** The leaf's review state: the count of its own edits, so the caret's report can tell typing
 *  from arriving, the items answered here, and the item the caret was put into by its id, which
 *  the caret names while it stays where it was put. */
interface ReviewState {
	edits: number;
	answered: ReadonlyMap<string, Answer>;
	entered: string | undefined;
	/** The accepts an undo or a redo took back or gave again, for the plugin view to report. */
	replayed: readonly { id: string; to: 'accept' | undefined }[];
	/** The id the store gave each block it took again under a new one, by the id it had: a
	 *  block an undo puts back is the block a proposal named. */
	renamed: ReadonlyMap<string, string>;
}

/** What a transaction tells the review state: an answer given or taken back, the ids of
 *  answered items the host's list no longer holds, or the item the caret is put into. */
interface ReviewMeta {
	answer?: { id: string; to: Answer | undefined };
	prune?: readonly string[];
	entered?: string;
	renamed?: readonly (readonly [string, string])[];
}

const reviewKey = new PluginKey<ReviewState>('quill-review');

/** Tell the review layer the store took blocks under new ids, each `[was, now]`. */
export function renameBlocks(
	tr: Transaction,
	renamed: readonly (readonly [string, string])[]
): void {
	if (renamed.length) tr.setMeta(reviewKey, { renamed } satisfies ReviewMeta);
}

/** The id the block once named `id` stands under now. */
function nowOf(renamed: ReadonlyMap<string, string>, id: string): string {
	for (let hops = 0; hops < renamed.size && renamed.has(id); hops++) id = renamed.get(id)!;
	return id;
}

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
	tr.steps.forEach((step) => {
		if (!(step instanceof ReviewAnswer)) return;
		next = answering(next, step.id, step.to);
		// Reported whether or not the answer is still held: the host's list may have dropped it.
		if (history) next = { ...next, replayed: [...next.replayed, { id: step.id, to: step.to }] };
	});
	const meta = tr.getMeta(reviewKey) as ReviewMeta | undefined;
	if (meta?.answer) next = answering(next, meta.answer.id, meta.answer.to);
	for (const id of meta?.prune ?? []) next = answering(next, id, undefined);
	if (meta?.renamed) next = { ...next, renamed: new Map([...next.renamed, ...meta.renamed]) };
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

/** One drawn proposal: where the caret counts as in it, and whether it only adds after its
 *  paragraph. */
interface Span {
	id: string;
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

/** A decoration that reads differently on the lit item, made for one state or the other. */
type Lighting = { id: string; make: (on: boolean) => Decoration };

interface Drawn {
	/** In document order, those that read the lit item made on asking. */
	decos: (Decoration | Lighting)[];
	/** The items a decoration of which reads the lit one. */
	lighting: Set<string>;
	spans: Span[];
	/** Each drawn proposal's pieces, by its id. */
	plans: Map<string, Piece[]>;
	outdated: string[];
	undrawn: { id: string; reason: LeafUndrawn }[];
}

/** The edit that takes a proposal: its pieces, last first, so each still stands where it was
 *  read. `undefined` where the pieces no longer make a document the schema holds. */
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

/** A value of two nodes, kept while both are: a node an edit leaves alone is the same object
 *  after it, so a paragraph the reader did not touch is not diffed again. */
function byPair<T>(of: (a: PMNode, b: PMNode) => T): (a: PMNode, b: PMNode) => T {
	const kept = new WeakMap<PMNode, WeakMap<PMNode, T>>();
	return (a, b) => {
		let row = kept.get(a);
		if (!row) kept.set(a, (row = new WeakMap()));
		if (row.has(b)) return row.get(b)!;
		const value = of(a, b);
		row.set(b, value);
		return value;
	};
}

/** The hunks between two paired textblocks: their words', and inside the words they keep,
 *  each run whose formatting differs. */
const hunksOf = byPair((a: PMNode, b: PMNode): Hunk[] => {
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
});

/** What the reader wrote in a block since a proposal arrived over it. */
const sinceOf = byPair((was: PMNode, now: PMNode): DiffHunk[] =>
	was === now ? [] : wordDiff(textOf(was), textOf(now))
);

/** One stretch of a held block a proposal rewrites: `[at, end)` of the block as it stands, and
 *  the words that would stand there. */
interface Rewrite {
	at: number;
	end: number;
	content: Fragment;
}

/**
 * What `to` rewrites of a block that read `was` when the proposal was made and reads `now`. Each
 * stretch the proposal changes in `was` is carried through what was written since: words typed
 * at its edge stay outside it, and where a word it would rewrite was itself rewritten, the stretch
 * covers the rewriting. A stretch that already reads as proposed is left out.
 *
 * The block is `outdated` where the reader's writing meets a stretch the proposal changes, since
 * taking it would write over words the reader wrote. Where that writing reaches past the stretch,
 * the stretch carried onto words it was never computed against would write a sentence nobody
 * proposed, so the whole block as it now reads gives way to the whole proposed one.
 */
function rewrites(
	was: PMNode,
	now: PMNode,
	to: PMNode
): { outdated: boolean; stretches: Rewrite[] } {
	const since = sinceOf(was, now);
	const hunks = hunksOf(was, to);
	const meets = (s: DiffHunk, h: DiffHunk): boolean =>
		s.at === s.end
			? h.at < s.at && s.at < h.end
			: h.at === h.end
				? s.at < h.at && h.at < s.end
				: s.at < h.end && h.at < s.end;
	const past = since.some((s) =>
		hunks.some((h) => s.at < h.end && h.at < s.end && !(h.at <= s.at && s.end <= h.end))
	);
	if (past)
		return {
			outdated: true,
			stretches: [{ at: 0, end: now.content.size, content: to.content }]
		};
	const outdated = since.some((s) => hunks.some((h) => meets(s, h)));
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
	return { outdated, stretches: out };
}

/** {@link rewrites}, kept while its three blocks are. */
const rewritten = (() => {
	const kept = byPair(() => new WeakMap<PMNode, ReturnType<typeof rewrites>>());
	return (was: PMNode, now: PMNode, to: PMNode): ReturnType<typeof rewrites> => {
		const row = kept(was, now);
		let out = row.get(to);
		if (!out) row.set(to, (out = rewrites(was, now, to)));
		return out;
	};
})();

/** The blocks a proposal covered when it arrived, by its id, with the `after` it then held and
 *  the ids of the blocks that placed it. */
type Bases = Map<string, { after: string; place: readonly string[]; blocks: readonly PMNode[] }>;

/** The id of the stored block a leaf decodes from: a block island's own, any other's `id`. */
function blockOf(node: PMNode): string {
	return String((node.type.name === 'island_block' ? node.attrs.block : node.attrs.id) ?? '');
}

/** Where a proposal stands among the leaves: the ones it rewrites, the one it adds after, and
 *  whether it adds ahead of them all. `missing` where a block it names is gone, `'gone'` where
 *  no block it names stands. */
interface Place {
	cover: number[];
	beside: number;
	ahead: boolean;
	missing: boolean;
}

function placeOf(
	item: TextReview,
	leaves: readonly Leaf[],
	now: (id: string) => string
): Place | 'gone' {
	const index = (id: string): number => leaves.findIndex((leaf) => blockOf(leaf.node) === now(id));
	if ('replace' in item) {
		const named = new Set(item.replace.map(now));
		const cover = leaves.flatMap((leaf, i) => (named.has(blockOf(leaf.node)) ? [i] : []));
		if (!cover.length) return 'gone';
		const found = new Set(cover.map((i) => blockOf(leaves[i].node)));
		return { cover, beside: -1, ahead: false, missing: found.size < named.size };
	}
	const at = item.insert;
	let beside = leaves.length - 1;
	let ahead = false;
	if (at !== 'end') {
		const i = index('after' in at ? at.after : at.before);
		if (i < 0) return 'gone';
		if ('after' in at) beside = i;
		else if (i === 0) [beside, ahead] = [0, true];
		else beside = i - 1;
	}
	if (beside < 0) return 'gone';
	// A leaf of one empty paragraph is filled by what is added to it.
	const leaf = leaves[beside];
	if (leaves.length === 1 && leaf.node.isTextblock && !leaf.node.content.size)
		return { cover: [beside], beside, ahead: false, missing: false };
	return { cover: [], beside, ahead, missing: false };
}

/** The blocks a proposal's writer read, by the id each was read under; `undefined` where
 *  `before` does not read as one block for each id. */
const reads = new WeakMap<readonly string[], Map<string, Map<string, PMNode> | undefined>>();
function readOf(
	ids: readonly string[],
	before: string,
	channel: ReviewChannel
): Map<string, PMNode> | undefined {
	let row = reads.get(ids);
	if (!row) reads.set(ids, (row = new Map()));
	if (row.has(before)) return row.get(before);
	const doc = before.trim() ? channel.parse(before) : undefined;
	const blocks = doc ? leavesOf(doc) : [];
	const out =
		blocks.length === ids.length ? new Map(ids.map((id, k) => [id, blocks[k].node])) : undefined;
	row.set(before, out);
	return out;
}

function draw(state: EditorState, channel: ReviewChannel, bases: Bases): Drawn {
	const { answered, renamed } = reviewKey.getState(state)!;
	const now = (id: string): string => nowOf(renamed, id);
	const listed = channel.items();
	// A base outlives its item's answer and its leaving the list while a block it covered
	// stands, so a proposal brought back by an undo draws against the paragraph it first drew over.
	if (bases.size) {
		const ids = new Set(listed.map((item) => item.id));
		let blocks: Set<string> | undefined;
		const stands = (place: readonly string[]): boolean => {
			blocks ??= new Set(leavesOf(state.doc).map((leaf) => blockOf(leaf.node)));
			return place.some((id) => blocks!.has(id));
		};
		for (const [id, base] of bases) if (!ids.has(id) && !stands(base.place)) bases.delete(id);
	}
	const items = answered.size ? listed.filter((item) => !answered.has(item.id)) : listed;
	const plans = new Map<string, Piece[]>();
	const undrawn: Drawn['undrawn'] = [];
	const outdated: string[] = [];
	const decos: Drawn['decos'] = [];
	const lighting = new Set<string>();
	if (!items.length) return { decos, lighting, spans: [], plans, outdated, undrawn };
	const { doc } = state;
	const serializer = DOMSerializer.fromSchema(state.schema);
	const lights = (id: string, make: (on: boolean) => Decoration): void => {
		lighting.add(id);
		decos.push({ id, make });
	};
	const spans: Span[] = [];
	let leaves: Leaf[] | undefined;
	/** The paragraphs a proposal rewrites, and the places a proposal that only adds adds at:
	 *  a paragraph's end, or `-1` for the head of the leaf. */
	const taken = new Set<number>();
	const adding = new Set<number>();

	for (const item of items) {
		const name = { 'data-qm-review': item.id };

		leaves ??= leavesOf(doc);
		const at = placeOf(item, leaves, now);
		if (at === 'gone') {
			undrawn.push({ id: item.id, reason: 'block' });
			continue;
		}
		const { cover, beside, ahead } = at;
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
		let stale = at.missing;
		let base: readonly PMNode[];
		if ('replace' in item && item.before !== undefined) {
			const read = readOf(item.replace, item.before, channel);
			const named = new Map(item.replace.map((id) => [now(id), id]));
			const was = covered.map((leaf) => read?.get(named.get(blockOf(leaf.node)) ?? ''));
			stale ||= was.some((node) => !node);
			base = was.map((node, k) => node ?? covered[k].node);
		} else {
			const seen = bases.get(item.id);
			base =
				seen?.after === item.after && seen.blocks.length === covered.length
					? seen.blocks
					: covered.map((leaf) => leaf.node);
			bases.set(item.id, {
				after: item.after,
				place: covered.map((l) => blockOf(l.node)),
				blocks: base
			});
		}

		covered.forEach((leaf, k) => {
			const [lo, hi] = reach(leaf);
			const whole = k >= paired;
			lights(item.id, (on) =>
				Decoration.node(leaf.pos, leaf.pos + leaf.node.nodeSize, {
					class: ['qm-review-held', whole && 'qm-review-out', on && 'qm-review-lit']
						.filter(Boolean)
						.join(' ')
				})
			);
			if (whole) {
				// Taking it removes what the reader wrote in the block since it was read.
				stale ||= !base[k].content.eq(leaf.node.content);
				plan.push({
					from: leaf.pos,
					to: leaf.pos + leaf.node.nodeSize,
					content: Fragment.empty,
					lift: true
				});
			}
			if (!leaf.node.isTextblock) return;
			const strike = (from: number, to: number): void => {
				if (to > from)
					decos.push(
						Decoration.inline(from, to, { nodeName: 'del', class: 'qm-review-del', ...name })
					);
			};
			if (whole) return strike(lo, hi);
			const to = next[k].node;
			const read = base[k].type === leaf.node.type;
			stale ||= !read;
			const { outdated: past, stretches } = rewritten(read ? base[k] : leaf.node, leaf.node, to);
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
			lighting.delete(item.id);
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
			pieces.forEach((piece, n) => {
				lights(item.id, (on) =>
					Decoration.widget(
						piece.at,
						() => {
							const el = serializer.serializeNode(piece.node) as HTMLElement;
							el.classList.add('qm-review-add');
							if (on) el.classList.add('qm-review-lit');
							el.contentEditable = 'false';
							el.setAttribute('data-qm-review', item.id);
							return el;
						},
						{
							side: ahead ? -1000 + n : 1 + n,
							key: `add:${item.id}:${n}:${on}:${piece.node.toString()}`
						}
					)
				);
			});
		}

		// What a proposal only adds to has the caret anywhere in the block it adds from.
		spans.push({
			id: item.id,
			adds: !covered.length,
			from: reach(covered[0] ?? last)[0],
			to: reach(last)[1]
		});
	}
	return { decos, lighting, spans, plans, outdated, undrawn };
}

/** The item the caret is in: the one it was put into by its id while it holds the caret, else
 *  the one that holds it closest, so of a proposal that rewrites a paragraph and one that adds
 *  after it, the one that rewrites. */
function spanAt(
	spans: readonly Span[],
	pos: number,
	entered: string | undefined
): Span | undefined {
	let best: Span | undefined;
	for (const s of spans) {
		if (s.from > pos || pos > s.to) continue;
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
	/** Put the caret in item `id` and take the focus. False for an item the leaf does not
	 *  draw. */
	enter(view: EditorView, id: string): boolean;
	/** Answer item `id`, moving neither the caret nor the focus. False where the leaf does not
	 *  draw it or cannot write it. */
	answer(id: string, action: 'accept' | 'dismiss'): boolean;
	/** Open a dismissal of item `id` again and say so, the dismissal still held here or
	 *  already pruned by the host taking the item off its list. */
	reopen(view: EditorView, id: string): void;
	/** Undo the leaf's newest history step: an accept's, which reopens its item. */
	undo(view: EditorView): boolean;
}

/**
 * The leaf's review layer. The decorations are a function of the document and the channel's
 * items, kept until one of them moves. The caret's report holds off while the reader
 * types inside an item: an item is news on arriving in it, and noise under every keystroke.
 */
export function reviewLayer(channel: ReviewChannel): ReviewLayer {
	let memo:
		| {
				doc: PMNode;
				review: ReviewState;
				items: readonly TextReview[];
				drawn: Drawn;
		  }
		| undefined;
	/** The decorations of what is drawn, with the lit item they were made for. */
	let shown: { drawn: Drawn; lit: string | undefined; set: DecorationSet } | undefined;
	const NOTHING = JSON.stringify({ ids: [], outdated: [], undrawn: [] } satisfies ReviewReport);
	let reported = NOTHING;
	let host: EditorView | undefined;
	const bases: Bases = new Map();
	/** Answer an item, moving neither the caret nor the focus. Taking a proposal writes it
	 *  first, and one that can no longer be written stays as it is. */
	const act = (id: string, action: Answer): boolean => {
		const view = host;
		if (!view || !drawn(view.state).spans.some((span) => span.id === id)) return false;
		if (action === 'accept') {
			const plan = drawn(view.state).plans.get(id);
			const tr = plan && taking(view.state, plan);
			if (!tr || !plan) return false;
			channel.writing?.(true);
			try {
				view.dispatch(tr.step(new ReviewAnswer(id, 'accept')));
			} finally {
				channel.writing?.(false);
			}
		} else {
			view.dispatch(
				view.state.tr
					.setMeta(reviewKey, { answer: { id, to: 'dismiss' } } satisfies ReviewMeta)
					.setMeta('addToHistory', false)
			);
		}
		channel.act(id, action);
		return true;
	};
	const drawn = (state: EditorState): Drawn => {
		const review = reviewKey.getState(state)!;
		const items = channel.items();
		if (memo && memo.doc === state.doc && memo.review === review && memo.items === items)
			return memo.drawn;
		const next = draw(state, channel, bases);
		memo = { doc: state.doc, review, items, drawn: next };
		return next;
	};
	/** Whether the lit item moving to `lit` changes how anything here reads. */
	const relit = (lit: string | undefined): boolean =>
		!shown ||
		(shown.lit !== lit &&
			((shown.lit !== undefined && shown.drawn.lighting.has(shown.lit)) ||
				(lit !== undefined && shown.drawn.lighting.has(lit))));
	const decorations = (state: EditorState): DecorationSet => {
		const now = drawn(state);
		const lit = channel.lit();
		if (shown?.drawn === now && !relit(lit)) {
			shown.lit = lit;
			return shown.set;
		}
		const set = DecorationSet.create(
			state.doc,
			now.decos.map((d) => ('make' in d ? d.make(d.id === lit) : d))
		);
		shown = { drawn: now, lit, set };
		return set;
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

	const plugin = new Plugin<ReviewState>({
		key: reviewKey,
		state: {
			init: () => ({
				edits: 0,
				answered: new Map(),
				entered: undefined,
				replayed: [],
				renamed: new Map()
			}),
			apply: applyReview
		},
		props: {
			decorations,
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
			// Only the lit item moved, and nothing here reads it: the leaf is left alone.
			const lit = channel.lit();
			if (memo?.items === channel.items() && !relit(lit)) {
				if (shown) shown.lit = lit;
				return;
			}
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
		answer: act,
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
