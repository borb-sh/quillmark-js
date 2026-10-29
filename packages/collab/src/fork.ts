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
import type { AuthoringCard, Document, Quill } from '@quillmark/wasm';
import { bindDocument, canonical, Diverged, type CardOp, type CardRef } from './document.js';
import { MAIN } from './shape.js';

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
			/** Where both values are text: the run of lines that differs, from line `line` of
			 *  `before`, for a reader that needs the change and not the whole field. */
			hunk?: { line: number; before: string; after: string };
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
	 *  moves a card returns that operation, and makes no other card-list change. */
	edit(doc: Document): CardOp | void;
}

export interface Written {
	/** The edit as a Y update, to apply to the session or append to its log. */
	update: Uint8Array;
	/** What the edit changed, from `base`. */
	changes: Change[];
	/** What changed in `history` since `base` at a place the edit changed too: a field both
	 *  wrote, a card both moved, or a card one side removed or retyped that the other wrote. A
	 *  writer that rewrote a field from its old text would merge into text it never read. */
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
		const op = opts.edit(base.doc) ?? undefined;
		const step = base.doc.cardCount - count;
		const named = op?.op === 'insert' ? 1 : op?.op === 'remove' ? -1 : 0;
		if (step !== named)
			throw new Unwritable(
				`the edit changed the card count by ${step} and named ${op ? `a ${op.op}` : 'no card operation'}`
			);
		base.binding.push(op);
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

/** A Document's state as its cards' Y ids and authoring form, for comparing. */
interface State {
	ids: string[];
	main: AuthoringCard;
	cards: AuthoringCard[];
}

function state(bound: Bound, quill: Quill): State {
	const a = quill.toAuthoring(bound.doc);
	return {
		ids: [...bound.binding.ids],
		main: { kind: MAIN, fields: a.fields ?? {}, body: a.body ?? '' },
		cards: (a.cards ?? []).map((c) => ({
			kind: c.kind,
			fields: c.fields ?? {},
			body: c.body ?? ''
		}))
	};
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
		longestRun(
			kept,
			b.ids.filter((id) => inA.has(id))
		)
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
	return out;
}

function fields(from: CardRef, at: CardRef, x: AuthoringCard, y: AuthoringCard): Change[] {
	const out: Change[] = [];
	if ((x.body ?? '') !== (y.body ?? ''))
		out.push({ type: 'field', from, at, before: x.body, after: y.body, ...hunkOf(x.body, y.body) });
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
			...hunkOf(before, after)
		});
	}
	return out;
}

/** The lines two texts differ in, between their common leading and trailing lines. */
function hunkOf(
	before: unknown,
	after: unknown
): { hunk?: { line: number; before: string; after: string } } {
	if (typeof before !== 'string' || typeof after !== 'string') return {};
	const a = before.split('\n');
	const b = after.split('\n');
	let p = 0;
	while (p < a.length && p < b.length && a[p] === b[p]) p++;
	let s = 0;
	while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
	return {
		hunk: {
			line: p,
			before: a.slice(p, a.length - s).join('\n'),
			after: b.slice(p, b.length - s).join('\n')
		}
	};
}

/** The longest common subsequence of two orders of one set of ids. */
function longestRun(a: string[], b: string[]): string[] {
	const n = a.length;
	const m = b.length;
	const len = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			len[i][j] = a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
	const out: string[] = [];
	for (let i = 0, j = 0; i < n && j < m;) {
		if (a[i] === b[j]) {
			out.push(a[i]);
			i++;
			j++;
		} else if (len[i + 1][j] >= len[i][j + 1]) i++;
		else j++;
	}
	return out;
}

/** The changes in `theirs` at a place `mine` changed too. Both are from one base. */
function overlap(mine: Change[], theirs: Change[]): Change[] {
	const written = new Set<CardRef>();
	const whole = new Set<CardRef>();
	const moved = new Set<CardRef>();
	const fieldsOf = new Set<string>();
	for (const c of mine) {
		if (c.type === 'field') {
			written.add(c.from);
			fieldsOf.add(`${c.from}/${c.field ?? ''}`);
		} else if (c.type === 'remove' || c.type === 'kind') {
			written.add(c.from);
			whole.add(c.from);
		} else if (c.type === 'move') moved.add(c.from);
	}
	return theirs.filter((c) => {
		switch (c.type) {
			case 'field':
				return fieldsOf.has(`${c.from}/${c.field ?? ''}`) || whole.has(c.from);
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
