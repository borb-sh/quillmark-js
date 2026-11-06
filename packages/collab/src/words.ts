// Words: the unit a write from a revision is written in and compared in.
//
// A live keystroke is written as the characters it changed, so two people typing in one word
// merge character by character. A write from a revision replaces whole words: an edit that turns
// "two" into "three" deletes "two" and inserts "three", leaving no shared "t" for a concurrent
// edit to land inside, and two words it changed far apart in one line are two splices, so what
// was typed between them stays.
import { changedRuns, type Run, type Splice } from './lines.js';
import { LINE_KEYS, MARK_KEYS, SLOT, canonical, type YField } from './shape.js';

export type Grain = 'char' | 'word';

const WORD = /[\p{L}\p{N}\p{M}_'’]/u;
const SPACE = /[^\S\n]/u;

/** `chars[from, to)` as tokens, each `[start, end)`: a run of word characters, a run of spaces,
 *  or any other one character. A `\n` and an island slot are always a token of their own. */
export function tokenSpans(chars: readonly string[], from: number, to: number): [number, number][] {
	const out: [number, number][] = [];
	for (let i = from; i < to;) {
		const ch = chars[i];
		let j = i + 1;
		if (ch !== SLOT && ch !== '\n') {
			const kind = WORD.test(ch) ? WORD : SPACE.test(ch) ? SPACE : undefined;
			if (kind) while (j < to && chars[j] !== SLOT && chars[j] !== '\n' && kind.test(chars[j])) j++;
		}
		out.push([i, j]);
		i = j;
	}
	return out;
}

/**
 * The splices that take `a[a0, a1)` to `b[b0, b1)` a word at a time: the tokens both hold, by
 * longest common subsequence of their keys, are kept, and each run between is one splice. An
 * insertion alone sits as far left as the text allows, so a word typed before a repeat of itself
 * is written where it was typed.
 */
export function wordSplices(
	a: readonly string[],
	a0: number,
	a1: number,
	keyA: (from: number, to: number) => string,
	b: readonly string[],
	b0: number,
	b1: number,
	keyB: (from: number, to: number) => string
): Splice[] {
	const ta = tokenSpans(a, a0, a1);
	const tb = tokenSpans(b, b0, b1);
	const ka = ta.map(([s, e]) => keyA(s, e));
	const kb = tb.map(([s, e]) => keyB(s, e));
	const startA = (k: number) => (k < ta.length ? ta[k][0] : a1);
	const startB = (k: number) => (k < tb.length ? tb[k][0] : b1);
	return leftmost(ka, kb).map(({ from, to, at, end }) => ({
		at: startA(from),
		end: startA(to),
		from: startB(at),
		to: startB(end)
	}));
}

/** The runs `a` and `b` differ in, an insertion alone moved as far left as the text allows: one
 *  change finds one place, however the longest common subsequence happened to align it. */
function leftmost(a: readonly string[], b: readonly string[]): Run[] {
	const out: Run[] = [];
	let floor = 0;
	for (const r of changedRuns(a, b)) {
		let { from, to, at, end } = r;
		if (from === to)
			while (from > floor && at > 0 && a[from - 1] === b[end - 1]) {
				from--;
				to--;
				at--;
				end--;
			}
		out.push({ from, to, at, end });
		floor = r.to;
	}
	return out;
}

/** A content root's Y state as tokens for comparing two states of it: a first token for block
 *  0's record, then each word, space, other character, `\n` and island slot. A token's key holds
 *  everything Y holds for it: a word's characters and marks, a `\n`'s block record and the
 *  records of its containers, a slot's island. `block[k]` is the block token `k` belongs to, a
 *  `\n` to the block it opens. */
export interface Tokens {
	keys: string[];
	block: number[];
}

export function fieldTokens(field: YField): Tokens {
	const within = (path: string[]) => path.map((c) => field.containers.get(c) ?? null);
	const first = field.blocks[0];
	const keys = [
		canonical({ block: first.id, kind: first.kind, within: within(first.path), codec: field.codec })
	];
	const block = [0];
	let line = 0;
	let island = 0;
	for (const [s, e] of tokenSpans(field.chars, 0, field.chars.length)) {
		const ch = field.chars[s];
		if (ch === '\n') {
			const b = field.blocks[++line];
			const attrs = Object.fromEntries(LINE_KEYS.map((k) => [k, field.attrs[s][k] ?? null]));
			keys.push(canonical({ nl: attrs, within: within(b?.path ?? []) }));
		} else if (ch === SLOT) {
			const map = field.islands[island++];
			keys.push(canonical({ island: map?.toJSON() ?? null, marks: marksAt(field, s) }));
		} else {
			const marks: unknown[] = [];
			for (let i = s; i < e; i++) marks.push(marksAt(field, i));
			keys.push(canonical({ text: field.chars.slice(s, e).join(''), marks }));
		}
		block.push(line);
	}
	return { keys, block };
}

function marksAt(field: YField, i: number): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of MARK_KEYS) if (field.attrs[i][k] != null) out[k] = field.attrs[i][k];
	return out;
}

/** A run of tokens two states of one root differ in. An insertion alone can sit at any gap
 *  from `from` to `hi` where the tokens around it repeat, so its place is that whole range. */
export interface TokenRun extends Run {
	hi: number;
}

/** The runs of tokens two states of one root differ in, by the tokens of the first. */
export function tokenRuns(before: Tokens, after: Tokens): TokenRun[] {
	const [a, b] = [before.keys, after.keys];
	const runs = leftmost(a, b);
	return runs.map((r, k) => {
		if (r.from !== r.to) return { ...r, hi: r.from };
		const ceiling = k + 1 < runs.length ? runs[k + 1].from : a.length;
		let { from: hi, at, end } = r;
		while (hi < ceiling && end < b.length && b[at] === b[end]) {
			hi++;
			at++;
			end++;
		}
		return { ...r, hi };
	});
}

/** Whether two runs of one base's tokens meet: they share a token, or one inserts at a place the
 *  other touches, its edges included, since two inserts beside one deleted word interleave. */
export function wordsMeet(x: TokenRun, y: TokenRun): boolean {
	if (Math.max(x.from, y.from) < Math.min(x.to, y.to)) return true;
	if (x.from === x.to && y.from === y.to) return x.from <= y.hi && y.from <= x.hi;
	if (x.from === x.to) return x.from <= y.to && y.from <= x.hi;
	if (y.from === y.to) return y.from <= x.to && x.from <= y.hi;
	return false;
}

/** The blocks a run of tokens touches, as `[first, last]`. */
export function blocksOf(run: Run, tokens: Tokens): [number, number] {
	const last = tokens.block.length - 1;
	if (run.from === run.to) {
		const b = tokens.block[Math.min(Math.max(run.from - 1, 0), last)];
		return [b, b];
	}
	return [tokens.block[run.from], tokens.block[run.to - 1]];
}
