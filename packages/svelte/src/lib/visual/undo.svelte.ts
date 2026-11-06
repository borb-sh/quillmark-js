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
// a while, so an Undo pressed long after the removal is not a surprise.
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
	/** Run the standing offer and clear it. False when there was none to run. */
	take(): boolean;
	/** Drop the standing offer without running it. */
	withdraw(): void;
}

export function createStructuralUndo(): StructuralUndo & { dispose(): void } {
	let current = $state<UndoOffer | undefined>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const clear = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		current = undefined;
	};
	return {
		get current() {
			return current;
		},
		offer(notice, restore) {
			clear();
			current = { notice, restore };
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
			take: () => false,
			withdraw() {}
		}
	);
}
