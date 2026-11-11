<!--
 The review items a container hands to one of its places, each a proposal marked on that place's
 control and said on the answer card. An item naming a place deeper than the control it marks,
 which no control of its own draws, is said on the card with where it is: the cells and members
 between, by name and number.
-->
<script lang="ts">
	import type { PathStep } from '@quillmark/wasm';
	import ReviewProposal from './ReviewProposal.svelte';
	import { valueIn, type DeepReview } from './review.js';
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
	<ReviewProposal
		{item}
		value={valueIn(value, steps)}
		label={where(steps)}
		removes={item.after === undefined && (steps.length ? typeof steps.at(-1) === 'number' : member)}
	/>
{/each}
