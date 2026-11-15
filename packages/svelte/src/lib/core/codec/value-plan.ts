// What Accept writes for a field's whole proposed value of words, and how it differs from what the
// field holds: one plan the leaf draws and the editor writes, so the two cannot part.
//
// A proposal carries `before`, the value as its writer read it. Each stretch it rewrites there is
// carried onto the value as it now reads, so words the reader wrote beside a stretch stay theirs
// and survive Accept. Where the reader's change meets a stretch, carrying it would write a line
// nobody proposed, so the proposal is outdated and Accept writes the proposed value whole.
import type { Content, ContentBlock, ContentMark } from '@quillmark/wasm';
import { wordDiff } from './review-diff.js';

/** `[at, end)` of one value gives way to `[from, to)` of another. */
export interface ValueChange {
	at: number;
	end: number;
	from: number;
	to: number;
}

/** What Accept writes, and whether the reader's own change meets the proposal. */
export interface ValuePlan {
	merged: Content;
	outdated: boolean;
}

/** Line `k`'s block where a value of words names none of its own. */
const para = (_: unknown, k: number): ContentBlock => ({ id: `b${k}`, kind: 'para' });

/** A field value of words as a `Content`: a string by its lines, a rich or plain text value as it
 *  is, nothing as the empty line. `undefined` for a value that is not words. */
export function asContent(value: unknown): Content | undefined {
	if (value == null) return { text: '', blocks: [para(null, 0)] };
	if (typeof value === 'string') return { text: value, blocks: value.split('\n').map(para) };
	if (typeof value !== 'object' || typeof (value as { text?: unknown }).text !== 'string')
		return undefined;
	const v = value as Content;
	return Array.isArray(v.blocks) ? v : { ...v, blocks: v.text.split('\n').map(para) };
}

const markKey = (m: ContentMark): string =>
	JSON.stringify([m.type, 'attrs' in m ? (m.attrs ?? null) : null]);

/** The marks over each offset of `c`, as one key per offset. */
function marksAt(c: Content): string[] {
	const out = new Array<string[]>(c.text.length);
	for (let i = 0; i < out.length; i++) out[i] = [];
	for (const m of c.marks ?? [])
		for (let i = m.start; i < m.end && i < out.length; i++) out[i].push(markKey(m));
	return out.map((keys) => keys.sort().join('|'));
}

/**
 * The changes that take `a` to `b`, in order and apart: the words that differ, then, in the words
 * both hold, each run whose formatting differs, which gives way to itself as `b` formats it.
 */
export function valueChanges(a: Content, b: Content): ValueChange[] {
	const words: ValueChange[] = [];
	let shift = 0;
	for (const h of wordDiff(a.text, b.text)) {
		const from = h.at + shift;
		words.push({ at: h.at, end: h.end, from, to: from + h.insert.length });
		shift += h.insert.length - (h.end - h.at);
	}
	if (!(a.marks?.length || b.marks?.length)) return words;
	const ma = marksAt(a);
	const mb = marksAt(b);
	const out: ValueChange[] = [];
	let i = 0;
	let j = 0;
	const kept = (end: number): void => {
		let run: ValueChange | undefined;
		for (; i < end; i++, j++) {
			if (ma[i] === mb[j]) {
				if (run) out.push(run);
				run = undefined;
				continue;
			}
			if (run) {
				run.end = i + 1;
				run.to = j + 1;
			} else run = { at: i, end: i + 1, from: j, to: j + 1 };
		}
		if (run) out.push(run);
	};
	for (const w of words) {
		kept(w.at);
		out.push(w);
		i = w.end;
		j = w.to;
	}
	kept(a.text.length);
	return out;
}

/** Whether two changes over one value touch the same words: they overlap, or one inserts inside
 *  the other, or both insert at one place. */
function meet(p: ValueChange, r: ValueChange): boolean {
	if (p.at < r.end && r.at < p.end) return true;
	if (p.at === p.end && r.at === r.end) return p.at === r.at;
	if (p.at === p.end) return p.at > r.at && p.at < r.end;
	if (r.at === r.end) return r.at > p.at && r.at < p.end;
	return false;
}

/** The marks of `[from, to)` of `c`, from `at`. */
function marksIn(c: Content, from: number, to: number, at: number): ContentMark[] {
	return (c.marks ?? []).flatMap((m) => {
		const start = Math.max(m.start, from);
		const end = Math.min(m.end, to);
		return end > start ? [{ ...m, start: start - from + at, end: end - from + at }] : [];
	});
}

/** One mark for each run of touching marks of one kind. */
function joinMarks(marks: ContentMark[]): ContentMark[] {
	const sorted = [...marks].sort((x, y) => x.start - y.start || x.end - y.end);
	const out: ContentMark[] = [];
	for (const m of sorted) {
		const prev = out.find((o) => markKey(o) === markKey(m) && o.end >= m.start);
		if (prev) prev.end = Math.max(prev.end, m.end);
		else out.push({ ...m });
	}
	return out.sort((x, y) => x.start - y.start || x.end - y.end);
}

/** `c` with `[at, end)` giving way to `[from, to)` of `src`, marks and all. */
function splice(
	c: Content,
	at: number,
	end: number,
	src: Content,
	from: number,
	to: number
): Content {
	const delta = to - from - (end - at);
	const text = c.text.slice(0, at) + src.text.slice(from, to) + c.text.slice(end);
	const marks = joinMarks([
		...marksIn(c, 0, at, 0),
		...marksIn(c, end, c.text.length, end + delta),
		...marksIn(src, from, to, at)
	]);
	const lines = text.split('\n').length;
	const blocks =
		lines === c.blocks.length
			? c.blocks
			: Array.from({ length: lines }, (_, k) => c.blocks[k] ?? para(null, k));
	const out: Content = { ...c, text, blocks };
	if (marks.length) out.marks = marks;
	else delete out.marks;
	delete out.anchors;
	return out;
}

/** Whether a value holds a block of its own kind, a container or an island, which a change to
 *  its words alone does not carry. */
const structured = (c: Content): boolean =>
	!!c.islands?.length ||
	!!c.containers?.length ||
	c.blocks.some((b) => b.kind !== 'para' || b.path?.length);

/**
 * What Accept writes over `live`, the value as it reads now: `after` where there is no `before`,
 * or where the reader has changed nothing since; else each change from `before` to `after` carried
 * onto `live`, the reader's own changes kept. Where a change of the reader's meets one of the
 * proposal's, or the value holds more than lines of words, it is `after` whole and outdated, unless
 * the value already reads as `after`.
 */
export function planValue(before: Content | undefined, live: Content, after: Content): ValuePlan {
	if (!before) return { merged: after, outdated: false };
	const ours = valueChanges(before, live);
	if (!ours.length || !valueChanges(live, after).length) return { merged: after, outdated: false };
	const theirs = valueChanges(before, after);
	if ([before, live, after].some(structured) || theirs.some((p) => ours.some((r) => meet(p, r))))
		return { merged: after, outdated: true };
	const moved = (x: number): number =>
		ours.reduce((at, r) => (r.end <= x ? at + (r.to - r.from) - (r.end - r.at) : at), x);
	let merged = live;
	for (const p of [...theirs].reverse()) {
		const at = moved(p.at);
		merged = splice(merged, at, at + (p.end - p.at), after, p.from, p.to);
	}
	return { merged, outdated: false };
}

/** Unchanged lines that may stand between two runs of changed lines on one proposal. */
const RUN_GAP = 2;

/** Line `k` of `c`, as a value of its own. */
function lineOf(c: Content, starts: number[], k: number): { text: string; marks: ContentMark[] } {
	const from = starts[k];
	const to = k + 1 < starts.length ? starts[k + 1] - 1 : c.text.length;
	return { text: c.text.slice(from, to), marks: marksIn(c, from, to, 0) };
}

/** Where each line of `c` starts. */
function lineStarts(c: Content): number[] {
	const out = [0];
	for (let i = 0; i < c.text.length; i++) if (c.text[i] === '\n') out.push(i + 1);
	return out;
}

/**
 * `after` as one proposal per run of lines it changes in `before`: each `before` with that run
 * alone written as `after` has it, in reading order. Lines pair by their words and formatting
 * along their longest common run, so a line added or taken out is one run, never every line below
 * it. By `'run'`, runs at most two unchanged lines apart are one; by `'paragraph'`, a run that
 * rewrites as many lines as it reads is one proposal per line, as the body proposes paragraphs. A
 * value that holds more than lines of words, or one that changes a single line or run, is `[after]`.
 */
export function lineRuns(
	before: Content,
	after: Content,
	unit: 'run' | 'paragraph' = 'run'
): Content[] {
	if ([before, after].some(structured)) return [after];
	const bs = lineStarts(before);
	const as = lineStarts(after);
	if (bs.length !== before.blocks.length || as.length !== after.blocks.length) return [after];
	const key = (c: Content, starts: number[], k: number): string =>
		JSON.stringify(lineOf(c, starts, k));
	const bk = bs.map((_, k) => key(before, bs, k));
	const ak = as.map((_, k) => key(after, as, k));
	const m = bk.length;
	const n = ak.length;
	const lcs = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--)
		for (let j = n - 1; j >= 0; j--)
			lcs[i][j] = bk[i] === ak[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
	const runs: { b: number; be: number; a: number; ae: number }[] = [];
	let i = 0;
	let j = 0;
	let open: { b: number; a: number } | undefined;
	const close = (): void => {
		if (!open) return;
		const last = runs.at(-1);
		if (unit === 'run' && last && open.b - last.be <= RUN_GAP) {
			last.be = i;
			last.ae = j;
		} else runs.push({ b: open.b, be: i, a: open.a, ae: j });
		open = undefined;
	};
	while (i < m || j < n) {
		if (i < m && j < n && bk[i] === ak[j]) {
			close();
			i++;
			j++;
		} else {
			open ??= { b: i, a: j };
			if (j >= n || (i < m && lcs[i + 1][j] >= lcs[i][j + 1])) i++;
			else j++;
		}
	}
	close();
	const apart =
		unit === 'paragraph'
			? runs.flatMap((r) =>
					r.be - r.b === r.ae - r.a && r.be - r.b > 1
						? Array.from({ length: r.be - r.b }, (_, k) => ({
								b: r.b + k,
								be: r.b + k + 1,
								a: r.a + k,
								ae: r.a + k + 1
							}))
						: [r]
				)
			: runs;
	if (apart.length < 2) return [after];
	return apart.map((run) => {
		const lines = [
			...bs.slice(0, run.b).map((_, k) => lineOf(before, bs, k)),
			...as.slice(run.a, run.ae).map((_, k) => lineOf(after, as, run.a + k)),
			...bs.slice(run.be).map((_, k) => lineOf(before, bs, run.be + k))
		];
		const blocks = [
			...before.blocks.slice(0, run.b),
			...after.blocks.slice(run.a, run.ae),
			...before.blocks.slice(run.be)
		].map((b, k) => ({ ...b, id: `b${k}` }));
		let at = 0;
		const marks: ContentMark[] = [];
		for (const line of lines) {
			for (const mark of line.marks)
				marks.push({ ...mark, start: mark.start + at, end: mark.end + at });
			at += line.text.length + 1;
		}
		const out: Content = { ...before, text: lines.map((l) => l.text).join('\n'), blocks };
		if (marks.length) out.marks = marks;
		else delete out.marks;
		delete out.anchors;
		return out;
	});
}
