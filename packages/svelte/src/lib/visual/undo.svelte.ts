// The structural undo: the step back for a removal, offered on a toast.
//
// A leaf's text has its own history (`core/codec/field.ts`), so a keystroke is undone where
// it was typed. A removal has no leaf left to hold one: the card or the row it took is gone
// from the tree, and with it every history that could have restored it. So the surface keeps
// the step itself and offers it where the removal happened.
//
// An offer is the latest step's, and one deep: a second replaces the first, and the toast
// lapses on its own after a while, the while holding as long as the toast is under the
// pointer or the focus. A row's step goes with its offer, its list's own history being what
// holds it after: the restore reinserts at the index the removal left, so any other
// structural edit withdraws it.
//
// Two steps are held past their toast, each the last thing that happened to the document
// until the next edit lands, and ⌘Z is theirs until then.
//
// A card's step is kept for the session, because nothing else holds a card: its restore
// names the neighbours it left rather than an index, so no later edit unseats it, and the
// surface draws the newest kept step as a standing control. Past the next edit the control
// is the way back, so the key never brings back a card the user has since worked past.
//
// A standing step rides the same toast and the same key: the review answers since the
// reader's last edit, which land outside every leaf's history. ⌘Z anywhere in the editor is
// its, a text leaf's own included. Its restore is good against the document it was offered
// over and no other, so the next edit drops it, toast and all. It is made by no edit, so it
// holds a card's step it was offered over: taking the answer back leaves the card's the last
// thing that happened again.
//
// The key listens on the document, not on the surface: a removal by the pointer takes the
// pressed button with it and leaves the focus on the page's body, which no keydown on the
// surface hears.
import { getContext, setContext } from 'svelte';

/** How long an offer stands, in ms. Long enough to read the toast and reach its button;
 *  short enough that the toast is gone before the user has moved on to something else. */
export const OFFER_MS = 6000;

export interface UndoOffer {
	/** What the toast says, already worded: `Item 2 removed`. */
	readonly notice: string;
	/** Put back what the removal took. Runs at most once. */
	readonly restore: () => void;
}

/** A removal whose step is kept for the session. */
export interface KeptStep {
	/** What the standing control says, already worded: `Restore Findings`. */
	readonly label: string;
	/** Put back what the removal took. Runs at most once. */
	readonly restore: () => void;
}

/** How a step is held past its toast. */
export interface Hold {
	/** A standing step: the key is its in a text control too, and the next edit drops it. */
	readonly standing?: boolean;
	/** A card's step: kept under this label, whatever lands after. */
	readonly keptAs?: string;
	/** Held for the key alone, with no toast: a standing step whose way back is the key. */
	readonly quiet?: boolean;
	/** A review answer's step, standing: an answer is no edit, so it holds the card's step it
	 *  was offered over, which is the key's again once the answer is taken back. */
	readonly answer?: boolean;
}

export interface StructuralUndo {
	/** The offer on show, if any. */
	readonly current: UndoOffer | undefined;
	/** The newest kept step, if any. */
	readonly kept: KeptStep | undefined;
	/** Offer `restore` as the undo of the step just made, replacing any standing offer. With
	 *  a `hold`, the key stays the step's past its toast, until {@link settle}. Returns the
	 *  offer, for {@link holds}. */
	offer(notice: string, restore: () => void, hold?: Hold): UndoOffer;
	/** An edit landed: a held step is no longer the last thing that happened. A standing one
	 *  goes, and a kept one answers to its control alone once its offer has. */
	settle(): void;
	/** Name the control the removal handed the focus to. ⌘Z there is the offer's until the
	 *  control takes an edit or the focus leaves it: the key that removed is the key that
	 *  asks for it back, and the control has nothing of its own to undo yet. */
	hand(el: Element | null): void;
	/** Whether ⌘Z pressed at `target` is this undo's: there is an offer, or a held step no
	 *  edit has landed since, and the target is the page's body, where a removal under the
	 *  pointer leaves the focus, when this editor offered last on the page; the handed
	 *  control; or a control under `root` that keeps no history of its own. A text control
	 *  that is not the handed one keeps its key from a removal and gives it to a standing step. */
	accepts(target: EventTarget | null, root: Element | undefined): boolean;
	/** Hold the lapse while the toast is under the pointer or the focus, and let it run again. */
	pause(): void;
	resume(): void;
	/** Whether `offer` is the one the key would take, on its toast or held past it. */
	holds(offer: UndoOffer | undefined): boolean;
	/** Run the standing offer, or with none the held step, and clear it. False when there
	 *  was nothing to run. */
	take(): boolean;
	/** Run the newest kept step, whatever offer stands. False when none is kept. */
	takeKept(): boolean;
	/** Drop the standing offer or the held step without running it, unless it is kept. */
	withdraw(): void;
}

const EDITABLE = 'input, textarea, select, [contenteditable="true"]';

/** A step held past its toast, and an answer's, the card's step it was offered over. */
interface Held {
	readonly offer: UndoOffer;
	readonly standing: boolean;
	readonly under?: Held;
}

/** The editor whose offer is the page's latest: the body belongs to no surface, so of two
 *  editors with an offer standing, the key at the body is the one that offered last's. */
let latest: object | undefined;

export function createStructuralUndo(): StructuralUndo & { dispose(): void } {
	let current = $state.raw<UndoOffer | undefined>();
	let kept = $state.raw<readonly KeptStep[]>([]);
	/** The held step no edit has landed since: the key's, on its toast or past it. */
	let last: Held | undefined;
	let handed: Element | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let paused = false;
	const stop = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};
	const lower = (): void => {
		stop();
		paused = false;
		handed = undefined;
		current = undefined;
	};
	const lapse = (): void => {
		timer = setTimeout(lower, OFFER_MS);
	};
	const clear = (): void => {
		lower();
		last = undefined;
	};
	/** The step the key would take. */
	const live = (): UndoOffer | undefined => current ?? last?.offer;
	const stepOf = (offer: UndoOffer | undefined): KeptStep | undefined =>
		offer && kept.find((step) => step.restore === offer.restore);
	const run = (step: KeptStep): void => {
		kept = kept.filter((k) => k !== step);
		step.restore();
	};
	const self: StructuralUndo & { dispose(): void } = {
		get current() {
			return current;
		},
		get kept() {
			return kept.at(-1);
		},
		offer(notice, restore, { standing = false, keptAs, quiet = false, answer = false } = {}) {
			const under = answer ? (last?.standing ? last.under : last) : undefined;
			clear();
			const offer = { notice, restore };
			if (keptAs !== undefined) kept = [...kept, { label: keptAs, restore }];
			if (standing || keptAs !== undefined) last = { offer, standing, under };
			latest = self;
			if (quiet) return offer;
			current = offer;
			lapse();
			return offer;
		},
		settle() {
			if (last?.standing) clear();
			else last = undefined;
		},
		hand(el) {
			if (!current || !el) return;
			handed = el;
			const release = (): void => {
				if (handed === el) handed = undefined;
				el.removeEventListener('input', release);
				el.removeEventListener('focusout', release);
			};
			el.addEventListener('input', release);
			el.addEventListener('focusout', release);
		},
		accepts(target, root) {
			if (!live() || !(target instanceof Element)) return false;
			if (target === document.body) return latest === self;
			if (target === handed) return true;
			return !!root?.contains(target) && (!!last?.standing || !target.closest(EDITABLE));
		},
		pause() {
			if (!current || paused) return;
			paused = true;
			stop();
		},
		resume() {
			if (!current || !paused) return;
			paused = false;
			lapse();
		},
		holds: (offer) => !!offer && live() === offer,
		take() {
			const offer = live();
			if (!offer) return false;
			const step = stepOf(offer);
			const under = last?.standing && last.offer === offer ? last.under : undefined;
			clear();
			last = under && stepOf(under.offer) ? under : undefined;
			if (step) run(step);
			else offer.restore();
			return true;
		},
		takeKept() {
			const step = kept.at(-1);
			if (!step) return false;
			if (stepOf(live()) === step) clear();
			run(step);
			return true;
		},
		withdraw() {
			if (!stepOf(live())) clear();
		},
		dispose() {
			clear();
			kept = [];
		}
	};
	return self;
}

const KEY = Symbol('qm.undo');

export function setStructuralUndo(undo: StructuralUndo): void {
	setContext(KEY, undo);
}

/** What a component rendered outside the editor gets: no offer, so it removes as it always did. */
const NO_UNDO: StructuralUndo = {
	current: undefined,
	kept: undefined,
	offer: (notice, restore) => ({ notice, restore }),
	settle() {},
	hand() {},
	accepts: () => false,
	pause() {},
	resume() {},
	holds: () => false,
	take: () => false,
	takeKept: () => false,
	withdraw() {}
};

/** The editor's undo, or {@link NO_UNDO} off-tree. */
export function structuralUndo(): StructuralUndo {
	return getContext<StructuralUndo>(KEY) ?? NO_UNDO;
}
