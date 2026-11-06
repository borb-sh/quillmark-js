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
	/** Offer `restore` as the undo of the removal just made, replacing any standing offer. */
	offer(notice: string, restore: () => void): void;
	/** Name the control the removal handed the focus to. ⌘Z there is the offer's until the
	 *  control takes an edit or the focus leaves it: the key that removed is the key that
	 *  asks for it back, and the control has nothing of its own to undo yet. */
	hand(el: Element | null): void;
	/** Whether ⌘Z pressed at `target` is the offer's: the page's body, where a removal under
	 *  the pointer leaves the focus, when this offer is the page's latest; the handed control; or a control under `root` that keeps
	 *  no history of its own. A text control that is not the handed one keeps its key. */
	accepts(target: EventTarget | null, root: Element | undefined): boolean;
	/** Hold the lapse while the toast is under the pointer or the focus, and let it run again. */
	pause(): void;
	resume(): void;
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
	let handed: Element | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let paused = false;
	const stop = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};
	const clear = (): void => {
		stop();
		paused = false;
		handed = undefined;
		current = undefined;
	};
	const self: StructuralUndo & { dispose(): void } = {
		get current() {
			return current;
		},
		offer(notice, restore) {
			clear();
			current = { notice, restore };
			latest = self;
			timer = setTimeout(clear, OFFER_MS);
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
			if (!current || !(target instanceof Element)) return false;
			if (target === document.body) return latest === self;
			if (target === handed) return true;
			return !!root?.contains(target) && !target.closest(EDITABLE);
		},
		pause() {
			if (!current || paused) return;
			paused = true;
			stop();
		},
		resume() {
			if (!current || !paused) return;
			paused = false;
			timer = setTimeout(clear, OFFER_MS);
		},
		take() {
			const offer = current;
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

/** The editor's undo, or one that offers nothing off-tree, so a component rendered outside
 *  the editor removes as it always did. */
export function structuralUndo(): StructuralUndo {
	return (
		getContext<StructuralUndo>(KEY) ?? {
			current: undefined,
			offer() {},
			hand() {},
			accepts: () => false,
			pause() {},
			resume() {},
			take: () => false,
			withdraw() {}
		}
	);
}
