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
import {
	bindDocument,
	canonical,
	Diverged,
	formOf,
	type CardOp,
	type CardRef
} from './document.js';
import { changedRuns, commonRun, meet, type Run } from './lines.js';
import { MAIN, SLOT } from './shape.js';

/** What differs between two states of one session, by the cards' place in each. A card moved
 *  is named by `from`, its index in the older state, and `at`, its index in the newer one. */
export type Change =
	| { type: 'insert'; at: number; card: AuthoringCard }
	| { type: 'remove'; from: number }
	| { type: 'move'; from: number; at: number }
	| { type: 'kind'; from: number; at: number; before: string; after: string }
	| {
			type: 'field';
			from: CardRef;
			at: CardRef;
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
}

export interface Written {
	/** The edit as a Y update, to apply to the session or append to its log. */
	update: Uint8Array;
	/** What the edit changed, from `base`. */
	changes: Change[];
	/** What changed in `history` since `base` at a place the edit changed too: lines of a text
	 *  field both wrote, a field both set, a card both moved, or a card one side removed or
	 *  retyped that the other wrote. A writer that rewrote lines from their old text would merge
	 *  into text it never read. */
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
	const at = Y.decodeSnapshot(opts.base);
	const scratch = Y.createDocFromSnapshot(opts.history, at, new Y.Doc({ gc: false }));
	let base: Bound | undefined;
	try {
		base = bind(scratch, quill, opts.doc);
		const before = state(base, quill);
		const count = base.doc.cardCount;
		const made = opts.edit(base.doc) ?? [];
		const ops = Array.isArray(made) ? made : [made];
		const step = base.doc.cardCount - count;
		const named = ops.reduce((n, o) => n + (o.op === 'insert' ? 1 : o.op === 'remove' ? -1 : 0), 0);
		if (step !== named)
			throw new Unwritable(
				`the edit changed the card count by ${step} and its card operations by ${named}`
			);
		base.binding.push(ops);
		const changes = diff(before, state(base, quill));
		const landed = diff(before, project(scratch, quill, opts.doc));
		if (canonical(landed) !== canonical(changes))
			throw new Unwritable('the edit touched a card or field the session holds a refused value in');
		const update = Y.encodeStateAsUpdate(scratch, Y.encodeStateVector(at.sv));
		const moved = diff(before, project(opts.history, quill, opts.doc));
		return { update, changes, conflicts: overlap(changes, moved) };
	} finally {
		base?.free();
		scratch.destroy();
	}
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
	binding: ReturnType<typeof bindDocument>;
	free(): void;
}

/** `template`'s clone bound to `ydoc`. A remote value the clone refuses stays held, as in a
 *  session; only a card list it cannot follow is fatal. */
function bind(ydoc: Y.Doc, quill: Quill, template: Document): Bound {
	const doc = template.clone();
	let diverged: unknown;
	const binding = bindDocument({
		doc,
		quill,
		ydoc,
		onError: (e) => {
			if (e instanceof Diverged) diverged ??= e;
		}
	});
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
		main: { kind: MAIN, fields: a.fields ?? {}, body: a.body ?? '' },
		cards: (a.cards ?? []).map((c) => ({
			kind: c.kind,
			fields: c.fields ?? {},
			body: c.body ?? ''
		})),
		lines
	};
}

/** A plain text's lines, each up to and including its `\n`. */
function textLines(text: string): string[] {
	return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Each line of `content` as one comparable value: its characters, an island slot as the island,
 *  its kind and containers without the numbers derived from position, and its marks from its
 *  start. Two lines with one value are one line to Y. */
function contentLines(content: Content): string[] {
	const chars = Array.from(content.text);
	const out: string[] = [];
	let start = 0;
	let island = 0;
	content.lines.forEach((line, k) => {
		let end = start;
		while (end < chars.length && chars[end] !== '\n') end++;
		const text = chars
			.slice(start, end)
			.map((ch) => (ch === SLOT ? canonical(content.islands[island++] ?? null) : ch));
		const containers = line.containers.map((c) =>
			c.container === 'list_item'
				? { c: c.container, ordered: c.attrs.ordered, checked: c.attrs.checked }
				: { c: c.container }
		);
		const marks = content.marks
			.filter((m) => m.type !== 'anchor' && m.start < end && m.end > start)
			.map((m) => ({
				...m,
				start: Math.max(m.start, start) - start,
				end: Math.min(m.end, end) - start
			}));
		const { containers: _, ...rest } = line;
		out.push(canonical({ text, rest, containers, marks, last: k === content.lines.length - 1 }));
		start = end + 1;
	});
	return out;
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
	a.ids.forEach((id, from) => {
		if (!inB.has(id)) out.push({ type: 'remove', from });
	});
	const kept = a.ids.filter((id) => inB.has(id));
	const stay = new Set(
		commonRun(
			kept,
			b.ids.filter((id) => inA.has(id))
		).map(([i]) => kept[i])
	);
	b.ids.forEach((id, at) => {
		const from = inA.get(id);
		if (from === undefined) out.push({ type: 'insert', at, card: b.cards[at] });
		else if (!stay.has(id)) out.push({ type: 'move', from, at });
	});
	out.push(...fields(MAIN, MAIN, a.main, b.main));
	b.ids.forEach((id, at) => {
		const from = inA.get(id);
		if (from === undefined) return;
		const [x, y] = [a.cards[from], b.cards[at]];
		if (x.kind !== y.kind) out.push({ type: 'kind', from, at, before: x.kind, after: y.kind });
		out.push(...fields(from, at, x, y));
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

function fields(from: CardRef, at: CardRef, x: AuthoringCard, y: AuthoringCard): Change[] {
	const out: Change[] = [];
	if ((x.body ?? '') !== (y.body ?? ''))
		out.push({
			type: 'field',
			from,
			at,
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
			from,
			at,
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
	const moved = new Set<CardRef>();
	const fieldsOf = new Map<string, Change>();
	for (const c of mine) {
		if (c.type === 'field') {
			written.add(c.from);
			fieldsOf.set(`${c.from}/${c.field ?? ''}`, c);
		} else if (c.type === 'remove' || c.type === 'kind') {
			written.add(c.from);
			whole.add(c.from);
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
				return written.has(c.from) || moved.has(c.from);
			case 'kind':
				return written.has(c.from);
			case 'move':
				return moved.has(c.from);
			case 'insert':
				return false;
		}
	});
}
