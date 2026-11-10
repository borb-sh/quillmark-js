// Review, as a host hands it to the editor: a plain list of what someone other than the reader
// changed and what one proposes, drawn in the editor's own flow. Data in, events out: the editor
// holds no opinion on where an item came from, and the host lays the anchors and takes an
// answered item off the list.
//
// Who writes follows who holds the words. A proposal carries what it would write, so taking it
// is the editor's own edit, down the lane a reader's edit takes: what lands is what was drawn,
// `onChange` reports it, and the reader's undo takes it back. A change carries at most what it
// replaced as words to show, so taking one back is the host's write, which alone knows the
// inverse of what it wrote.
import type { DocPath } from '../core/address.js';
import { wordDiff, type BlockPlace, type ReviewAction } from '../core/codec/index.js';

/**
 * One item of review. `id` is the host's, unique in the list, and is what every event names.
 *
 * An item names its place one of three ways:
 *
 * - `field` with `replace` or `insert`: blocks of a rich text field or a body, by the ids the
 *   document gives them. A `proposed` item with `replace` reads the blocks named as rewritten to
 *   `after`, Markdown, drawn as a word-level edit of them; `''` proposes their removal. `before`
 *   is those blocks as the proposal's writer read them, so what the reader wrote in them since is
 *   theirs: kept unstruck, and kept by Accept. One with `insert` proposes new blocks after or
 *   before a block, or at the field's end. A paragraph takes one proposal that rewrites it and one
 *   that adds after it.
 * - `anchor`: the id of an anchor in a rich text field or a body, which the host lays with the
 *   document's own `apply` (a transient one, id prefixed `~`, never reaches the stored value). A
 *   `changed` item marks the anchor's range as written, `before` the text it replaced; over a
 *   point anchor it marks where text was only removed. A `proposed` item reads every paragraph the
 *   anchor touches as rewritten to `after`, and over a point anchor proposes new paragraphs after
 *   the one holding it.
 * - `field` alone: the path of a field, for a value with no text to anchor in. A `changed` item
 *   marks the field's control, `before` the value it held; a `proposed` item sets `after` under
 *   the control, the value the field's writer would take, an absent one proposing the field
 *   cleared, and `before` the value its writer read. A path into a container names its field.
 *
 * An item whose place the editor does not hold draws nothing. A dismissed item is drawn no more,
 * and an accepted proposal the list still holds is drawn as the change it made, with the card
 * that takes it back, until the list lets it go.
 */
export type ReviewItem =
	| { id: string; state: 'changed'; anchor: string; before?: string }
	| { id: string; state: 'proposed'; anchor: string; after: string }
	| FieldChange
	| FieldProposal
	| BlockProposal;

/** A proposal over blocks of a rich text field, by their ids. */
export type BlockProposal =
	| {
			id: string;
			state: 'proposed';
			field: DocPath;
			replace: readonly string[];
			before?: string;
			after: string;
	  }
	| { id: string; state: 'proposed'; field: DocPath; insert: BlockPlace; after: string };

/** Whether an item names blocks of a rich text field, which its prose leaf draws. */
export const byBlocks = (item: object): item is BlockProposal =>
	'replace' in item || 'insert' in item;

/** Whether an item is a field's own, drawn on its control. */
export const onField = (item: object): item is FieldChange | FieldProposal =>
	'field' in item && !byBlocks(item);

/**
 * A reader's answer to an item.
 *
 * - `accept`: a proposal taken. The editor has written it by now, as an edit of the reader's.
 * - `dismiss`: a proposal turned down. Nothing is written.
 * - `revert`: a change to take back. Nothing is written here: the write is the host's.
 * - `reopen`: an accept or a dismissal undone. The editor has taken back what an accept wrote,
 *   and the item is open again.
 */
export interface ReviewEvent {
	id: string;
	action: ReviewAction;
}

/**
 * Why a listed item draws nothing:
 *
 * - `anchor`: no mounted leaf holds its anchor.
 * - `block`: no block it names stands in its field, or no leaf of the field is mounted.
 * - `field`: its path names no field the editor holds, or a proposal names a place inside one.
 * - `parse`: its `after` is not Markdown the leaf holding it reads.
 * - `taken`: an earlier item has its paragraph, or its field.
 * - `applied`: the text already reads as proposed, so it would write nothing.
 */
export type ReviewUndrawn = 'anchor' | 'block' | 'field' | 'parse' | 'taken' | 'applied';

/** What the editor draws of the host's list. */
export interface ReviewDrawn {
	/** The items the editor draws, in document order: the open ones and the accepted ones. */
	order: readonly string[];
	/** The proposals accepted and still listed, which the editor draws as the changes they made. */
	accepted: readonly string[];
	/** Drawn proposals the reader's own writing meets: words both changed, a block one names
	 *  gone or no longer what its writer read, or a field no longer holding its `before`. */
	outdated: readonly string[];
	/** Listed items the editor does not draw, each with why. */
	undrawn: readonly { id: string; reason: ReviewUndrawn }[];
}

/** A `changed` item over a field's control. */
export type FieldChange = { id: string; state: 'changed'; field: DocPath; before?: unknown };
/** A `proposed` item under a field's control. */
export type FieldProposal = {
	id: string;
	state: 'proposed';
	field: DocPath;
	before?: unknown;
	after?: unknown;
};

/** Whether two values are one, whatever order their keys stand in; absent is `null`. */
export function sameValue(a: unknown, b: unknown): boolean {
	const canonical = (value: unknown): string =>
		JSON.stringify(value ?? null, (_, v: unknown) =>
			v && typeof v === 'object' && !Array.isArray(v)
				? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
				: v
		);
	return canonical(a) === canonical(b);
}

/** A reviewed value as the words a reader is shown for it: a string as written, a rich text
 *  value by its text, a list by its members, a subform by its named cells. `''` for nothing. */
export function reviewText(value: unknown, words: { on: string; off: string }): string {
	if (value == null) return '';
	if (typeof value === 'boolean') return value ? words.on : words.off;
	if (typeof value !== 'object') return String(value);
	if (Array.isArray(value))
		return value
			.map((v) => reviewText(v, words))
			.filter(Boolean)
			.join(', ');
	const text = (value as { text?: unknown }).text;
	if (typeof text === 'string' && Array.isArray((value as { blocks?: unknown }).blocks))
		return text;
	return Object.entries(value)
		.map(([key, v]) => [key, reviewText(v, words)])
		.filter(([, v]) => v)
		.map(([key, v]) => `${key}: ${v}`)
		.join('; ');
}

/** A stretch of a proposal as a reader is shown it: kept, struck, or tinted. */
export interface ReviewRun {
	text: string;
	kind?: 'del' | 'ins';
}

type Words = { on: string; off: string };

const prose = (v: unknown): v is string | { text: string } =>
	typeof v === 'string' || (typeof v === 'object' && v !== null && 'text' in v);
const record = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v) && !prose(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function whole(before: string, after: string): ReviewRun[] {
	return [
		...(before ? [{ text: before, kind: 'del' as const }] : []),
		...(after ? [{ text: after, kind: 'ins' as const }] : [])
	];
}

function joined(parts: ReviewRun[][], by: string): ReviewRun[] {
	return parts.filter((p) => p.length).flatMap((p, i) => (i ? [{ text: by }, ...p] : p));
}

/** The keys of two records that differ, each as `key: ` with what goes struck and what comes
 *  tinted. */
function recordRuns(
	before: Record<string, unknown>,
	after: Record<string, unknown>,
	words: Words
): ReviewRun[] {
	const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])];
	return joined(
		keys
			.filter((key) => !same(before[key], after[key]))
			.map((key) => {
				const runs = whole(reviewText(before[key], words), reviewText(after[key], words));
				return runs.length ? [{ text: `${key}: ` }, ...runs] : [];
			}),
		'; '
	);
}

/** Two lists by their members, in order: a member both hold is kept, one only `before` holds is
 *  struck, one only `after` holds is tinted. In a list of records a kept record is left out, and a
 *  record struck where one is tinted reads as the keys the two differ in. */
function listRuns(
	before: readonly unknown[],
	after: readonly unknown[],
	words: Words
): ReviewRun[] {
	const n = before.length;
	const m = after.length;
	const common = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			common[i][j] = same(before[i], after[j])
				? common[i + 1][j + 1] + 1
				: Math.max(common[i + 1][j], common[i][j + 1]);
	const records = [...before, ...after].some(record);
	/** A record edited in place, named by its first value where that stays, so a reader can tell
	 *  which of the list it is with the records kept left out. */
	const edited = (was: Record<string, unknown>, now: Record<string, unknown>): ReviewRun[] => {
		const first = Object.keys(now)[0];
		const name =
			first !== undefined && same(was[first], now[first]) && reviewText(now[first], words);
		const runs = recordRuns(was, now, words);
		return name ? [{ text: `${name} (` }, ...runs, { text: ')' }] : runs;
	};
	const parts: ReviewRun[][] = [];
	let gone: unknown[] = [];
	let come: unknown[] = [];
	const flush = (): void => {
		const pairs = records ? Math.min(gone.length, come.length) : 0;
		for (let k = 0; k < pairs; k++)
			parts.push(
				record(gone[k]) && record(come[k])
					? edited(gone[k] as Record<string, unknown>, come[k] as Record<string, unknown>)
					: whole(reviewText(gone[k], words), reviewText(come[k], words))
			);
		for (const v of gone.slice(pairs)) parts.push(whole(reviewText(v, words), ''));
		for (const v of come.slice(pairs)) parts.push(whole('', reviewText(v, words)));
		gone = [];
		come = [];
	};
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && same(before[i], after[j])) {
			flush();
			if (!records) parts.push([{ text: reviewText(before[i], words) }]);
			i++;
			j++;
		} else if (j < m && (i === n || common[i][j + 1] >= common[i + 1][j])) come.push(after[j++]);
		else gone.push(before[i++]);
	}
	flush();
	return joined(parts, ', ');
}

/** A proposal as runs, what it keeps, strikes and tints. Two lines of words differ by their words,
 *  two lists by their members, two records by their keys; any other pair differs whole. */
export function reviewRuns(before: unknown, after: unknown, words: Words): ReviewRun[] {
	if (Array.isArray(before) && Array.isArray(after) && before.length && after.length)
		return listRuns(before, after, words);
	if (record(before) && record(after)) return recordRuns(before, after, words);
	const was = reviewText(before, words);
	const now = reviewText(after, words);
	if (!prose(before) || !prose(after) || !was || !now) return whole(was, now);
	const out: ReviewRun[] = [];
	let at = 0;
	for (const hunk of wordDiff(was, now)) {
		if (hunk.at > at) out.push({ text: was.slice(at, hunk.at) });
		if (hunk.end > hunk.at) out.push({ text: was.slice(hunk.at, hunk.end), kind: 'del' });
		if (hunk.insert) out.push({ text: hunk.insert, kind: 'ins' });
		at = hunk.end;
	}
	if (at < was.length) out.push({ text: was.slice(at) });
	return out;
}
