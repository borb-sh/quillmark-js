<!--
 A proposed value whose control cannot draw it as words, marked on that control. The control
 shows the value it would hold (its caller hands it `after`) and takes the review tint, so a
 proposal moves nothing around it; a member a proposal takes out is struck where it stands. A
 one-line text leaf draws its proposal itself, as a word diff (`value-diff.ts`), and takes no
 mark.

 It draws nothing of its own. Its anchor stands after the control it marks, and the control is
 the nearest element before it that is neither another anchor, a diagnostic list nor a row's
 actions; with none, its parent. The mark sits on that control's own box (`BOX`) where the
 element found is a cell or a row holding one, so the tint never spreads past the control. The control carries the item's id among its `data-qm-review`
 tokens, so the card stands on the control and a press on it names the item.
-->
<script lang="ts">
	import type { FieldProposal } from './review.js';
	import { review } from './review.svelte.js';

	interface Props {
		item: FieldProposal;
		/** It takes a list's member out, so nothing comes in its place. */
		removes?: boolean;
	}
	let { item, removes = false }: Props = $props();

	const reviewing = review();

	const SKIP = '.qm-review-anchor, .qm-diag-list, .qm-row-actions';

	/** A control's own box: what the tint and the ring sit on, at any depth, where the control
	 *  found is the cell or the row around it. */
	const BOX = '.qm-control-box, .qm-toggle, .qm-tick';

	function control(anchor: HTMLElement): HTMLElement | undefined {
		let at = anchor.previousElementSibling;
		while (at && at.matches(SKIP)) at = at.previousElementSibling;
		const found = (at as HTMLElement | null) ?? anchor.parentElement ?? undefined;
		if (!found || removes || found.matches(BOX)) return found;
		return found.querySelector<HTMLElement>(BOX) ?? found;
	}

	function mark(anchor: HTMLElement) {
		const target = control(anchor);
		const id = item.id;
		if (!target) return;
		const tokens = () => (target.getAttribute('data-qm-review') ?? '').split(' ').filter(Boolean);
		target.setAttribute('data-qm-review', [...tokens(), id].join(' '));
		target.setAttribute('data-qm-proposed', '');
		if (removes) target.setAttribute('data-qm-removes', '');
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
				target.removeAttribute('data-qm-removes');
				target.removeAttribute('data-qm-proposed-lit');
			}
		};
	}
</script>

<span class="qm-review-anchor" hidden {@attach mark}></span>
