// The editor's review state: the host's list split by where each item draws, and the one current
// item, which the answer card and the review keys answer.
//
// The current item is sticky: a step, a reveal, a click, the caret arriving in an item, or the
// pointer resting on one names it, and it stays until another is named or it is answered. The
// pointer names one only after a dwell, and never while it is over the answer card, so a pointer
// crossing the text on its way to the card does not move the card from under it.
//
// An answered item is drawn no more, from the answer and not from the host's next list: the
// reader's press shows at once however long the host takes to hand over a list without it.
//
// The answer journal holds the answers since the reader's last edit, each undone by ⌘Z from
// anywhere in the editor, newest first, its item reopened with it. An edit that is not an answer
// empties it: an inverse is good against the document it was recorded over. An answer's own
// writes, and an inverse's, go down the lanes an edit does, so they are flagged while they are
// made.
import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { PathStep } from '@quillmark/wasm';
import type { DocPath } from '../core/address.js';
import type { ReviewAction, ReviewReport, ReviewVia, TextReview } from '../core/codec/index.js';
import { asContent, planValue, type ValueState } from '../core/codec/index.js';
import {
	byBlocks,
	byCard,
	locate,
	onField,
	sameValue,
	textProposal,
	valueIn,
	writesProposed,
	type CardProposal,
	type DeepReview,
	type FieldProposal,
	type ReviewDrawn,
	type ReviewItem,
	type ReviewUndrawn
} from './review.js';
import { orderOf, type CardLayout } from './review-order.js';
import type { StructuralUndo, UndoOffer } from './undo.svelte.js';

/** How long the pointer rests on an item before it is current, in ms. */
export const DWELL_MS = 160;

/** A card proposed new, drawn after the card it follows. */
export type CardAdd = Extract<CardProposal, { add: unknown }>;

/** Where the open card items draw, by the session keys of the cards as they stand. */
export interface CardsReviewed {
	/** The new cards after each card, by its key, `head` ahead of every card and `end` past the
	 *  last, in list order. */
	adds: ReadonlyMap<string, readonly CardAdd[]>;
	/** The card each removal marks, by its key. */
	removes: ReadonlyMap<string, Extract<CardProposal, { remove: number }>>;
}

export interface Review {
	/** The host's list, less what was answered here. */
	readonly items: readonly ReviewItem[];
	/** The items the prose leaf at `key` draws, those placed by blocks of its own field. One
	 *  identity until the list changes. */
	textAt(key: string): readonly TextReview[];
	/** Each mounted prose leaf's report of what it draws, by leaf key. */
	readonly reports: ReadonlyMap<string, ReviewReport>;
	/** The field items no control draws, each with why. */
	readonly fieldUndrawn: readonly { id: string; reason: ReviewUndrawn }[];
	/** The field proposals whose field no longer holds the value their `before` says was read. */
	readonly fieldOutdated: ReadonlySet<string>;
	/** The open items drawn, in the page's order. */
	readonly order: readonly string[];
	/** What the editor draws of the host's list, and why it draws what it does not. */
	readonly report: ReviewDrawn;
	/** The current item: open, drawn, and what the answer card and the review keys answer. */
	readonly lit: string | undefined;
	/** Where the open card items draw. */
	readonly cards: CardsReviewed;
	/** The card an accepted `add` wrote, by its session key, or none once it is taken back. */
	wrote(id: string, key: string | undefined): void;
	/** The items over the field at leaf `key`: its own, and those naming a place inside it,
	 *  each with the steps to the value it names as the field holds it now. */
	at(key: string): { proposed?: FieldProposal; nested?: readonly DeepReview[] };
	/** Whether anything draws at leaf `key`: a field's own item, or a text item in its leaf. */
	marks(key: string): boolean;
	/** The leaf drawing item `id`, where one does. */
	keyOf(id: string): string | undefined;
	/** A prose leaf's report of what it draws. */
	drew(key: string, report: ReviewReport): void;
	/** The item the pointer or the caret is in, `undefined` where it left one: the caret
	 *  arriving names it at once, the pointer once it has rested, and leaving names nothing. */
	point(id: string | undefined, via: ReviewVia): void;
	/** A reader's answer. False where it could not be made. */
	act(id: string, action: ReviewAction): boolean;
	/** Answer items as the answer card would, in the page's order: `'all'` is every item drawn,
	 *  less on Accept the outdated ones, each of which would write over the reader. Each is
	 *  planned against the document the one before it left, and one that cannot be answered
	 *  stands. ⌘Z takes the call back whole. Returns the ids answered. */
	answer(ids: readonly string[] | 'all', action: 'accept' | 'dismiss'): string[];
	/** An edit landed that is no answer's: the answers before it can no longer be taken back. */
	settled(): void;
	/** A reader's commit of `value` on a control that shows one value, under the proposal `id`:
	 *  the proposed value accepts it, any other is written and dismisses it, both one answer.
	 *  False where it could not be made, and the commit is the caller's. */
	answerWith(id: string, value: unknown): boolean;
	/** A leaf of words drawing proposal `id` over what it holds: how it stands against it,
	 *  `undefined` once it draws it no more. One the leaf already reads as is `applied`. */
	planned(id: string, state: ValueState | undefined): void;
	/** The value the place `item` names holds now, as its control is handed it. */
	current(item: FieldProposal): unknown;
	/** What Accept of `item` writes at a place holding `value`: a proposal of words a leaf draws
	 *  carried onto what the reader wrote since its writer read it, else its `after`. */
	writes(item: FieldProposal, value: unknown): unknown;
	/** An answer leaf `key` has already given, the item listed or not: a reopen and a redo's
	 *  accept arrive for items the host may have taken off or not yet put back. */
	heard(id: string, action: ReviewAction, key: string): void;
	/** A leaf is writing an answer, and is done: its edit is the answer's, not the reader's. */
	writing(on: boolean): void;
	/** Make `id` current at once: a step, a reveal, or a click or tap on it. */
	reveal(id: string): void;
	/** The pointer is over the answer card, which holds the current item where it is. */
	hoverCard(on: boolean): void;
}

export interface ReviewSource {
	items(): readonly ReviewItem[] | undefined;
	/** The leaf key a field path names, `undefined` for one the editor does not hold. */
	keyFor(path: DocPath): string | undefined;
	/** Whether a path names a field itself, and not a place inside one. */
	exact(path: DocPath): boolean;
	/** A path naming a place inside a field: the field's leaf key, the steps from it, and the
	 *  value it holds. `undefined` for a place its schema does not declare. */
	nested(path: DocPath): { key: string; steps: readonly PathStep[]; value: unknown } | undefined;
	/** The value the field at `path` holds, as its control is handed it. */
	valueAt(path: DocPath): unknown;
	/** The key of the prose leaf a rich text field's or a body's path names, `undefined` for
	 *  one the editor does not hold. */
	leafFor(path: DocPath): string | undefined;
	/** A reader's answer, to make and to pass on: `item` where the list holds it, `key` the
	 *  leaf that gave it where one did, `write` the value a dismissal made by an edit writes.
	 *  `false` where it could not be made, and the item stands; a function is the way back, which
	 *  takes back what the answer wrote and reopens the item. */
	answer(
		id: string,
		item: ReviewItem | undefined,
		action: ReviewAction,
		key?: string,
		write?: { value: unknown }
	): boolean | (() => void);
	/** Answer the item the prose leaf at `key` draws, as its answer card would. False where the
	 *  leaf could not. */
	answerProse(key: string, id: string, action: 'accept' | 'dismiss'): boolean;
	/** The editor's undo, which holds the newest journal entry for the key. */
	undo: StructuralUndo;
	/** The main card, then each card of the stack, each with its leaves as it draws them. */
	layout(): readonly CardLayout[];
	/** The session keys of the cards as they stood when the list was set, by index. */
	listedCards(): readonly string[];
	/** The session keys of the cards as they stand. */
	liveCards(): readonly string[];
	/** The session key of the card holding `$id` `id`, `undefined` where none does. */
	cardFor(id: string): string | undefined;
	/** The current item was answered: move on from it, in `order` where a batch of answers gives
	 *  the order it stood in before them. */
	answered?(id: string, order?: readonly string[]): void;
}

export function createReview(source: ReviewSource): Review & { dispose(): void } {
	/** The ids answered, each until a list arrives without it. */
	const answered = new Set<string>();
	let answers = $state(0);
	const items = $derived.by(() => {
		const listed = source.items() ?? [];
		if (!answers) return listed;
		const ids = new Set(listed.map((item) => item.id));
		for (const id of answered) if (!ids.has(id)) answered.delete(id);
		return answered.size ? listed.filter((item) => !answered.has(item.id)) : listed;
	});
	const drawn = new SvelteMap<string, ReviewReport>();
	const byId = $derived(new Map(items.map((item) => [item.id, item])));
	/** The items each prose leaf draws, by leaf key. */
	const text = $derived.by(() => {
		const own = new Map<string, TextReview[]>();
		for (const item of items) {
			if (!byBlocks(item)) continue;
			const key = source.leafFor(item.field);
			if (key === undefined) continue;
			let list = own.get(key);
			if (!list) own.set(key, (list = []));
			list.push(item);
		}
		return own;
	});
	/** The card each accepted `add` wrote, by item id. */
	const written = new SvelteMap<string, string>();
	const cards = $derived.by(() => {
		const listed = source.listedCards();
		const live = source.liveCards();
		const standing = new Set(live);
		const all = source.items() ?? [];
		const adds = new Map<string, CardAdd[]>();
		const removes = new Map<string, Extract<CardProposal, { remove: number }>>();
		const undrawn: { id: string; reason: ReviewUndrawn }[] = [];
		const open = new Set(items.map((item) => item.id));
		for (const [at, item] of all.entries()) {
			if (!byCard(item) || !open.has(item.id)) continue;
			if ('remove' in item) {
				const key = item.card === undefined ? listed[item.remove] : source.cardFor(item.card);
				if (key !== undefined && standing.has(key)) removes.set(key, item);
				else undrawn.push({ id: item.id, reason: 'applied' });
				continue;
			}
			const lead = leadOf(all, at, listed, standing);
			adds.set(lead, [...(adds.get(lead) ?? []), item]);
		}
		return { adds, removes, undrawn };
	});
	/** Where the `add` at `at` of `all` stands: after the card the nearest earlier add of the same
	 *  place wrote, else after the card it names, the head, or the end where that card is gone. */
	function leadOf(
		all: readonly ReviewItem[],
		at: number,
		listed: readonly string[],
		standing: ReadonlySet<string>
	): string {
		const item = all[at] as CardAdd;
		for (let k = at - 1; k >= 0; k--) {
			const before = all[k];
			if (!byCard(before) || !('add' in before)) continue;
			if (before.afterCard !== item.afterCard) continue;
			if (item.afterCard === undefined && before.after !== item.after) continue;
			const key = written.get(before.id);
			if (key !== undefined && standing.has(key)) return key;
		}
		if (item.afterCard !== undefined) {
			const key = source.cardFor(item.afterCard);
			return key !== undefined && standing.has(key) ? key : 'end';
		}
		if (item.after === undefined || item.after < 0) return 'head';
		const key = listed[item.after];
		return key !== undefined && standing.has(key) ? key : 'end';
	}
	const placed = $derived.by(() => {
		const out = new Map<string, { proposed?: FieldProposal; nested?: DeepReview[] }>();
		const undrawn: { id: string; reason: ReviewUndrawn }[] = [...cards.undrawn];
		/** The nested proposals whose `before` the field no longer holds. */
		const moved = new Set<string>();
		const claims = new Map<string, Set<string>>();
		for (const item of items) {
			if (byBlocks(item)) {
				if (source.leafFor(item.field) === undefined)
					undrawn.push({ id: item.id, reason: 'field' });
				continue;
			}
			if (!onField(item)) continue;
			if (!source.exact(item.field)) {
				const deep = source.nested(item.field);
				if (!deep) {
					undrawn.push({ id: item.id, reason: 'field' });
					continue;
				}
				const claimed = claims.get(deep.key) ?? new Set<string>();
				claims.set(deep.key, claimed);
				const held = out.get(deep.key) ?? {};
				const { steps, found } = locate(deep.value, deep.steps, item, claimed);
				if ((held.nested ?? []).some((e) => sameValue(e.steps, steps))) {
					undrawn.push({ id: item.id, reason: 'taken' });
					continue;
				}
				if (!found) moved.add(item.id);
				held.nested = [...(held.nested ?? []), { steps, item }];
				out.set(deep.key, held);
				continue;
			}
			const key = source.keyFor(item.field);
			if (key === undefined) {
				undrawn.push({ id: item.id, reason: 'field' });
				continue;
			}
			const held = out.get(key) ?? {};
			if (held.proposed !== undefined) {
				undrawn.push({ id: item.id, reason: 'taken' });
				continue;
			}
			held.proposed = item;
			out.set(key, held);
		}
		return { fields: out, undrawn, moved };
	});
	const fields = $derived(placed.fields);
	/** Each proposal of words a leaf draws, by id: how it stands against what the leaf holds. */
	const carried = new SvelteMap<string, ValueState>();
	// A proposal made from a value the field no longer holds would write over the reader's. One a
	// leaf of words carries is outdated only where the reader's writing meets it.
	const outdated = $derived.by(() => {
		const out = new Set<string>(placed.moved);
		for (const { proposed } of fields.values())
			if (
				proposed &&
				'before' in proposed &&
				!sameValue(source.valueAt(proposed.field), proposed.before)
			)
				out.add(proposed.id);
		for (const [id, state] of carried)
			if (state === 'outdated') out.add(id);
			else out.delete(id);
		return out;
	});

	/** The field items no control draws, those a leaf already reads as proposed among them. */
	const undrawnFields = $derived.by(() => {
		const applied = [...carried].filter(([, state]) => state === 'applied');
		if (!applied.length) return placed.undrawn;
		return [...placed.undrawn, ...applied.map(([id]) => ({ id, reason: 'applied' as const }))];
	});

	/** The open items drawn, in the page's order; one whose leaf no card lays out, last, in the
	 *  list's order. */
	const order = $derived.by(() => {
		const undrawn = new Set(undrawnFields.map((u) => u.id));
		const out = orderOf({
			layout: source.layout(),
			adds: cards.adds,
			removes: cards.removes,
			at: (key) => fields.get(key) ?? {},
			reports: drawn,
			undrawn
		});
		const placed = new Set(out);
		const reported = new Set<string>();
		for (const report of drawn.values()) for (const id of report.ids) reported.add(id);
		for (const item of items) {
			if (placed.has(item.id) || byCard(item)) continue;
			if (onField(item) ? !undrawn.has(item.id) : reported.has(item.id)) out.push(item.id);
		}
		return out;
	});
	const report = $derived.by((): ReviewDrawn => {
		const reported = new Set<string>();
		const stale = new Set(outdated);
		const why = new Map<string, ReviewUndrawn>();
		for (const leaf of drawn.values()) {
			for (const id of leaf.ids) reported.add(id);
			for (const id of leaf.outdated) stale.add(id);
			for (const { id, reason } of leaf.undrawn) {
				reported.add(id);
				why.set(id, reason);
			}
		}
		for (const { id, reason } of undrawnFields) why.set(id, reason);
		for (const item of items)
			if (!reported.has(item.id) && !why.has(item.id) && byBlocks(item)) why.set(item.id, 'block');
		return {
			open: order,
			outdated: order.filter((id) => stale.has(id)),
			undrawn: items.flatMap((item) => {
				const reason = why.get(item.id);
				return reason ? [{ id: item.id, reason }] : [];
			})
		};
	});

	let current = $state<string | undefined>();
	let dwell: ReturnType<typeof setTimeout> | undefined;
	let overCard = false;
	const lit = $derived(current !== undefined && byId.has(current) ? current : undefined);
	const name = (id: string): void => {
		clearTimeout(dwell);
		current = id;
	};

	interface Answered {
		ids: string[];
		inverses: (() => void)[];
	}
	let journal: Answered[] = [];
	/** The entry a batch of answers records into, and the current item it answered. */
	let batching: (Answered & { moved?: string }) | undefined;
	let offer: UndoOffer | undefined;
	let writing = 0;
	const offerJournal = (): void => {
		offer = journal.length
			? source.undo.offer('', unanswer, { standing: true, quiet: true, answer: true })
			: undefined;
	};
	const unanswer = (): void => {
		const top = journal.pop();
		if (!top) return;
		writing++;
		try {
			for (const inverse of [...top.inverses].reverse()) inverse();
		} finally {
			writing--;
		}
		offerJournal();
	};
	const record = (entry: Answered): void => {
		// Another step took the key since: the answers before it are no longer the last thing
		// that happened.
		if (!offer || !source.undo.holds(offer)) journal = [];
		journal.push(entry);
		offerJournal();
	};

	const answering = (id: string, action: ReviewAction, made: true | (() => void)): void => {
		if (made !== true) {
			if (batching) {
				batching.ids.push(id);
				batching.inverses.push(made);
			} else record({ ids: [id], inverses: [made] });
		}
		const was = current === id;
		if (action === 'reopen') answered.delete(id);
		else answered.add(id);
		answers++;
		if (action === 'reopen') name(id);
		else if (!was) return;
		else if (batching) batching.moved = id;
		else source.answered?.(id);
	};

	const self: Review & { dispose(): void } = {
		get items() {
			return items;
		},
		textAt: (key) => text.get(key) ?? NO_ITEMS,
		get reports() {
			return drawn;
		},
		get fieldUndrawn() {
			return undrawnFields;
		},
		get fieldOutdated() {
			return outdated;
		},
		get order() {
			return order;
		},
		get report() {
			return report;
		},
		get lit() {
			return lit;
		},
		get cards() {
			return cards;
		},
		wrote(id, key) {
			if (key === undefined) written.delete(id);
			else written.set(id, key);
		},
		current(item) {
			if (source.exact(item.field)) return source.valueAt(item.field);
			const place = source.nested(item.field);
			return place && valueIn(place.value, place.steps);
		},
		at: (key) => fields.get(key) ?? {},
		marks: (key) => fields.has(key) || !!drawn.get(key)?.ids.length,
		keyOf(id) {
			const item = byId.get(id);
			if (!item || byCard(item)) return undefined;
			if (byBlocks(item)) {
				const key = source.leafFor(item.field);
				return key !== undefined && drawn.get(key)?.ids.includes(id) ? key : undefined;
			}
			if ('field' in item) return source.keyFor(item.field);
			for (const [key, report] of drawn) if (report.ids.includes(id)) return key;
			return undefined;
		},
		drew(key, report) {
			if (report.ids.length || report.undrawn.length) drawn.set(key, report);
			else drawn.delete(key);
		},
		point(id, via) {
			if (via === 'caret') {
				if (id !== undefined) name(id);
				return;
			}
			clearTimeout(dwell);
			if (id === undefined || id === current) return;
			dwell = setTimeout(() => {
				if (!overCard && byId.has(id)) current = id;
			}, DWELL_MS);
		},
		act(id, action) {
			const item = byId.get(id);
			const made = item && source.answer(id, item, action);
			if (!made) return false;
			answering(id, action, made);
			return true;
		},
		answer(ids, action) {
			const before = order;
			const stale = new Set(ids === 'all' && action === 'accept' ? report.outdated : []);
			const asked =
				ids === 'all'
					? before.filter((id) => !stale.has(id))
					: before.filter((id) => ids.includes(id));
			const out: string[] = [];
			const entry: Answered & { moved?: string } = { ids: [], inverses: [] };
			batching = entry;
			writing++;
			try {
				for (const id of asked) {
					const item = byId.get(id);
					if (!item) continue;
					const key = self.keyOf(id);
					const made =
						onField(item) || byCard(item)
							? self.act(id, action)
							: key !== undefined && source.answerProse(key, id, action);
					if (made) out.push(id);
				}
			} finally {
				writing--;
				batching = undefined;
			}
			if (entry.ids.length) record({ ids: entry.ids, inverses: entry.inverses });
			if (entry.moved !== undefined) source.answered?.(entry.moved, before);
			return out;
		},
		settled() {
			if (writing) return;
			journal = [];
			offer = undefined;
			source.undo.settle();
		},
		answerWith(id, value) {
			const item = byId.get(id);
			if (!item || !onField(item)) return false;
			const action = writesProposed(value, item.after) ? 'accept' : 'dismiss';
			const write = action === 'dismiss' ? { value } : undefined;
			const made = source.answer(id, item, action, undefined, write);
			if (!made) return false;
			answering(id, action, made);
			return true;
		},
		planned(id, state) {
			if (state === undefined) carried.delete(id);
			else if (carried.get(id) !== state) carried.set(id, state);
		},
		writes(item, value) {
			const text = carried.has(item.id) ? textProposal(item) : undefined;
			const live = asContent(value);
			if (!text?.before || !live || item.after === undefined) return item.after;
			const { merged } = planValue(text.before, live, text.after);
			if (merged === text.after) return item.after;
			return typeof item.after === 'string' ? merged.text : merged;
		},
		writing(on) {
			writing += on ? 1 : -1;
		},
		heard(id, action, key) {
			const made = source.answer(id, byId.get(id), action, key);
			if (made) answering(id, action, made);
		},
		reveal: name,
		hoverCard(on) {
			overCard = on;
			if (on) clearTimeout(dwell);
		},
		dispose() {
			clearTimeout(dwell);
		}
	};
	return self;
}

const KEY = Symbol('qm.review');

export function setReview(review: Review): void {
	setContext(KEY, review);
}

const NO_ITEMS: readonly TextReview[] = [];

/** What a component rendered outside the editor gets: nothing to draw. */
const NO_REVIEW: Review = {
	items: [],
	textAt: () => NO_ITEMS,
	reports: new Map(),
	fieldUndrawn: [],
	fieldOutdated: new Set(),
	order: [],
	report: { open: [], outdated: [], undrawn: [] },
	lit: undefined,
	cards: { adds: new Map(), removes: new Map() },
	wrote() {},
	at: () => ({}),
	marks: () => false,
	keyOf: () => undefined,
	drew() {},
	point() {},
	act: () => false,
	answer: () => [],
	settled() {},
	answerWith: () => false,
	planned() {},
	current: () => undefined,
	writes: (item) => item.after,
	heard() {},
	writing() {},
	reveal() {},
	hoverCard() {}
};

/** The editor's review state, or {@link NO_REVIEW} off-tree. */
export function review(): Review {
	return getContext<Review>(KEY) ?? NO_REVIEW;
}
