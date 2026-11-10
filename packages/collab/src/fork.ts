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
import type { Addr, AuthoringCard, Content, Document, Quill } from '@quillmark/wasm';
import { bindWith, Diverged, formOf, type CardOp, type CardRef } from './document.js';
import { changedRuns, commonRun, meet, type Run } from './lines.js';
import {
	MAIN,
	SLOT,
	canonical,
	contentRoot,
	contentTypes,
	readField,
	sameBytes,
	type YField
} from './shape.js';
import { islandWithoutAnchors } from './write.js';
import { blocksOf, fieldTokens, tokenRuns, wordsMeet } from './words.js';

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
	 *  card-list change. */
	edit(doc: Document): CardOp | CardOp[] | void;
	/** Where an edit to a text meets one made since: `word`, where the words they changed touch,
	 *  or `line`, where they change one line. Default `word`. */
	scope?: 'word' | 'line';
}

export interface Written {
	/** The edit as a Y update, to apply to the session or append to its log. */
	update: Uint8Array;
	/** What the update changes, from `base`. */
	changes: Change[];
	/** What changed in `history` since `base` at a place the update changes too: words or lines
	 *  of a text both wrote (`scope`), a field both set, a card both moved, or a card one side
	 *  removed or retyped that the other changed. A writer that rewrote words from their old text
	 *  would merge into text it never read. */
	conflicts: Change[];
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
	const { quill } = opts;
	const scope = opts.scope ?? 'word';
	const at = Y.decodeSnapshot(opts.base);
	const scratch = Y.createDocFromSnapshot(opts.history, at, new Y.Doc({ gc: false }));
	let bound: Bound | undefined;
	try {
		bound = bind(scratch, quill, opts.doc);
		const { doc, binding } = bound;
		const before = state(bound, quill);
		const count = doc.cardCount;
		const result = opts.edit(doc) ?? [];
		const ops = Array.isArray(result) ? result : [result];
		const step = doc.cardCount - count;
		const named = ops.reduce((n, o) => n + (o.op === 'insert' ? 1 : o.op === 'remove' ? -1 : 0), 0);
		if (step !== named)
			throw new Unwritable(
				`the edit changed the card count by ${step} and its card operations by ${named}`
			);
		const since = diff(before, current(opts.history, quill, opts.doc));
		const bases = new Map<string, { root: string; base: YField }>();
		for (const c of since) {
			if (c.type !== 'field' || !before.lines.has(keyOf(c.from, c.field))) continue;
			const root = rootOf(c.from, c.field, before);
			if (scratch.share.has(root))
				bases.set(keyOf(c.from, c.field), { root, base: readField(contentTypes(scratch, root)) });
		}
		binding.push(ops);
		const changes = diff(before, state(bound, quill));
		if (binding.holding) {
			const landed = diff(before, project(scratch, quill, opts.doc));
			if (canonical(landed) !== canonical(changes))
				throw new Unwritable(
					'the edit touched a card or field the session holds a refused value in'
				);
		}
		const update = Y.encodeStateAsUpdate(scratch, Y.encodeStateVector(at.sv));
		const conflicts = overlap(changes, since).filter((theirs) => {
			if (theirs.type !== 'field') return true;
			const mine = changes.find(
				(c): c is FieldChange =>
					c.type === 'field' && c.from === theirs.from && c.field === theirs.field
			);
			if (!mine) return true;
			const key = keyOf(mine.from, mine.field);
			const lines = before.lines.get(key)?.length;
			const runs = meeting(mine, theirs, scope, lines, bases.get(key), scratch, opts.history);
			return runs === 'whole' || runs.length > 0;
		});
		return { update, changes, conflicts };
	} finally {
		bound?.free();
		scratch.destroy();
	}
}

const addrOf = (c: CardRef, field?: string): Addr => ({
	...(c === MAIN ? {} : { card: c }),
	...(field === undefined ? {} : { field })
});

/** A card in the authoring form, as `State` holds it. */
const authoring = (c: AuthoringCard): AuthoringCard => ({
	kind: c.kind,
	fields: c.fields ?? {},
	body: c.body ?? ''
});

type FieldChange = Extract<Change, { type: 'field' }>;

/** A text field's key in `State.lines`; the body's field is `''`. */
const keyOf = (c: CardRef, field?: string): string => `${c}/${field ?? ''}`;

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
	scope: WriteFromOpts['scope'],
	lines: number | undefined,
	where: { root: string; base: YField } | undefined,
	scratch: Y.Doc,
	history: Y.Doc
): Run[] | 'whole' {
	const x = runsOf.get(mine)?.flatMap(lineByLine);
	const y = runsOf.get(theirs);
	if (!x || !y) return 'whole';
	const byLine = () => x.filter((r) => y.some((q) => meet(r, q)));
	if (scope === 'line' || !where || !history.share.has(where.root)) return byLine();
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
		lines.set(keyOf(c), contentLines(card.body));
		const schema = c === MAIN ? quill.schema.main : quill.schema.card_kinds?.[card.kind];
		for (const [field, f] of Object.entries(schema?.fields ?? {})) {
			const addr = addrOf(c, field);
			const v = doc.getStored(addr);
			if (v == null) continue;
			if (formOf(f.type) !== 'content') continue;
			const content = typeof v === 'object' ? (v as Content) : reader.getContent(addr);
			if (content) lines.set(keyOf(c, field), contentLines(content));
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
		const before = a.lines.get(keyOf(c.from, c.field));
		const after = b.lines.get(keyOf(c.at, c.field));
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
			fieldsOf.set(keyOf(c.from, c.field), c);
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
				const m = fieldsOf.get(keyOf(c.from, c.field));
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
