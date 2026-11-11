<script lang="ts">
	// SPIKE: the one floating answer card, on the current review item.
	import { onMount } from 'svelte';

	interface Props {
		/** The current item, `undefined` for no card. */
		id: string | undefined;
		root: HTMLElement | undefined;
		/** Room the host's chrome takes at the foot of the scroller, in px. */
		inset: number;
		hidden: boolean;
		outdated: boolean;
		position?: string;
		onAnswer(action: 'accept' | 'dismiss'): void;
		onHover(on: boolean): void;
	}
	let { id, root, inset, hidden, outdated, position, onAnswer, onHover }: Props = $props();

	const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
	const mod = MAC ? '⌘' : 'Ctrl+';
	const GAP = 6;

	let el = $state<HTMLElement | undefined>();
	let top = $state(0);
	let left = $state(0);
	let shown = $state(false);

	function scrollerOf(node: HTMLElement): HTMLElement {
		for (let at: HTMLElement | null = node; at; at = at.parentElement) {
			const { overflowY } = getComputedStyle(at);
			if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight)
				return at;
		}
		return document.documentElement;
	}

	function place(): void {
		if (!root || !el || id === undefined) return void (shown = false);
		const els = [...root.querySelectorAll<HTMLElement>(`[data-qm-review="${CSS.escape(id)}"]`)];
		const rects = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width || r.height);
		if (!rects.length) return void (shown = false);
		const u = {
			top: Math.min(...rects.map((r) => r.top)),
			bottom: Math.max(...rects.map((r) => r.bottom))
		};
		const scroller = scrollerOf(root);
		const v =
			scroller === document.documentElement
				? { top: 0, bottom: window.innerHeight }
				: scroller.getBoundingClientRect();
		const floor = Math.min(v.bottom, window.innerHeight) - inset - GAP;
		const ceil = Math.max(v.top, 0) + GAP;
		if (u.bottom < ceil || u.top > floor) return void (shown = false);
		const h = el.offsetHeight;
		const w = el.offsetWidth;
		const column = (els[0].closest('.qm-card') ?? root).getBoundingClientRect();
		left = Math.max(GAP, column.right - w - 12);
		let at = u.bottom + GAP;
		if (at + h > floor) {
			const above = u.top - h - GAP;
			at = above >= ceil ? above : floor - h;
		}
		top = Math.max(ceil, Math.min(at, floor - h));
		shown = true;
	}

	let frame = 0;
	const schedule = () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(place);
	};
	$effect(() => {
		void id;
		void inset;
		void hidden;
		schedule();
	});
	onMount(() => {
		const ro = new ResizeObserver(schedule);
		if (root) ro.observe(root);
		const mo = root && new MutationObserver(schedule);
		mo?.observe(root!, { subtree: true, childList: true, attributes: true, characterData: true });
		window.addEventListener('scroll', schedule, true);
		window.addEventListener('resize', schedule);
		return () => {
			cancelAnimationFrame(frame);
			ro.disconnect();
			mo?.disconnect();
			window.removeEventListener('scroll', schedule, true);
			window.removeEventListener('resize', schedule);
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={el}
	class="qm-review-card"
	class:qm-review-card-on={shown && !hidden && id !== undefined}
	style:top="{top}px"
	style:left="{left}px"
	role="group"
	aria-label="Proposed change"
	onpointerenter={() => onHover(true)}
	onpointerleave={() => onHover(false)}
	onmousedown={(e) => e.preventDefault()}
>
	{#if outdated}<span class="qm-review-card-note">You edited this</span>{/if}
	{#if position}<span class="qm-review-card-pos">{position}</span>{/if}
	<button type="button" class="qm-review-card-dismiss" onclick={() => onAnswer('dismiss')}
		>Dismiss <kbd>{mod}.</kbd></button
	>
	<button type="button" class="qm-review-card-accept" onclick={() => onAnswer('accept')}
		>Accept <kbd>{mod}↵</kbd></button
	>
</div>

<style>
	.qm-review-card {
		position: fixed;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: 0.625rem;
		background: var(--_qm-surface-popover, Canvas);
		color: var(--_qm-fg, CanvasText);
		box-shadow:
			0 0 0 1px var(--_qm-review-line, rgb(0 0 0 / 0.12)),
			0 6px 20px rgb(0 0 0 / 0.14);
		font: 500 0.8125rem/1.2 var(--_qm-font, system-ui, sans-serif);
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 120ms,
			top 140ms ease-out,
			left 140ms ease-out;
	}
	.qm-review-card-on {
		opacity: 1;
		pointer-events: auto;
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 2rem;
		padding: 0.25rem 0.625rem;
		border-radius: 0.4rem;
		cursor: pointer;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
	}
	.qm-review-card-dismiss {
		color: var(--_qm-ink-label, GrayText);
	}
	.qm-review-card-dismiss:hover {
		background: var(--_qm-surface-hover, rgb(0 0 0 / 0.06));
	}
	.qm-review-card-accept {
		background: var(--_qm-accent, #2563eb);
		color: var(--_qm-bg, white);
		padding-inline: 0.875rem;
	}
	kbd {
		font: inherit;
		font-size: 0.6875rem;
		opacity: 0.7;
	}
	.qm-review-card-note,
	.qm-review-card-pos {
		padding-inline: 0.5rem;
		font-size: 0.75rem;
		color: var(--_qm-ink-label, GrayText);
	}
	@media (pointer: coarse) {
		kbd {
			display: none;
		}
		button {
			min-height: 2.75rem;
			padding-inline: 1rem;
		}
	}
</style>
