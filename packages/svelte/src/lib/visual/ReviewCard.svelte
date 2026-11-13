<!--
 The answer card: one floating surface on the current change of a review, and the one place a
 change is answered by pointer. A quiet Dismiss and a primary Accept, each with its key, and a
 note where the reader's own writing meets the change. The change itself is drawn where it
 stands, so the card is the same two answers on every change. It carries no position: the count
 is the host's bar's.

 It sits under the block the change flows in, so it covers no line of its paragraph, or beside
 that block's last line where the line ends short of it, centred on a block of one line such as a
 one-line field's, right-aligned to the text column the
 change stands in, and flips above that block where there is no room below, keeping clear of the
 host's chrome at the pane's foot (`inset`). Over a change taller than the pane it stays pinned
 at the foot while any of the change shows. A change out of the pane keeps its card where it
 would stand beside it, so the card scrolls out with the text and the pane's edge clips it as it
 clips the text.
 A change is several elements (struck runs, tinted widgets, added blocks, a row
 under a control, a card's mark), so the box is their union, read anew on each measure: a leaf
 redraws its decorations as it likes, and a box measured once parts from the text it stood on.
 What it watches is the card holding the change, not the editor: a mutation there, a scroll
 anywhere, a resize of the editor.

 It never takes the focus. A press on it keeps the focus where it is, and the keyboard reaches
 it only by `enter`, from which Escape and every answer hand the focus back.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { REVIEW_KEYS } from '../core/codec/index.js';
	import { keycap, keyshortcut, wording } from './strings.js';
	import './controls.css';

	interface Props {
		/** The current change, `undefined` for no card. */
		id: string | undefined;
		/** The editor's root, which every element of the change is under. */
		root: HTMLElement | undefined;
		/** The room, in px, the host's chrome takes at the pane's foot. */
		inset: number;
		/** Held out of the way: the reader is typing. */
		hidden: boolean;
		/** The reader's own writing meets the change. */
		outdated: boolean;
		onAnswer(action: 'accept' | 'dismiss'): void;
	}
	let { id, root, inset, hidden, outdated, onAnswer }: Props = $props();

	const t = wording();

	let el = $state<HTMLElement | undefined>();
	let top = $state(0);
	let left = $state(0);
	/** Pinned at the pane's foot, where every scroll moves it, so it follows without a glide. */
	let pinned = $state(false);
	/** The change is drawn, so the card has somewhere to stand. */
	let placed = $state(false);
	/** Where the focus was when the keyboard entered the card, to hand it back. */
	let from: HTMLElement | undefined;

	const shown = $derived(placed && !hidden && id !== undefined);

	/** The elements the change draws. */
	const parts = (): HTMLElement[] =>
		id === undefined || !root
			? []
			: [...root.querySelectorAll<HTMLElement>(`[data-qm-review~="${CSS.escape(id)}"]`)];

	/** The box the pane shows the editor through: its nearest scroller's, within the window. */
	function band(): { top: number; bottom: number; left: number; right: number } {
		let box = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
		for (let at = root ?? null; at; at = at.parentElement) {
			const { overflowY } = getComputedStyle(at);
			if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
			const r = at.getBoundingClientRect();
			box = {
				top: Math.max(r.top, 0),
				bottom: Math.min(r.bottom, window.innerHeight),
				left: Math.max(r.left, 0),
				right: Math.min(r.right, window.innerWidth)
			};
			break;
		}
		return box;
	}

	/** Whether any of `at` shows in the pane, clear of the host's chrome at its foot. */
	function inView(at: HTMLElement): boolean {
		const r = at.getBoundingClientRect();
		const view = band();
		return r.bottom > view.top && r.top < view.bottom - inset;
	}

	function place(): void {
		const els = parts();
		const blocks = els.map(blockOf);
		const rects = blocks.map((b) => b.getBoundingClientRect()).filter((r) => r.width || r.height);
		if (!el || !rects.length) {
			placed = false;
			return;
		}
		const gap = gapPx();
		const view = band();
		const ceil = view.top + gap;
		const floor = view.bottom - inset - gap;
		const upper = Math.min(...rects.map((r) => r.top));
		const lower = Math.max(...rects.map((r) => r.bottom));
		const shows = lower >= ceil && upper <= floor;
		const h = el.offsetHeight;
		const w = el.offsetWidth;
		const column = (els[0].closest(
			'.qm-field, .qm-card, .qm-review-card-add, .qm-review-card-remove'
		) ?? root)!;
		left = Math.max(view.left + gap, column.getBoundingClientRect().right - w);
		const at = (root ?? el).getBoundingClientRect();
		const last = blocks.find((b, i) => b !== els[i] && b.getBoundingClientRect().bottom === lower);
		const tuck = last && lastLine(last, h);
		const below = tuck && tuck.right + gap <= left ? tuck.top : lower + gap;
		const above = upper - gap - h;
		const fits = below + h <= floor || above >= ceil;
		const y =
			below + h <= floor
				? below
				: above >= ceil
					? above
					: !shows
						? upper > floor
							? above
							: below
						: Math.max(ceil, Math.min(floor - h, below));
		top = y - at.top + (root?.scrollTop ?? 0);
		left = left - at.left + (root?.scrollLeft ?? 0);
		pinned = shows && !fits;
		placed = true;
	}

	/** The block a run of the change flows in, which the card keeps clear of whole: a card on
	 *  the run's own line covers the lines of its paragraph after it. */
	function blockOf(at: HTMLElement): HTMLElement {
		for (let up: HTMLElement | null = at; up && up !== root; up = up.parentElement)
			if (!/^(inline|contents)/.test(getComputedStyle(up).display)) return up;
		return at;
	}

	/** Where a card `h` tall stands beside the last line of a block, and where the line's words
	 *  end: a card beside a short last line covers nothing of the block, and beside a one-line
	 *  field's text, centred on it, nothing of the field after it. */
	function lastLine(block: HTMLElement, h: number): { top: number; right: number } | undefined {
		const range = document.createRange();
		range.selectNodeContents(block);
		const lines = [...range.getClientRects()].filter((r) => r.width && r.height);
		if (!lines.length) return undefined;
		const from = Math.max(...lines.map((r) => r.top));
		const on = lines.filter((r) => r.bottom > from);
		const top = Math.min(...on.map((r) => r.top));
		const right = Math.max(...on.map((r) => r.right));
		if (on.length < lines.length) return { top, right };
		const bottom = Math.max(...on.map((r) => r.bottom));
		return { top: (top + bottom - h) / 2, right };
	}

	function gapPx(): number {
		const n = Number.parseFloat(getComputedStyle(el ?? root!).getPropertyValue('--_qm-space'));
		return Number.isFinite(n) ? n : 0;
	}

	let frame = 0;
	function schedule(): void {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			place();
		});
	}

	// What moves the change: its own card's subtree, and the editor's size. Until the change has
	// drawn, the editor as a whole, which an advance to a change not yet redrawn needs.
	$effect(() => {
		void id;
		void inset;
		void hidden;
		if (!root || id === undefined) {
			placed = false;
			return;
		}
		schedule();
		const home = (): Element =>
			parts()[0]?.closest('.qm-card-slot, .qm-primary, .qm-review-head') ?? root!;
		let watched = home();
		const mutations = new MutationObserver(() => {
			const now = home();
			if (now !== watched) {
				mutations.disconnect();
				watched = now;
				mutations.observe(watched, WATCH);
			}
			schedule();
		});
		mutations.observe(watched, WATCH);
		const sizes = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
		sizes?.observe(root);
		return () => {
			mutations.disconnect();
			sizes?.disconnect();
		};
	});
	$effect(() => () => cancelAnimationFrame(frame));

	const WATCH: MutationObserverInit = {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ['data-qm-review', 'class', 'open', 'hidden']
	};

	/** Put the focus on Accept, handing it back to where it was on Escape or an answer. False
	 *  with no card on show. */
	export async function enter(): Promise<boolean> {
		if (!shown || !el || !inView(el)) return false;
		from = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
		await tick();
		el.querySelector<HTMLElement>('.qm-review-card-accept')?.focus({ preventScroll: true });
		return true;
	}

	function leave(): void {
		const back = from;
		from = undefined;
		if (back?.isConnected) back.focus({ preventScroll: true });
	}

	function answer(action: 'accept' | 'dismiss'): void {
		const held = !!el?.contains(document.activeElement);
		onAnswer(action);
		if (held) leave();
	}

	function onkeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			leave();
			return;
		}
		if (e.key !== 'Tab' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		const buttons = [...(el?.querySelectorAll<HTMLElement>('button') ?? [])];
		const at = buttons.indexOf(document.activeElement as HTMLElement);
		if (at < 0) return;
		e.preventDefault();
		const back = e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey);
		buttons[(at + (back ? -1 : 1) + buttons.length) % buttons.length].focus();
	}
</script>

<svelte:window onscrollcapture={schedule} onresize={schedule} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- The press keeps the focus where it is: the answer is about the text, not a move off it. -->
<div
	bind:this={el}
	class={[
		'qm-review-card qm-popover-surface',
		{ 'qm-review-card-on': shown, 'qm-review-card-pinned': pinned }
	]}
	style:top="{top}px"
	style:left="{left}px"
	role="group"
	aria-label={t.strings.reviewProposal}
	aria-hidden={!shown}
	inert={!shown}
	onmousedown={(e) => e.preventDefault()}
	{onkeydown}
	onfocusout={(e) => {
		if (!el?.contains(e.relatedTarget as Node | null)) from = undefined;
	}}
>
	{#if outdated}<span class="qm-review-card-note">{t.strings.reviewOutdated}</span>{/if}
	<button
		type="button"
		class="qm-review-card-dismiss qm-focus-ring"
		tabindex="-1"
		aria-keyshortcuts={keyshortcut(REVIEW_KEYS.dismiss)}
		onclick={() => answer('dismiss')}
		>{t.strings.reviewDismiss}<kbd>{keycap(REVIEW_KEYS.dismiss)}</kbd></button
	>
	<button
		type="button"
		class="qm-review-card-accept qm-focus-ring"
		tabindex="-1"
		aria-keyshortcuts={keyshortcut(REVIEW_KEYS.accept)}
		onclick={() => answer('accept')}
		>{t.strings.reviewAccept}<kbd>{keycap(REVIEW_KEYS.accept)}</kbd></button
	>
</div>

<style>
	/* Out of flow and over the text, at the popover's lift, translucency and blur. Placed in the
	   editor's own coordinates, so it scrolls with the change it stands on rather than chasing it
	   frame by frame. Hidden by opacity rather than unmounted, so a step glides it from one change
	   to the next. */
	.qm-review-card {
		position: absolute;
		z-index: 2;
		width: max-content;
		display: flex;
		align-items: center;
		gap: var(--_qm-space-half);
		padding: var(--_qm-space-half);
		font-family: var(--_qm-font);
		font-size: var(--_qm-text-label);
		line-height: var(--_qm-leading-tight);
		color: var(--_qm-ink);
		opacity: 0;
		pointer-events: none;
		animation: none;
		transition:
			opacity var(--_qm-duration-fast) var(--_qm-ease-reverse),
			top var(--_qm-duration-fast) var(--_qm-ease-reverse),
			left var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-review-card-pinned {
		transition: opacity var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-review-card-on {
		opacity: 1;
		pointer-events: auto;
	}
	@media (prefers-reduced-motion: reduce) {
		.qm-review-card {
			transition: opacity var(--_qm-duration-fast) var(--_qm-ease-reverse);
		}
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: var(--_qm-space);
		min-height: var(--_qm-tap-min);
		padding: var(--_qm-space-half) var(--_qm-space-2);
		border: none;
		border-radius: var(--_qm-radius-inner);
		background: transparent;
		font: inherit;
		font-weight: var(--_qm-weight-mid);
		color: inherit;
		cursor: pointer;
		transition: background-color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-review-card-dismiss {
		color: var(--_qm-ink-label);
	}
	.qm-review-card-dismiss:hover {
		background: var(--_qm-surface-hover);
		color: var(--_qm-ink);
	}
	.qm-review-card-accept {
		padding-inline: var(--_qm-space-3);
		background: var(--_qm-accent);
		color: var(--_qm-bg);
	}
	kbd {
		font: inherit;
	}
	.qm-review-card-note {
		padding-inline: var(--_qm-space-2);
		color: var(--_qm-ink-label);
	}
	/* Under a finger the keys are no help, and each answer is a tap target. */
	@media (pointer: coarse), (hover: none) {
		kbd {
			display: none;
		}
		button {
			padding-inline: var(--_qm-space-3);
		}
	}
	@media (forced-colors: active) {
		button {
			border: var(--_qm-border-width) solid ButtonText;
		}
	}
</style>
