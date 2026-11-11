<!--
 A proposed value, marked on the control whose value it would replace and said on the answer
 card. The control takes the mark in place, a ring in the review hue, so a proposal moves nothing
 around it; what would go and what would come is the card's to say, struck and tinted as prose
 is: two lines of words by the words they differ in, two lists by their members, two records by
 their keys, any other pair of values whole.

 It draws nothing of its own. Its anchor stands after the control it marks, and the control is
 the nearest element before it that is neither another anchor, a diagnostic list nor a row's
 actions; with none, its parent. The control carries the item's id among its `data-qm-review`
 tokens, so the card stands on the control and a press on it names the item.
-->
<script lang="ts">
	import { wording } from './strings.js';
	import { reviewRuns, reviewText, type FieldProposal } from './review.js';
	import { review } from './review.svelte.js';

	interface Props {
		item: FieldProposal;
		/** The value the control holds. */
		value: unknown;
		/** Where the value is, for one inside the control it marks. */
		label?: string;
		/** It takes a list's member out, so nothing comes in its place. */
		removes?: boolean;
	}
	let { item, value, label, removes = false }: Props = $props();

	const t = wording();
	const reviewing = review();

	const words = $derived({ on: t.strings.reviewOn, off: t.strings.reviewOff });
	const empty = $derived(!reviewText(item.after, words));
	const runs = $derived(reviewRuns(value, item.after, words));

	$effect(() => {
		const id = item.id;
		reviewing.show(id, { label, runs, empty, removes });
		return () => reviewing.show(id, undefined);
	});

	const SKIP = '.qm-review-anchor, .qm-diag-list, .qm-row-actions';

	function control(anchor: HTMLElement): HTMLElement | undefined {
		let at = anchor.previousElementSibling;
		while (at && at.matches(SKIP)) at = at.previousElementSibling;
		return (at as HTMLElement | null) ?? anchor.parentElement ?? undefined;
	}

	function mark(anchor: HTMLElement) {
		const target = control(anchor);
		const id = item.id;
		if (!target) return;
		const tokens = () => (target.getAttribute('data-qm-review') ?? '').split(' ').filter(Boolean);
		target.setAttribute('data-qm-review', [...tokens(), id].join(' '));
		target.setAttribute('data-qm-proposed', '');
		const enter = () => reviewing.point(id, 'pointer');
		const leave = () => reviewing.point(undefined, 'pointer');
		target.addEventListener('pointerenter', enter);
		target.addEventListener('pointerleave', leave);
		$effect(() => {
			const lit = reviewing.lit !== undefined && tokens().includes(reviewing.lit);
			target.toggleAttribute('data-qm-proposed-lit', lit);
		});
		return () => {
			target.removeEventListener('pointerenter', enter);
			target.removeEventListener('pointerleave', leave);
			const rest = tokens().filter((t) => t !== id);
			if (rest.length) {
				target.setAttribute('data-qm-review', rest.join(' '));
				target.toggleAttribute('data-qm-proposed-lit', rest.includes(reviewing.lit ?? ''));
			} else {
				target.removeAttribute('data-qm-review');
				target.removeAttribute('data-qm-proposed');
				target.removeAttribute('data-qm-proposed-lit');
			}
		};
	}
</script>

<span class="qm-review-anchor" hidden {@attach mark}></span>
