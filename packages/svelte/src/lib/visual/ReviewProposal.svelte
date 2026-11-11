<!--
 A proposed value, under the control whose value it would replace: the value as words, and the
 two answers. In flow, as a diagnostic is, so the proposal stands with its field and takes no
 surface of its own. It is drawn as a prose proposal is, what would go struck and what would
 come tinted: two lines of words by the words they differ in, two lists by their members, two
 records by their keys, any other pair of values whole.

 The buttons are in the tab order, a form control having no caret for a chord to follow; the
 chords answer too while the focus is in the field (`Field.svelte`).
-->
<script lang="ts">
	import { wording } from './strings.js';
	import { reviewRuns, reviewText, type FieldProposal } from './review.js';
	import { review } from './review.svelte.js';

	interface Props {
		item: FieldProposal;
		/** The value the control holds. */
		value: unknown;
		/** Take the focus back to the control: an answer given from the row unmounts it. */
		refocus?: () => void;
		/** Where the value is, for one drawn under a control that is not its own. */
		label?: string;
		/** It takes a list's member out, so nothing comes in its place. */
		removes?: boolean;
	}
	let { item, value, refocus, label, removes = false }: Props = $props();

	let row = $state<HTMLElement>();
	function answer(action: 'accept' | 'dismiss'): void {
		const held = !!row?.contains(document.activeElement);
		reviewing.act(item.id, action);
		if (held) refocus?.();
	}

	const t = wording();
	const reviewing = review();

	const words = $derived({ on: t.strings.reviewOn, off: t.strings.reviewOff });
	const after = $derived(reviewText(item.after, words));
	const runs = $derived(reviewRuns(value, item.after, words));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={row}
	class={['qm-review-proposal', { 'qm-review-lit': reviewing.lit === item.id }]}
	data-qm-review={item.id}
	role="group"
	aria-label={t.strings.reviewProposal}
	onpointerenter={() => reviewing.point(item.id, 'pointer')}
	onpointerleave={() => reviewing.point(undefined, 'pointer')}
>
	<span class="qm-review-value">
		{#if label}<span class="qm-review-where">{label}: </span>{/if}
		{#each runs as run, i (i)}
			{#if run.kind === 'del'}<del class="qm-review-del">{run.text}</del
				>{:else if run.kind === 'ins'}<ins class="qm-review-ins">{run.text}</ins
				>{:else}{run.text}{/if}
		{/each}
		{#if !after && !removes}
			<span class="qm-review-none">{t.strings.reviewEmpty}</span>
		{/if}
	</span>
	<span class="qm-review-answers">
		{#if reviewing.fieldOutdated.has(item.id)}
			<span class="qm-review-outdated-label">{t.strings.reviewOutdated}</span>
		{/if}
		<button
			type="button"
			class="qm-review-act qm-review-accept qm-focus-ring"
			title={t.strings.reviewAcceptTitle}
			onclick={() => answer('accept')}>{t.strings.reviewAccept}</button
		>
		<button
			type="button"
			class="qm-review-act qm-review-dismiss qm-focus-ring"
			title={t.strings.reviewDismissTitle}
			onclick={() => answer('dismiss')}>{t.strings.reviewDismiss}</button
		>
	</span>
</div>

<style>
	/* The value starts on the control's own text column, so the proposal reads as the line the
	   control would hold, and the answers trail it as they trail a paragraph's last line. No
	   fill on the row: the tint is on the proposed words, as it is in prose, and a row is not a
	   second well. */
	.qm-review-proposal {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--_qm-space-half) var(--_qm-space-3);
		padding-inline-start: var(--_qm-space-3);
		font-size: var(--_qm-text-body);
	}
	.qm-review-value {
		min-width: 0;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
	.qm-review-del {
		color: var(--_qm-ink-label);
		text-decoration: line-through;
		text-decoration-color: var(--_qm-review-line);
	}
	.qm-review-ins {
		text-decoration: none;
		background: var(--_qm-review-tint);
		box-shadow:
			calc(-1 * var(--_qm-space-half)) 0 0 var(--_qm-review-tint),
			var(--_qm-space-half) 0 0 var(--_qm-review-tint);
		border-radius: var(--_qm-radius-inner);
		-webkit-box-decoration-break: clone;
		box-decoration-break: clone;
		transition:
			background-color var(--_qm-duration-fast) var(--_qm-ease-reverse),
			box-shadow var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-review-del + .qm-review-ins {
		margin-inline-start: calc(var(--_qm-space) + var(--_qm-space-half));
	}
	.qm-review-lit .qm-review-ins {
		background: var(--_qm-review-lit);
		box-shadow:
			calc(-1 * var(--_qm-space-half)) 0 0 var(--_qm-review-lit),
			var(--_qm-space-half) 0 0 var(--_qm-review-lit);
	}
	/* Forced colours drop the tint, so the proposed words take the line prose's take
	   (`codec/prose.css`). */
	@media (forced-colors: active) {
		.qm-review-ins {
			text-decoration: underline;
		}
	}
	.qm-review-where {
		color: var(--_qm-ink-label);
	}
	.qm-review-none {
		color: var(--_qm-ink-label);
		font-style: italic;
	}
	.qm-review-answers {
		display: inline-flex;
		flex-shrink: 0;
		gap: var(--_qm-space-half);
		font-size: var(--_qm-text-label);
		font-weight: var(--_qm-weight-mid);
		line-height: var(--_qm-leading-tight);
	}
	@media (pointer: coarse) {
		.qm-review-answers {
			gap: var(--_qm-space-2);
		}
	}
</style>
