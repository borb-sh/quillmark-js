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

const PARA: ContentBlock = { id: '', kind: 'para' };

/** A field value of words as a `Content`: a string by its lines, a rich or plain text value as it
 *  is, nothing as the empty line. `undefined` for a value that is not words. */
export function asContent(value: unknown): Content | undefined {
	if (value == null) return { text: '', blocks: [PARA] };
	if (typeof value === 'string') return { text: value, blocks: value.split('\n').map(() => PARA) };
	if (typeof value !== 'object' || typeof (value as { text?: unknown }).text !== 'string')
		return undefined;
	const v = value as Content;
	return Array.isArray(v.blocks) ? v : { ...v, blocks: v.text.split('\n').map(() => PARA) };
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
			: Array.from({ length: lines }, (_, k) => c.blocks[k] ?? PARA);
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
 * proposal's, or the value holds more than lines of words, it is `after` whole and outdated.
 */
export function planValue(before: Content | undefined, live: Content, after: Content): ValuePlan {
	if (!before) return { merged: after, outdated: false };
	const ours = valueChanges(before, live);
	if (!ours.length) return { merged: after, outdated: false };
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
