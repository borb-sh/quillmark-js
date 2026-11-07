// Positions: the content ↔ PM map that carries the caret (INVARIANTS §Positions). A content offset is a
// UTF-16 index into the flat `text`; a PM position counts node tokens. The map is a list of runs
// (built by the shared `scanDoc` walk, so it can never disagree with the content projection) that
// tile the text: a `text` run where PM and the content advance together, an `nl` run for a `\n`
// spanning a PM block boundary or a `U+2028` standing for a hard break, and an `atom` run for a
// `U+FFFC` island slot. `ContentHit.pos` / `FieldRegion.span` reach a PM caret through
// `offsetToPM`; a caret signal to the preview runs `pmToOffset` in reverse.
import type { Node as PMNode } from 'prosemirror-model';
import { scanDoc, type PosRun, type Scan } from './encode.js';

/** A text change as one pass over the text before, offsets in UTF-16 code units: what a host
 *  hands `applyExternal` for a field another writer changed, such as `@quillmark/collab`'s
 *  `RemoteChange` delta. */
export interface Delta {
	ops: ({ retain: number } | { insert: string } | { delete: number })[];
}

/** A prebuilt position index for a PM doc, rebuilt on structural change. */
export interface LineIndex {
	runs: PosRun[];
	/** Length of the content text. */
	end: number;
	/** PM position at the end of the last content run (the caret-max). */
	pmEndContent: number;
	/** PM content position of the first block (the caret for an empty doc). */
	firstContentStart: number;
}

/** Build the position index for `doc` (walks it once via the shared scanner). */
export function buildLineIndex(doc: PMNode): LineIndex {
	return lineIndexOf(scanDoc(doc));
}

/** The index a scan's runs make. The commit path takes this one: it wants the
 *  content projection off the same walk (`encode.ts`, `scanContent`). */
export function lineIndexOf(s: Scan): LineIndex {
	const runs = s.runs;
	let pmEndContent = 1;
	let firstContentStart = 1;
	if (runs.length) {
		const first = runs[0];
		firstContentStart = first.pmStart;
		const last = runs[runs.length - 1];
		pmEndContent = runEndPm(last);
	}
	return { runs, end: s.text.length, pmEndContent, firstContentStart };
}

/** PM position just past a run (its exclusive end). */
function runEndPm(run: PosRun): number {
	if (run.kind === 'text') return run.pmStart + run.s.length;
	if (run.kind === 'nl') return run.pmEnd;
	return run.pmStart + 1;
}

const atOf = (run: PosRun) => run.at;
const pmStartOf = (run: PosRun) => run.pmStart;

/**
 * Index of the last run whose `coord` is ≤ `pos`, or `-1` when `pos` precedes the
 * first run. The walk emits runs in document order and every run owns at least one
 * position in each space, so both coordinates increase strictly across the list and
 * the lookup bisects. Bulk conversion is what wants it: `readAnchors` converts
 * once per anchor on every commit, and a scan would make that O(anchors × runs).
 */
function lastRunAtOrBefore(runs: PosRun[], pos: number, coord: (run: PosRun) => number): number {
	let lo = 0;
	let hi = runs.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (coord(runs[mid]) <= pos) {
			found = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return found;
}

/** Content offset → PM position. */
export function offsetToPM(index: LineIndex, offset: number): number {
	const at = clamp(offset, 0, index.end);
	if (at >= index.end) return index.end === 0 ? index.firstContentStart : index.pmEndContent;
	// The runs tile the content from 0 (every text the walk appends pushes its run first), so
	// below `end` the run at or before `at` is the run that owns it.
	const run = index.runs[lastRunAtOrBefore(index.runs, at, atOf)];
	if (run.kind === 'text') return run.pmStart + (at - run.at);
	return run.pmStart; // nl / atom: the run's single owned position
}

/** PM position → content offset. */
export function pmToOffset(index: LineIndex, pmPos: number): number {
	const i = lastRunAtOrBefore(index.runs, pmPos, pmStartOf);
	if (i < 0) return 0; // before the first run's PM position (or no runs at all)
	const run = index.runs[i];
	// PM coverage has gaps no run owns (a rule's own token). A position in one is past every run
	// that could answer it → the end of the content text.
	if (pmPos >= runEndPm(run)) return index.end;
	if (run.kind === 'text') return run.at + (pmPos - run.pmStart);
	return run.at;
}

function clamp(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Where content offset `pos` lands after `delta`, its ops counting UTF-16 code units: text
 * inserted at `pos` lands before it, so a caret at an edit's edge follows the text typed there.
 */
export function mapThroughDelta(delta: Delta, pos: number): number {
	let at = 0;
	let out = pos;
	for (const op of delta.ops) {
		if (at > pos) break;
		if ('retain' in op) at += op.retain;
		else if ('insert' in op) out += op.insert.length;
		else {
			const gone = Math.min(op.delete, Math.max(0, pos - at));
			out -= gone;
			if (pos < at + op.delete) break;
			at += op.delete;
		}
	}
	return out;
}
