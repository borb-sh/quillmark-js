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
import { closeHistory } from 'prosemirror-history';
import { DOMSerializer, Fragment, type Node as PMNode } from 'prosemirror-model';
import { keydownHandler } from 'prosemirror-keymap';
import {
	Plugin,
	PluginKey,
	Selection,
	type EditorState,
	type Transaction
} from 'prosemirror-state';
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
 * paragraph takes one proposal, and a later item naming it draws nothing.
 */
export type TextReview =
	| { id: string; state: 'changed'; anchor: string }
	| { id: string; state: 'proposed'; anchor: string; after: string };

/** What a reader did with an item: took a proposal, which the leaf has written by the time it
 *  says so, turned one down, or asked for a change back. */
export type ReviewAction = 'accept' | 'dismiss' | 'undo';

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
}

export const DEFAULT_REVIEW_STRINGS: ReviewStrings = {
	reviewAccept: 'Accept',
	reviewDismiss: 'Dismiss',
	reviewAcceptTitle: 'Accept',
	reviewDismissTitle: 'Dismiss',
	reviewProposal: 'Proposed change',
	reviewGone: 'Text removed here'
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
	act(id: string, action: ReviewAction): void;
	/** The item the pointer or the caret is in, `undefined` once it has left. */
	point(id: string | undefined, via: ReviewVia): void;
	/** The ids the leaf draws, on each change of the set. */
	drew(ids: readonly string[]): void;
}

/** Counts the leaf's own edits, so the caret's report can tell typing from arriving. */
const reviewKey = new PluginKey<number>('quill-review');

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

/** One drawn item: where the caret counts as in it, and whether it is a proposal. */
interface Span {
	id: string;
	proposed: boolean;
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

/** The hunks between two paired textblocks: their words', or where the words agree and the
 *  formatting does not, the one stretch that differs. */
function hunksOf(a: PMNode, b: PMNode): DiffHunk[] {
	const before = textOf(a);
	const after = textOf(b);
	if (before !== after) return wordDiff(before, after);
	const start = a.content.findDiffStart(b.content);
	if (start == null) return [];
	const end = a.content.findDiffEnd(b.content)!.a;
	const to = Math.max(start, end);
	return [{ at: Math.min(start, end), end: to, insert: after.slice(Math.min(start, end), to) }];
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
 */
function rewrites(was: PMNode, now: PMNode, to: PMNode): Rewrite[] {
	const since = was === now ? [] : wordDiff(textOf(was), textOf(now));
	const text = since.length ? textOf(now) : '';
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
	for (const hunk of hunksOf(was, to)) {
		const start = hunk.at + shift;
		shift += hunk.insert.length - (hunk.end - hunk.at);
		const at = through(hunk.at, 'start');
		const end = Math.max(at, through(hunk.end, 'end'));
		if (since.length && text.slice(at, end) === hunk.insert) continue;
		out.push({ at, end, content: to.content.cut(start, start + hunk.insert.length) });
	}
	return out;
}

/** A reader's answer to an item, from a button or a chord. */
type Act = (id: string, action: ReviewAction) => void;

function button(
	act: Act,
	id: string,
	action: 'accept' | 'dismiss',
	label: string,
	title: string
): HTMLButtonElement {
	const el = document.createElement('button');
	el.type = 'button';
	el.tabIndex = -1;
	el.className = `qm-review-act qm-review-${action}`;
	el.textContent = label;
	el.title = title;
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
function chip(strings: ReviewStrings, act: Act, id: string, row: boolean): HTMLElement {
	const el = document.createElement(row ? 'div' : 'span');
	el.className = row ? 'qm-review-chip qm-review-chip-row' : 'qm-review-chip';
	el.contentEditable = 'false';
	el.setAttribute('data-qm-review', id);
	el.setAttribute('role', 'group');
	el.setAttribute('aria-label', strings.reviewProposal);
	const acts = document.createElement('span');
	acts.className = 'qm-review-acts';
	acts.append(
		button(act, id, 'accept', strings.reviewAccept, strings.reviewAcceptTitle),
		button(act, id, 'dismiss', strings.reviewDismiss, strings.reviewDismissTitle)
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

/** The blocks a proposal covered when it arrived, by its id, with the `after` it then held. */
type Bases = Map<string, { after: string; blocks: PMNode[] }>;

function draw(
	state: EditorState,
	channel: ReviewChannel,
	act: Act,
	answered: ReadonlySet<string>,
	bases: Bases
): Drawn {
	const items = channel.items().filter((item) => !answered.has(item.id));
	const plans = new Map<string, Piece[]>();
	if (!items.length) return { set: DecorationSet.empty, spans: [], plans };
	const { doc } = state;
	const anchors = new Map(channel.anchors(state).map((a) => [a.id, a]));
	const lit = channel.lit();
	const strings = channel.strings();
	const serializer = DOMSerializer.fromSchema(state.schema);
	const decos: Decoration[] = [];
	const spans: Span[] = [];
	let leaves: Leaf[] | undefined;
	const taken = new Set<number>();

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
		if (cover.some((i) => taken.has(i))) continue;

		const proposed = item.after.trim() ? channel.parse(item.after) : undefined;
		if (item.after.trim() && !proposed) continue;
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
		for (const i of cover) taken.add(i);
		const plan: Piece[] = [];
		plans.set(item.id, plan);
		const seen = bases.get(item.id);
		const base =
			seen?.after === item.after && seen.blocks.length === covered.length
				? seen.blocks
				: covered.map((leaf) => leaf.node);
		bases.set(item.id, { after: item.after, blocks: base });

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
			rewrites(was, leaf.node, to).forEach(({ at, end, content }, n) => {
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

		const last = covered.at(-1) ?? leaves[beside];
		const $last = doc.resolve(last.pos);
		/** Past the outermost block holding the last one, or the head of the leaf. */
		const outer = ahead ? 0 : $last.depth ? $last.after(1) : last.pos + last.node.nodeSize;
		const row = (): void => {
			decos.push(
				Decoration.widget(outer, () => chip(strings, act, item.id, true), {
					side: ahead ? -1 : 9999,
					key: `chip:${item.id}:row`,
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
							if (holds) lastLine(el)?.append(chip(strings, act, item.id, false));
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
				Decoration.widget(reach(last)[1], () => chip(strings, act, item.id, false), {
					side: 1,
					key: `chip:${item.id}`,
					stopEvent: () => true
				})
			);
		} else row();

		// What a proposal only adds to has the caret anywhere in the block it adds from.
		spans.push({
			id: item.id,
			proposed: true,
			from: reach(covered[0] ?? last)[0],
			to: reach(last)[1]
		});
	}
	return { set: DecorationSet.create(doc, decos), spans, plans };
}

/** Whether a block's last leaf is a textblock, so its last line can carry a run. */
function endsInLine(node: PMNode): boolean {
	let at: PMNode = node;
	while (!at.isTextblock && !at.isAtom && at.lastChild) at = at.lastChild;
	return at.isTextblock;
}

/** The item the caret is in: the one that holds it closest, so a change inside a paragraph a
 *  proposal covers is the change while the caret is in its words. `proposed` asks for the
 *  proposal alone. */
function spanAt(spans: readonly Span[], pos: number, proposed = false): Span | undefined {
	let best: Span | undefined;
	for (const s of spans) {
		if (s.from > pos || pos > s.to || (proposed && !s.proposed)) continue;
		if (!best || s.to - s.from < best.to - best.from) best = s;
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
				anchors: readonly AnchorPos[];
				items: readonly TextReview[];
				lit: string | undefined;
				strings: ReviewStrings;
				drawn: Drawn;
		  }
		| undefined;
	let drewIds = '';
	let host: EditorView | undefined;
	/** The items answered here, drawn no more: an answer shows at once, whenever the list that
	 *  held the item is next handed over. */
	const answered = new Set<string>();
	const bases: Bases = new Map();
	/** Answer an item. Taking a proposal writes it first, and one that can no longer be written
	 *  stays as it is. A proposal taken by a press while the focus is elsewhere leaves the caret
	 *  after what landed, in a focused leaf: the edit is the reader's, and so is its undo. */
	const act: Act = (id, action) => {
		const view = host;
		if (!view) return;
		if (action === 'accept') {
			const plan = drawn(view.state).plans.get(id);
			const tr = plan && taking(view.state, plan);
			if (!tr || !plan) return;
			const away = !view.hasFocus();
			if (away) {
				const end = tr.mapping.map(Math.max(...plan.map((piece) => piece.to)), 1);
				tr.setSelection(Selection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size)), -1));
			}
			answered.add(id);
			memo = undefined;
			view.dispatch(tr);
			if (away) view.focus();
		} else {
			answered.add(id);
			memo = undefined;
			view.setProps({});
		}
		channel.act(id, action);
	};
	const drawn = (state: EditorState): Drawn => {
		const anchors = channel.anchors(state);
		const items = channel.items();
		if (memo?.items !== items) {
			const listed = new Set(items.map((item) => item.id));
			for (const id of answered) if (!listed.has(id)) answered.delete(id);
			for (const id of bases.keys()) if (!listed.has(id)) bases.delete(id);
		}
		const lit = channel.lit();
		const strings = channel.strings();
		if (
			memo &&
			memo.doc === state.doc &&
			memo.anchors === anchors &&
			memo.items === items &&
			memo.lit === lit &&
			memo.strings === strings
		)
			return memo.drawn;
		const next = draw(state, channel, act, answered, bases);
		memo = { doc: state.doc, anchors, items, lit, strings, drawn: next };
		const ids = next.spans.map((s) => s.id);
		const joined = ids.join('\u0000');
		if (joined !== drewIds) {
			drewIds = joined;
			channel.drew(ids);
		}
		return next;
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
				? spanAt(drawn(view.state).spans, selection.head)?.id
				: undefined;
		if (at !== muted) muted = undefined;
		if (typed && at) muted = at;
		const next = at === muted ? undefined : at;
		if (next === caret) return;
		caret = next;
		channel.point(next, 'caret');
	};

	const answer =
		(action: 'accept' | 'reject') =>
		(state: EditorState): boolean => {
			const span = spanAt(drawn(state).spans, state.selection.head, action === 'accept');
			if (!span) return false;
			act(span.id, span.proposed ? (action === 'accept' ? 'accept' : 'dismiss') : 'undo');
			return true;
		};
	/** Escape lowers the card over the item the caret is in, before it is anything else's. */
	const lower = (state: EditorState): boolean => {
		const id = channel.shown();
		if (id === undefined || !drawn(state).spans.some((span) => span.id === id)) return false;
		channel.dismiss();
		return true;
	};

	const plugin = new Plugin<number>({
		key: reviewKey,
		state: {
			init: () => 0,
			apply: (tr, edits) => (tr.docChanged && !tr.getMeta(remoteKey) ? edits + 1 : edits)
		},
		props: {
			decorations: (state) => drawn(state).set,
			handleKeyDown: keydownHandler({
				[REVIEW_KEYS.accept]: answer('accept'),
				[REVIEW_KEYS.reject]: answer('reject'),
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
			return {
				update(view, prev) {
					follow(view, reviewKey.getState(prev) !== reviewKey.getState(view.state));
				},
				destroy() {
					if (hovered !== undefined) channel.point(undefined, 'pointer');
					if (caret !== undefined) channel.point(undefined, 'caret');
					if (drewIds) channel.drew([]);
					host = undefined;
				}
			};
		}
	});

	return {
		plugin,
		refresh(view) {
			view.setProps({});
		},
		elements(view, id) {
			return [...view.dom.querySelectorAll<HTMLElement>('[data-qm-review]')].filter(
				(el) => el.getAttribute('data-qm-review') === id
			);
		},
		enter(view, id) {
			const span = drawn(view.state).spans.find((s) => s.id === id);
			if (!span) return false;
			const { doc, tr } = view.state;
			view.dispatch(tr.setSelection(Selection.near(doc.resolve(span.to), -1)));
			view.focus();
			return true;
		}
	};
}
