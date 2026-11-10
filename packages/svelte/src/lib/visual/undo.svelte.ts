// The structural undo: the step back for a removal, offered on a toast.
//
// A leaf's text has its own history (`core/codec/field.ts`), so a keystroke is undone where
// it was typed. A removal has no leaf left to hold one: the card or the row it took is gone
// from the tree, and with it every history that could have restored it. So the surface keeps
// the step itself and offers it where the removal happened.
//
// An offer is the latest removal's, and one deep: a second removal replaces the first, and
// the toast lapses on its own after a while, the while holding as long as the toast is under
// the pointer or the focus. A row's step goes with its offer, its list's own history being
// what holds it after: the restore reinserts at the index the removal left, so any other
// structural edit withdraws it.
//
// A card's step is kept, because nothing else holds a card: its restore names the
// neighbours it left rather than an index, so no later edit unseats it, and the surface
// draws the newest kept step as a standing control once the toast is gone. ⌘Z reaches a
// kept step with no toast up only while its removal is the document's latest change, so the
// key never brings back a card the user has since worked past; the control is the way back
// from there.
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

/** A removal whose step outlives its offer. */
export interface KeptStep {
	/** What the standing control says, already worded: `Restore Findings`. */
	readonly label: string;
	/** Put back what the removal took. Runs at most once. */
	readonly restore: () => void;
}

export interface StructuralUndo {
	/** The offer on show, if any. */
	readonly current: UndoOffer | undefined;
	/** The newest kept step, if any. */
	readonly kept: KeptStep | undefined;
	/** Offer `restore` as the undo of the removal just made, replacing any standing offer.
	 *  With `keptAs`, the step is kept under that label after the offer goes. */
	offer(notice: string, restore: () => void, keptAs?: string): void;
	/** The document changed some other way: a kept step no longer answers ⌘Z once its
	 *  offer is gone. */
	touch(): void;
	/** Name the control the removal handed the focus to. ⌘Z there is the offer's until the
	 *  control takes an edit or the focus leaves it: the key that removed is the key that
	 *  asks for it back, and the control has nothing of its own to undo yet. */
	hand(el: Element | null): void;
	/** Whether ⌘Z pressed at `target` is this undo's: there is an offer, or a kept step whose
	 *  removal is still the latest change, and the target is the page's body, where a removal
	 *  under the pointer leaves the focus, when this editor offered last on the page; the
	 *  handed control; or a control under `root` that keeps no history of its own. A text
	 *  control that is not the handed one keeps its key. */
	accepts(target: EventTarget | null, root: Element | undefined): boolean;
	/** Hold the lapse while the toast is under the pointer or the focus, and let it run again. */
	pause(): void;
	resume(): void;
	/** Run the standing offer and clear it, or with none standing the newest kept step.
	 *  False when there was nothing to run. */
	take(): boolean;
	/** Run the newest kept step, whatever offer stands. False when none is kept. */
	takeKept(): boolean;
	/** Drop a standing offer whose step is not kept, without running it. */
	withdraw(): void;
}

const EDITABLE = 'input, textarea, select, [contenteditable="true"]';

/** The editor whose offer is the page's latest: the body belongs to no surface, so of two
 *  editors with an offer standing, the key at the body is the one that offered last's. */
let latest: object | undefined;

export function createStructuralUndo(): StructuralUndo & { dispose(): void } {
	let current = $state<UndoOffer | undefined>();
	let kept = $state.raw<readonly KeptStep[]>([]);
	/** How many kept steps the document has changed since: the ones past it answer ⌘Z. */
	let settled = 0;
	let handed: Element | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let paused = false;
	const stop = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};
	const lapse = (): void => {
		timer = setTimeout(clear, OFFER_MS);
	};
	const clear = (): void => {
		stop();
		paused = false;
		handed = undefined;
		current = undefined;
	};
	const holds = (offer: UndoOffer | undefined): boolean =>
		!!offer && kept.some((step) => step.restore === offer.restore);
	/** Run `step` and drop it. A restore is itself a change, and the steps under it are as
	 *  recent as they were. */
	const run = (step: KeptStep): void => {
		const was = settled;
		kept = kept.filter((k) => k !== step);
		step.restore();
		settled = Math.min(was, kept.length);
	};
	const self: StructuralUndo & { dispose(): void } = {
		get current() {
			return current;
		},
		get kept() {
			return kept.at(-1);
		},
		offer(notice, restore, keptAs) {
			clear();
			current = { notice, restore };
			if (keptAs !== undefined) kept = [...kept, { label: keptAs, restore }];
			latest = self;
			lapse();
		},
		touch() {
			settled = kept.length;
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
			if (!current && kept.length <= settled) return false;
			if (!(target instanceof Element)) return false;
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
			lapse();
		},
		take() {
			const offer = current;
			if (!offer) return self.takeKept();
			const step = kept.find((k) => k.restore === offer.restore);
			clear();
			if (step) run(step);
			else offer.restore();
			return true;
		},
		takeKept() {
			const step = kept.at(-1);
			if (!step) return false;
			if (current?.restore === step.restore) clear();
			run(step);
			return true;
		},
		withdraw() {
			if (!holds(current)) clear();
		},
		dispose() {
			clear();
			kept = [];
			settled = 0;
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
	offer() {},
	touch() {},
	hand() {},
	accepts: () => false,
	pause() {},
	resume() {},
	take: () => false,
	takeKept: () => false,
	withdraw() {}
};

/** The editor's undo, or {@link NO_UNDO} off-tree. */
export function structuralUndo(): StructuralUndo {
	return getContext<StructuralUndo>(KEY) ?? NO_UNDO;
}
