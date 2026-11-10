<!--
 The review items a container hands to one of its places, drawn under that place's control:
 a proposal as the value that would go and the value that would come with its two answers, an
 accepted one as the line a changed field's control carries along its foot. An item naming a
 place deeper than the control under which it is drawn, which no control of its own draws,
 leads with where it is: the cells and members between, by name and number.
-->
<script lang="ts">
	import type { PathStep } from '@quillmark/wasm';
	import ReviewProposal from './ReviewProposal.svelte';
	import { isChange, valueIn, type DeepReview } from './review.js';
	import { review } from './review.svelte.js';
	import { wording } from './strings.js';
	import { humanize } from './structure.js';

	interface Props {
		entries: readonly DeepReview[] | undefined;
		/** The value the place holds, which the entries' steps walk from. */
		value: unknown;
		/** The place is a list's member, which a proposal of nothing takes out. */
		member?: boolean;
	}
	let { entries, value, member = false }: Props = $props();

	const t = wording();
	const reviewing = review();

	const where = (steps: readonly PathStep[]): string | undefined =>
		steps.length
			? steps
					.map((step) =>
						typeof step === 'number' ? t.strings.elementItem(step + 1) : humanize(step)
					)
					.join(' · ')
			: undefined;
</script>

{#each entries ?? [] as { steps, item } (item.id)}
	{#if !isChange(item)}
		<ReviewProposal
			{item}
			value={valueIn(value, steps)}
			label={where(steps)}
			removes={item.after === undefined &&
				(steps.length ? typeof steps.at(-1) === 'number' : member)}
		/>
	{:else}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class={['qm-review-line', { 'qm-review-lit': reviewing.lit === item.id }]}
			data-qm-review={item.id}
			onpointerenter={() => reviewing.point(item.id, 'pointer')}
			onpointerleave={() => reviewing.point(undefined, 'pointer')}
		></div>
	{/if}
{/each}

<style>
	/* The line a changed control carries along its foot (`Field.svelte`), under the place it
	   changed, at the vertical width the surface draws a stroke at. */
	.qm-review-line {
		height: var(--_qm-vertical-width);
		background: var(--_qm-review-line);
	}
	.qm-review-line.qm-review-lit {
		box-shadow: 0 0 0 var(--_qm-vertical-width) var(--_qm-review-tint);
	}
</style>
