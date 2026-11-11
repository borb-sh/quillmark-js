<!--
 A proposed value whose control cannot draw it as words, marked on that control. The control
 shows the value it would hold (its caller hands it `after`) and takes the review tint, so a
 proposal moves nothing around it; a member a proposal takes out is struck where it stands. A
 one-line text leaf draws its proposal itself, as a word diff (`value-diff.ts`), and takes no
 mark.

 It draws nothing of its own. Its anchor holds what the mark says to assistive tech, the proposed
 value being the one the control shows, and each focusable part of the control is described by it. Its anchor stands after the control it marks, and the control is
 the nearest element before it that is neither another anchor, a diagnostic list nor a row's
 actions; with none, its parent. The mark sits on that control's own box (`BOX`) where the
 element found is a cell or a row holding one, so the tint never spreads past the control. The control carries the item's id among its `data-qm-review`
 tokens, so the card stands on the control and a press on it names the item.
-->
<script lang="ts">
	import { reviewText, type FieldProposal } from './review.js';
	import { review } from './review.svelte.js';
	import { wording } from './strings.js';

	interface Props {
		item: FieldProposal;
		/** It takes a list's member out, so nothing comes in its place. */
		removes?: boolean;
		/** The value the control would show without the proposal, where the caller knows it: a
		 *  default an unset field prints. Else the value the place holds. */
		current?: unknown;
	}
	let { item, removes = false, current }: Props = $props();

	const reviewing = review();
	const t = wording();
	const describer = $props.id();
	const description = $derived.by(() => {
		if (removes) return t.strings.reviewRemoveCard;
		const words = { on: t.strings.reviewOn, off: t.strings.reviewOff };
		const now = current ?? reviewing.current(item);
		const shown = now == null && typeof item.after === 'boolean' ? false : now;
		return t.strings.reviewCurrently(reviewText(shown, words) || t.strings.reviewEmpty);
	});

	/** What a reader lands on in the control: the control itself where it takes focus, else each
	 *  part of it that does, a date's segments. */
	const FOCUSABLE =
		'button, input, select, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

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
		const described = target.matches(FOCUSABLE)
			? [target]
			: [...target.querySelectorAll<HTMLElement>(FOCUSABLE)];
		const by = (el: HTMLElement) =>
			(el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
		for (const el of described)
			el.setAttribute('aria-describedby', [...by(el), describer].join(' '));
		$effect(() => {
			const lit = reviewing.lit !== undefined && tokens().includes(reviewing.lit);
			target.toggleAttribute('data-qm-proposed-lit', lit);
		});
		return () => {
			for (const el of described) {
				const rest = by(el).filter((d) => d !== describer);
				if (rest.length) el.setAttribute('aria-describedby', rest.join(' '));
				else el.removeAttribute('aria-describedby');
			}
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

<span class="qm-review-anchor" id={describer} hidden {@attach mark}>{description}</span>
