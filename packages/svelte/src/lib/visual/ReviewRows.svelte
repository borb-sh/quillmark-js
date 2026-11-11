<!--
 The review items a container hands to one of its places, each marked on that place's control:
 the review tint where the control shows the value it would hold, struck where a member would be
 taken out. An item naming a place deeper than the control it marks, which no control of its own
 draws, tints the nearest control that holds it.
-->
<script lang="ts">
	import ReviewProposal from './ReviewProposal.svelte';
	import type { DeepReview } from './review.js';

	interface Props {
		entries: readonly DeepReview[] | undefined;
		/** The place is a list's member, which a proposal of nothing takes out. */
		member?: boolean;
	}
	let { entries, member = false }: Props = $props();
</script>

{#each entries ?? [] as { steps, item } (item.id)}
	<ReviewProposal
		{item}
		removes={item.after === undefined && (steps.length ? typeof steps.at(-1) === 'number' : member)}
	/>
{/each}
