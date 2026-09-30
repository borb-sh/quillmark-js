/**
 * The document's checklists, and the search an open matrix's add box runs over them
 * (VISUAL_EDITOR §"The matrix"). The editor root publishes every card-level matrix off
 * the model it derives, so a list in a collapsed group or another card is searched
 * as surely as the one the author is typing in; a matrix mounted off-tree, or nested
 * in a container, searches its own items alone.
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

/** One option of an add box. */
export interface AddOption {
	/** Stable across one query's options: the option element's id suffix. */
	key: string;
	title: string;
	/** Words after the title: the list a result stands in, its held state. */
	note?: string;
	/** The option that adds what was typed, rather than a result. */
	add?: boolean;
}

/** One search result: an item of some checklist, `list` naming which. */
export interface ChecklistHit<L> {
	list: L;
	id: string;
	title: string;
	held: boolean;
	score: number;
}

/** Lowercase, unaccented words: `Exec / Aide / CAG` → `exec aide cag`. */
function words(s: string): string[] {
	return s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

/** `flt` in `flight`: every letter in order, the first letters equal. */
function abbreviates(token: string, word: string): boolean {
	if (token[0] !== word[0]) return false;
	let i = 0;
	for (const c of word) if (c === token[i]) i++;
	return i === token.length;
}

/**
 * How well `query` names `title`, `0` for not at all. Each query word claims one title
 * word, whole (3), as its opening (2), or as an abbreviation of it (1): `flt cc` names
 * `Flight CC`. A query run together that opens the title's initials names it too:
 * `jqo` names `Joint Qualified Officer`. A title the query opens outright ranks above
 * the same words met out of order.
 */
export function matchScore(query: string, title: string): number {
	const q = words(query);
	const w = words(title);
	if (!q.length || !w.length) return 0;
	const free = w.map(() => true);
	let score = 0;
	for (const token of q) {
		let best = 0;
		let at = -1;
		for (let i = 0; i < w.length; i++) {
			if (!free[i]) continue;
			const s = w[i] === token ? 3 : w[i].startsWith(token) ? 2 : abbreviates(token, w[i]) ? 1 : 0;
			if (s > best) {
				best = s;
				at = i;
			}
		}
		if (!best) {
			const initials = w.map((x) => x[0]).join('');
			const run = q.join('');
			return run.length > 1 && initials.startsWith(run) ? 1 : 0;
		}
		free[at] = false;
		score += best;
	}
	return words(title).join(' ').startsWith(q.join(' ')) ? score + 1 : score;
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
			const score = matchScore(query, item.title);
			if (score)
				hits.push({
					list,
					id: item.id,
					title: item.title,
					held: matrixHeld(memberValue(value, item.id)),
					score
				});
		}
	return hits
		.map((h, i) => [h, i] as const)
		.sort(([a, i], [b, j]) => b.score - a.score || i - j)
		.slice(0, limit)
		.map(([h]) => h);
}
