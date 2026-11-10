// The editor's review state: the host's list split by where each item draws, and the one item
// under attention.
//
// Attention has three sources and one answer. The pointer over an item, the caret in one and a
// host's reveal each name an item; the lit one is the card's where a card is up, else the
// revealed, the caret's, the pointer's, in that order. A card is the before-and-undo surface of a
// `changed` item: it rises at once for a reveal, and after a beat for the pointer and the caret,
// so neither raises one on its way across a paragraph, and it waits a beat on the pointer's
// leaving so the pointer can travel into it.
//
// An answered item is drawn no more, from the answer and not from the host's next list: the
// reader's press shows at once however long the host takes to hand over a list without it.
import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { DocPath } from '../core/address.js';
import type { ReviewAction, ReviewVia, TextReview } from '../core/codec/index.js';
import type { FieldChange, FieldProposal, ReviewItem } from './review.js';

/** How long the pointer or the caret rests on a change before its card rises, in ms. */
export const HOVER_MS = 350;
/** How long a card outlasts the pointer's leaving, in ms: the trip from the mark into the card. */
export const LEAVE_MS = 200;
/** How long a revealed item with no card stays lit, in ms. */
export const REVEAL_MS = 2400;

/** The card on show: the `changed` item it is up for, and what raised it. */
export interface ShownReview {
	item: Extract<ReviewItem, { state: 'changed' }>;
	via: ReviewVia | 'reveal';
}

export interface Review {
	/** The items a prose leaf draws, one identity until the list changes. */
	readonly text: readonly TextReview[];
	/** The item under attention. */
	readonly lit: string | undefined;
	readonly shown: ShownReview | undefined;
	/** The items over the field at leaf `key`. */
	at(key: string): { changed?: FieldChange; proposed?: FieldProposal };
	/** Whether anything draws at leaf `key`: a field's own item, or a text item in its leaf. */
	marks(key: string): boolean;
	/** The leaf drawing item `id`, where one does. */
	keyOf(id: string): string | undefined;
	/** A prose leaf's report of the ids it draws. */
	drew(key: string, ids: readonly string[]): void;
	point(id: string | undefined, via: ReviewVia): void;
	act(id: string, action: ReviewAction): void;
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
	/** A reader's answer, to make and to pass on. `false` where it could not be made, and the
	 *  item stands. */
	answer(item: ReviewItem, action: ReviewAction): boolean;
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
	const byId = $derived(new Map(items.map((item) => [item.id, item])));
	const text = $derived(
		items.flatMap((item): TextReview[] =>
			'anchor' in item
				? [
						item.state === 'proposed'
							? { id: item.id, state: 'proposed', anchor: item.anchor, after: item.after }
							: { id: item.id, state: 'changed', anchor: item.anchor }
					]
				: []
		)
	);
	const fields = $derived.by(() => {
		const out = new Map<string, { changed?: FieldChange; proposed?: FieldProposal }>();
		for (const item of items) {
			if (!('field' in item)) continue;
			const key = source.keyFor(item.field);
			if (key === undefined) continue;
			const held = out.get(key) ?? {};
			if (item.state === 'changed') held.changed ??= item;
			else held.proposed ??= item;
			out.set(key, held);
		}
		return out;
	});
	const drawn = new SvelteMap<string, readonly string[]>();

	let pointer = $state<string | undefined>();
	let caret = $state<string | undefined>();
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
		id !== undefined && byId.get(id)?.state === 'changed';

	const shown = $derived.by((): ShownReview | undefined => {
		const item = card && byId.get(card.id);
		return item?.state === 'changed' && card ? { item, via: card.via } : undefined;
	});
	const lit = $derived(
		[shown?.item.id, revealed, caret, pointer].find((id) => id !== undefined && byId.has(id))
	);

	const self: Review & { dispose(): void } = {
		get text() {
			return text;
		},
		get lit() {
			return lit;
		},
		get shown() {
			return shown;
		},
		at: (key) => fields.get(key) ?? {},
		marks: (key) => fields.has(key) || !!drawn.get(key)?.length,
		keyOf(id) {
			const item = byId.get(id);
			if (!item) return undefined;
			if ('field' in item) return source.keyFor(item.field);
			for (const [key, ids] of drawn) if (ids.includes(id)) return key;
			return undefined;
		},
		drew(key, ids) {
			if (ids.length) drawn.set(key, ids);
			else drawn.delete(key);
		},
		point(id, via) {
			if (via === 'caret') {
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
		act(id, action) {
			const item = byId.get(id);
			if (!item || !source.answer(item, action)) return;
			if (card?.id === id) card = undefined;
			answered.add(id);
			answers++;
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
	text: NO_ITEMS,
	lit: undefined,
	shown: undefined,
	at: () => ({}),
	marks: () => false,
	keyOf: () => undefined,
	drew() {},
	point() {},
	act() {},
	hold() {},
	release() {},
	dismiss() {},
	reveal() {}
};

/** The editor's review state, or {@link NO_REVIEW} off-tree. */
export function review(): Review {
	return getContext<Review>(KEY) ?? NO_REVIEW;
}
