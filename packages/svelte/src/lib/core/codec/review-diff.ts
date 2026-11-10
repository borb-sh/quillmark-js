// The word diff a proposal draws: what a reader would strike from a line and what they would
// write in its place. Compared a word at a time, since a reader sees a word change and a
// character diff keeps the letters two words happen to share.
import { HARD_BREAK, ISLAND_SLOT } from './islands.js';

/** One change to `before`: its `[at, end)` gives way to `insert`. Either half may be empty. */
export interface DiffHunk {
	at: number;
	end: number;
	insert: string;
}

const WORD = /[\p{L}\p{N}\p{M}_'’]/u;
const SPACE = /\s/u;

/** `text` as tokens, each `[start, end)` in UTF-16: a run of word characters, a run of spaces, or
 *  any other one character. A break and an island are each a token of their own. */
function tokens(text: string): [number, number][] {
	const out: [number, number][] = [];
	let run: 'word' | 'space' | undefined;
	let at = 0;
	for (const ch of text) {
		const kind =
			ch === HARD_BREAK || ch === ISLAND_SLOT || ch === '\n'
				? undefined
				: WORD.test(ch)
					? 'word'
					: SPACE.test(ch)
						? 'space'
						: undefined;
		if (kind && kind === run) out[out.length - 1][1] = at + ch.length;
		else out.push([at, at + ch.length]);
		run = kind;
		at += ch.length;
	}
	return out;
}

/** Past this many cells the table is not built, and the lines differ whole between what they
 *  share at either end. */
const CELLS = 4_000_000;

/** The share of the longer line's words two lines have to hold in common to be drawn as an edit
 *  of one another. Under it the words they share are chance, and the diff is the whole line. */
const KIN = 0.34;

/**
 * The hunks that take `before` to `after`, in order and apart. Two changes with only space between
 * them are one, so a rewritten phrase reads as a phrase. Lines that share too few words to be an
 * edit of one another differ whole.
 */
export function wordDiff(before: string, after: string): DiffHunk[] {
	if (before === after) return [];
	const a = tokens(before);
	const b = tokens(after);
	const ka = a.map(([s, e]) => before.slice(s, e));
	const kb = b.map(([s, e]) => after.slice(s, e));
	let head = 0;
	while (head < ka.length && head < kb.length && ka[head] === kb[head]) head++;
	let tail = 0;
	while (
		tail < ka.length - head &&
		tail < kb.length - head &&
		ka[ka.length - 1 - tail] === kb[kb.length - 1 - tail]
	)
		tail++;
	const n = ka.length - head - tail;
	const m = kb.length - head - tail;
	const startA = (k: number) => (k < a.length ? a[k][0] : before.length);
	const startB = (k: number) => (k < b.length ? b[k][0] : after.length);
	const hunk = (a0: number, a1: number, b0: number, b1: number): DiffHunk => ({
		at: startA(a0),
		end: startA(a1),
		insert: after.slice(startB(b0), startB(b1))
	});
	const whole = [hunk(head, head + n, head, head + m)];
	if (!n || !m || n * m > CELLS) return whole;

	// Longest common subsequence over the middle, read back from the end so a run of matches
	// sits as far left as the lines allow.
	const width = m + 1;
	const table = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			table[i * width + j] =
				ka[head + i] === kb[head + j]
					? table[(i + 1) * width + j + 1] + 1
					: Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);

	const isWord = (t: string) => !SPACE.test(t[0]);
	const words = (list: string[]) => list.reduce((count, t) => count + (isWord(t) ? 1 : 0), 0);
	let kept = words(ka.slice(0, head)) + words(ka.slice(ka.length - tail));

	/** A run both lines hold, by its place in each, then the next. */
	const runs: [number, number, number, number][] = [];
	let i = 0;
	let j = 0;
	let open: [number, number] | undefined;
	const close = () => {
		if (open) runs.push([open[0], i, open[1], j]);
		open = undefined;
	};
	while (i < n && j < m) {
		if (ka[head + i] === kb[head + j]) {
			open ??= [i, j];
			if (isWord(ka[head + i])) kept++;
			i++;
			j++;
		} else {
			close();
			if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
			else j++;
		}
	}
	close();

	const most = Math.max(words(ka), words(kb));
	if (most >= 4 && kept / most < KIN) return [hunk(0, ka.length, 0, kb.length)];

	const out: DiffHunk[] = [];
	let ai = 0;
	let bi = 0;
	let pending: [number, number] | undefined;
	for (const [a0, a1, b0, b1] of [...runs, [n, n, m, m] as const]) {
		const spaces =
			a1 > a0 && a1 < n && ka.slice(head + a0, head + a1).every((t) => SPACE.test(t[0]));
		if (spaces && (pending || a0 > ai || b0 > bi)) {
			pending ??= [ai, bi];
			ai = a1;
			bi = b1;
			continue;
		}
		const [fromA, fromB] = pending ?? [ai, bi];
		if (a0 > fromA || b0 > fromB) out.push(hunk(head + fromA, head + a0, head + fromB, head + b0));
		pending = undefined;
		ai = a1;
		bi = b1;
	}
	return out;
}
