<!--
 The card over a change: what the words or the value replaced, and the one button that takes the
 change back. One card, shell-owned, up for whichever `changed` item the review state shows
 (`review.svelte.ts`), over a mark in a prose leaf or over a field's control.

 Under its anchor, where the format popover rises over a selection: the two can be up at once,
 and what the reader is reading is the line above.

 Focus discipline is the format popover's: the card never takes the focus, so the caret that
 raised it stays where it was, and its button swallows its own mousedown for the same reason.
 The pointer's card ends on a scroll, the page having moved under a pointer that did not; the
 caret's and a reveal's follow their mark.
-->
<script lang="ts" module>
	import type { RangeAnchor } from '../core/codec/index.js';
</script>

<script lang="ts">
	import { Popover } from 'bits-ui';
	import { spacePx } from '../core/rungs.js';
	import { wording } from './strings.js';
	import { reviewText } from './review.js';
	import type { Review } from './review.svelte.js';
	import './controls.css';

	/** Where item `id` is drawn. */
	export interface ReviewTarget {
		/** What its card hangs off: a field's control, or a live measure of a mark in a leaf. */
		anchor: Element | RangeAnchor;
		/** The mark is the wedge that stands where text was only removed. */
		removed: boolean;
	}

	interface Props {
		review: Review;
		targetFor: (id: string) => ReviewTarget | undefined;
	}
	let { review, targetFor }: Props = $props();

	const t = wording();

	const shown = $derived(review.shown);
	const target = $derived(shown ? targetFor(shown.item.id) : undefined);
	const anchor = $derived(target?.anchor);
	const open = $derived(!!shown && !!anchor);
	const portalTarget = $derived.by(() => {
		const el = anchor && 'contextElement' in anchor ? anchor.contextElement : anchor;
		return el?.closest<HTMLElement>('[data-qm-root]') ?? undefined;
	});

	/** What the card says: a lead word, and the old words or value where there were any. */
	const said = $derived.by(() => {
		if (!shown) return undefined;
		const { item } = shown;
		const s = t.strings;
		if ('field' in item) {
			const was = reviewText(item.before, { on: s.reviewOn, off: s.reviewOff });
			return { lead: s.reviewWas, text: was || s.reviewEmpty, empty: !was };
		}
		const before = item.before ?? '';
		if (target?.removed) return { lead: s.reviewRemoved, text: before, empty: false };
		return before
			? { lead: s.reviewWas, text: before, empty: false }
			: { lead: s.reviewAdded, text: '', empty: false };
	});

	function onScroll(): void {
		if (review.shown?.via === 'pointer') review.dismiss();
	}
</script>

<svelte:document onscrollcapture={onScroll} />

<Popover.Root
	{open}
	onOpenChange={(next) => {
		if (!next) review.dismiss();
	}}
>
	<Popover.Portal to={portalTarget}>
		<Popover.Content
			customAnchor={anchor ?? null}
			collisionBoundary={portalTarget ?? []}
			side="bottom"
			align="start"
			trapFocus={false}
			sideOffset={spacePx(portalTarget, 1)}
			onOpenAutoFocus={(e: Event) => e.preventDefault()}
			onCloseAutoFocus={(e: Event) => e.preventDefault()}
			onInteractOutside={(e: Event) => {
				// A press on the mark the card is up for is not a press away from it.
				const id = review.shown?.item.id;
				const on = e.target instanceof Element ? e.target.closest('[data-qm-review]') : null;
				if (id !== undefined && on?.getAttribute('data-qm-review') === id) e.preventDefault();
			}}
		>
			{#snippet child({ props, wrapperProps, open: raised })}
				<div {...wrapperProps}>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- The handlers hold the card up while it is in use and add no interaction. -->
					<div
						{...props}
						class="qm-review-card qm-popover-surface"
						data-qm-root
						role="group"
						aria-label={t.strings.reviewChange}
						inert={!raised}
						onpointerenter={() => review.hold()}
						onpointerleave={() => review.release()}
					>
						{#if said}
							<span class="qm-review-said">
								<span class="qm-review-lead">{said.lead}</span>
								{#if said.text}
									<span class={['qm-review-before', { 'qm-review-none': said.empty }]}
										>{said.text}</span
									>
								{/if}
							</span>
						{/if}
						<button
							type="button"
							class="qm-chip qm-review-undo qm-focus-ring"
							title={t.strings.reviewUndoTitle}
							onmousedown={(e) => e.preventDefault()}
							onclick={() => shown && review.act(shown.item.id, 'undo')}
							>{t.strings.reviewUndo}</button
						>
					</div>
				</div>
			{/snippet}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>

<style>
	/* The lift, the translucency and the scale-in are `.qm-popover-surface`'s (controls.css).
	   A row: what was, then the way back, the button holding its place at the top of a card
	   whose old words wrap. The measure caps a long passage at a few lines, which is a
	   reminder of what stood there rather than a second copy of the page. */
	.qm-review-card {
		display: flex;
		align-items: flex-start;
		gap: var(--_qm-space-3);
		max-width: min(24rem, 90vw);
		padding: var(--_qm-space) var(--_qm-space) var(--_qm-space) var(--_qm-space-3);
		font-size: var(--_qm-text-label);
		line-height: var(--_qm-leading-tight);
		color: var(--_qm-ink);
	}
	.qm-review-said {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		overflow: hidden;
		min-width: 0;
		/* The button's own height less this line's, halved: one line of words centres on it. */
		padding-block: calc((var(--_qm-tap-min) - 1lh) / 2);
		overflow-wrap: anywhere;
	}
	.qm-review-lead {
		color: var(--_qm-ink-label);
	}
	.qm-review-before {
		margin-inline-start: var(--_qm-space);
		white-space: pre-wrap;
	}
	.qm-review-none {
		color: var(--_qm-ink-label);
		font-style: italic;
	}
	.qm-review-undo {
		flex-shrink: 0;
		font-weight: var(--_qm-weight-mid);
		color: var(--_qm-ink);
	}
</style>
