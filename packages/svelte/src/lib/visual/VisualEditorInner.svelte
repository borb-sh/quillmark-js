<!--
 The federated WYSIWYG surface (INVARIANTS §"Federated, not monolithic"). A thin
 composition over many small editors; not one PM document spanning the page.

 Mounted once per document. `VisualEditor` keys this component on `doc`, so
 everything below seeds from a handle that cannot change under it: `cardIds`, the
 id `seq`, the leaf registry, the commit-error map, the active address and the
 card refs are all mount-scoped, and the prose leaves close over the `doc` they
 mounted against. That is what makes them plain state rather than something
 threaded through a generation token.

 Reactivity across the WASM handle. The `Document` is opaque to Svelte, so a
 `revision` counter is bumped after a scalar/structure mutation and the card
 tree is `$derived` by re-reading `doc.main`/`doc.cards`/`quill.schema`. Prose
 leaves are mounted once per stable leaf key (keyed `<Card>`/`<ProseField>`);
 they commit to the doc directly and do not bump `revision`, so a re-derive never
 remounts them or drops a caret. `doc.main`/`doc.cards` allocate per read: read
 once per derive.

 A run of commits to one field is typing in a by-value cell, and a derive per
 keystroke is a whole-document read, resolve and validate under each one. So the
 run's commits past its first rebuild the one card from the one field's value
 (`patched`), and the derive lands once the run rests.
-->
<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { keydownHandler } from 'prosemirror-keymap';
	import { DropdownMenu } from 'bits-ui';
	import { isQuillmarkError, MAIN_CARD_ADDR } from '@quillmark/wasm';
	import {
		addrForFieldPath,
		nearestAddrForFieldPath,
		cardPath,
		nestedAddrForFieldPath,
		fieldPathForAddr,
		type DocPath,
		type Landing
	} from '../core/address.js';
	import { errorMessage, reportError } from '../core/errors.js';
	import { bloom } from '../core/bloom.js';
	import { createLifespan } from '../core/teardown.js';
	import { spacePx } from '../core/rungs.js';
	import type {
		Addr,
		CardAddr,
		Diagnostic,
		PathStep,
		PayloadItem,
		QuillFieldSchema,
		Resolved,
		ResolvedField
	} from '@quillmark/wasm';
	import type { VisualEditorProps } from './props.js';
	import type { Delta } from '../core/codec/positions.js';
	import { mergeStrings, setWording } from './strings.js';
	import { createStructuralUndo, setStructuralUndo, type UndoOffer } from './undo.svelte.js';
	import { createReview, setReview } from './review.svelte.js';
	import type { FieldProposal, ReviewDrawn } from './review.js';
	import type { CardId, CardOp, ChangeSource } from './signals.js';
	import {
		markAnchor,
		REVIEW_KEYS,
		type FieldController,
		type LeafViews
	} from '../core/codec/index.js';
	import {
		IdSeq,
		controlKind,
		isContainer,
		shortCell,
		schemaAt,
		cardSections,
		cardTitle,
		kindTitle,
		fieldValues,
		bodyEnabled,
		provenanceMap,
		resolvedByCardIndex,
		ghostDefault,
		titleText,
		resolveBodyGhost,
		NO_RESOLVED_ROWS,
		type CardModel,
		type ResolvedCardRows
	} from './structure.js';
	import {
		fieldKeyToString,
		resolveCardKey,
		routeAndResolve,
		mergeDiagnostics,
		type FieldKey,
		type RoutedDiagnostic
	} from './diagnostics.js';
	import { fieldDomIds, groupPanelId } from './domid.js';
	import { createLeafRegistry, type ActiveProse, type FieldControl } from './leaves.js';
	import { reorder, reorderArm, reorderTrips, scrollSettled, slot } from './motion.js';
	import { tipsChannel } from './tips.js';
	import { patchEditorExt } from './ext.js';
	import { raiseGuidance } from './guidance.js';
	import { familiesOf, registerFaces } from './fonts.js';
	import Card from './Card.svelte';
	import TipsCard from './TipsCard.svelte';
	import FormatPopover from './FormatPopover.svelte';
	import ReviewPopover, { type ReviewTarget } from './ReviewPopover.svelte';
	// The add trigger and the kind menu draw shared recipes; a component carrying a
	// shared class without also pulling its rule ships unstyled (controls.css).
	import './controls.css';

	let {
		doc,
		quill,
		onActiveLeafChange,
		onCaretMove,
		onChange,
		onError,
		diagnostics,
		enumOptionAllowed,
		enumDisallowed = 'disable',
		fonts,
		fontLabels,
		strings,
		formatDiagnostic,
		review,
		onReview,
		onReviewFocus,
		onReviewDrawn,
		reviewAdvance = true,
		class: className,
		style
	}: VisualEditorProps = $props();

	// The wording, merged once and published to the tree. A getter pair rather than a
	// snapshot: a consumer swapping locale mid-session re-renders every label,
	// including the ones eight components down that never see a prop.
	const merged = $derived(mergeStrings(strings));
	setWording({
		get strings() {
			return merged;
		},
		get formatDiagnostic() {
			return formatDiagnostic;
		}
	});

	// The host's font library: registered with the page while mounted, so a run draws in
	// the face the preview sets it in, and offered family by family to the popover.
	const fontFamilies = $derived(familiesOf(fonts ?? []));
	$effect(() => registerFaces(fonts ?? []));

	// ── Reactivity + session identity ───────────────────────────────────────────
	let revision = $state(0);
	// This editor's own id, prefixed onto every field's DOM ids (`domid.ts`). The
	// leaf-key space is unique per editor, not per page: two editors mounted
	// side-by-side both hold `main:subject`, and a duplicate `id` makes `for` resolve
	// to whichever mounted first. `$props.id()` is stable across SSR and hydration,
	// which a module counter is not.
	const uid = $props.id();
	const seq = new IdSeq();
	// Session ids, one per composable card, reordered in lockstep with structure ops.
	// svelte-ignore state_referenced_locally
	let cardIds = $state<string[]>(seq.take(doc.cardCount));

	// Local commit-error diagnostics (INVARIANTS §Diagnostics, producer #2),
	// id-keyed rather than positional so an error stays pinned to its field across a
	// card reorder.
	const commitErrors = new SvelteMap<string, RoutedDiagnostic>();

	const kinds = $derived(Object.keys(quill.schema.card_kinds ?? {}));

	// The removal's step back (`undo.svelte.ts`), published so an array's row removal
	// offers on the same toast a card's does.
	const undo = createStructuralUndo();
	setStructuralUndo(undo);

	/**
	 * Re-derive the card tree and report the edit. Called for the two lanes that go
	 * through this component; a prose leaf commits itself and reports through
	 * `proseChanged`, which does not bump the revision (bumping it would re-derive
	 * and remount every leaf, costing the caret on every keystroke).
	 *
	 * The path is minted here, after the bump, because an op's own index is only
	 * addressable against the tree the bump re-derived: an insert's card does not exist
	 * in the previous one, and a retype's kind is the previous kind.
	 */
	function bump(source: ChangeSource, cardId?: CardId, at?: Addr | number, op?: CardOp): void {
		rederive();
		report(source, cardId, at, op);
	}
	function report(source: ChangeSource, cardId?: CardId, at?: Addr | number, op?: CardOp): void {
		const path =
			at == null ? undefined : typeof at === 'number' ? cardPath(at, liveKinds()) : pathFor(at);
		settled();
		onChange?.({ source, cardId, path, ...(op ? { op } : {}) });
	}
	function rederive(): void {
		clearTimeout(rest);
		rest = undefined;
		patched = {};
		revision++;
		liveTitles = {};
	}

	/** How long after a field's commit the next one to it still counts as the same run:
	 *  the gap between two keys of slow typing. */
	const RUN_MS = 2000;
	/** How long after a run's last commit its derive lands: a pause in the typing. */
	const REST_MS = 300;
	let run: { key: string; at: number } | undefined;
	let rest: ReturnType<typeof setTimeout> | undefined;
	/** The cards a run rebuilt, by session key, over the derive they stand on. */
	let patched = $state.raw<Record<CardId, CardModel>>({});
	/**
	 * A field's commit, re-derived. A run's commits past its first rebuild the one card:
	 * the committed field's value re-read, every other value the object the last derive
	 * read, so no control beside the one typed in is handed anything new. Validation and
	 * the resolved rows hold as the last derive left them until the run rests, which is
	 * exact for the rows a control reads: a default's, which an authored field has none
	 * of before or after. A commit that sets or unsets the field moves a row, so it
	 * derives at once.
	 */
	function fieldCommitted(id: CardId, isMain: boolean, name: string, value: unknown): void {
		const key = fieldKeyToString({ card: isMain ? undefined : id, field: name });
		const now = performance.now();
		const running = run?.key === key && now - run.at < RUN_MS;
		run = { key, at: now };
		const at = cardIndexOf(id);
		const shown = isMain ? model.main : model.cards[at];
		if (!running || value === undefined || !shown || !Object.hasOwn(shown.values, name))
			return rederive();
		const fresh = fieldValues((isMain ? doc.main : doc.card(at)).payloadItems);
		const cardSchema = isMain ? quill.schema.main : quill.schema.card_kinds?.[shown.kind];
		patched = {
			...patched,
			[id]: {
				...shown,
				values: { ...shown.values, [name]: fresh[name] },
				titlePlaceholder: cardTitle(cardSchema, shown.kind, fresh, undefined)
			}
		};
		if (id in liveTitles) {
			const titles = { ...liveTitles };
			delete titles[id];
			liveTitles = titles;
		}
		clearTimeout(rest);
		rest = setTimeout(() => {
			if (span.alive) rederive();
		}, REST_MS);
	}
	/** Read at the mutation boundary, never cached (INVARIANTS §"The address is the
	 * spine"). */
	function cardIndexOf(id: string): number {
		return cardIds.indexOf(id);
	}
	/** The inverse, for the two signals that arrive as an address and nothing else (a
	 * focus, a prose commit), off the same array the mutation boundary reads.
	 * `undefined` for an address outside the live card array, as {@link pathFor}: the
	 * key is a host's only handle on a card, so a stale one is dropped rather than
	 * reported. */
	function cardIdOf(addr: Addr): CardId | undefined {
		if (addr.card == null) return 'main';
		return typeof addr.card === 'number' ? cardIds[addr.card] : undefined;
	}

	// ── Teardown (core/teardown.ts: unregister, cancel, then free) ──────────────
	// A document swap is a remount (see the remount contract above), so a destroy is
	// the only way this surface ends and one span covers both. Cancellers register
	// below in the order they run: the registry that resolves new work first, then
	// the work already scheduled. The document handle is the consumer's to free, so
	// the span holds nothing to release.
	const span = createLifespan();
	onDestroy(() => span.end());
	span.onEnd(() => clearTimeout(rest));
	span.onEnd(undo.dispose);

	// ── Leaf registry (landing target lookup + the active-leaf seam) ────────────
	// Every mounted field is in it, prose leaf and form control alike (`leaves.ts`):
	// a landing needs a focus and a box to bloom, which every control has, and the
	// codec lane is asked for only where there is an offset to place.
	const leaves = createLeafRegistry();
	// Each leaf unregisters itself on its own teardown; this covers the surface
	// going away as a whole, where a leaf's cleanup order relative to the parent's
	// is Svelte's business and not something to depend on.
	span.onEnd(() => leaves.clear());

	/** ⌘Z/Ctrl+Z takes the step back where the undo accepts it (`undo.accepts`).
	 *  On the document, since a removal under the pointer leaves the focus on the body, and
	 *  captured, so a leaf the removal handed the focus to hears the key after the offer. */
	function onUndoKey(e: KeyboardEvent): void {
		if (e.defaultPrevented || e.isComposing || e.shiftKey || e.altKey) return;
		if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
		if (!undo.accepts(e.target, rootEl)) return;
		e.preventDefault();
		e.stopPropagation();
		undo.take();
	}
	// ── Review (`review.svelte.ts`): the host's list, published to the tree ─────
	// A field item's path resolves here, against the live card keys, as a diagnostic's does:
	// the nearest field holding it.
	const reviewed = (path: DocPath): FieldKey | undefined => {
		const addr = nearestAddrForFieldPath(path);
		return addr && declaredField(addr) ? resolveCardKey(addr, cardIds) : undefined;
	};
	const reviewing = createReview({
		items: () => review,
		keyFor: (path) => {
			const key = reviewed(path);
			return key && fieldKeyToString(key);
		},
		exact: (path) => addrForFieldPath(path) != null,
		chorded(id) {
			if (!reviewAdvance) return;
			const index = drewOrder.indexOf(id);
			void tick().then(() => {
				if (span.alive) void step(1, true, index < 0 ? undefined : { id, index });
			});
		},
		writing(on) {
			writing += on ? 1 : -1;
		},
		answer(id, item, action, key) {
			let back: (() => void) | undefined;
			if (action === 'accept' && item?.state === 'proposed' && 'field' in item) {
				back = takeField(item);
				if (!back) return false;
			}
			onReview?.({ id, action });
			if (action !== 'accept' && action !== 'dismiss') return true;
			const field = item && 'field' in item ? reviewed(item.field) : undefined;
			const leaf = key ?? (field && fieldKeyToString(field));
			if (leaf === undefined) return true;
			const reopen = (): void => reviewing.heard(id, 'reopen', leaf);
			const prose = key !== undefined && !field;
			record(
				id,
				prose
					? action === 'accept'
						? () => void leaves.prose(leaf)?.undoReview()
						: () => void leaves.prose(leaf)?.reopenReview(id)
					: () => {
							back?.();
							reopen();
						},
				back && merged.reviewAccepted
			);
			return true;
		}
	});

	// ── The answer journal: the review answers since the reader's last edit, each undone by
	// ⌘Z from anywhere in the editor, newest first, its item reopened with it. An edit that is
	// not an answer empties it, as it drops a host's step: an inverse is good against the
	// document it was recorded over. An answer's own writes, and an inverse's, go down the
	// lanes an edit does, so they are flagged while they are made.
	interface Answered {
		ids: string[];
		inverses: (() => void)[];
		/** The toast it stands on; none where the key alone takes it back. */
		notice?: string;
	}
	let journal: Answered[] = [];
	/** The entry a batch of answers records into. */
	let batching: Answered | undefined;
	let journalOffer: UndoOffer | undefined;
	let writing = 0;
	function settled(): void {
		if (writing) return;
		journal = [];
		journalOffer = undefined;
		undo.settle();
	}
	function offerJournal(): void {
		const top = journal.at(-1);
		journalOffer =
			top &&
			undo.offer(top.notice ?? '', unanswer, { standing: true, quiet: top.notice === undefined });
	}
	function unanswer(): void {
		const top = journal.pop();
		if (!top) return;
		writing++;
		try {
			for (const inverse of [...top.inverses].reverse()) inverse();
		} finally {
			writing--;
		}
		offerJournal();
	}
	function record(id: string, inverse: () => void, notice?: string): void {
		if (batching) {
			batching.ids.push(id);
			batching.inverses.push(inverse);
			return;
		}
		// Another step took the key since: the answers before it are no longer the last thing
		// that happened.
		if (!journalOffer || !undo.holds(journalOffer)) journal = [];
		journal.push({ ids: [id], inverses: [inverse], notice });
		offerJournal();
	}

	/**
	 * Take a field's proposal: its value down the lane the field's own control commits by, so
	 * the writer checks it and `onChange` reports it. A text leaf re-reads what was written.
	 * Returns the write back to the value it replaced, or `undefined` where the writer refused
	 * the value, which the field then says as it says any refused commit.
	 */
	function takeField(item: FieldProposal): (() => void) | undefined {
		const key = reviewed(item.field);
		if (!key?.field || typeof key.card === 'number') return undefined;
		const isMain = key.card === undefined;
		const id = key.card ?? model.main.id;
		const name = key.field;
		const leaf = fieldKeyToString(key);
		const before = doc.getStored(makeAddr(id, isMain, name));
		const write = (value: unknown): boolean => {
			commitScalar(id, isMain, name, value);
			if (commitErrors.has(leaf)) return false;
			leaves.prose(leaf)?.applyExternal();
			return true;
		};
		writing++;
		try {
			return write(item.after) ? () => void write(before) : undefined;
		} finally {
			writing--;
		}
	}
	setReview(reviewing);
	span.onEnd(reviewing.dispose);
	// The lit item, to a host lighting its own list: each change, and not the nothing a mount
	// starts from.
	let reported: string | undefined;
	$effect(() => {
		const id = reviewing.lit;
		if (id === reported) return;
		reported = id;
		onReviewFocus?.(id);
	});
	/** The open items drawn, in document order: each id's first element under the root, then
	 *  any drawn one not yet in the DOM, in list order. */
	function reviewOrder(): string[] {
		const fieldUndrawn = new Set(reviewing.fieldUndrawn.map((u) => u.id));
		const drawn = new Set<string>();
		for (const report of reviewing.reports.values()) for (const id of report.ids) drawn.add(id);
		for (const item of reviewing.items)
			if ('field' in item && !fieldUndrawn.has(item.id)) drawn.add(item.id);
		const order: string[] = [];
		const seen = new Set<string>();
		const take = (id: string | null): void => {
			if (id === null || !drawn.has(id) || seen.has(id)) return;
			seen.add(id);
			order.push(id);
		};
		for (const el of rootEl?.querySelectorAll('[data-qm-review]') ?? [])
			take(el.getAttribute('data-qm-review'));
		for (const item of reviewing.items) take(item.id);
		return order;
	}
	/** What the editor draws of the host's list, and why it draws what it does not. */
	function reviewReport(): ReviewDrawn {
		const reported = new Set<string>();
		const outdated: string[] = [];
		const why = new Map<string, ReviewDrawn['undrawn'][number]['reason']>();
		for (const report of reviewing.reports.values()) {
			for (const id of report.ids) reported.add(id);
			outdated.push(...report.outdated);
			for (const { id, reason } of report.undrawn) {
				reported.add(id);
				why.set(id, reason);
			}
		}
		for (const { id, reason } of reviewing.fieldUndrawn) why.set(id, reason);
		for (const item of reviewing.items)
			if ('anchor' in item && !reported.has(item.id)) why.set(item.id, 'anchor');
		return {
			order: reviewOrder(),
			outdated,
			undrawn: reviewing.items.flatMap((item) => {
				const reason = why.get(item.id);
				return reason ? [{ id: item.id, reason }] : [];
			})
		};
	}
	// The report, to a host counting its own list: each change, read once the leaves the change
	// mounted have drawn, so a list just handed over is not reported as anchored nowhere.
	const NO_REPORT = JSON.stringify({ order: [], outdated: [], undrawn: [] } satisfies ReviewDrawn);
	let drewReport = NO_REPORT;
	let drewOrder: readonly string[] = [];
	$effect(() => {
		void reviewing.items;
		void reviewing.fieldUndrawn;
		for (const report of reviewing.reports.values()) void report;
		let live = true;
		void tick().then(() => {
			if (!live || !span.alive) return;
			const report = reviewReport();
			drewOrder = report.order;
			const joined = JSON.stringify(report);
			if (joined === drewReport) return;
			drewReport = joined;
			onReviewDrawn?.(report);
		});
		return () => {
			live = false;
		};
	});
	/** The item a step last went to, and where it stood in the order then, so a step from an
	 *  item since answered goes on from its place. */
	let stepped: { id: string; index: number } | undefined;
	async function step(
		dir: 1 | -1,
		focus: boolean,
		from?: { id: string; index: number }
	): Promise<string | undefined> {
		if (!span.alive) return undefined;
		const order = reviewOrder();
		if (!order.length) return undefined;
		const at = from ? -1 : order.indexOf(reviewing.lit ?? stepped?.id ?? '');
		const past = from ?? stepped;
		const next =
			at >= 0 ? at + dir : past ? (dir > 0 ? past.index : past.index - 1) : dir > 0 ? 0 : -1;
		const index = ((next % order.length) + order.length) % order.length;
		const id = order[index];
		stepped = { id, index };
		await reveal(id, focus, true);
		return id;
	}
	const stepKeys = keydownHandler({
		[REVIEW_KEYS.next]: () => {
			void step(1, true);
			return true;
		},
		[REVIEW_KEYS.previous]: () => {
			void step(-1, true);
			return true;
		}
	});
	/** The step chords, from anywhere under the root, ahead of a leaf's own arrows. */
	function onStepKey(e: KeyboardEvent): void {
		if (e.isComposing || !reviewing.items.length) return;
		// The bindings read no view: this is `prosemirror-keymap`'s chord matcher alone.
		if (!stepKeys({} as never, e)) return;
		e.preventDefault();
		e.stopPropagation();
	}
	/** Where item `id` is drawn, for the card that hangs off it. */
	function reviewTarget(id: string): ReviewTarget | undefined {
		const key = reviewing.keyOf(id);
		if (key === undefined) return undefined;
		const prose = leaves.prose(key);
		const mark = prose?.reviewElements(id)[0];
		if (prose && mark)
			return {
				anchor: markAnchor(prose.el, () => prose.reviewElements(id)[0]),
				removed: mark.classList.contains('qm-review-gone')
			};
		const control = leaves.control(key);
		return control && { anchor: control.el, removed: false };
	}

	// Card handles, for `setCaret`'s reveal hop: the one thing a leaf's own controller
	// cannot do, since which group is open is the card's state (Card §revealLeaf).
	type CardHandle = {
		revealLeaf(key: string): void;
		scrollIntoViewCard(block: ScrollLogicalPosition): void;
		focusHeader(): void;
	};
	let mainCard = $state<CardHandle | undefined>(undefined);
	let cardRefs = $state<(CardHandle | undefined)[]>([]);
	/** The slot each card sits in: what a reorder animates, and so what the post-mutation
	 *  scroll waits on before it measures anything. */
	let slotEls = $state<(HTMLElement | undefined)[]>([]);
	/** The stack's own element: it carries `data-qm-root`, so it is what the kind
	 * menu portals into, the way each leaf's surface resolves its nearest root. */
	let rootEl = $state<HTMLElement | undefined>(undefined);

	// ── Focus + bridge outputs ──────────────────────────────────────────────────
	// `activeCardId` is the id-keyed half of `activeAddr` (whose `card` is positional),
	// and it feeds lookups only: the `activeController` seam below, and the clear on
	// delete. Nothing draws it: a card's active treatment is its controls' reveal,
	// which the card reads off `:focus-within`.
	let activeAddr = $state<Addr | undefined>(undefined);
	let activeCardId = $state<CardId | undefined>(undefined);

	/** Snapshot a (possibly getter-backed) addr to a plain, index-resolved value. */
	function normalize(addr: Addr): Addr {
		const card = addr.card;
		return card != null ? { card, field: addr.field } : { field: addr.field };
	}
	function handleFocus(addr: Addr, steps: readonly PathStep[] = []): void {
		const plain = normalize(addr);
		activeAddr = plain;
		activeCardId = cardIdOf(plain);
		// The arrival ends the caret memo's run (`lastCaretField` below): a leaf returned
		// to at the offset it still names has to report again.
		lastCaretField = undefined;
		lastCaretPos = undefined;
		const field = pathFor(plain, steps);
		// Both halves or neither: a stale addr names no path and no live card.
		if (field != null && activeCardId != null)
			onActiveLeafChange?.({ field, cardId: activeCardId });
	}
	/** No card kinds are read for a main address; the shared empty stands in so the
	 *  common case allocates nothing. */
	const NO_KINDS: readonly string[] = [];
	/**
	 * The live kinds by content index, off the derived card tree rather than
	 * `doc.cards`: they are already in hand, and `doc.cards` serializes every card on
	 * each read, which is not a thing to do per keystroke.
	 */
	function liveKinds(): string[] {
		return model.cards.map((c) => c.kind);
	}
	/**
	 * A leaf's canonical `DocPath`, `steps` down from the field. `undefined` for an
	 * address outside the live card array (a stale addr: drop rather than mis-target).
	 */
	function pathFor(addr: Addr, steps: readonly PathStep[] = []): DocPath | undefined {
		return fieldPathForAddr(addr, addr.card == null ? NO_KINDS : liveKinds(), steps);
	}
	// The last place reported, so a caret that did not move is not news. A leaf fires
	// one caret signal per transaction, and a transaction need not have moved the
	// caret to exist: a mark toggle over the same range, an anchor op, a plugin's own
	// bookkeeping. The memo is the editor's rather than each leaf's, because a place
	// spans leaves: a caret that leaves `main.body` at 5 for a card leaf and comes
	// back to 5 made two moves, and a per-leaf memo would swallow the second. An edit
	// that reflows the page under a caret holding its offset is the case this drops,
	// and a preview does not need the signal to answer it: the place is unchanged, so
	// the one it already followed is the one its recompile re-locates.
	//
	// A focus clears it, and must: a focus into a leaf with no caret to report ends a
	// consumer's follow (INVARIANTS §"Follow-the-caret scroll"), and the return to the
	// offset the memo still names is the only thing that would restart it.
	let lastCaretField: DocPath | undefined;
	let lastCaretPos: number | undefined;
	function handleCaret(addr: Addr, pos: number): void {
		const field = pathFor(normalize(addr));
		if (field == null) return;
		if (field === lastCaretField && pos === lastCaretPos) return;
		lastCaretField = field;
		lastCaretPos = pos;
		onCaretMove?.({ field, pos });
	}
	/** A prose leaf's own commit: the third change lane, and the one that must not
	 *  bump `revision` (see {@link bump}). */
	function proseChanged(addr: Addr): void {
		const plain = normalize(addr);
		const cardId = cardIdOf(plain);
		if (cardId == null) return;
		refreshTitle(plain, cardId);
		settled();
		onChange?.({ source: 'prose', cardId, path: pathFor(plain) });
	}

	/** A header named by the card's own values, after a prose commit to one that can name
	 *  it: the one piece of the model that lane moves, held beside the model and dropped
	 *  on the next bump, which rebuilds it from the document. The card is read only for a
	 *  one-line prose field of a kind declaring no `title` (`cardTitle`). */
	let liveTitles = $state<Record<CardId, string>>({});
	function refreshTitle(addr: Addr, cardId: CardId): void {
		const { card: at, field } = addr;
		if (typeof at !== 'number' || field == null) return;
		const shown = model.cards[at];
		const cardSchema = shown && quill.schema.card_kinds?.[shown.kind];
		if (!cardSchema || cardSchema.title?.trim()) return;
		const sub = Object.hasOwn(cardSchema.fields, field) ? cardSchema.fields[field] : undefined;
		if (!sub || !shortCell(sub)) return;
		liveTitles = {
			...liveTitles,
			[cardId]: cardTitle(cardSchema, shown.kind, fieldValues(doc.card(at).payloadItems), undefined)
		};
	}
	function titled(c: CardModel): CardModel {
		const t = liveTitles[c.id];
		return t == null ? c : { ...c, titlePlaceholder: t };
	}

	// ── Commit routing ──────────────────────────────────────────────────────────
	// Scalars / arrays / objects → the typed writer (schema-checked); a cleared entry
	// arrives as `undefined` and takes the unset lane instead. Prose leaves commit
	// themselves via the codec (`apply`) and do not pass through here.
	//
	// A bad value makes `writer.set` throw a `QuillmarkError` whose `diagnostics[0]`
	// carries a `code` and a canonical `path` (`edit::field_coercion_failed` at
	// `main.font_size`, `edit::unknown_field`). That diagnostic is surfaced verbatim,
	// under a key minted from the address being committed rather than parsed from the
	// positional path, so it survives a later card reorder. Nothing gates: the document
	// is unchanged on throw, per the boundary's transactional contract, and editing
	// continues.
	function commitScalar(id: string, isMain: boolean, name: string, value: unknown): void {
		const key: FieldKey = { card: isMain ? undefined : id, field: name };
		const keyStr = fieldKeyToString(key);
		try {
			if (value === undefined) {
				// The unset rung (INVARIANTS §"The commitment ladder"): removing the field
				// leaves Quillmark's authored › `default:` › blank-fill resolve to render the
				// default, where writing one bakes a snapshot the schema cannot track
				// (quillmark/INVARIANTS §"The commitment ladder": Quillmark never writes a
				// default; the editor writes one only as the edit that takes it). Removal writes no value, so there is
				// nothing for a schema to conform and the lane is the quill-free one.
				if (isMain) {
					doc.removeField(name);
				} else {
					const i = cardIndexOf(id);
					if (i < 0) return;
					doc.removeField({ card: i, field: name });
				}
			} else {
				const w = quill.writer(doc);
				if (isMain) {
					w.set(name, value);
				} else {
					const i = cardIndexOf(id);
					if (i < 0) return;
					w.card(i).set(name, value);
				}
			}
			commitErrors.delete(keyStr);
			fieldCommitted(id, isMain, name, value);
			report('field', id, makeAddr(id, isMain, name));
		} catch (e) {
			const diagnostic: Diagnostic = (isQuillmarkError(e) ? e.diagnostics[0] : undefined) ?? {
				severity: 'error',
				message: errorMessage(e)
			};
			commitErrors.set(keyStr, { key, diagnostic });
			// Both channels, deliberately: the diagnostic pins to the field on
			// screen, the error reaches the app's sink (core/errors.ts).
			reportError(onError, {
				code: 'commit-refused',
				severity: 'error',
				message: `write to ${name} refused: ${errorMessage(e)}`,
				cause: e,
				path: pathFor(makeAddr(id, isMain, name))
			});
		}
	}

	// ── Structure mutators (resolve id→index here, then reorder ids in lockstep) ──
	/**
	 * Scroll the card `id` into view once the mutation that placed it has rendered:
	 * on a document of any length an insert lands off-screen, and a
	 * viewport that does not follow reads as nothing happening.
	 *
	 * Coalesced on the last call: each takes a ticket and a continuation holding a stale
	 * one drops out, so two mutations inside a tick run one smooth scroll to the last of
	 * them rather than two fighting over the same scroller. A ticket rather than the id
	 * being scrolled to, because an insert and a move of the *same* card are two calls
	 * naming one id, on different terms — `center` against `nearest`.
	 */
	let scrollTicket = 0;
	async function scrollCardIntoView(id: string, block: ScrollLogicalPosition): Promise<boolean> {
		const ticket = ++scrollTicket;
		if (!(await span.resumes(tick()))) return false;
		if (ticket !== scrollTicket) return false;
		// A reorder is running by this flush and holds the slot at its pre-move position
		// for the length of the trip (`motion.ts`), so asking now measures the box the
		// card is leaving — where a `nearest` would take the stack back to for the card
		// that moved in from off screen. The trip says the card moved; the scroll follows
		// it to where it landed. `allSettled`, because a second reorder cancels the first
		// and a cancelled run rejects.
		const slot = slotEls[cardIndexOf(id)];
		const trips = slot ? reorderTrips(slot) : [];
		if (trips.length) {
			if (!(await span.resumes(Promise.allSettled(trips.map((trip) => trip.finished)))))
				return false;
			if (ticket !== scrollTicket) return false;
		}
		const i = cardIndexOf(id);
		if (i < 0) return false;
		cardRefs[i]?.scrollIntoViewCard(block);
		return true;
	}
	/** Returns the new card's session key, or `undefined` when the kind seeds nothing
	 *  or the insert threw: what `insertCard` hands a host that wants to track it. The
	 *  strip's own add `land`s focus in the new card; a host's leaves focus where it is. */
	function addCard(atIndex: number, kind: string, land = false): CardId | undefined {
		try {
			const overlay = doc.seedOverlay(kind);
			const card = quill.seedCard(kind, overlay);
			if (!card) return undefined;
			const from = document.activeElement;
			doc.unchecked.insertCard(card, atIndex);
			undo.withdraw();
			const id = seq.next();
			arm.arm();
			cardIds = [...cardIds.slice(0, atIndex), id, ...cardIds.slice(atIndex)];
			bump('structure', id, atIndex, { op: 'insert', at: atIndex });
			// Centred: the new card is the subject, and the neighbours it landed between
			// are what say where it went.
			const scrolled = scrollCardIntoView(id, 'center');
			if (land) void landInCard(id, scrolled, from);
			return id;
		} catch (e) {
			reportError(onError, {
				code: 'card-op-failed',
				severity: 'error',
				message: `adding a ${kind} card failed: ${errorMessage(e)}`,
				cause: e
			});
			return undefined;
		}
	}
	/**
	 * Focus the card the strip just added: its first field, else its body, else its title.
	 *
	 * After the centring scroll has run rather than beside it: a control's `focus()`
	 * takes the browser's own scroll, which cuts a smooth one short wherever it had
	 * reached. A focus that went elsewhere while the scroll ran was the user's, and stays.
	 */
	async function landInCard(
		id: CardId,
		scrolled: Promise<boolean>,
		from: Element | null
	): Promise<void> {
		if (!(await scrolled) || !(await span.resumes(scrollSettled()))) return;
		const now = document.activeElement;
		if (now !== from && now !== document.body) return;
		const at = cardIndexOf(id);
		const shown = model.cards[at];
		if (!shown) return;
		const first = (shown.sections.find((s) => s.group == null) ?? shown.sections[0])?.fields[0];
		const path = first || shown.hasBody ? pathFor({ card: at, field: first?.name }) : undefined;
		const found = path && (await revealLeaf(path));
		if (found) await land(found, undefined);
		else cardRefs[cardIndexOf(id)]?.focusHeader();
	}
	// A kind picked off the menu lands focus in the card it added, so the menu's close
	// hands none back to its trigger; an Escape out of the menu still does.
	let picked = false;
	function addPicked(atIndex: number, kind: string): void {
		picked = addCard(atIndex, kind, true) != null;
	}

	// The list gesture's arming window (`motion.ts`): the reconcile that moves a slot is
	// the trip, and every other reconcile that happens to move one is not.
	const arm = reorderArm();
	span.onEnd(arm.cancel);

	function moveCardById(id: string, dir: -1 | 1): void {
		const from = cardIndexOf(id);
		if (from < 0) return;
		const to = from + dir;
		if (to < 0 || to >= doc.cardCount) return;
		const focused = document.activeElement;
		const held = focused instanceof HTMLElement && slotEls[from]?.contains(focused);
		arm.arm();
		doc.moveCard(from, to);
		undo.withdraw();
		const w = cardIds.slice();
		const [x] = w.splice(from, 1);
		w.splice(to, 0, x);
		cardIds = w;
		bump('structure', id, to, { op: 'move', from, to });
		if (held) void keepFocus(focused);
		// `nearest`: the card was already in view and only needs to stay there, so one
		// that never left the viewport moves it not at all.
		void scrollCardIntoView(id, 'nearest');
	}
	/** Give the focus back to the control a move was made from. The reconcile reorders by
	 *  re-inserting slots, and a re-inserted node loses the focus to the page's body with no
	 *  blur to say so; which of two swapped slots it re-inserts is its own choice. */
	async function keepFocus(el: HTMLElement): Promise<void> {
		if (!(await span.resumes(tick()))) return;
		if (el.isConnected && document.activeElement !== el) el.focus({ preventScroll: true });
	}
	function removeCardById(id: string): void {
		const i = cardIndexOf(id);
		if (i < 0) return;
		// Held visibly, which a pointer's press on delete is not: some engines focus a
		// pressed button, and the hand-on is the keyboard's.
		const focused = document.activeElement;
		const held = !!focused && !!slotEls[i]?.contains(focused) && focused.matches(':focus-visible');
		const card = doc.card(i);
		const shown = model.cards[i];
		const name =
			shown?.titleOverride ||
			shown?.titlePlaceholder ||
			kindTitle(quill.schema.card_kinds?.[card.kind], card.kind);
		const gone: Removed = { id, card, above: cardIds[i - 1], below: cardIds[i + 1], at: i };
		doc.removeCard(i);
		arm.arm();
		cardIds = cardIds.filter((_, k) => k !== i);
		forget(id);
		// No addr: the removed card has none left and every survivor's shifted. The
		// stack changed, not a leaf, and the id is the only handle the removal leaves.
		bump('structure', id, undefined, { op: 'remove', at: i });
		removed.push(gone);
		undo.offer(merged.undoRemoved(name), () => restoreCard(gone), {
			keptAs: merged.undoRestore(name)
		});
		if (held) void focusAfterRemove(i);
	}
	/** A removed card and the place it left, named by the cards either side of it: an index
	 *  names whatever stands there after the next insert, move or removal, and a session key
	 *  names one card for the surface's life. */
	type Removed = {
		readonly id: CardId;
		readonly card: ReturnType<typeof doc.card>;
		above: CardId | undefined;
		below: CardId | undefined;
		readonly at: number;
	};
	/** The removals not yet restored, each the step `undo` keeps for it. */
	const removed: Removed[] = [];
	/** Where a removed card goes back: under the card it stood below, else over the one it
	 *  stood above, else the index it left, held to the stack's length. */
	function placeOf(gone: Removed): number {
		const above = gone.above === undefined ? -1 : cardIndexOf(gone.above);
		if (above >= 0) return above + 1;
		const below = gone.below === undefined ? -1 : cardIndexOf(gone.below);
		return below >= 0 ? below : Math.min(gone.at, cardIds.length);
	}
	/** The removal's undo: the card back beside the neighbours it left, under a fresh session
	 *  key (ids are never reused), with the focus on its title. A removal that named the
	 *  gone card as its neighbour names the restored one. The document mints a card's `$id`
	 *  from the ids it holds, so a card added since may hold the one this card left with,
	 *  and the card then goes back without it and is minted another. */
	function restoreCard(gone: Removed): void {
		if (!span.alive) return;
		const { card } = gone;
		const i = placeOf(gone);
		try {
			const taken = card.id !== undefined && cardIds.some((_, k) => doc.card(k).id === card.id);
			const back = { ...card };
			if (taken) delete back.id;
			doc.unchecked.insertCard(back, i);
		} catch (e) {
			reportError(onError, {
				code: 'card-op-failed',
				severity: 'error',
				message: `restoring the ${card.kind} card failed: ${errorMessage(e)}`,
				cause: e
			});
			return;
		}
		const id = seq.next();
		removed.splice(removed.indexOf(gone), 1);
		for (const other of removed) {
			if (other.above === gone.id) other.above = id;
			if (other.below === gone.id) other.below = id;
		}
		arm.arm();
		cardIds = [...cardIds.slice(0, i), id, ...cardIds.slice(i)];
		bump('structure', id, i, { op: 'insert', at: i });
		void (async () => {
			if (!(await scrollCardIntoView(id, 'nearest'))) return;
			cardRefs[cardIndexOf(id)]?.focusHeader();
		})();
	}
	/** Drop what the surface holds for a removed card. Ids are never reused, so an entry
	 *  keyed to the gone card is unreachable rather than mis-attributed to whichever card
	 *  takes this position: it needs dropping because nothing else will ever clear it. */
	function forget(id: CardId): void {
		if (activeCardId === id) {
			activeCardId = undefined;
			activeAddr = undefined;
		}
		const prefix = `${id}:`;
		const stale = [...commitErrors.keys()].filter((k) => k.startsWith(prefix));
		for (const k of stale) commitErrors.delete(k);
	}
	/** Hand the focus a removed card held to the title of the card before it, else the
	 *  one that took its place, else the strip that adds one: a focused node the flush
	 *  drops leaves the focus on the page's body, and the keyboard's place with it. */
	async function focusAfterRemove(at: number): Promise<void> {
		if (!(await span.resumes(tick()))) return;
		if (cardIds.length) cardRefs[Math.max(at - 1, 0)]?.focusHeader();
		else rootEl?.querySelector<HTMLElement>('.qm-add-btn')?.focus();
		undo.hand(document.activeElement);
	}
	function retypeCardById(id: string, kind: string): void {
		const i = cardIndexOf(id);
		if (i < 0) return;
		try {
			// The retyped card keeps the original's `$id`, which two cards cannot hold at
			// once, so the original goes first and comes back where `insertCard` refuses:
			// it validates the whole card before it mutates, so the document is as it was.
			const card = doc.card(i);
			doc.removeCard(i);
			undo.withdraw();
			try {
				doc.unchecked.insertCard({ ...card, kind }, i);
			} catch (e) {
				doc.unchecked.insertCard(card, i);
				throw e;
			}
			bump('structure', id, i);
		} catch (e) {
			reportError(onError, {
				code: 'card-op-failed',
				severity: 'error',
				message: `retyping the card to ${kind} failed: ${errorMessage(e)}`,
				cause: e
			});
		}
	}
	/** A title's blur can fire as the surface is torn down, against a document that may be
	 *  freed. */
	function renameCardById(id: string, title: string): void {
		if (!span.alive) return;
		const i = cardIndexOf(id);
		if (i < 0) return;
		patchEditorExt(doc, { card: i }, { title });
		bump('structure', id, i);
	}
	/** The only write tips make. `undefined` drops the key while `title` and any later
	 *  sibling ride through; `ext.ts` holds why that matters. */
	function dismissTips(): void {
		patchEditorExt(doc, MAIN_CARD_ADDR, { tips: undefined });
		// Document-level chrome, not a leaf's: no addr, as for a card removal, and no
		// card either. Tips ride `main`'s `$ext` because that is where a document-scoped
		// `$ext` lives, which is not a claim that the main card changed.
		bump('structure');
	}

	// ── Addressing + per-card op bundle ─────────────────────────────────────────
	/** A live card address: `card` is a getter, so a reorder re-targets in place. */
	function cardAddr(id: string, field?: string): Addr {
		return field != null
			? ({
					get card() {
						return cardIndexOf(id);
					},
					field
				} as Addr)
			: ({
					get card() {
						return cardIndexOf(id);
					}
				} as Addr);
	}
	function makeAddr(id: string, isMain: boolean, field?: string): Addr {
		if (isMain) return field != null ? { field } : {};
		return cardAddr(id, field);
	}

	// ── Diagnostics routing (INVARIANTS §Diagnostics) ────────────────────────
	// Producer #1: quill.validate(doc), re-run every revision.
	const validation = $derived.by(() => {
		revision; // re-run on every mutation, per INVARIANTS §Diagnostics
		try {
			return quill.validate(doc);
		} catch (e) {
			reportError(onError, {
				code: 'validate-failed',
				severity: 'error',
				message: `quill.validate threw; this derive contributes no validation diagnostics: ${errorMessage(e)}`,
				cause: e
			});
			return [] as Diagnostic[];
		}
	});

	// All three producers. The two positional ones resolve their `.path` to the live
	// stable-id keying; commit errors are id-keyed already. Nothing is dropped for
	// being unwelcome — diagnostics never gate — but warnings do not draw: only
	// errors reach a control (`routeAndResolve`).
	const diagByKey = $derived.by(() => {
		const fromValidate = routeAndResolve(validation, cardIds);
		const fromExternal = routeAndResolve(diagnostics, cardIds);
		return mergeDiagnostics(fromValidate, fromExternal, [...commitErrors.values()]);
	});
	function opsFor(id: string, isMain: boolean) {
		// One identity per field: the leaf registry, the DOM's three names, and the
		// diagnostics map all key off this string, so a leaf, its label and its
		// diagnostics can only ever resolve together.
		const leafKey = (field?: string) => fieldKeyToString({ card: isMain ? undefined : id, field });
		return {
			makeAddr: (field?: string) => makeAddr(id, isMain, field),
			leafKey,
			domIds: (field?: string) => fieldDomIds(uid, leafKey(field)),
			panelId: (group: string) => groupPanelId(uid, isMain ? undefined : id, group),
			commit: (name: string, value: unknown) => commitScalar(id, isMain, name, value),
			move: (dir: -1 | 1) => moveCardById(id, dir),
			remove: () => removeCardById(id),
			retype: (kind: string) => retypeCardById(id, kind),
			rename: (title: string) => renameCardById(id, title),
			diagFor: (field?: string) => diagByKey.get(leafKey(field)),
			enumAllowed: (field: string, value: string) =>
				enumOptionAllowed?.(makeAddr(id, isMain, field), value) ?? true
		};
	}

	// ── The derived card tree (schema × payload join) ───────────────────────────
	function buildCard(
		id: string,
		isMain: boolean,
		kind: string,
		card: {
			payloadItems: readonly PayloadItem[];
			ext?: Record<string, unknown>;
		},
		cardSchema: Parameters<typeof cardSections>[0] | undefined,
		rows: ResolvedCardRows
	): CardModel {
		const values = fieldValues(card.payloadItems);
		const sections = cardSchema ? cardSections(cardSchema) : [];
		const extEditor = card.ext?.editor as { title?: string } | undefined;
		const hasBody = bodyEnabled(cardSchema);
		return {
			id,
			isMain,
			kind,
			// `main` always resolves `schema.main`, so it is never unschemable.
			unschemable: !isMain && !cardSchema,
			titleOverride: extEditor?.title ?? '',
			titlePlaceholder: cardTitle(cardSchema, kind, values, undefined),
			values,
			provenance: provenanceMap(rows.fields),
			sections,
			hasBody,
			// The body ghosts its resolved `default:` exactly as a scalar does, and falls
			// back to an invitation where a scalar shows nothing: an empty body is a
			// surface to write on where an empty control is a value not yet given. The
			// hook is pure by contract, so its answer is kept nowhere — a ghost holds
			// still across a re-derive because the function does.
			bodyGhost: hasBody
				? resolveBodyGhost(
						titleText(ghostDefault(rows.body ?? undefined)) || undefined,
						merged.bodyPlaceholder?.({ cardId: id, kind, isMain }),
						merged.bodyGhost
					)
				: undefined
		};
	}

	const tree = $derived.by(() => {
		revision; // re-derive on every mutation
		const schema = quill.schema;
		const main = doc.main;
		const cards = doc.cards;
		// The provenance channel (FIELD_PROVENANCE): one whole-doc resolve per
		// derive, feeding the ghosted `default:` only. Guarded: provenance is
		// chrome, so a resolve failure degrades to no ghosts, never a blank form.
		let resolved: Resolved | undefined;
		try {
			resolved = quill.reader(doc).resolve();
		} catch (e) {
			reportError(onError, {
				code: 'resolve-failed',
				severity: 'error',
				message: `reader.resolve threw; ghosted defaults fall back to none: ${errorMessage(e)}`,
				cause: e
			});
		}
		const byCard = resolvedByCardIndex(resolved);
		return {
			// Tips are document-level, not a property of the main card: they hang off
			// `main`'s `$ext` because that is where a document-scoped `$ext` lives, and
			// the model says so at the root rather than making every card carry a field
			// one card renders.
			tips: tipsChannel((main.ext?.editor as { tips?: unknown } | undefined)?.tips),
			main: buildCard('main', true, 'main', main, schema.main, {
				fields: resolved?.main.fields ?? [],
				body: resolved?.main.body ?? null
			}),
			cards: cards.map((c, i) =>
				buildCard(
					cardIds[i] ?? `orphan${i}`,
					false,
					c.kind,
					c,
					schema.card_kinds?.[c.kind],
					byCard.get(i) ?? NO_RESOLVED_ROWS
				)
			)
		};
	});

	const model = $derived({
		tips: tree.tips,
		main: patched.main ?? tree.main,
		cards: tree.cards.map((c) => patched[c.id] ?? c)
	});

	// ── Public entry points ─────────────────────────────────────────────────────
	/**
	 * Resolve a preview {@link Landing} to a mounted leaf and land in it.
	 *
	 * Async because the reveal has to render before the landing: a collapsed group
	 * is `inert`, which swallows a focus silently, so a caret placed in the same
	 * tick as the reveal would go nowhere and report nothing. The consumer's
	 * `onPick` ignores the promise: awaiting it is for a caller that wants to
	 * observe where the caret went.
	 */
	export async function setCaret(at: Landing): Promise<void> {
		const found = await revealLeaf(at.field);
		if (!found) return missed(`no mounted field at ${at.field}`, at.field);
		// A `'segment'` hit landed on origin-less ink (list markers, a code fence's
		// interior): `pos` is the segment start, not a cluster-exact caret
		// (HitGranularity), so it is dropped rather than snapped to a spot the click
		// did not resolve. `'cluster'` (and an absent granularity: the backend did not
		// report it, treat as exact) places the caret. An absent `pos` is the placement
		// rung and reaches the same floor.
		// The wash is unconditional, and takes the box the landing settled in: a preview
		// click is one discrete act, and its commonest target is the leaf already focused
		// (where landing a caret changes nothing on screen) or one off-screen, where the
		// browser's focus-scroll moves the page and leaves the caret to be hunted for.
		const box = await land(found, at.granularity === 'segment' ? undefined : at.pos);
		if (span.alive) bloom(box);
	}
	/** The active prose leaf: the formatting popover's observation seam. The active
	 *  field's own leaf where it registered one, else the by-value leaf focused last
	 *  under it (`leaves.ts`); `undefined` for a form control, which holds no marks to
	 *  toggle. */
	export function getActiveLeaf(): ActiveProse | undefined {
		if (!activeAddr) return undefined;
		const card = activeAddr.card != null ? activeCardId : undefined;
		const key = fieldKeyToString({ card, field: activeAddr.field });
		const controller = leaves.prose(key);
		if (controller) return { views: controller as FieldController & LeafViews };
		const views = leaves.value(key);
		return views && { views };
	}

	/**
	 * Reveal the field at `field` and hand back its landing handle plus the target it
	 * resolved to, once the reveal has rendered. The shared half of the two landing
	 * verbs: a collapsed group is clipped to zero height and sits inside an `inert`
	 * panel, which swallows a focus silently, so a caret placed in the same tick as the
	 * reveal goes nowhere and reports nothing. Exactly one card holds the key; the rest
	 * do nothing.
	 *
	 * The target comes back with the handle because the caller needs its key to ask for
	 * the codec lane (`leaves.prose`), and minting it twice would be two parses of one
	 * path.
	 *
	 * A destroy lands inside the flush, and a PM view destroyed in that window throws on
	 * the dispatch that follows. A consumer's call outlives the surface it points at
	 * too, so the span is asked on the way in as well as after the await.
	 */
	async function revealLeaf(field: DocPath): Promise<Landed | undefined> {
		if (!span.alive) return undefined;
		const target = leafTargetFor(field);
		const control = target && leaves.control(target.key);
		if (!target || !control) return undefined;
		mainCard?.revealLeaf(target.key);
		for (const card of cardRefs) card?.revealLeaf(target.key);
		if (!(await span.resumes(tick()))) return undefined;
		return { ...target, control };
	}

	/**
	 * Put the caret in a revealed target, at the finest grain it can take: a UTF-16 offset
	 * in a prose leaf or a nested content cell, a bare focus everywhere else. A form
	 * control has no coordinate to spend an offset in (an `<input type="number">`
	 * refuses a selection outright), which is also the whole of what a click on
	 * plate-placed ink can mean. A cell is no `createField` leaf, so the offset goes
	 * down the container's walk instead, where what it means is the leaf's (`leaves.ts`).
	 *
	 * Hands back the box the arrival wash blooms in, which is the landing's own
	 * granularity rather than the registry's: a walk lands in one row and says so over
	 * the innermost row it opened, and everything else — the field, a property under a
	 * field-level subform, and a row the document has since dropped — over the field's
	 * box. Async because a row two closed boxes down exists only once the row above it
	 * has opened and flushed.
	 */
	async function land(found: Landed, pos: number | undefined): Promise<HTMLElement> {
		if (found.steps && found.control.focusPath) {
			return (await found.control.focusPath(found.steps, pos)) ?? found.control.el;
		}
		if (pos != null) {
			const prose = leaves.prose(found.key);
			if (prose) {
				prose.setCaret(pos);
				return found.control.el;
			}
		}
		found.control.focus();
		return found.control.el;
	}

	// ── The verbs, as instance exports ──────────────────────────────────────────
	// The same functions the card's own chrome calls, reached through `bind:this`, and
	// they speak the public vocabulary — a `DocPath` for a place, a `CardId` for a card
	// — so a host drives them with what the hooks handed it.
	//
	// A target the surface does not hold is a no-op that reports `target-unknown` at
	// `dev`: a key from a previous session, a card already removed, a path naming no
	// declared field. `setCaret` reports it too, being the verb a preview click drives:
	// a landing that resolved nothing is indistinguishable from one that landed, and a
	// consumer wiring the bridge reads the difference off nothing else.

	/** Reveal and focus the field at `field`, placing no caret inside it: a form control
	 *  takes the same handoff a click on its label does (`Field`, `leaves.ts`). */
	export async function focusField(field: DocPath): Promise<void> {
		const found = await revealLeaf(field);
		if (!found) return missed(`no mounted field at ${field}`, field);
		const box = await land(found, undefined);
		if (span.alive) bloom(box);
	}
	/** Play the arrival wash over the field at `field` and touch nothing else: no focus,
	 *  no reveal, no scroll. A field in a closed panel is skipped, its box clipped to
	 *  nothing; a nested address washes its field's box, a row being something only a
	 *  landing opens. */
	export function washField(field: DocPath): void {
		if (!span.alive) return;
		const target = leafTargetFor(field);
		const control = target && leaves.control(target.key);
		if (!control) return missed(`no mounted field at ${field}`, field);
		for (let n: HTMLElement | null = control.el; n; n = n.parentElement) if (n.inert) return;
		bloom(control.el);
	}
	/** Seed a card of `kind` and insert it at `at` (default: the end). Returns the new
	 *  card's session key, or `undefined` when the quill seeds no card of that kind. */
	export function insertCard(kind: string, at: number = cardIds.length): CardId | undefined {
		return addCard(Math.min(Math.max(at, 0), cardIds.length), kind);
	}
	export function removeCard(cardId: CardId): void {
		if (!holds(cardId)) return;
		removeCardById(cardId);
	}
	/** One slot: the step the reorder control takes, and the one the surface animates. */
	export function moveCard(cardId: CardId, dir: -1 | 1): void {
		if (!holds(cardId)) return;
		moveCardById(cardId, dir);
	}
	export function setKind(cardId: CardId, kind: string): void {
		if (!holds(cardId)) return;
		retypeCardById(cardId, kind);
	}

	// ── Changes the host made ───────────────────────────────────────────────────
	// A live session writes another client's edits into the document itself and then
	// says what it moved. The surface re-reads, keeps every mounted leaf and caret it can,
	// and reports none of it through `onChange`: the edit is not this surface's.

	/** Re-read the prose leaf at `field` from the document, landing the difference as one
	 *  step outside its undo history; `delta`, the change's text delta over what the leaf
	 *  held, carries the caret. */
	export function applyExternal(field: DocPath, delta?: Delta): void {
		if (!span.alive) return;
		const target = leafTargetFor(field);
		if (target && !target.steps) leaves.prose(target.key)?.applyExternal(delta);
		rederive();
	}
	/** Re-read the cards' kinds, titles and form fields from the document. */
	export function refresh(): void {
		if (span.alive) rederive();
	}
	/** Move the card keys in step with card-list changes the document already holds, in the
	 *  order it applied them, so every card that stays keeps its leaves. */
	export function applyCardOps(ops: readonly CardOp[]): void {
		if (!span.alive) return;
		undo.withdraw();
		const ids = cardIds.slice();
		for (const op of ops) {
			if (op.op === 'insert') ids.splice(op.at, 0, seq.next());
			else if (op.op === 'remove') forget(ids.splice(op.at, 1)[0]);
			else ids.splice(op.to, 0, ...ids.splice(op.from, 1));
		}
		cardIds = ids;
		rederive();
	}

	// ── Review ──────────────────────────────────────────────────────────────────

	/**
	 * Bring the review item `id` to the reader: open the panel holding it, scroll it to the
	 * middle of the view, light it, and raise its card where it has one. The focus stays
	 * where it is, the reader having asked to look, unless `focus` asks for it: the caret
	 * then goes into the item, or the focus to its field, so the chords answer it. False for
	 * an item the editor does not draw.
	 */
	export function revealReview(id: string, opts: { focus?: boolean } = {}): Promise<boolean> {
		return reveal(id, opts.focus ?? false, false);
	}
	/** {@link revealReview}; a step leaves an item already wholly in view where it is, so a walk
	 *  down neighbouring items does not jump the page under each. */
	async function reveal(id: string, focus: boolean, stepping: boolean): Promise<boolean> {
		if (!span.alive) return false;
		const key = reviewing.keyOf(id);
		if (key === undefined) return false;
		mainCard?.revealLeaf(key);
		for (const card of cardRefs) card?.revealLeaf(key);
		if (!(await span.resumes(tick()))) return false;
		reviewing.reveal(id);
		if (focus && !leaves.prose(key)?.enterReview(id)) leaves.control(key)?.focus();
		// The lit item is drawn again, so its element is read once it has been.
		if (!(await span.resumes(tick()))) return false;
		const at =
			leaves.prose(key)?.reviewElements(id)[0] ??
			[...(rootEl?.querySelectorAll<HTMLElement>('[data-qm-review]') ?? [])].find(
				(el) => el.getAttribute('data-qm-review') === id
			) ??
			leaves.control(key)?.el;
		const box = at?.getBoundingClientRect();
		if (stepping && box && box.top >= 0 && box.bottom <= window.innerHeight) return true;
		const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		at?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
		return true;
	}

	/**
	 * Answer open items as their buttons would, in document order: `'all'` is every item drawn.
	 * An accept passes over a change, which has none, and an item that cannot be answered (a
	 * proposal that no longer writes, a value the field's writer refuses) stands. `onReview`
	 * hears each answer, and neither the focus nor the caret moves. Returns the ids answered.
	 */
	export function answerReview(
		ids: readonly string[] | 'all',
		action: 'accept' | 'dismiss'
	): string[] {
		if (!span.alive) return [];
		const order = reviewOrder();
		const asked = ids === 'all' ? order : order.filter((id) => ids.includes(id));
		const out: string[] = [];
		const entry: Answered = { ids: [], inverses: [] };
		batching = entry;
		writing++;
		try {
			for (const id of asked) {
				const item = reviewing.items.find((it) => it.id === id);
				if (!item || (action === 'accept' && item.state === 'changed')) continue;
				const key = reviewing.keyOf(id);
				// Each one is planned against the document the one before it left.
				const answered =
					'anchor' in item
						? key !== undefined && !!leaves.prose(key)?.answerReview(id, action)
						: reviewing.act(id, action);
				if (answered) out.push(id);
			}
		} finally {
			writing--;
			batching = undefined;
		}
		if (entry.ids.length) {
			if (!journalOffer || !undo.holds(journalOffer)) journal = [];
			entry.notice = action === 'accept' ? merged.reviewAcceptedAll : merged.reviewDismissedAll;
			journal.push(entry);
			offerJournal();
		}
		return out;
	}

	/** Bring the next or previous open item to the reader, in document order and round from
	 *  either end, from the lit item or the one last stepped to: the caret in it, or the
	 *  focus in its field, unless `focus` is false. Resolves its id, `undefined` when none is
	 *  drawn. */
	export function stepReview(
		dir: 1 | -1,
		opts: { focus?: boolean } = {}
	): Promise<string | undefined> {
		return step(dir, opts.focus ?? true);
	}

	/**
	 * Offer `undo` as the one step back from a write the host just made: `notice` on the
	 * toast a removal's undo takes, with its button, and ⌘Z/Ctrl+Z anywhere in the editor
	 * until the next edit lands. Runs at most once. Returns the withdrawal, for a host whose
	 * step has gone stale some other way.
	 */
	export function offerUndo(notice: string, restore: () => void): () => void {
		if (!span.alive) return () => {};
		undo.offer(notice, restore, { standing: true });
		const offered = undo.current;
		return () => {
			if (undo.holds(offered)) undo.withdraw();
		};
	}

	function holds(cardId: CardId): boolean {
		if (cardIndexOf(cardId) >= 0) return true;
		missed(`no card ${cardId} in this session`);
		return false;
	}
	function missed(message: string, path?: DocPath): void {
		reportError(onError, { code: 'target-unknown', severity: 'dev', message, path });
	}

	/** What a `DocPath` resolves to in the mounted tree: a leaf key, and the steps from
	 *  that field to the leaf when the address names one inside it. */
	interface LeafTarget {
		key: string;
		steps?: PathStep[];
	}
	/** A resolved target with the handle the registry holds for it. */
	type Landed = LeafTarget & { control: FieldControl };

	/**
	 * Map a landing's `field` to a mounted target, by the `addrForFieldPath` route the
	 * diagnostics take.
	 *
	 * Two rungs, because the boundary mints addresses at a finer granularity than
	 * `Addr` can name: a `richtext[]` element surfaces as `main.keywords[0]`, a nested
	 * row's cell as `main.vectors[0].tours[2].title`. The second rung reads the steps
	 * past the field against the schema, rung by rung — an index under a declared
	 * array, a key under a declared object, variant or matrix — which is why the ladder
	 * is the editor's (INVARIANTS §Surface): the preview carries no schema, and
	 * truncating the address there is worse than guessing, since `pos` is an offset
	 * into the leaf's own content.
	 */
	function leafTargetFor(field: DocPath): LeafTarget | undefined {
		const direct = addrForFieldPath(field);
		if (direct) {
			const resolved = resolveCardKey(direct, cardIds);
			return resolved ? { key: fieldKeyToString(resolved) } : undefined;
		}
		const nested = nestedAddrForFieldPath(field);
		if (!nested) return undefined;
		const declared = declaredField(nested.field);
		if (!declared || !isContainer(controlKind(declared))) return undefined;
		if (!schemaAt(declared, nested.steps)) return undefined;
		const resolved = resolveCardKey(nested.field, cardIds);
		return resolved ? { key: fieldKeyToString(resolved), steps: nested.steps } : undefined;
	}

	/** The schema the field at `addr` declares, off the live card's kind: the guard the
	 *  nested rung stands on. Asked of `controlKind` and `schemaAt`, so what the ladder
	 *  tests is the control the tree mounted — the one holding a `focusPath` — and not a
	 *  second reading of the schema beside it. */
	function declaredField(addr: Addr): QuillFieldSchema | undefined {
		if (addr.field == null) return undefined;
		const kind = typeof addr.card === 'number' ? model.cards[addr.card]?.kind : undefined;
		const schema = quill.schema;
		const card = addr.card == null ? schema.main : kind ? schema.card_kinds?.[kind] : undefined;
		return card?.fields?.[addr.field];
	}

	/** A file dropped anywhere in the editor is refused, or the browser opens it in place
	 *  of the page. Text drops carry no `Files` and pass. */
	function refuseFiles(e: DragEvent): void {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'none';
	}
</script>

<svelte:document onkeydowncapture={onUndoKey} />

<!-- The keydown is a control's, bubbled: the root resolves which description it raises.
     A file dragged over or dropped is refused here, after any control has seen it. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="qm-editor {className ?? ''}"
	{style}
	data-qm-root
	bind:this={rootEl}
	onkeydowncapture={onStepKey}
	onkeydown={raiseGuidance}
	ondragover={refuseFiles}
	ondrop={refuseFiles}
>
	<!-- `main` and the tips card are one block in the stack: the tips card tucks under
	 `main`'s bottom corners, so the two share a seam rather than a gutter and the
	 wrapper is what holds them to it. -->
	<div class="qm-primary">
		<Card
			bind:this={mainCard}
			card={model.main}
			{doc}
			{quill}
			isFirst={true}
			isLast={true}
			{kinds}
			ops={opsFor('main', true)}
			{enumDisallowed}
			onFocus={handleFocus}
			onCaretMove={handleCaret}
			onChange={proseChanged}
			{onError}
			{leaves}
		/>

		<!-- A fixed slot after `main`, ahead of the cards, so document-level guidance
		 reads as document-level and never displaces a field. Dismissal empties the
		 channel, so the card leaves for good (INVARIANTS §"Card operations"). -->
		{#if model.tips.length}
			<TipsCard tips={model.tips} onDismiss={dismissTips} {onError} />
		{/if}
	</div>

	{@render addAffordance(0)}
	<!-- A card and the gap under it are one slot, which is what a reorder moves: the
	 strip below a card is the same strip wherever the card lands, so it rides along
	 rather than being slid across. It is also the shape `animate:` asks for, being the
	 keyed block's only child. -->
	{#each model.cards as c, i (c.id)}
		<div class="qm-card-slot" bind:this={slotEls[i]} animate:reorder={arm.armed} in:slot out:slot>
			<Card
				bind:this={cardRefs[i]}
				card={titled(c)}
				{doc}
				{quill}
				isFirst={i === 0}
				isLast={i === model.cards.length - 1}
				{kinds}
				ops={opsFor(c.id, false)}
				{enumDisallowed}
				onFocus={handleFocus}
				onCaretMove={handleCaret}
				onChange={proseChanged}
				{onError}
				{leaves}
			/>
			{@render addAffordance(i + 1)}
		</div>
	{/each}
	<!-- The way back to a removed card once its toast has gone: the newest kept step, by
	 name, at the stack's foot, where the control that adds a card is looked for. -->
	{#if undo.kept}
		<div class="qm-restore">
			<button
				type="button"
				class="qm-restore-btn qm-tap-floor qm-focus-ring"
				onclick={() => undo.takeKept()}>{undo.kept.label}</button
			>
		</div>
	{/if}
	<!-- The removal's undo. The region stands empty between offers so the notice it takes is
	 announced: a live region inserted along with its text is one a reader may not hear. -->
	<div class="qm-toast-slot" role="status">
		{#if undo.current}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- The handlers hold the lapse while the toast is in use and add no interaction. -->
			<div
				class="qm-toast"
				onpointerenter={() => undo.pause()}
				onpointerleave={() => undo.resume()}
				onfocusin={() => undo.pause()}
				onfocusout={() => undo.resume()}
			>
				<span class="qm-toast-notice">{undo.current.notice}</span>
				<button
					type="button"
					class="qm-toast-action qm-focus-ring"
					aria-keyshortcuts="Meta+Z Control+Z"
					onclick={() => undo.take()}>{merged.undoAction}</button
				>
			</div>
		{/if}
	</div>
</div>

<FormatPopover {getActiveLeaf} families={fontFamilies} {fontLabels} />
<ReviewPopover review={reviewing} targetFor={reviewTarget} />

<!-- The add affordance is gated on the schema declaring `card_kinds`, there being
 nothing to seed otherwise. Cards render regardless: a kind with no schema degrades to
 a recovery shell inside <Card> (retype + delete), never gated away, so its content is
 neither dropped nor trapped. The gate lives here rather than at each call site: the
 strip is one decision, and two copies of it drift into a stack with a gap at one
 end. -->
{#snippet addAffordance(atIndex: number)}
	{#if kinds.length}
		<!-- The strip past the last card is the append point, the one a reader looks for
		 rather than finds by position, so it alone states itself in words at rest. A gap
		 between cards draws nothing inside it: the strip is the gap, and the pill it fills
		 on hover is the space the new card takes. -->
		{@const marked = atIndex === model.cards.length}
		<div class={['qm-add-card', { 'qm-add-card-marked': marked }]}>
			<!-- Marked, the words are the accessible name and no `aria-label` doubles
			 them; bare, the same words land as the label, the strip having no
			 content to carry them. -->
			{#if kinds.length === 1}
				<button
					type="button"
					class="qm-add-btn qm-add-affordance qm-tap-floor qm-focus-ring"
					aria-label={marked ? undefined : merged.addCard}
					onclick={() => addCard(atIndex, kinds[0], true)}
					>{#if marked}{`+ ${merged.addCard}`}{/if}</button
				>
			{:else}
				<!-- Multi-kind add: pick the kind, then seed + insert. A menu rather than a
			 disclosure: it floats out of the stack, so raising it moves no card, and
			 it dismisses on pick, on Escape and on a click outside, none of which a
			 `<details>` does. The trigger is bits-ui's `<button>`, which is why the
			 rules below reach it through `:global`. -->
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="qm-add-btn qm-add-affordance qm-tap-floor qm-focus-ring"
						aria-label={marked ? undefined : merged.addCard}
						>{#if marked}{`+ ${merged.addCard}`}{/if}</DropdownMenu.Trigger
					>
					<DropdownMenu.Portal to={rootEl}>
						<DropdownMenu.Content
							collisionBoundary={rootEl ?? []}
							sideOffset={spacePx(rootEl)}
							onCloseAutoFocus={(e) => {
								if (picked) e.preventDefault();
								picked = false;
							}}
						>
							<!-- Portalled out of the row but into the stack's root, and carrying the
						     marker itself: floating is still a detached subtree to the
						     derivation, like FormatPopover and the enum listbox. The root is the
						     flip's boundary for the reason it is theirs: it is the box that clips
						     the surface where the consumer scrolls one. -->
							<div class="qm-menu-surface" data-qm-root>
								{#each kinds as k (k)}
									<DropdownMenu.Item class="qm-menu-item" onSelect={() => addPicked(atIndex, k)}
										>{kindTitle(quill.schema.card_kinds?.[k], k)}</DropdownMenu.Item
									>
								{/each}
							</div>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			{/if}
		</div>
	{/if}
{/snippet}

<style>
	/* Pinned to the foot of whatever scrolls the surface, and taking no room in the stack:
	   zero tall, its gap handed back, so an offer raises a toast over the cards without
	   moving one. */
	.qm-toast-slot {
		position: sticky;
		bottom: var(--toast-foot, var(--_qm-space-3));
		z-index: 1;
		display: flex;
		justify-content: center;
		align-items: flex-end;
		height: 0;
		margin-top: calc(-1 * var(--_qm-space-2));
		pointer-events: none;
	}
	.qm-toast {
		display: flex;
		align-items: center;
		gap: var(--_qm-space-3);
		padding: var(--_qm-space) var(--_qm-space) var(--_qm-space) var(--_qm-space-3);
		border: var(--_qm-border-width) solid var(--_qm-border);
		border-radius: var(--_qm-radius-pill);
		background: var(--_qm-surface-raised);
		box-shadow: var(--_qm-lift);
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink);
		pointer-events: auto;
	}
	.qm-toast-action {
		min-height: var(--_qm-tap-min);
		padding-inline: var(--_qm-space-2);
		border: 0;
		border-radius: var(--_qm-radius-pill);
		background: transparent;
		font: inherit;
		font-weight: var(--_qm-weight-strong);
		color: var(--_qm-accent);
		cursor: pointer;
	}
	.qm-toast-action:hover {
		background: var(--_qm-accent-tint);
	}
	/* Words at the label ink, unboxed: the stack's foot already holds one outlined pill, and
	   a second would stand as its equal. */
	.qm-restore {
		display: flex;
		justify-content: center;
	}
	.qm-restore-btn {
		min-height: var(--_qm-tap-min);
		padding-inline: var(--_qm-space-2);
		border: 0;
		border-radius: var(--_qm-radius-pill);
		background: transparent;
		font: inherit;
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
		cursor: pointer;
	}
	.qm-restore-btn:hover {
		background: var(--_qm-add-fill);
		color: var(--_qm-ink);
	}
	/* A detached root, carrying `data-qm-root` for the derivation core/theme.css applies
	   to one — the baseline font and colour included, so nothing here restates them.

	   The column, not only the cards in it: the gutter the stack sits in and the tone
	   behind it are the surface's own, so a bare `<div>` is a mounting site and nothing
	   is owed before the editor looks right. `border-box`, so a height from the caller is
	   the height this draws.

	   `:global(:where(…))` puts a promised class at zero rank, and both halves are
	   load-bearing: `:global` drops the scoping class, `:where` drops the rest
	   (INVARIANTS §Styling). The class is the surface's root wherever it mounts, so
	   leaving the component's scope costs nothing.

	   The sunken rung, which is what makes a card an island: the cards are the base
	   plane and this is the one they float on, so the gutter reads as ground rather
	   than as more card (INVARIANTS §Styling). The inset is the widest rung on the
	   ramp, which is what gives the ground enough of itself to read as ground: at a
	   narrower one the stack meets whatever frames the surface and the islands are
	   back to being one block clipped at its edges. That is the page form; a pane's
	   frame is the host's, and it spends less (`.qm-pane` below). */
	:global(:where(.qm-editor)) {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		/* The width is the host's, never the document's. A mount standing in a column that
		   floors at what it holds — a flex or grid track with no minimum of its own — is
		   otherwise asked for the widest thing in the document, and a table is as wide as
		   its columns. The island holds its own end of that (`codec/prose.css` §"The table
		   island"); this is the boundary, so a construct a leaf gains later cannot reach
		   past it either. `inline-size`, not `size`: a surface is as tall as its cards, or
		   the pane's under `.qm-pane`. */
		contain: inline-size;
		gap: var(--_qm-space-2);
		padding: var(--_qm-space-5);
		background: var(--_qm-surface-sunken);
		color: var(--_qm-ink);
	}
	/* Opt-in, and the four popovers are the reason: each resolves its portal target with
	   `closest('[data-qm-root]')`, which is this element, so an `overflow` here clips the
	   menu a leaf raised. Mounted in a page that scrolls, nothing clips; mounted in a
	   pane that does, the host says so and takes the clipping it would have had from its
	   own scrolling frame either way. The tail rides with the scroller because it is only
	   meaningful under one: dead space below the last card, so it can be read mid-pane
	   rather than against the bottom edge.

	   The height is what makes the rest of the rule mean anything, and it is the pane's
	   rather than a number of ours: `overflow` on a box that grows to its content never
	   has anything to scroll, so the stack would run past the pane and be clipped by
	   whatever the host frames it with. Taking the pane's height is the whole of what
	   `.qm-pane` claims (THEMING §"Drop it in"), and it resolves to `auto` on a mounting
	   site with no height of its own, which is the page form kept. The cards do not
	   shrink to fit: a flex item's automatic minimum floors each at its own height, so
	   the stack overflows and scrolls rather than squashing.

	   A pane is where the host has already framed the surface, so the ground needs less
	   of itself to read as ground: the frame is what the stack would otherwise meet. So
	   the gutter steps in to the seam the add strip holds between cards, the ground
	   being one width all round the stack, and the width it gives back goes to what is
	   written. */
	:global(:where(.qm-editor.qm-pane)) {
		height: 100%;
		overflow: auto;
		overscroll-behavior: contain;
		padding: var(--_qm-space-4);
		padding-block-end: var(--_qm-tail);
		/* The pane is the toast's scroller, and a sticky box stops at its scroller's
		   padding: the tail would hold the toast a tail's height off the pane's foot. On a
		   page the viewport scrolls, and the surface's padding is no bar. */
		--toast-foot: calc(var(--_qm-space-3) - var(--_qm-tail));
	}
	/* The stack's one gapless seam, which `TipsCard` draws and this holds the two
	 blocks to. `main` has to paint over the tip: a later sibling paints over an earlier
	 one otherwise, and the tip's background would cover the corners it is there to
	 fill. `isolation` keeps that z-index local, so one wrapper owns the ordering and no
	 card below inherits an argument about it. The wrapper is a single flex item, so the
	 pair takes the editor's gap once, together, exactly as one card does. */
	.qm-primary {
		isolation: isolate;
	}
	.qm-primary > :global(.qm-card) {
		position: relative;
		z-index: 1;
	}
	/* A slot restates the stack's own column and rhythm, so grouping a card with the
	 strip under it changes no geometry: the strip takes the same gap back on both
	 sides whether the gap above it is the slot's or the stack's, and a slot's own
	 height is short by exactly the gap the strip absorbed at its foot. */
	.qm-card-slot {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space-2);
	}
	/* The strip between two blocks, and the whole of it is the target: a gap is found by
	 position, so reveal and hit region are the full-bleed row rather than a word to aim
	 at in the middle of it. Taking the editor's gap back on both sides is what makes it
	 the gutter rather than a control sitting in one, and the pill it fills on hover is
	 edge to edge the space the new card opens into. No band is held back as
	 miss-tolerance: gutter that reads as the trigger and inserts nothing unsays what the
	 fill claims. Absorbed rather than removed, because `gap` is also what separates the
	 one seam no strip sits in: every card from the next under a quill declaring no
	 kinds, where the affordance does not render at all. */
	.qm-add-card {
		display: flex;
		margin-top: calc(var(--_qm-space-2) * -1);
		margin-bottom: calc(var(--_qm-space-2) * -1);
	}
	/* Unboxed, like every button, and not dashed: a dashed edge is the placeholder idiom
	 ("nothing is here yet"), which on a button reads as disabled or as a drop target. It
	 stays honest in one place, the un-schemable card (`Card.svelte`), which is a state
	 rather than a control. A gap's trigger rests invisible, so the fill is the whole of
	 what it shows: the pill fills the strip because the strip is what was
	 pressed, and the strip is the gap, so the fill is the card-to-be drawn where it will
	 land.

	 No inset of its own: the pill and the gap are the same rectangle, and a bare strip is
	 a band of gutter, so its height is a rhythm rung. The press floor the box gives up is
	 `.qm-tap-floor`'s (controls.css); what it overhangs is the card's own inset above and
	 below, which holds no target, so the floor costs a neighbour nothing.

	 A gap's ink is pinned to the label tone in every state, taking back the family's hover
	 step: the trigger arrives and leaves on opacity, and a tone moving under an opacity already
	 moving reads as two trips at different speeds.

	 `:global`, because the multi-kind trigger is bits-ui's own element and a `class`
	 passed to a primitive is a plain string that never picks up the scoping hash:
	 the same seam the enum trigger is styled through. */
	.qm-add-card :global(.qm-add-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: var(--_qm-space-4);
		color: var(--_qm-ink-label);
		opacity: 0;
		transition:
			opacity var(--_qm-duration-fast) var(--_qm-ease-reverse),
			background-color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	/* The append point is the one strip read at rest, so it is a pill sized to its words
	   at the ink, outlined by the well's hairline rather than dashed: the document's main
	   structural action stands as plainly as the controls inside a card. */
	.qm-add-card-marked {
		justify-content: center;
	}
	.qm-add-card-marked :global(.qm-add-btn) {
		width: auto;
		height: var(--_qm-tap-min);
		padding-inline: var(--_qm-space-3);
		font-size: var(--_qm-text-label);
		font-weight: var(--_qm-weight-mid);
		color: var(--_qm-ink);
		background: var(--_qm-surface);
		box-shadow: inset 0 0 0 var(--_qm-border-width) var(--_qm-well-edge);
		opacity: 1;
	}
	/* One arrival, three ways in. Keyboard focus, because the fill is the only thing that
	   reads as the trigger on a bare strip; and an open menu, because it portals out of
	   the strip, so a pointer moving onto an item has left the row whose hover was drawing
	   the pill the menu hangs from. The arrival takes the long trip and the leave the fast
	   rung, a transition being the state's it ends in. */
	.qm-add-card :global(.qm-add-btn:hover),
	.qm-add-card :global(.qm-add-btn:focus-visible),
	.qm-add-card :global(.qm-add-btn[data-state='open']) {
		opacity: 1;
		background: var(--_qm-add-fill);
		transition:
			opacity var(--_qm-reveal),
			background-color var(--_qm-reveal);
	}
</style>
