/**
 * The document's checklists, and the search an open matrix's add box runs over them
 * (VISUAL_EDITOR §"The matrix"). The editor root publishes every card-level matrix off
 * the model it derives, so a list in a collapsed group or another card is searched
 * as surely as the one the author is typing in. A matrix mounted off-tree, or nested
 * in a container, is not indexed and searches its own items alone.
 */
import { getContext, setContext } from 'svelte';
import type { QuillFieldSchema } from '@quillmark/wasm';
import type { DocPath } from '../core/address.js';
import {
	addedItems,
	matrixHeld,
	matrixMembers,
	memberValue,
	type CardModel,
	type MatrixMember
} from './structure.js';

/** One matrix of the document, as the add box reaches it. */
export interface Checklist {
	/** The field's leaf key: how a mounted matrix tells itself from the rest. */
	key: string;
	/** The field's path, the prefix a member's landing address extends. */
	path: DocPath;
	/** What a result from this list reads under: the field's label, and the card's
	 *  where the field is not the main card's. */
	label: string;
	schema: QuillFieldSchema;
	/** The held set as it prints: the stored map, else the declared `default:`. */
	value: Record<string, unknown> | undefined;
	/** Commit the whole map, as the field's own control does. */
	commit: (next: Record<string, unknown> | undefined) => void;
}

export interface ChecklistIndex {
	list: () => readonly Checklist[];
	/** Reveal and focus a member by its address. */
	land: (path: DocPath) => void;
}

const KEY = Symbol('qm-checklists');

export function setChecklists(index: ChecklistIndex): void {
	setContext(KEY, index);
}

/** The index under a mounted editor; `undefined` off-tree. */
export function checklists(): ChecklistIndex | undefined {
	return getContext<ChecklistIndex | undefined>(KEY);
}

/** The value a matrix prints: the stored map, else a mapping `default:`. */
export function matrixPrinted(
	value: unknown,
	schema: QuillFieldSchema
): Record<string, unknown> | undefined {
	const map = (v: unknown) =>
		typeof v === 'object' && v !== null && !Array.isArray(v)
			? (v as Record<string, unknown>)
			: undefined;
	return value == null ? map(schema.default) : map(value);
}

/** Every card-level matrix of the cards, in document order. */
export function cardChecklists(
	cards: readonly CardModel[],
	cardLabel: (card: CardModel) => string,
	path: (card: CardModel, field: string) => DocPath | undefined,
	leafKey: (card: CardModel, field: string) => string,
	commit: (card: CardModel, field: string, next: Record<string, unknown> | undefined) => void
): Checklist[] {
	const out: Checklist[] = [];
	for (const card of cards) {
		if (card.unschemable) continue;
		for (const section of card.sections)
			for (const f of section.fields) {
				if (f.control !== 'matrix') continue;
				const at = path(card, f.name);
				if (at == null) continue;
				out.push({
					key: leafKey(card, f.name),
					path: at,
					label: card.isMain ? f.label : `${f.label} · ${cardLabel(card)}`,
					schema: f.schema,
					value: matrixPrinted(card.values[f.name], f.schema),
					commit: (next) => commit(card, f.name, next)
				});
			}
	}
	return out;
}

/** Every item a matrix can show: the roster in declaration order, then the items its
 *  map adds, in id order. */
export function checklistItems(
	schema: QuillFieldSchema,
	value: Record<string, unknown> | undefined
): MatrixMember[] {
	return [...matrixMembers(schema.members), ...addedItems(schema, value)];
}

/** Whether an item of a matrix carries `title`, case and surrounding space aside. */
export function checklistCarries(
	schema: QuillFieldSchema,
	value: Record<string, unknown> | undefined,
	title: string
): boolean {
	const fold = (s: string) => s.trim().toLowerCase();
	return checklistItems(schema, value).some((item) => fold(item.title) === fold(title));
}

/** One option of an add box. */
export interface AddOption {
	/** Stable across one query's options: the option element's id suffix. */
	key: string;
	title: string;
	/** Words after the title: the list a result stands in, its held state. */
	note?: string;
	/** The option that adds what was typed, rather than a result. */
	add?: boolean;
	/** A result the typed words name outright, which Enter takes unarrowed: an add box
	 *  whose best result is weaker takes its add option instead. */
	strong?: boolean;
	/** What the owner reads back off a chosen option. */
	payload?: unknown;
}

/** One search result: an item of some checklist, `list` naming which. */
export interface ChecklistHit<L> {
	list: L;
	id: string;
	title: string;
	held: boolean;
	score: number;
	/** Every query word claimed a title word whole or as its opening. */
	strong: boolean;
}

/** Lowercase, unaccented words, any script: `Exec / Aide / CAG` → `exec aide cag`. */
function words(s: string): string[] {
	return s
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

/** `flt` in `flight`: every letter in order, the first letters equal. */
function abbreviates(token: string, word: string): boolean {
	if (token[0] !== word[0]) return false;
	let i = 0;
	for (const c of word) if (c === token[i]) i++;
	return i === token.length;
}

/** How a query word claims one title word: whole (3), as its opening (2), as an
 *  abbreviation (1), or not (0). */
function claim(token: string, word: string): number {
	return word === token ? 3 : word.startsWith(token) ? 2 : abbreviates(token, word) ? 1 : 0;
}

/** The end of the run of free words from `i` whose openings spell `token` in order —
 *  `fcc` over `flight cc`, `jqo` over `joint qualified officer` — or `-1`. */
function runFrom(token: string, w: readonly string[], free: readonly boolean[], i: number): number {
	if (i >= w.length || !free[i]) return -1;
	for (let k = Math.min(token.length, w[i].length); k > 0; k--) {
		if (!w[i].startsWith(token.slice(0, k))) continue;
		if (k === token.length) return i + 1;
		const end = runFrom(token.slice(k), w, free, i + 1);
		if (end >= 0) return end;
	}
	return -1;
}

/**
 * How well `query` names `title`, or `undefined` for not at all. Each query word claims
 * a title word — whole, as its opening, or as an abbreviation of it (`flt cc` names
 * `Flight CC`) — the stronger claims taken first, so `c cc` names `CC Candidate`; a
 * word left over may claim a run of words whose openings it spells (`fcc`, `jqo`). The
 * title the query spells outright ranks first, then one it opens.
 */
export function matchTitle(
	query: string,
	title: string
): { score: number; strong: boolean } | undefined {
	const q = words(query);
	const w = words(title);
	if (!q.length || !w.length) return undefined;
	const free = w.map(() => true);
	const left = q.map(() => true);
	let score = 0;
	let strong = true;
	for (const level of [3, 2, 1])
		q.forEach((token, t) => {
			if (!left[t]) return;
			const at = w.findIndex((word, i) => free[i] && claim(token, word) === level);
			if (at < 0) return;
			free[at] = left[t] = false;
			score += level;
			if (level === 1) strong = false;
		});
	for (let t = 0; t < q.length; t++) {
		if (!left[t]) continue;
		let found = false;
		for (let i = 0; i < w.length && !found; i++) {
			const end = runFrom(q[t], w, free, i);
			if (end - i < 2) continue;
			for (let k = i; k < end; k++) free[k] = false;
			found = true;
		}
		if (!found) return undefined;
		score += 1;
		strong = false;
	}
	const typed = q.join(' ');
	const whole = w.join(' ');
	return { score: score + (whole === typed ? 3 : whole.startsWith(typed) ? 1 : 0), strong };
}

/** {@link matchTitle}'s score, `0` for no match. */
export function matchScore(query: string, title: string): number {
	return matchTitle(query, title)?.score ?? 0;
}

/** What a search reads of one list: its items and their ticks. */
export interface Searchable<L> {
	list: L;
	schema: QuillFieldSchema;
	value: Record<string, unknown> | undefined;
}

/**
 * The items across `lists` that `query` names, best first; a tie keeps the order of
 * `lists`, then of each list's items.
 */
export function searchChecklists<L>(
	query: string,
	lists: readonly Searchable<L>[],
	limit = 8
): ChecklistHit<L>[] {
	const hits: ChecklistHit<L>[] = [];
	for (const { list, schema, value } of lists)
		for (const item of checklistItems(schema, value)) {
			const match = matchTitle(query, item.title);
			if (match)
				hits.push({
					list,
					id: item.id,
					title: item.title,
					held: matrixHeld(memberValue(value, item.id)),
					...match
				});
		}
	return hits
		.map((h, i) => [h, i] as const)
		.sort(([a, i], [b, j]) => b.score - a.score || i - j)
		.slice(0, limit)
		.map(([h]) => h);
}
