// The editor's review state: the host's list split by where each item draws, and the one item
// under attention.
//
// Attention has three sources and one answer. The pointer over an item, the caret in one and a
// host's reveal each name an item; the lit one is the revealed, else the caret's, else the
// pointer's.
//
// An answered item is drawn no more, from the answer and not from the host's next list: the
// reader's press shows at once however long the host takes to hand over a list without it.
import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { PathStep } from '@quillmark/wasm';
import type { DocPath } from '../core/address.js';
import type { ReviewAction, ReviewReport, ReviewVia, TextReview } from '../core/codec/index.js';
import {
	byBlocks,
	byCard,
	locate,
	onField,
	sameValue,
	type DeepReview,
	type FieldProposal,
	type ReviewItem,
	type ReviewUndrawn
} from './review.js';

/** How long the pointer rests on an item before it becomes current, in ms. */
export const DWELL_MS = 160;

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
	/** The item under attention. */
	readonly lit: string | undefined;
	/** The items over the field at leaf `key`: its own, and those naming a place inside it,
	 *  each with the steps to the value it names as the field holds it now. */
	at(key: string): { proposed?: FieldProposal; nested?: readonly DeepReview[] };
	/** Whether anything draws at leaf `key`: a field's own item, or a text item in its leaf. */
	marks(key: string): boolean;
	/** The leaf drawing item `id`, where one does. */
	keyOf(id: string): string | undefined;
	/** A prose leaf's report of what it draws. */
	drew(key: string, report: ReviewReport): void;
	/** The item the pointer or the caret is in, from leaf `from`: a caret's leaving reported by
	 *  a leaf the caret has already left for another is old news. */
	point(id: string | undefined, via: ReviewVia, from?: string): void;
	/** A reader's answer, `chord` where a key gave it. False where it could not be made. */
	act(id: string, action: ReviewAction, chord?: boolean): boolean;
	/** An answer leaf `key` has already given, the item listed or not: a reopen and a redo's
	 *  accept arrive for items the host may have taken off or not yet put back. */
	heard(id: string, action: ReviewAction, key: string, chord?: boolean): void;
	/** A leaf is writing an answer, and is done: its edit is the answer's, not the reader's. */
	writing(on: boolean): void;
	reveal(id: string): void;
	/** A click or tap on an item: current at once. */
	pick(id: string): void;
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
	 *  leaf that gave it where one did. `false` where it could not be made, and the item
	 *  stands. */
	answer(id: string, item: ReviewItem | undefined, action: ReviewAction, key?: string): boolean;
	/** An answer, once it is made: the editor moves on from it. */
	answered?(id: string): void;
	writing?(on: boolean): void;
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
	const placed = $derived.by(() => {
		const out = new Map<string, { proposed?: FieldProposal; nested?: DeepReview[] }>();
		const undrawn: { id: string; reason: ReviewUndrawn }[] = [];
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
	// A proposal made from a value the field no longer holds would write over the reader's.
	const outdated = $derived.by(() => {
		const out = new Set<string>(placed.moved);
		for (const { proposed } of fields.values())
			if (
				proposed &&
				'before' in proposed &&
				!sameValue(source.valueAt(proposed.field), proposed.before)
			)
				out.add(proposed.id);
		return out;
	});

	/** The one current item: sticky, set by a step, a reveal, the caret, a click, or the pointer
	 *  after a dwell, and held until another names one or it is answered. */
	let current = $state<string | undefined>();
	let dwell: ReturnType<typeof setTimeout> | undefined;
	let overCard = false;
	const lit = $derived(current !== undefined && byId.has(current) ? current : undefined);

	const answering = (id: string, action: ReviewAction, chord?: boolean): void => {
		void chord;
		if (action === 'reopen') {
			answered.delete(id);
			current = id;
		} else answered.add(id);
		answers++;
		if (action !== 'reopen') source.answered?.(id);
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
			return placed.undrawn;
		},
		get fieldOutdated() {
			return outdated;
		},
		get lit() {
			return lit;
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
			if (via === 'pointer') {
				clearTimeout(dwell);
				if (id === undefined || id === current) return;
				dwell = setTimeout(() => {
					if (!overCard && byId.has(id)) current = id;
				}, DWELL_MS);
				return;
			}
			if (id !== undefined) current = id;
		},
		act(id, action, chord) {
			const item = byId.get(id);
			if (!item || !source.answer(id, item, action)) return false;
			answering(id, action, chord);
			return true;
		},
		writing: (on) => source.writing?.(on),
		heard(id, action, key, chord) {
			if (source.answer(id, byId.get(id), action, key)) answering(id, action, chord);
		},
		reveal(id) {
			clearTimeout(dwell);
			current = id;
		},
		pick(id) {
			clearTimeout(dwell);
			if (byId.has(id)) current = id;
		},
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
	lit: undefined,
	at: () => ({}),
	marks: () => false,
	keyOf: () => undefined,
	drew() {},
	point() {},
	act: () => false,
	heard() {},
	writing() {},
	reveal() {},
	pick() {},
	hoverCard() {}
};

/** The editor's review state, or {@link NO_REVIEW} off-tree. */
export function review(): Review {
	return getContext<Review>(KEY) ?? NO_REVIEW;
}
