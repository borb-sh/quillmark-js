// The structural undo: one step back for a removal, offered on a toast.
//
// A leaf's text has its own history (`core/codec/field.ts`), so a keystroke is undone where
// it was typed. A removal has no leaf left to hold one: the card or the row it took is gone
// from the tree, and with it every history that could have restored it. So the surface keeps
// the step itself, one deep, and offers it where the removal happened.
//
// One deep, and only the latest: a second removal replaces the first offer, and any other
// structural edit withdraws it, because the restore reinserts at the index the removal left
// and an edit between the two moves what that index names. The offer lapses on its own after
// a while, so an Undo pressed long after the removal is not a surprise; the while holds as
// long as the toast is under the pointer or the focus.
//
// A host's step rides the same toast and the same key (`offerUndo`): a write the host made for
// the reader, an assistant's answer, lands outside every leaf's history, so nothing the reader
// can press takes it back. It stands past its toast: it is the last thing that happened to the
// document until the reader does something else, so ⌘Z anywhere in the editor is its, a text
// leaf's own included, until the next edit lands.
//
// The key listens on the document while an offer stands, not on the surface: a removal by
// the pointer takes the pressed button with it and leaves the focus on the page's body,
// which no keydown on the surface hears.
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

export interface StructuralUndo {
	/** The offer on show, if any. */
	readonly current: UndoOffer | undefined;
	/** Offer `restore` as the undo of the removal just made, replacing any standing offer.
	 *  `standing` is a host's step: the key stays its past the toast, and in a text control,
	 *  until {@link settle}. */
	offer(notice: string, restore: () => void, standing?: boolean): void;
	/** An edit landed: a host's step is no longer the last thing that happened. */
	settle(): void;
	/** Name the control the removal handed the focus to. ⌘Z there is the offer's until the
	 *  control takes an edit or the focus leaves it: the key that removed is the key that
	 *  asks for it back, and the control has nothing of its own to undo yet. */
	hand(el: Element | null): void;
	/** Whether ⌘Z pressed at `target` is the offer's: the page's body, where a removal under
	 *  the pointer leaves the focus, when this offer is the page's latest; the handed control; or a control under `root` that keeps
	 *  no history of its own. A text control that is not the handed one keeps its key from a
	 *  removal's offer and gives it to a host's step. */
	accepts(target: EventTarget | null, root: Element | undefined): boolean;
	/** Hold the lapse while the toast is under the pointer or the focus, and let it run again. */
	pause(): void;
	resume(): void;
	/** Whether `offer` is the one standing, on its toast or past it. */
	holds(offer: UndoOffer | undefined): boolean;
	/** Run the standing offer and clear it. False when there was none to run. */
	take(): boolean;
	/** Drop the standing offer without running it. */
	withdraw(): void;
}

const EDITABLE = 'input, textarea, select, [contenteditable="true"]';

/** The editor whose offer is the page's latest: the body belongs to no surface, so of two
 *  editors with an offer standing, the key at the body is the one that offered last's. */
let latest: object | undefined;

export function createStructuralUndo(): StructuralUndo & { dispose(): void } {
	let current = $state<UndoOffer | undefined>();
	/** A host's step, held past its toast. */
	let kept: UndoOffer | undefined;
	let handed: Element | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let paused = false;
	const stop = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};
	const lapse = (): void => {
		timer = setTimeout(() => (kept ? lower() : clear()), OFFER_MS);
	};
	const lower = (): void => {
		stop();
		paused = false;
		handed = undefined;
		current = undefined;
	};
	const clear = (): void => {
		lower();
		kept = undefined;
	};
	const self: StructuralUndo & { dispose(): void } = {
		get current() {
			return current;
		},
		offer(notice, restore, standing = false) {
			clear();
			current = { notice, restore };
			if (standing) kept = current;
			latest = self;
			lapse();
		},
		settle() {
			if (kept) clear();
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
			if (!(current ?? kept) || !(target instanceof Element)) return false;
			if (target === document.body) return latest === self;
			if (target === handed) return true;
			return !!root?.contains(target) && (!!kept || !target.closest(EDITABLE));
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
		holds: (offer) => !!offer && (current ?? kept) === offer,
		take() {
			const offer = current ?? kept;
			clear();
			if (!offer) return false;
			offer.restore();
			return true;
		},
		withdraw: clear,
		dispose: clear
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
	offer() {},
	settle() {},
	hand() {},
	accepts: () => false,
	pause() {},
	resume() {},
	holds: () => false,
	take: () => false,
	withdraw() {}
};

/** The editor's undo, or {@link NO_UNDO} off-tree. */
export function structuralUndo(): StructuralUndo {
	return getContext<StructuralUndo>(KEY) ?? NO_UNDO;
}
