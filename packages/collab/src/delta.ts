// The text change a write made to a content field, as the `Delta` an editor maps its positions
// through.
//
// A write's receipt names the change from the value before as steps, each over the text the step
// before it left; the delta composes them into one pass over the text before. Offsets are UTF-16
// units and an island's character is one, as the content model counts them. Only the steps that
// change the field's own text count: a splice, and an island's character inserted.
import type { Change } from '@quillmark/wasm';
import { SLOT } from './shape.js';

/** A text change as one pass over the text before: keep, insert, or delete a run of it. */
export interface Delta {
	ops: ({ retain: number } | { insert: string } | { delete: number })[];
}

type Op = Delta['ops'][number];

export function deltaOf(change: Change): Delta {
	let ops: Op[] = [];
	for (const step of change.steps) {
		if ('splice' in step) {
			const { at, delete: removed = '', insert } = step.splice;
			ops = compose(ops, edit(at, removed, insert));
		} else if ('island' in step && 'at' in step.island) {
			ops = compose(ops, edit(step.island.at, '', SLOT));
		}
	}
	return { ops: trim(ops) };
}

/** A splice of `removed` for `insert` at `at`, narrowed to what the two do not share at either
 *  end: a write replaces whole words, and a caret inside one stays where the letters it sits
 *  between stay. */
function edit(at: number, removed: string, insert: string): Op[] {
	let p = 0;
	while (p < removed.length && p < insert.length && removed[p] === insert[p]) p++;
	if (p && isHigh(removed.charCodeAt(p - 1))) p--;
	let s = 0;
	while (
		s < removed.length - p &&
		s < insert.length - p &&
		removed[removed.length - 1 - s] === insert[insert.length - 1 - s]
	)
		s++;
	if (s && isLow(removed.charCodeAt(removed.length - s))) s--;
	const ops: Op[] = [];
	if (at + p) ops.push({ retain: at + p });
	if (insert.length - p - s) ops.push({ insert: insert.slice(p, insert.length - s) });
	if (removed.length - p - s) ops.push({ delete: removed.length - p - s });
	return ops;
}

const isHigh = (u: number) => u >= 0xd800 && u < 0xdc00;
const isLow = (u: number) => u >= 0xdc00 && u < 0xe000;

const size = (op: Op): number =>
	'retain' in op ? op.retain : 'delete' in op ? op.delete : op.insert.length;

/** The part of `op` from `from` units on, `n` units long. */
function part(op: Op, from: number, n: number): Op {
	if ('retain' in op) return { retain: n };
	if ('delete' in op) return { delete: n };
	return { insert: op.insert.slice(from, from + n) };
}

/** `a` then `b`, `b` reading the text `a` leaves, as one pass over the text `a` reads. */
function compose(a: Op[], b: Op[]): Op[] {
	const out: Op[] = [];
	let i = 0;
	let ai = 0;
	const next = (n: number): Op => {
		while ('delete' in (a[i] ?? {})) out.push(a[i++]);
		const op = a[i] ?? { retain: Infinity };
		const take = Math.min(n, size(op) - ai);
		const piece = part(op, ai, take);
		ai += take;
		if (ai === size(op)) {
			i++;
			ai = 0;
		}
		return piece;
	};
	for (const op of b) {
		if ('insert' in op) {
			out.push(op);
			continue;
		}
		let n = 'retain' in op ? op.retain : op.delete;
		while (n > 0) {
			const piece = next(n);
			n -= size(piece);
			if ('retain' in op) out.push(piece);
			else if ('retain' in piece) out.push({ delete: size(piece) });
		}
	}
	while (i < a.length) {
		const op = a[i];
		out.push(ai ? part(op, ai, size(op) - ai) : op);
		i++;
		ai = 0;
	}
	return out;
}

/** Merge neighbours of one kind, insert before delete, and drop a trailing retain. */
function trim(ops: Op[]): Op[] {
	const out: Op[] = [];
	for (const op of ops) {
		if (size(op) === 0 || size(op) === Infinity) continue;
		const last = out.at(-1);
		if (last && 'retain' in last && 'retain' in op) last.retain += op.retain;
		else if (last && 'delete' in last && 'delete' in op) last.delete += op.delete;
		else if (last && 'insert' in last && 'insert' in op) last.insert += op.insert;
		else if (last && 'delete' in last && 'insert' in op) {
			out.pop();
			const before = out.at(-1);
			if (before && 'insert' in before) before.insert += op.insert;
			else out.push(op);
			out.push(last);
		} else out.push(op);
	}
	while (out.length && 'retain' in out.at(-1)!) out.pop();
	return out;
}
