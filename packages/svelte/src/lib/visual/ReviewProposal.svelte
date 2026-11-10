<!--
 A proposed value, under the control whose value it would replace: the value as words, and the
 two answers. In flow, as a diagnostic is, so the proposal stands with its field and takes no
 surface of its own. It is drawn as a prose proposal is, what would go struck and what would
 come tinted: two lines of words by the words they differ in, any other pair of values whole.

 The buttons are in the tab order, a form control having no caret for a chord to follow; the
 chords answer too while the focus is in the field (`Field.svelte`).
-->
<script lang="ts">
	import { wordDiff } from '../core/codec/index.js';
	import { wording } from './strings.js';
	import { reviewText, type FieldProposal } from './review.js';
	import { review } from './review.svelte.js';

	interface Props {
		item: FieldProposal;
		/** The value the control holds. */
		value: unknown;
		/** Take the focus back to the control: an answer given from the row unmounts it. */
		refocus?: () => void;
	}
	let { item, value, refocus }: Props = $props();

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
	/** The proposal as runs: kept, struck, added. Two lines of words differ by their words; any
	 *  other pair differs whole, the value that would go and the one that would come. */
	const runs = $derived.by((): { text: string; kind?: 'del' | 'ins' }[] => {
		const prose = (v: unknown): v is string | { text: string } =>
			typeof v === 'string' || (typeof v === 'object' && v !== null && 'text' in v);
		const before = reviewText(value, words);
		if (!prose(value) || !prose(item.after) || !before || !after)
			return [
				...(before ? [{ text: before, kind: 'del' as const }] : []),
				...(after ? [{ text: after, kind: 'ins' as const }] : [])
			];
		const out: { text: string; kind?: 'del' | 'ins' }[] = [];
		let at = 0;
		for (const hunk of wordDiff(before, after)) {
			if (hunk.at > at) out.push({ text: before.slice(at, hunk.at) });
			if (hunk.end > hunk.at) out.push({ text: before.slice(hunk.at, hunk.end), kind: 'del' });
			if (hunk.insert) out.push({ text: hunk.insert, kind: 'ins' });
			at = hunk.end;
		}
		if (at < before.length) out.push({ text: before.slice(at) });
		return out;
	});
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
		{#each runs as run, i (i)}
			{#if run.kind === 'del'}<del class="qm-review-del">{run.text}</del
				>{:else if run.kind === 'ins'}<ins class="qm-review-ins">{run.text}</ins
				>{:else}{run.text}{/if}
		{/each}
		{#if !after}
			<span class="qm-review-none">{t.strings.reviewEmpty}</span>
		{/if}
	</span>
	<span class="qm-review-answers">
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
