// The page's order of the review items the editor draws, from what the editor holds: the card
// stack, each card's fields as it lays them out, and each leaf's report of what it draws.
import type { QuillFieldSchema } from '@quillmark/wasm';
import type { ReviewReport } from '../core/codec/index.js';
import { rankAt, type CardModel } from './structure.js';
import type { DeepReview, FieldProposal } from './review.js';

/** A leaf as its card draws it: its key, and for a field its name, and the schema and the value
 *  it holds, which place what is drawn inside it. */
export interface LeafLayout {
	key: string;
	name?: string;
	schema?: QuillFieldSchema;
	value?: unknown;
}

/** A card as the page stands it: its session key, and its leaves in the order it draws them. */
export interface CardLayout {
	key: string;
	leaves: readonly LeafLayout[];
}

/** The leaves of `card` in the order it draws them: its ungrouped sections, its panels, then
 *  its body. */
export function cardLayout(card: CardModel): CardLayout {
	const leaves: LeafLayout[] = [];
	if (!card.unschemable) {
		const ungrouped = card.sections.filter((s) => s.group == null);
		const grouped = card.sections.filter((s) => s.group != null);
		for (const section of [...ungrouped, ...grouped])
			for (const field of section.fields)
				leaves.push({
					key: `${card.id}:${field.name}`,
					name: field.name,
					schema: field.schema,
					value: card.values[field.name]
				});
		if (card.hasBody) leaves.push({ key: `${card.id}:$body` });
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
	const leaf = ({ key, schema, value }: LeafLayout): void => {
		const { proposed, nested } = drawn.at(key);
		if (proposed && !drawn.undrawn.has(proposed.id)) take(proposed.id);
		const inside = (nested ?? [])
			.filter((e) => !drawn.undrawn.has(e.item.id))
			.map((e) => ({ id: e.item.id, rank: schema ? rankAt(schema, e.steps, value) : [] }));
		for (const { id } of inside.sort((a, b) => byRank(a.rank, b.rank))) take(id);
		for (const id of drawn.reports.get(key)?.ids ?? []) take(id);
	};
	const adds = (lead: string): void => {
		for (const item of drawn.adds.get(lead) ?? []) take(item.id);
	};
	drawn.layout.forEach((card, n) => {
		const removal = drawn.removes.get(card.key);
		if (removal) take(removal.id);
		for (const at of card.leaves) leaf(at);
		adds(n === 0 ? 'head' : card.key);
	});
	adds('end');
	return out;
}
