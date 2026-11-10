// The editor's review state: the host's list split by where each item draws, and the one item
// under attention.
//
// Attention has three sources and one answer. The pointer over an item, the caret in one and a
// host's reveal each name an item; the lit one is the card's where a card is up, else the
// revealed, the caret's, the pointer's, in that order. A card is the before-and-undo surface of an
// accepted proposal: it rises at once for a reveal, and after a beat for the pointer and the caret,
// so neither raises one on its way across a paragraph, and it waits a beat on the pointer's
// leaving so the pointer can travel into it.
//
// A dismissed item is drawn no more, from the answer and not from the host's next list: the
// reader's press shows at once however long the host takes to hand over a list without it.
import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { PathStep } from '@quillmark/wasm';
import type { DocPath } from '../core/address.js';
import type { ReviewAction, ReviewReport, ReviewVia, TextReview } from '../core/codec/index.js';
import {
	byBlocks,
	locate,
	isChange,
	onField,
	sameValue,
	type DeepReview,
	type FieldChange,
	type FieldProposal,
	type ReviewItem,
	type ReviewUndrawn
} from './review.js';

/** How long the pointer or the caret rests on a change before its card rises, in ms. */
export const HOVER_MS = 350;
/** How long a card outlasts the pointer's leaving, in ms: the trip from the mark into the card. */
export const LEAVE_MS = 200;
/** How long a revealed item with no card stays lit, in ms. */
export const REVEAL_MS = 2400;

/** The card on show: the accepted proposal it is up for, as its change, and what raised it. */
export interface ShownReview {
	item: FieldChange | TextChange;
	via: ReviewVia | 'reveal';
}

/** A proposal taken in a prose leaf, as the change it made, `before` the text it replaced. */
export type TextChange = { id: string; state: 'changed'; before?: string };

export interface Review {
	/** The host's list, less what was answered here. */
	readonly items: readonly ReviewItem[];
	/** The proposals accepted and still listed, each as the change it made. */
	readonly accepted: ReadonlyMap<string, FieldChange | TextChange>;
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
	readonly shown: ShownReview | undefined;
	/** The items over the field at leaf `key`: its own, and those naming a place inside it,
	 *  each with the steps to the value it names as the field holds it now. */
	at(key: string): {
		changed?: FieldChange;
		proposed?: FieldProposal;
		nested?: readonly DeepReview[];
	};
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
	/** Hold the card up while the pointer or the focus is in it, and let it go again. */
	hold(): void;
	release(): void;
	dismiss(): void;
	reveal(id: string): void;
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
	answer(
		id: string,
		item: ReviewItem | FieldChange | TextChange | undefined,
		action: ReviewAction,
		key?: string
	): boolean;
	/** An answer a chord gave, once it is made. */
	chorded?(id: string): void;
	writing?(on: boolean): void;
	/** The field proposals accepted here, each as the change it made. */
	taken?(): ReadonlyMap<string, FieldChange>;
	/** Take back what accepting `id` wrote, so it is open again. */
	putBack?(id: string): boolean;
}

export function createReview(source: ReviewSource): Review & { dispose(): void } {
	/** The ids answered, each until a list arrives without it. */
	const answered = new Set<string>();
	/** The field proposals accepted here, drawn while the field still holds what was written. */
	const took = new Set<string>();
	let answers = $state(0);
	const items = $derived.by(() => {
		const listed = source.items() ?? [];
		if (!answers) return listed;
		const ids = new Set(listed.map((item) => item.id));
		for (const id of answered) if (!ids.has(id)) answered.delete(id);
		for (const id of took) if (!ids.has(id)) took.delete(id);
		const taken = source.taken?.();
		const gone = (id: string): boolean => answered.has(id) || (took.has(id) && !taken?.has(id));
		return answered.size || took.size ? listed.filter((item) => !gone(item.id)) : listed;
	});
	const drawn = new SvelteMap<string, ReviewReport>();
	/** Each accepted proposal still listed, as the change the card and the field draw. */
	const accepted = $derived.by(() => {
		const out = new Map<string, FieldChange | TextChange>();
		const listed = new Map((source.items() ?? []).map((item) => [item.id, item]));
		for (const [id, change] of source.taken?.() ?? []) if (listed.has(id)) out.set(id, change);
		for (const report of drawn.values())
			for (const { id, before } of report.accepted ?? []) {
				const item = listed.get(id);
				if (item && byBlocks(item)) out.set(id, { id, state: 'changed', before });
			}
		return out;
	});
	const byId = $derived(new Map(items.map((item) => [item.id, accepted.get(item.id) ?? item])));
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
		const out = new Map<
			string,
			{ changed?: FieldChange; proposed?: FieldProposal; nested?: DeepReview[] }
		>();
		const undrawn: { id: string; reason: ReviewUndrawn }[] = [];
		/** The nested proposals whose `before` the field no longer holds. */
		const moved = new Set<string>();
		const claims = new Map<string, Set<string>>();
		for (const listed of items) {
			if (byBlocks(listed)) {
				if (source.leafFor(listed.field) === undefined)
					undrawn.push({ id: listed.id, reason: 'field' });
				continue;
			}
			const item = accepted.get(listed.id) ?? listed;
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
				const same = (held.nested ?? []).some(
					(e) => isChange(e.item) === isChange(item) && sameValue(e.steps, steps)
				);
				if (same) {
					undrawn.push({ id: item.id, reason: 'taken' });
					continue;
				}
				if (!found && !isChange(item)) moved.add(item.id);
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
			if ((isChange(item) ? held.changed : held.proposed) !== undefined) {
				undrawn.push({ id: item.id, reason: 'taken' });
				continue;
			}
			if (isChange(item)) held.changed = item;
			else held.proposed = item;
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

	let pointer = $state<string | undefined>();
	let caret = $state<string | undefined>();
	let caretFrom: string | undefined;
	let revealed = $state<string | undefined>();
	let card = $state<{ id: string; via: ReviewVia | 'reveal' } | undefined>();
	let held = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	/** The caret's rest on a change, its own so the pointer's passing does not restart it. */
	let rest: ReturnType<typeof setTimeout> | undefined;
	let fade: ReturnType<typeof setTimeout> | undefined;
	const wait = (ms: number, then: () => void): void => {
		clearTimeout(timer);
		timer = setTimeout(then, ms);
	};
	const changed = (id: string | undefined): id is string =>
		id !== undefined && !!byId.get(id) && isChange(byId.get(id)!);

	const shown = $derived.by((): ShownReview | undefined => {
		const item = card && byId.get(card.id);
		return item && isChange(item) && card ? { item, via: card.via } : undefined;
	});
	const lit = $derived(
		[shown?.item.id, revealed, caret, pointer].find((id) => id !== undefined && byId.has(id))
	);

	const answering = (id: string, action: ReviewAction, chord?: boolean): void => {
		if (action === 'reopen') {
			answered.delete(id);
			took.delete(id);
		} else {
			if (card?.id === id) card = undefined;
			// An accepted proposal stays, drawn as its change, while the list holds it.
			if (action !== 'accept') answered.add(id);
			else if (byId.get(id) && onField(byId.get(id)!)) took.add(id);
		}
		answers++;
		if (chord) source.chorded?.(id);
	};

	const self: Review & { dispose(): void } = {
		get items() {
			return items;
		},
		get accepted() {
			return accepted;
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
		get shown() {
			return shown;
		},
		at: (key) => fields.get(key) ?? {},
		marks: (key) => fields.has(key) || !!drawn.get(key)?.ids.length,
		keyOf(id) {
			const item = byId.get(id);
			if (!item) return undefined;
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
		point(id, via, from) {
			if (via === 'caret') {
				if (id === undefined && from !== undefined && caretFrom !== from) return;
				caretFrom = from;
				caret = id;
				clearTimeout(rest);
				if (changed(id)) {
					// A card already up for the item is the caret's from here: it stays while
					// the caret does. The caret's card takes the pointer's place.
					const raise = (): void => {
						clearTimeout(timer);
						card = { id, via };
					};
					if (card?.id === id) raise();
					else
						rest = setTimeout(() => {
							if (caret === id) raise();
						}, HOVER_MS);
				} else if (card?.via === 'caret' || (id !== undefined && card)) card = undefined;
				if (id !== undefined) revealed = undefined;
				return;
			}
			pointer = id;
			if (changed(id)) {
				if (card?.id === id) return clearTimeout(timer);
				if (card && card.via !== 'pointer') return;
				if (card) card = { id, via };
				else
					wait(HOVER_MS, () => {
						if (pointer === id && (!card || card.via === 'pointer')) card = { id, via };
					});
			} else if (card?.via === 'pointer' && !held)
				wait(LEAVE_MS, () => {
					if (card?.via === 'pointer' && card.id !== pointer && !held) card = undefined;
				});
			else clearTimeout(timer);
		},
		act(id, action, chord) {
			if (accepted.has(id) && action === 'reopen') return source.putBack?.(id) ?? false;
			const item = byId.get(id);
			if (!item || !source.answer(id, item, action)) return false;
			answering(id, action, chord);
			return true;
		},
		writing: (on) => source.writing?.(on),
		heard(id, action, key, chord) {
			if (source.answer(id, byId.get(id), action, key)) answering(id, action, chord);
		},
		hold() {
			held = true;
			clearTimeout(timer);
		},
		release() {
			held = false;
			if (card?.via === 'pointer' && card.id !== pointer)
				wait(LEAVE_MS, () => {
					if (!held && card?.via === 'pointer' && card.id !== pointer) card = undefined;
				});
		},
		dismiss() {
			clearTimeout(timer);
			clearTimeout(rest);
			card = undefined;
		},
		reveal(id) {
			clearTimeout(timer);
			clearTimeout(rest);
			clearTimeout(fade);
			card = changed(id) ? { id, via: 'reveal' } : undefined;
			revealed = id;
			fade = setTimeout(() => {
				if (revealed === id) revealed = undefined;
			}, REVEAL_MS);
		},
		dispose() {
			clearTimeout(timer);
			clearTimeout(rest);
			clearTimeout(fade);
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
	accepted: new Map(),
	textAt: () => NO_ITEMS,
	reports: new Map(),
	fieldUndrawn: [],
	fieldOutdated: new Set(),
	lit: undefined,
	shown: undefined,
	at: () => ({}),
	marks: () => false,
	keyOf: () => undefined,
	drew() {},
	point() {},
	act: () => false,
	heard() {},
	writing() {},
	hold() {},
	release() {},
	dismiss() {},
	reveal() {}
};

/** The editor's review state, or {@link NO_REVIEW} off-tree. */
export function review(): Review {
	return getContext<Review>(KEY) ?? NO_REVIEW;
}
