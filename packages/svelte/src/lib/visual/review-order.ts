// The page's order of the review items the editor draws, from what the editor holds: the card
// stack, each card's fields as it lays them out, and each leaf's report of what it draws.
import type { PathStep } from '@quillmark/wasm';
import type { ReviewReport } from '../core/codec/index.js';
import type { CardModel } from './structure.js';
import type { DeepReview, FieldProposal } from './review.js';

/** A card as the page stands it: its session key, and its leaf keys in the order it draws them. */
export interface CardLayout {
	key: string;
	leaves: readonly string[];
}

/** The leaf keys of `card` in the order it draws them: its ungrouped sections, its panels, then
 *  its body. */
export function cardLayout(card: CardModel): CardLayout {
	const leaves: string[] = [];
	if (!card.unschemable) {
		const ungrouped = card.sections.filter((s) => s.group == null);
		const grouped = card.sections.filter((s) => s.group != null);
		for (const section of [...ungrouped, ...grouped])
			for (const field of section.fields) leaves.push(`${card.id}:${field.name}`);
		if (card.hasBody) leaves.push(`${card.id}:$body`);
	}
	return { key: card.id, leaves };
}

export interface Drawn {
	/** The main card, then each card of the stack. */
	layout: readonly CardLayout[];
	/** The cards proposed new after each card, by its key, `head` and `end` at either end. */
	adds: ReadonlyMap<string, readonly { id: string }[]>;
	/** The removal marking each card, by its key. */
	removes: ReadonlyMap<string, { id: string }>;
	/** The field items over the leaf at `key`. */
	at(key: string): { proposed?: FieldProposal; nested?: readonly DeepReview[] };
	/** What each prose leaf draws, by leaf key, its ids in the leaf's order. */
	reports: ReadonlyMap<string, ReviewReport>;
	/** The field items no control draws. */
	undrawn: ReadonlySet<string>;
	/** Where a place inside the field at `key` is drawn among the places inside it. */
	rank?(key: string, steps: readonly PathStep[]): readonly number[];
}

const byRank = (a: readonly number[], b: readonly number[]): number => {
	for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
	return a.length - b.length;
};

/** The ids drawn, in the page's order. */
export function orderOf(drawn: Drawn): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const take = (id: string): void => {
		if (seen.has(id)) return;
		seen.add(id);
		out.push(id);
	};
	const leaf = (key: string): void => {
		const { proposed, nested } = drawn.at(key);
		if (proposed && !drawn.undrawn.has(proposed.id)) take(proposed.id);
		const inside = (nested ?? []).filter((e) => !drawn.undrawn.has(e.item.id));
		const ranked = inside.map((e, n) => ({
			id: e.item.id,
			rank: drawn.rank?.(key, e.steps) ?? e.steps.map((s) => (typeof s === 'number' ? s : n))
		}));
		for (const { id } of ranked.sort((a, b) => byRank(a.rank, b.rank))) take(id);
		for (const id of drawn.reports.get(key)?.ids ?? []) take(id);
	};
	const adds = (lead: string): void => {
		for (const item of drawn.adds.get(lead) ?? []) take(item.id);
	};
	drawn.layout.forEach((card, n) => {
		const removal = drawn.removes.get(card.key);
		if (removal) take(removal.id);
		for (const key of card.leaves) leaf(key);
		adds(n === 0 ? 'head' : card.key);
	});
	adds('end');
	return out;
}
