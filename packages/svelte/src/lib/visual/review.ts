// Review, as a host hands it to the editor: a plain list of what someone other than the reader
// proposes, drawn in the editor's own flow. Data in, events out: the editor holds no opinion on
// where an item came from, and the host sets the list once and clears it once.
//
// A proposal carries what it would write, so taking it is the editor's own edit, down the lane a
// reader's edit takes: what lands is what was drawn, `onChange` reports it, and the reader's undo
// takes it back.
import type { PathStep } from '@quillmark/wasm';
import type { DocPath } from '../core/address.js';
import { wordDiff, type BlockPlace, type ReviewAction } from '../core/codec/index.js';

/**
 * One proposal. `id` is the host's, unique in the list, and is what every event names.
 *
 * An item names its place one of two ways:
 *
 * - `field` with `replace` or `insert`: blocks of a rich text field or a body, by the ids the
 *   document gives them. A `proposed` item with `replace` reads the blocks named as rewritten to
 *   `after`, Markdown, drawn as a word-level edit of them; `''` proposes their removal. `before`
 *   is those blocks as the proposal's writer read them, so what the reader wrote in them since is
 *   theirs: kept unstruck, and kept by Accept. One with `insert` proposes new blocks after or
 *   before a block, or at the field's end. A paragraph takes one proposal that rewrites it and one
 *   that adds after it.
 * - `field` alone: the path of a field. It sets `after` under the control, the value the
 *   field's writer would take, an absent one proposing the field cleared, and `before` the value
 *   its writer read. A path to a place inside a record or a
 *   list names that place: a cell, or a member by its index, which `after` absent takes out
 *   and an index past the last appends.
 *
 * An item whose place the editor does not hold draws nothing. An answered item is drawn no
 * more: a dismissed one wrote nothing, and an accepted one is plain text in the document.
 */
export type ReviewItem = FieldProposal | BlockProposal | CardReview;

/** A card proposed new or proposed taken out, by its index into the cards as they stood when the
 *  list was set. The editor draws it among its cards; the host writes it, by `applyCardOps`,
 *  when `onReview` reports it accepted. */
export type CardReview =
	| {
			id: string;
			/** After the card at this index, `-1` after the main card, past the last for the end. */
			add: { after: number; kind: string; title?: string; text?: string };
	  }
	| { id: string; remove: number };

/** Whether an item proposes a whole card. */
export const byCard = (item: object): item is CardReview => 'add' in item || 'remove' in item;

/** A proposal over blocks of a rich text field, by their ids. */
export type BlockProposal =
	| {
			id: string;
			field: DocPath;
			replace: readonly string[];
			before?: string;
			after: string;
	  }
	| { id: string; field: DocPath; insert: BlockPlace; after: string };

/** Whether an item names blocks of a rich text field, which its prose leaf draws. */
export const byBlocks = (item: object): item is BlockProposal =>
	'replace' in item || 'insert' in item;

/** Whether an item is a field's own, drawn under its control. */
export const onField = (item: object): item is FieldProposal => 'field' in item && !byBlocks(item);

/**
 * A reader's answer to an item.
 *
 * - `accept`: a proposal taken. The editor has written it by now, as an edit of the reader's.
 * - `dismiss`: a proposal turned down. Nothing is written.
 * - `reopen`: an accept or a dismissal undone by ⌘Z. The editor has taken back what an accept
 *   wrote, and the item is open again.
 */
export interface ReviewEvent {
	id: string;
	action: ReviewAction;
}

/**
 * Why a listed item draws nothing:
 *
 * - `block`: no block it names stands in its field, or no leaf of the field is mounted.
 * - `field`: its path names no field the editor holds, or a place inside one its schema does
 *   not declare.
 * - `parse`: its `after` is not Markdown the leaf holding it reads.
 * - `taken`: an earlier item has its paragraph, or its field.
 * - `applied`: the text already reads as proposed, so it would write nothing.
 */
export type ReviewUndrawn = 'block' | 'field' | 'parse' | 'taken' | 'applied';

/** What the editor draws of the host's list. */
export interface ReviewDrawn {
	/** The proposals the editor draws, in document order, each waiting for an answer. A review
	 *  is answered when it is empty. */
	open: readonly string[];
	/** Drawn proposals the reader's own writing meets: words both changed, a block one names
	 *  gone or no longer what its writer read, or a field no longer holding its `before`. */
	outdated: readonly string[];
	/** Listed items the editor does not draw, each with why. */
	undrawn: readonly { id: string; reason: ReviewUndrawn }[];
}

/** A proposal under a field's control. */
export type FieldProposal = {
	id: string;
	field: DocPath;
	before?: unknown;
	after?: unknown;
};

/** A field item routed past its field: the steps from the rung it is handed to down to the
 *  value it names, a member of a list by its index, a cell of a record by its key. */
export interface DeepReview {
	steps: readonly PathStep[];
	item: FieldProposal;
}

/** One rung of a nested item's walk: the items naming this rung's own value, and the rest by
 *  the step they take next, that step consumed. */
export function splitReview(list: readonly DeepReview[] | undefined): {
	here: DeepReview[];
	below: Map<PathStep, DeepReview[]>;
} {
	const here: DeepReview[] = [];
	const below = new Map<PathStep, DeepReview[]>();
	for (const entry of list ?? []) {
		if (!entry.steps.length) {
			here.push(entry);
			continue;
		}
		const [step, ...steps] = entry.steps;
		const bucket = below.get(step) ?? [];
		bucket.push({ steps, item: entry.item });
		below.set(step, bucket);
	}
	return { here, below };
}

/** The value `steps` reach in `value`, `undefined` where they reach nothing. */
export function valueIn(value: unknown, steps: readonly PathStep[]): unknown {
	let at = value;
	for (const step of steps) {
		if (at == null || typeof at !== 'object') return undefined;
		at = (at as Record<PathStep, unknown>)[step];
	}
	return at;
}

/** `value` with what `steps` reach set to `to`: a list's member past its end appended, and one
 *  set to nothing taken out; a record's cell set to nothing left out. Copies on the way down. */
export function valueWith(value: unknown, steps: readonly PathStep[], to: unknown): unknown {
	if (!steps.length) return to;
	const [step, ...rest] = steps;
	if (typeof step === 'number') {
		const list = Array.isArray(value) ? [...value] : [];
		const at = Math.min(step, list.length);
		const next = valueWith(list[at], rest, to);
		if (!rest.length && to === undefined) list.splice(at, 1);
		else if (step >= list.length) list.push(next);
		else list[at] = next;
		return list;
	}
	const record = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
	const next = valueWith((record as Record<string, unknown>)[step], rest, to);
	if (next === undefined) delete (record as Record<string, unknown>)[step];
	else (record as Record<string, unknown>)[step] = next;
	return record;
}

/**
 * Where a field proposal's steps land in `value` as it stands. A list's member is found by its
 * index where it holds `before`, else as the nearest member holding `before` that `claimed`
 * does not already hold, so one member taken out does not move another's proposal onto the
 * wrong row. `found` is false where the proposal has a `before` nothing holds.
 */
export function locate(
	value: unknown,
	steps: readonly PathStep[],
	item: FieldProposal,
	claimed: Set<string>
): { steps: readonly PathStep[]; found: boolean } {
	const read = 'before' in item;
	const before = read ? item.before : undefined;
	const at = steps.at(-1);
	const head = steps.slice(0, -1);
	const list = valueIn(value, head);
	const claim = (out: readonly PathStep[]) => {
		claimed.add(JSON.stringify(out));
		return out;
	};
	if (!read || before === undefined || typeof at !== 'number' || !Array.isArray(list)) {
		const found = !read || sameValue(valueIn(value, steps), before);
		return { steps: claim(steps), found };
	}
	const free = (i: number): boolean =>
		sameValue(list[i], before) && !claimed.has(JSON.stringify([...head, i]));
	if (free(at)) return { steps: claim(steps), found: true };
	for (let d = 1; d < list.length; d++)
		for (const i of [at - d, at + d])
			if (i >= 0 && i < list.length && free(i)) return { steps: claim([...head, i]), found: true };
	return { steps, found: false };
}

/** Whether two values are one, whatever order their keys stand in; absent is `null`, and a
 *  plain text value rests as its words, as a writer takes it either way. */
export function sameValue(a: unknown, b: unknown): boolean {
	const canonical = (value: unknown): string =>
		JSON.stringify(value ?? null, (_, v: unknown) => {
			if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
			const { text, codec } = v as { text?: unknown; codec?: unknown };
			if (codec === 'plain' && typeof text === 'string') return text;
			return Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
		});
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
