// Writes made from an older state: an edit computed against the document as someone read it,
// merged into the state that has moved on since.
//
// A writer that takes seconds to answer, a model above all, reads the document at one revision
// and answers after people have typed past it. Applying its answer to the live Document would
// revert their typing wherever the answer differs. Instead the answer is applied where it was
// computed: the Y state at the base is rebuilt from history, a scratch Document is bound to it,
// the edit runs there, and the binding writes the fewest operations that carry it (I2). The
// update that results is an ordinary concurrent edit, which Yjs merges with whatever came after.
//
// History is a `Y.Doc` with garbage collection off: a state at an older snapshot can only be
// rebuilt from one that kept the content deleted since.
import * as Y from 'yjs';
import type {
	Addr,
	AuthoringCard,
	Card,
	CardInput,
	Content,
	Document,
	Quill
} from '@quillmark/wasm';
import { bindWith, cardOps, Diverged, formOf, type CardOp, type CardRef } from './document.js';
import { changedRuns, commonRun, meet, type Run } from './lines.js';
import {
	BODY,
	CARDS,
	MAIN,
	SLOT,
	canonical,
	contentRoot,
	contentTypes,
	present,
	readField,
	type YField
} from './shape.js';
import { islandWithoutAnchors } from './write.js';
import { blocksOf, fieldTokens, tokenRuns, wordsMeet } from './words.js';
import { sliceBlocks, spliceBlocks, spliceLines, textLines, type BlockSplice } from './blocks.js';
import { project as projectField } from './project.js';
import { core } from './core.js';

/** What differs between two states of one session, by the cards' place in each. A card moved
 *  is named by `from`, its index in the older state, and `at`, its index in the newer one, and
 *  every composable card also by `id`, its `$id` in the state that names it first. */
export type Change =
	| { type: 'insert'; at: number; id: string; card: AuthoringCard }
	| { type: 'remove'; from: number; id: string }
	| { type: 'move'; from: number; at: number; id: string }
	| { type: 'kind'; from: number; at: number; id: string; before: string; after: string }
	| {
			type: 'field';
			from: CardRef;
			at: CardRef;
			/** The card's `$id`; absent for the main card. */
			id?: string;
			/** The field's name; absent for the body. */
			field?: string;
			/** The value in the authoring form, a content field as Markdown; absent where the
			 *  field is. */
			before?: unknown;
			after?: unknown;
			/** Where both values are text: each run of lines that differs, from line `line` of
			 *  `before`, for a reader that needs the change and not the whole field. */
			hunks?: { line: number; before: string; after: string }[];
	  };

export interface ForkOpts {
	/** The session's Y state, garbage collection off, holding at least everything up to `base`. */
	history: Y.Doc;
	/** `Y.encodeSnapshot` of the state the writer read. */
	base: Uint8Array;
	quill: Quill;
	/** A Document of the room, for what has no Y form. Read, not changed. */
	doc: Document;
}

export interface WriteFromOpts extends ForkOpts {
	/** Make the edit on the Document as it stood at `base`. An edit that inserts, removes or
	 *  moves cards returns those operations, in the order it made them, and makes no other
	 *  card-list change. Where part of it is held, the edit runs a second time, on a fresh
	 *  Document at `base`, and must make the same change there, or `Unwritable` is thrown. */
	edit(doc: Document): CardOp | CardOp[] | void;
	/** Where an edit to a text meets one made since: `word`, where the words they changed touch,
	 *  or `line`, where they change one line. Default `word`. */
	scope?: 'word' | 'line';
	/** What becomes of the part of the edit that meets a change made since: `none` writes it and
	 *  reports the change it met in `conflicts`; `hunk` holds back each run of lines that meets
	 *  one and writes the rest; `field` holds back each field that meets one. A whole-value field
	 *  is held whole, and so is everything the edit did to a card that one side removed, moved or
	 *  retyped while the other changed it. Default `none`. */
	hold?: 'none' | 'hunk' | 'field';
}

export interface Written {
	/** The edit as a Y update, to apply to the session or append to its log. */
	update: Uint8Array;
	/** What the update changes, from `base`. */
	changes: Change[];
	/** What changed in `history` since `base` at a place the update changes too: words or lines
	 *  of a text both wrote (`scope`), a field both set, a card both moved, or a card one side
	 *  removed or retyped that the other changed. A writer that rewrote words from their old text
	 *  would merge into text it never read. A part `hold` held back is not here but in `held`. */
	conflicts: Change[];
	/** The parts of the edit held back: runs of lines of a text, whole-value fields, and cards. */
	held: Held[];
}

/** A Y relative position in its JSON form, `Y.relativePositionToJSON`'s. */
export type HeldPosition = Record<string, unknown>;

/**
 * A part of an edit `writeFrom` held back. Every held part is plain JSON, so a host can keep it,
 * send it, and read it back. It belongs to the session it was made in: its places are Y names
 * and positions of that session's state, so a host drops it when the session ends.
 */
export type Held = HeldText | HeldValue | HeldCard;

/** A run of lines of a text field (or body) the edit changed and did not write. */
export interface HeldText {
	type: 'text';
	/** The card, by its index at `base` and after the edit, and its `$id`; `field` is absent for
	 *  the body. */
	from: CardRef;
	at: CardRef;
	id?: string;
	field?: string;
	/** The lines as the edit read them, as `history` held them when the write was made, and as
	 *  the edit wrote them: Markdown, or the text of a plain field. */
	before: string;
	theirs: string;
	after: string;
	/** Where the lines sit, as relative positions into the field's Y root on the line breaks
	 *  around them, so they are found again whatever is written around and in them. `end` is
	 *  absent where the edit only inserted lines, and `tail` says those come after the last line. */
	span: { root: string; start: HeldPosition; end?: HeldPosition; tail?: boolean };
	/** The edit's value for the field and the run of its lines to write. */
	proposal: { value: Content | string; from: number; to: number };
}

/** A whole-value field the edit set and did not write. */
export interface HeldValue {
	type: 'value';
	from: CardRef;
	at: CardRef;
	id?: string;
	field: string;
	/** The card's Y name. */
	card: string;
	/** The value as the edit read it, as `history` held it when the write was made, and as the
	 *  edit set it, in the authoring form; absent where the field is. */
	before?: unknown;
	theirs?: unknown;
	after?: unknown;
	/** The edit's value as stored, which `writeHeld` writes; absent where the edit removed it. */
	proposal?: unknown;
}

/** A composable card the edit removed, moved, retyped or wrote into, held whole because one side
 *  removed, moved or retyped it while the other changed it. */
export interface HeldCard {
	type: 'card';
	/** The card's index at `base`, and after the edit where the edit kept it. */
	from: number;
	at?: number;
	/** The card's `$id` at `base`, and its Y name. */
	id: string;
	card: string;
	/** The card as the edit read it, as `history` held it when the write was made (absent where
	 *  it was removed), and as the edit left it (absent where the edit removed it). */
	before: AuthoringCard;
	theirs?: AuthoringCard;
	after?: AuthoringCard;
	/** The edit's card as stored, and the Y names of the cards it followed in the edit's order,
	 *  nearest first; absent where the edit removed it. */
	proposal?: { card: Card; follows: string[] };
}

/** Where a held part stands now: `open`, as when it was held; `edited`, changed since; `matched`,
 *  reading as the edit would have written it; `gone`, its text or card removed. A held removal
 *  is `matched` once the card is gone. */
export interface HeldState {
	state: 'open' | 'edited' | 'matched' | 'gone';
	/** The held lines as they read now, a held value or card in the authoring form; absent when
	 *  gone. */
	current?: unknown;
}

/** An edit the session cannot carry: a card-list change without its operation, or a write to a
 *  field the session holds a value there the Document refused. Nothing was written. */
export class Unwritable extends Error {}

/**
 * Make `edit` from `base` and return it as an update that merges with `history`. The update is
 * checked before it is returned: the state it projects to differs from `base` exactly as the
 * edited Document does, or `Unwritable` is thrown.
 */
export function writeFrom(opts: WriteFromOpts): Written {
	const how = { scope: opts.scope ?? 'word', hold: opts.hold ?? 'none' } as const;
	const edit = (doc: Document) => opts.edit(doc);
	const first = attempt(opts, edit, how);
	if (!first.holds) return first.written;
	return attempt(opts, edit, how, { plans: first.holds, made: first.made }).written;
}

/** What `writeHeld` and `heldState` read a held part against: the session's Y state as it
 *  stands, the quill, and a Document of the room for what has no Y form. */
export type HeldOpts = Omit<ForkOpts, 'base'>;

/** Write a part `writeFrom` held over what its place holds now: the lines it spans, wherever
 *  they have moved and whatever was typed in them since, take the edit's lines; a whole value
 *  takes the edit's value; a card takes the edit's card, in the place the edit gave it, or is
 *  removed. Throws `Unwritable` where the part is gone. */
export function writeHeld(held: Held, opts: HeldOpts): Written {
	const { quill } = opts;
	const base = Y.encodeSnapshot(Y.snapshot(opts.history));
	const where = held.type === 'text' ? found(held, opts.history) : undefined;
	if (held.type === 'text' && !where) throw new Unwritable('the held lines are gone');
	const name = held.type === 'text' ? cardName(held.span.root) : held.card;
	return attempt(
		{ ...opts, base },
		(doc, ids) => {
			const c = name === MAIN ? MAIN : ids.indexOf(name);
			if (held.type === 'card') return writeCard(doc, ids, held, c as number);
			if (c === -1) throw new Unwritable('the held part’s card is gone');
			const addr = addrOf(c, held.field);
			if (held.type === 'value') {
				if (held.proposal === undefined) doc.removeField(addr);
				else doc.unchecked.storeField(addr, held.proposal);
				return;
			}
			const { value, from, to } = held.proposal;
			const run = { at: where!.blocks[0], end: where!.blocks[1], from, to };
			const now = doc.getStored(addr);
			if (typeof value === 'string' && typeof now === 'string')
				doc.unchecked.storeField(addr, spliceLines(now, value, [run]));
			else if (isContent(value) && isContent(now))
				doc.replace(idAddr(doc, addr), spliceBlocks(now, value, [run]));
			else if (isContent(value) && typeof now === 'string') {
				const content = quill.reader(doc).getContent(addr);
				if (!content) throw new Unwritable('the held field changed form');
				doc.unchecked.storeField(addr, spliceBlocks(content, value, [run]));
			} else throw new Unwritable('the held field changed form');
		},
		{ scope: 'word', hold: 'none' }
	).written;
}

/** Write a held card over card `c` of `doc`: remove it, or give it the edit's card and move it
 *  after the first card it followed in the edit that is still there. */
function writeCard(doc: Document, ids: readonly string[], held: HeldCard, c: number): CardOp[] {
	if (!held.proposal) {
		if (c === -1) return [];
		doc.removeCard(c);
		return [{ op: 'remove', at: c }];
	}
	if (c === -1) throw new Unwritable('the held card is gone');
	const id = doc.card(c).id ?? held.id;
	doc.removeCard(c);
	doc.unchecked.insertCard(inputOf(held.proposal.card, id), c);
	const rest = ids.filter((n) => n !== held.card);
	const lead = held.proposal.follows.find((n) => rest.includes(n));
	const to = lead === undefined ? 0 : rest.indexOf(lead) + 1;
	if (to === c) return [];
	doc.moveCard(c, to);
	return [{ op: 'move', from: c, to }];
}

/** Where a held part stands in `history` now. */
export function heldState(held: Held, opts: HeldOpts): HeldState {
	const { history } = opts;
	if (held.type === 'text') {
		const where = found(held, history);
		if (!where) return { state: 'gone' };
		const current = linesOf(where.field, where.plain, where.blocks[0], where.blocks[1]);
		return { state: stateOf(current, held.after, held.theirs), current };
	}
	const now = current(history, opts.quill, opts.doc);
	const c = held.card === MAIN ? MAIN : now.ids.indexOf(held.card);
	if (held.type === 'value') {
		if (c === -1) return { state: 'gone' };
		const card = c === MAIN ? now.main : now.cards[c];
		const current = card.fields?.[held.field] ?? undefined;
		return { state: stateOf(current, held.after, held.theirs), current };
	}
	if (c === -1) return { state: held.proposal ? 'gone' : 'matched' };
	const card = now.cards[c as number];
	if (!held.proposal) return { state: stateOf(card, undefined, held.theirs), current: card };
	const placed = (() => {
		const rest = now.ids.filter((n) => n !== held.card);
		const lead = held.proposal.follows.find((n) => rest.includes(n));
		return (lead === undefined ? 0 : rest.indexOf(lead) + 1) === c;
	})();
	const state = stateOf(card, placed ? held.after : undefined, held.theirs);
	return { state, current: card };
}

function stateOf(current: unknown, after: unknown, theirs: unknown): HeldState['state'] {
	if (canonical(current ?? null) === canonical(after ?? null)) return 'matched';
	return canonical(current ?? null) === canonical(theirs ?? null) ? 'open' : 'edited';
}

/** A stored card as an insert takes it, under `id`. */
const inputOf = (card: Card, id: string): CardInput => {
	const { kind, ext, seed, payloadItems, body } = card;
	return { kind, id, payloadItems, body, ...(ext ? { ext } : {}), ...(seed ? { seed } : {}) };
};

const isContent = (v: unknown): v is Content =>
	!!v && typeof v === 'object' && 'blocks' in v && 'text' in v;

/** Where a held text sits now, where its field still holds the form it was held in. */
function found(held: HeldText, history: Y.Doc): ReturnType<typeof resolve> {
	const where = resolve(held.span, history);
	return where && where.plain === (typeof held.proposal.value === 'string') ? where : undefined;
}

const cardName = (root: string): string => root.slice(0, root.indexOf('/'));

function cardPresent(name: string, history: Y.Doc): boolean {
	return name === MAIN || history.getArray<string>(CARDS).toArray().includes(name);
}

const addrOf = (c: CardRef, field?: string): Addr => ({
	...(c === MAIN ? {} : { card: c }),
	...(field === undefined ? {} : { field })
});

/** `addr` naming its card by `$id`, as a content write takes it. */
const idAddr = (doc: Document, addr: Addr): Addr =>
	typeof addr.card === 'number' ? { ...addr, card: doc.card(addr.card).id } : addr;

/** The blocks a held span covers in `history` now, `[first, end)`, with the field they are in;
 *  undefined where its card or its text is gone. */
function resolve(
	span: HeldText['span'],
	history: Y.Doc
): { blocks: [number, number]; field: YField; plain: boolean } | undefined {
	const name = cardName(span.root);
	if (!history.share.has(span.root) || !cardPresent(name, history)) return undefined;
	const key = span.root.slice(name.length + 1);
	const form = key === BODY ? 'content' : history.getMap<unknown>(name).get(present(key));
	if (form !== 'content' && form !== 'plain') return undefined;
	const field = readField(contentTypes(history, span.root));
	const plain = form === 'plain';
	const at = (rel: HeldPosition) =>
		Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(rel), history);
	const start = at(span.start);
	if (!start) return undefined;
	const lineAt = (unit: number) => {
		let u = 0;
		let line = 0;
		for (const ch of field.chars) {
			if (u >= unit) break;
			if (ch === '\n') line++;
			u += ch.length;
		}
		return line;
	};
	if (!span.end) {
		const b = span.tail ? field.blocks.length : lineAt(start.index);
		return { blocks: [b, b], field, plain };
	}
	const end = at(span.end);
	if (!end || end.index <= start.index) return undefined;
	return { blocks: [lineAt(start.index), lineAt(end.index) + 1], field, plain };
}

/** Blocks `[from, to)` of a field as a held part reads them: Markdown, or a plain field's text. */
function linesOf(field: YField, plain: boolean, from: number, to: number): string {
	if (plain) return textLines(field.chars.join('')).slice(from, to).join('').replace(/\n$/, '');
	return markdown(sliceBlocks(projectField(field).content, from, to));
}

function markdown(content: Content): string {
	if (!content.blocks.length) return '';
	return content.codec === 'plain' ? content.text : (core().exportMarkdown(content) as string);
}

/** A field change of the edit that meets a change made since, and what of it to hold. */
interface FieldPlan {
	kind: 'field';
	from: CardRef;
	at: CardRef;
	field?: string;
	/** Runs of lines of a text to hold, or the whole field. */
	runs: Run[] | 'whole';
	mine: FieldChange;
	theirs: FieldChange;
}

/** A card one side removed, moved or retyped while the other changed it: everything the edit did
 *  to it is held. `at` is its index after the edit, absent where the edit removed it. */
interface CardPlan {
	kind: 'card';
	from: number;
	at?: number;
	moved: boolean;
}

type Plan = FieldPlan | CardPlan;

/** A second attempt: what to hold, and what the edit made the first time, which it makes again. */
interface Again {
	plans: Plan[];
	made: string;
}

interface How {
	scope: 'word' | 'line';
	hold: 'none' | 'hunk' | 'field';
}

/**
 * Rebuild `base`, make `edit` there, hold back what `again` names, and write the rest. Without
 * `again`, a hold mode that meets changes made since answers the plans for a second attempt.
 */
function attempt(
	opts: ForkOpts,
	edit: (doc: Document, ids: readonly string[]) => CardOp | CardOp[] | void,
	how: How,
	again?: Again
): { written: Written; holds?: Plan[]; made: string } {
	const { quill } = opts;
	const at = Y.decodeSnapshot(opts.base);
	const scratch = Y.createDocFromSnapshot(opts.history, at, new Y.Doc({ gc: false }));
	let base: Bound | undefined;
	let pristine: Document | undefined;
	try {
		base = bind(scratch, quill, opts.doc);
		const bound = base;
		const before = state(bound, quill);
		const count = bound.doc.cardCount;
		if (again) pristine = bound.doc.clone();
		const result = edit(bound.doc, bound.binding.ids) ?? [];
		let ops = Array.isArray(result) ? result : [result];
		const step = bound.doc.cardCount - count;
		const named = ops.reduce((n, o) => n + (o.op === 'insert' ? 1 : o.op === 'remove' ? -1 : 0), 0);
		if (step !== named)
			throw new Unwritable(
				`the edit changed the card count by ${step} and its card operations by ${named}`
			);
		const made = () => canonical({ doc: quill.toAuthoring(bound.doc), ops });
		const held: Held[] = [];
		if (again && pristine) {
			if (made() !== again.made)
				throw new Unwritable('the edit made another change when it ran again');
			ops = hold(bound.doc, pristine, again.plans, ops, count, before, scratch, opts, held);
		}
		const touched = new Map<string, { root: string; base?: YField }>();
		for (const key of before.lines.keys()) {
			const slash = key.indexOf('/');
			const c = key.slice(0, slash);
			const field = key.slice(slash + 1) || undefined;
			const root = rootOf(c === MAIN ? MAIN : Number(c), field, before);
			const base = scratch.share.has(root) ? readField(contentTypes(scratch, root)) : undefined;
			touched.set(key, { root, base });
		}
		bound.binding.push(ops);
		const changes = diff(before, state(bound, quill));
		if (bound.binding.holding) {
			const landed = diff(before, project(scratch, quill, opts.doc));
			if (canonical(landed) !== canonical(changes))
				throw new Unwritable(
					'the edit touched a card or field the session holds a refused value in'
				);
		}
		const update = Y.encodeStateAsUpdate(scratch, Y.encodeStateVector(at.sv));
		const moved = diff(before, current(opts.history, quill, opts.doc));
		const holding = how.hold !== 'none' && !again;
		const mineCards = cardsOf(changes);
		const cards = new Map<number, CardPlan>();
		const fields: FieldPlan[] = [];
		const conflicts = overlap(changes, moved).filter((theirs) => {
			const c = cardMet(theirs, mineCards);
			if (holding && c !== undefined) {
				const { at, moved } = mineCards.get(c)!;
				cards.set(c, { kind: 'card', from: c, ...(at === undefined ? {} : { at }), moved });
				return false;
			}
			if (theirs.type !== 'field') return true;
			const mine = changes.find(
				(c): c is FieldChange =>
					c.type === 'field' && c.from === theirs.from && c.field === theirs.field
			);
			if (!mine) return true;
			const lines = before.lines.get(`${mine.from}/${mine.field ?? ''}`)?.length;
			const where = touched.get(`${mine.from}/${mine.field ?? ''}`);
			const runs = meeting(mine, theirs, how.scope, lines, where, scratch, opts.history);
			if (runs !== 'whole' && !runs.length) return false;
			if (!holding) return true;
			const whole = how.hold === 'field' || runs === 'whole';
			const plan = { from: mine.from, at: mine.at, field: mine.field, mine, theirs };
			fields.push({ kind: 'field', ...plan, runs: whole ? 'whole' : runs });
			return false;
		});
		const plans: Plan[] = [
			...fields.filter((p) => typeof p.from !== 'number' || !cards.has(p.from)),
			...cards.values()
		];
		const written = { update, changes, conflicts, held };
		return plans.length ? { written, holds: plans, made: made() } : { written, made: '' };
	} finally {
		pristine?.free();
		base?.free();
		scratch.destroy();
	}
}

/** What the edit did to each card of `base` it kept or removed: its index after the edit, absent
 *  where it removed the card, whether it moved it, and whether it removed or retyped it. */
function cardsOf(changes: Change[]): Map<number, { at?: number; moved: boolean; whole: boolean }> {
	const out = new Map<number, { at?: number; moved: boolean; whole: boolean }>();
	for (const c of changes) {
		if (c.type === 'insert' || c.from === MAIN) continue;
		const card = out.get(c.from) ?? { moved: false, whole: false };
		if (c.type === 'remove') card.whole = true;
		else card.at = c.at as number;
		if (c.type === 'move') card.moved = true;
		if (c.type === 'kind') card.whole = true;
		out.set(c.from, card);
	}
	return out;
}

/** The card a conflict is over as a whole, where it is: one side removed, moved or retyped it
 *  while the other changed it. */
function cardMet(
	theirs: Change,
	mine: Map<number, { at?: number; moved: boolean; whole: boolean }>
): number | undefined {
	if (theirs.type === 'insert' || !mine.has(theirs.from as number)) return undefined;
	if (theirs.type !== 'field') return theirs.from;
	return mine.get(theirs.from as number)!.whole ? (theirs.from as number) : undefined;
}

/**
 * Put back on `doc`, the edited Document, what `plans` hold, from `pristine`, the Document at
 * `base`, and add each held part to `held`. Returns the card operations that take `base` to the
 * Document that results.
 */
function hold(
	doc: Document,
	pristine: Document,
	plans: Plan[],
	ops: CardOp[],
	count: number,
	before: State,
	scratch: Y.Doc,
	opts: ForkOpts,
	held: Held[]
): CardOp[] {
	const cards = plans.filter((p): p is CardPlan => p.kind === 'card');
	const fields = plans.filter((p): p is FieldPlan => p.kind === 'field');
	const order = placesOf(count, ops);
	const authored = opts.quill.toAuthoring(doc).cards ?? [];
	const edits = cards.map((p) =>
		p.at === undefined
			? undefined
			: {
					card: structuredClone(doc.card(p.at)),
					after: authoring(authored[p.at]),
					follows: order
						.slice(0, p.at)
						.reverse()
						.flatMap((b) => (b === null ? [] : [before.ids[b]]))
				}
	);
	const proposals = fields.map((p) => doc.getStored(addrOf(p.at, p.field)));
	const was = (c: number) => inputOf(pristine.card(c), pristine.card(c).id!);
	for (const p of cards) {
		if (p.at === undefined) continue;
		doc.removeCard(p.at);
		doc.unchecked.insertCard(was(p.from), p.at);
	}
	for (const p of fields) restore(doc, pristine, p);
	let reordered = false;
	for (const p of cards) {
		if (p.at !== undefined && !p.moved) continue;
		const c = p.from;
		const now = order.indexOf(c);
		if (now >= 0) order.splice(now, 1);
		let to = 0;
		for (let b = c - 1; b >= 0; b--) {
			const k = order.indexOf(b);
			if (k >= 0) {
				to = k + 1;
				break;
			}
		}
		order.splice(to, 0, c);
		if (now === -1) doc.unchecked.insertCard(was(c), to);
		else if (now !== to) doc.moveCard(now, to);
		reordered = true;
	}
	fields.forEach((p, k) =>
		held.push(...heldParts(p, proposals[k], pristine, before, scratch, opts.history))
	);
	const now = current(opts.history, opts.quill, opts.doc);
	cards.forEach((p, k) => {
		const name = before.ids[p.from];
		const c = now.ids.indexOf(name);
		const edit = edits[k];
		held.push({
			type: 'card',
			from: p.from,
			...(p.at === undefined ? {} : { at: p.at }),
			id: before.cardIds[p.from],
			card: name,
			before: before.cards[p.from],
			...(c === -1 ? {} : { theirs: now.cards[c] }),
			...(edit ? { after: edit.after, proposal: { card: edit.card, follows: edit.follows } } : {})
		});
	});
	return reordered ? cardOps(order, count) : ops;
}

/** For each card after `ops`, in order, its index among the `count` cards before them, or `null`
 *  for one they inserted. */
function placesOf(count: number, ops: CardOp[]): (number | null)[] {
	const out: (number | null)[] = Array.from({ length: count }, (_, i) => i);
	for (const o of ops) {
		if (o.op === 'insert') out.splice(o.at, 0, null);
		else if (o.op === 'remove') out.splice(o.at, 1);
		else out.splice(o.to, 0, ...out.splice(o.from, 1));
	}
	return out;
}

/** A card in the authoring form, as `State` holds it. */
const authoring = (c: AuthoringCard): AuthoringCard => ({
	kind: c.kind,
	fields: c.fields ?? {},
	body: c.body ?? ''
});

type FieldChange = Extract<Change, { type: 'field' }>;

function rootOf(c: CardRef, field: string | undefined, at: State): string {
	return contentRoot(c === MAIN ? MAIN : at.ids[c], field);
}

/** Whether a run of lines touches blocks `[b0, b1]`; a run that only inserts touches the
 *  blocks on either side of where it inserts. */
const touches = (r: Run, [b0, b1]: [number, number]): boolean =>
	r.from === r.to ? b0 <= r.from && r.from - 1 <= b1 : r.from <= b1 && b0 <= r.to - 1;

/** The runs of lines of `mine` that meet `theirs`, both text changes from one base of `lines`
 *  lines, or `whole` where they cannot be told apart. */
function meeting(
	mine: FieldChange,
	theirs: FieldChange,
	scope: How['scope'],
	lines: number | undefined,
	where: { root: string; base?: YField } | undefined,
	scratch: Y.Doc,
	history: Y.Doc
): Run[] | 'whole' {
	const x = runsOf.get(mine)?.flatMap(lineByLine);
	const y = runsOf.get(theirs);
	if (!x || !y) return 'whole';
	const byLine = () => x.filter((r) => y.some((q) => meet(r, q)));
	if (scope === 'line' || !where?.base || !history.share.has(where.root)) return byLine();
	if (lines !== where.base.blocks.length) return byLine();
	const b = fieldTokens(where.base);
	const ours = tokenRuns(b, fieldTokens(readField(contentTypes(scratch, where.root))));
	const now = tokenRuns(b, fieldTokens(readField(contentTypes(history, where.root))));
	const hits = ours.filter((r) => now.some((q) => wordsMeet(r, q))).map((r) => blocksOf(r, b));
	if (!hits.length) return [];
	const out = x.filter((r) => hits.some((h) => touches(r, h)));
	return hits.every((h) => out.some((r) => touches(r, h))) ? out : 'whole';
}

/** A run that rewrote as many lines as it read, as one run per line, so a line that meets
 *  nothing is written apart from its neighbours. */
const lineByLine = (r: Run): Run[] =>
	r.to - r.from === r.end - r.at && r.to - r.from > 1
		? Array.from({ length: r.to - r.from }, (_, k) => ({
				from: r.from + k,
				to: r.from + k + 1,
				at: r.at + k,
				end: r.at + k + 1
			}))
		: [r];

/** Put back on `doc` what `plan` holds, from `pristine`, the Document as it stood at `base`. */
function restore(doc: Document, pristine: Document, plan: FieldPlan): void {
	const target = addrOf(plan.at, plan.field);
	const was = pristine.getStored(addrOf(plan.from, plan.field));
	const now = doc.getStored(target);
	const whole = () => {
		plan.runs = 'whole';
		if (was == null) doc.removeField(target);
		else if (isContent(was) && isContent(now)) doc.replace(idAddr(doc, target), was);
		else doc.unchecked.storeField(target, was);
	};
	if (plan.runs === 'whole') return whole();
	try {
		const runs = plan.runs.map(toSplice);
		if (typeof was === 'string' && typeof now === 'string')
			doc.unchecked.storeField(target, spliceLines(now, was, runs));
		else if (isContent(was) && isContent(now))
			doc.replace(idAddr(doc, target), spliceBlocks(now, was, runs));
		else whole();
	} catch {
		whole();
	}
}

/** A run of lines from `base` to the edit, as a splice of the edit's value back to `base`. */
const toSplice = (r: Run): BlockSplice => ({ at: r.at, end: r.end, from: r.from, to: r.to });

/** The parts a plan held, each found by where it sits in `scratch`, still at `base`. */
function heldParts(
	plan: FieldPlan,
	proposal: unknown,
	pristine: Document,
	before: State,
	scratch: Y.Doc,
	history: Y.Doc
): Held[] {
	const name = plan.from === MAIN ? MAIN : before.ids[plan.from];
	const was = pristine.getStored(addrOf(plan.from, plan.field));
	const root = contentRoot(name, plan.field);
	const plain = typeof was === 'string' && typeof proposal === 'string';
	const rich = isContent(was) && isContent(proposal);
	const where = {
		from: plan.from,
		at: plan.at,
		...(plan.from === MAIN ? {} : { id: before.cardIds[plan.from] })
	};
	if ((!plain && !rich) || !scratch.share.has(root)) {
		return [
			{
				type: 'value',
				...where,
				field: plan.field ?? '',
				card: name,
				...(plan.mine.before === undefined ? {} : { before: plan.mine.before }),
				...(plan.theirs.after === undefined ? {} : { theirs: plan.theirs.after }),
				...(plan.mine.after === undefined ? {} : { after: plan.mine.after }),
				...(proposal == null ? {} : { proposal })
			}
		];
	}
	const field = readField(contentTypes(scratch, root));
	const text = scratch.getText(root);
	const offsets = [0];
	let unit = 0;
	for (const ch of field.chars) {
		unit += ch.length;
		if (ch === '\n') offsets.push(unit);
	}
	const blocks = offsets.length;
	const B = was as Content | string;
	const E = proposal as Content | string;
	const count = (v: Content | string) =>
		typeof v === 'string' ? textLines(v).length : v.blocks.length;
	const runs: Run[] =
		plan.runs === 'whole' ? [{ from: 0, to: count(B), at: 0, end: count(E) }] : plan.runs;
	const lines = (v: Content | string, from: number, to: number) =>
		typeof v === 'string'
			? textLines(v).slice(from, to).join('').replace(/\n$/, '')
			: markdown(sliceBlocks(v, from, to));
	const rel = (index: number, assoc: number) =>
		Y.relativePositionToJSON(
			Y.createRelativePositionFromTypeIndex(text, index, assoc)
		) as HeldPosition;
	return runs.map((r) => {
		const tail = r.from >= blocks;
		const start = tail ? unit : offsets[r.from];
		const end = r.to >= blocks ? unit : offsets[r.to] - 1;
		const span: HeldText['span'] =
			r.from === r.to
				? { root, start: rel(start, tail ? -1 : 0), ...(tail ? { tail } : {}) }
				: { root, start: rel(start, -1), end: rel(end, 0) };
		const now = resolve(span, history);
		return {
			type: 'text',
			...where,
			...(plan.field === undefined ? {} : { field: plan.field }),
			before: lines(B, r.from, r.to),
			theirs: now ? linesOf(now.field, now.plain, now.blocks[0], now.blocks[1]) : '',
			after: lines(E, r.at, r.end),
			span,
			proposal: { value: E, from: r.at, to: r.end }
		};
	});
}

/** What changed in `history` since `base`. */
export function changesSince(opts: ForkOpts): Change[] {
	const scratch = Y.createDocFromSnapshot(
		opts.history,
		Y.decodeSnapshot(opts.base),
		new Y.Doc({ gc: false })
	);
	try {
		const before = project(scratch, opts.quill, opts.doc);
		return diff(before, project(opts.history, opts.quill, opts.doc));
	} finally {
		scratch.destroy();
	}
}

/** The Document `history` projects to now, over `doc`'s parts with no Y form. The host frees it. */
export function projectDocument(history: Y.Doc, quill: Quill, doc: Document): Document {
	const copy = new Y.Doc();
	Y.applyUpdate(copy, Y.encodeStateAsUpdate(history));
	try {
		const bound = bind(copy, quill, doc);
		bound.binding.destroy();
		return bound.doc;
	} finally {
		copy.destroy();
	}
}

interface Bound {
	doc: Document;
	binding: ReturnType<typeof bindWith>;
	free(): void;
}

/** `template`'s clone bound to `ydoc`. A remote value the clone refuses stays held, as in a
 *  session; only a card list it cannot follow is fatal. */
function bind(ydoc: Y.Doc, quill: Quill, template: Document): Bound {
	const doc = template.clone();
	let diverged: unknown;
	const binding = bindWith(
		{
			doc,
			quill,
			ydoc,
			leader: false,
			onError: (e) => {
				if (e instanceof Diverged) diverged ??= e;
			}
		},
		'word'
	);
	if (diverged !== undefined) {
		binding.destroy();
		doc.free();
		throw diverged;
	}
	return {
		doc,
		binding,
		free() {
			binding.destroy();
			doc.free();
		}
	};
}

/** A Document's state as its cards' Y ids and authoring form, for comparing, and each text
 *  field's lines as Y holds them, by `<card index>/<field>` (the body is `''`). */
interface State {
	ids: string[];
	/** Each composable card's `$id`, in order. */
	cardIds: string[];
	main: AuthoringCard;
	cards: AuthoringCard[];
	lines: Map<string, string[]>;
}

function state(bound: Bound, quill: Quill): State {
	const { doc } = bound;
	const a = quill.toAuthoring(doc);
	const reader = quill.reader(doc);
	const lines = new Map<string, string[]>();
	for (const c of [MAIN, ...doc.cards.map((_, i) => i)] as CardRef[]) {
		const card = c === MAIN ? doc.main : doc.card(c);
		const at = c === MAIN ? {} : { card: c };
		lines.set(`${c}/`, contentLines(card.body));
		const schema = c === MAIN ? quill.schema.main : quill.schema.card_kinds?.[card.kind];
		for (const [field, f] of Object.entries(schema?.fields ?? {})) {
			const addr: Addr = { ...at, field };
			const v = doc.getStored(addr);
			if (v == null) continue;
			const form = formOf(f.type);
			if (form === 'plain' && typeof v === 'string') lines.set(`${c}/${field}`, textLines(v));
			else if (form === 'content') {
				const content = typeof v === 'object' ? (v as Content) : reader.getContent(addr);
				if (content) lines.set(`${c}/${field}`, contentLines(content));
			}
		}
	}
	return {
		ids: [...bound.binding.ids],
		cardIds: doc.cards.map((c) => c.id ?? ''),
		main: authoring({ kind: MAIN, fields: a.fields, body: a.body }),
		cards: (a.cards ?? []).map(authoring),
		lines
	};
}

/** Each block of `content` as one comparable value: its characters, an island slot as the
 *  island, its record with its containers' records in place of their ids, and its marks from its
 *  start. Two blocks with one value are one line to Y. */
function contentLines(content: Content): string[] {
	const chars = Array.from(content.text);
	const containers = new Map((content.containers ?? []).map(({ id, ...rest }) => [id, rest]));
	const islands = content.islands ?? [];
	const out: string[] = [];
	let start = 0;
	let unit = 0;
	let island = 0;
	content.blocks.forEach(({ id: _, path, ...record }, k) => {
		let end = start;
		let unitEnd = unit;
		while (end < chars.length && chars[end] !== '\n') unitEnd += chars[end++].length;
		const text = chars
			.slice(start, end)
			.map((ch) =>
				ch === SLOT
					? canonical(islands[island] ? islandWithoutAnchors(islands[island++]) : null)
					: ch
			);
		const marks = (content.marks ?? [])
			.filter((m) => m.start < unitEnd && m.end > unit)
			.map((m) => ({
				...m,
				start: Math.max(m.start, unit) - unit,
				end: Math.min(m.end, unitEnd) - unit
			}));
		const within = (path ?? []).map((c) => containers.get(c) ?? null);
		out.push(canonical({ text, record, within, marks, last: k === content.blocks.length - 1 }));
		start = end + 1;
		unit = unitEnd + 1;
	});
	return out;
}

/** The last projection of each history, by the snapshot it was made at: the writes of one answer,
 *  and a write that holds part of itself, read the history once. */
const projected = new WeakMap<Y.Doc, { at: Uint8Array; quill: Quill; state: State }>();

function current(history: Y.Doc, quill: Quill, template: Document): State {
	const at = Y.encodeSnapshot(Y.snapshot(history));
	const held = projected.get(history);
	if (held && held.quill === quill && sameBytes(held.at, at)) return held.state;
	const state = project(history, quill, template);
	projected.set(history, { at, quill, state });
	return state;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function project(ydoc: Y.Doc, quill: Quill, template: Document): State {
	const copy = new Y.Doc();
	Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
	try {
		const bound = bind(copy, quill, template);
		try {
			return state(bound, quill);
		} finally {
			bound.free();
		}
	} finally {
		copy.destroy();
	}
}

function diff(a: State, b: State): Change[] {
	const out: Change[] = [];
	const inB = new Map(b.ids.map((id, i) => [id, i]));
	const inA = new Map(a.ids.map((id, i) => [id, i]));
	a.ids.forEach((name, from) => {
		if (!inB.has(name)) out.push({ type: 'remove', from, id: a.cardIds[from] });
	});
	const kept = a.ids.filter((id) => inB.has(id));
	const stay = new Set(
		commonRun(
			kept,
			b.ids.filter((id) => inA.has(id))
		).map(([i]) => kept[i])
	);
	b.ids.forEach((name, at) => {
		const from = inA.get(name);
		if (from === undefined) out.push({ type: 'insert', at, id: b.cardIds[at], card: b.cards[at] });
		else if (!stay.has(name)) out.push({ type: 'move', from, at, id: a.cardIds[from] });
	});
	out.push(...fields(MAIN, MAIN, a.main, b.main));
	b.ids.forEach((name, at) => {
		const from = inA.get(name);
		if (from === undefined) return;
		const [x, y] = [a.cards[from], b.cards[at]];
		const id = a.cardIds[from];
		if (x.kind !== y.kind) out.push({ type: 'kind', from, at, id, before: x.kind, after: y.kind });
		out.push(...fields(from, at, x, y, id));
	});
	for (const c of out) {
		if (c.type !== 'field') continue;
		const before = a.lines.get(`${c.from}/${c.field ?? ''}`);
		const after = b.lines.get(`${c.at}/${c.field ?? ''}`);
		if (before && after) runsOf.set(c, changedRuns(before, after));
	}
	return out;
}

/** The runs of lines a text field's change rewrote, by the lines of the state it came from. A
 *  field change with none conflicts whole. */
const runsOf = new WeakMap<Change, Run[]>();

function fields(
	from: CardRef,
	at: CardRef,
	x: AuthoringCard,
	y: AuthoringCard,
	id?: string
): Change[] {
	const out: Change[] = [];
	const card = { from, at, ...(id === undefined ? {} : { id }) };
	if ((x.body ?? '') !== (y.body ?? ''))
		out.push({
			type: 'field',
			...card,
			before: x.body,
			after: y.body,
			...hunksOf(x.body, y.body)
		});
	const xf = x.fields ?? {};
	const yf = y.fields ?? {};
	for (const field of new Set([...Object.keys(xf), ...Object.keys(yf)])) {
		const [before, after] = [xf[field] ?? undefined, yf[field] ?? undefined];
		if (canonical(before) === canonical(after)) continue;
		out.push({
			type: 'field',
			...card,
			field,
			...(before === undefined ? {} : { before }),
			...(after === undefined ? {} : { after }),
			...hunksOf(before, after)
		});
	}
	return out;
}

/** Each run of lines two texts differ in. */
function hunksOf(
	before: unknown,
	after: unknown
): { hunks?: { line: number; before: string; after: string }[] } {
	if (typeof before !== 'string' || typeof after !== 'string') return {};
	const a = before.split('\n');
	const b = after.split('\n');
	return {
		hunks: changedRuns(a, b).map((r) => ({
			line: r.from,
			before: a.slice(r.from, r.to).join('\n'),
			after: b.slice(r.at, r.end).join('\n')
		}))
	};
}

/** The changes in `theirs` at a place `mine` changed too. Both are from one base. */
function overlap(mine: Change[], theirs: Change[]): Change[] {
	const written = new Set<CardRef>();
	const whole = new Set<CardRef>();
	const removed = new Set<CardRef>();
	const moved = new Set<CardRef>();
	const fieldsOf = new Map<string, Change>();
	for (const c of mine) {
		if (c.type === 'field') {
			written.add(c.from);
			fieldsOf.set(`${c.from}/${c.field ?? ''}`, c);
		} else if (c.type === 'remove' || c.type === 'kind') {
			written.add(c.from);
			whole.add(c.from);
			if (c.type === 'remove') removed.add(c.from);
		} else if (c.type === 'move') moved.add(c.from);
	}
	return theirs.filter((c) => {
		switch (c.type) {
			case 'field': {
				if (whole.has(c.from)) return true;
				const m = fieldsOf.get(`${c.from}/${c.field ?? ''}`);
				if (!m) return false;
				const [x, y] = [runsOf.get(m), runsOf.get(c)];
				return !x || !y || x.some((r) => y.some((q) => meet(r, q)));
			}
			case 'remove':
				return !removed.has(c.from) && (written.has(c.from) || moved.has(c.from));
			case 'kind':
				return written.has(c.from);
			case 'move':
				return moved.has(c.from);
			case 'insert':
				return false;
		}
	});
}
