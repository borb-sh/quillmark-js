<!--
 The count on a `text` or `richtext` value declaring `max:` (VISUAL_EDITOR §"Structure
 mirrors the schema"): `120 / 350`, the characters as the engine counts them
 (`plainLength`) against the cap. A soft limit: the leaf takes every keystroke, so
 past the cap the count turns to danger and nothing else moves, the box unpainted.

 Shown by what the reader needs to see: always under a short cap (a form box of a
 hundred or fewer), where the count is the field's shape; from four fifths of a long
 one, or while the leaf holds the focus, since a `1 / 1350` under every idle field is
 noise; and always once over. Hidden, it stays in the tree, the control's
 `aria-describedby` naming it either way, so a screen reader hears the count where a
 sighted reader would see it dawn. The crossing is announced once, through a live
 region of its own: the description reads on focus, not on change, and a region
 re-announcing per keystroke would talk over the typing.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { wording } from './strings.js';

	interface Props {
		count: number;
		max: number;
		/** The leaf holds the focus: a long cap's count shows while it does. */
		focused?: boolean;
		/** The count's own id, for the control's `aria-describedby`. */
		id: string;
	}
	let { count, max, focused = false, id }: Props = $props();

	const t = wording();
	const SHORT_CAP = 100;
	const NEAR = 0.8;
	const over = $derived(count > max);
	const shown = $derived(over || focused || max <= SHORT_CAP || count >= max * NEAR);

	let announced = $state('');
	// One announcement per crossing: set as `over` turns true, cleared as it turns
	// false, untouched by the keystrokes in between, which is why the count is read
	// untracked.
	$effect(() => {
		announced = over ? untrack(() => t.strings.textOverCap(count, max)) : '';
	});
</script>

<span class={['qm-text-count', { over, hidden: !shown }]} {id}
	>{t.strings.textCount(count, max)}</span
>
<span class="qm-text-count-live" role="status">{announced}</span>

<style>
	/* The array count's register (`ArrayField`): a fact about the field at the label
	   rung, never a value. Tabular, so a growing count does not shift the row. */
	.qm-text-count {
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.qm-text-count.over {
		color: var(--_qm-danger);
	}
	/* In the tree, out of the layout: the control's description does not dangle while
	   the count waits for a reason to draw. The recipe is `FieldLabel`'s parked
	   description. */
	.qm-text-count.hidden,
	.qm-text-count-live {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
