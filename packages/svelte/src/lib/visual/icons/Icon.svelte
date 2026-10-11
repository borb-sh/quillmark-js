<script lang="ts">
	// The one glyph renderer: a name off the closed set in `nodes.ts`, drawn against
	// the shared frame. Stroke, fill and cap are the frame rather than props — a glyph
	// that strokes differently from its neighbours is a decision no call site has, and
	// `currentColor` is what puts the hue on the button's `color`, where the surface's
	// hover and open transitions already reach it.
	import { ICONS, type IconName } from './nodes.js';
	import type { SVGAttributes } from 'svelte/elements';

	interface Props extends Omit<SVGAttributes<SVGSVGElement>, 'name'> {
		name: IconName;
		/** The frame's edge, in px. A chip or a glyph button sizes the glyph from
		 *  `--_qm-glyph-control` in CSS, which beats this attribute; other callers pass
		 *  a size. */
		size?: number;
	}
	let { name, size = 24, ...rest }: Props = $props();
</script>

<!-- `aria-hidden` ahead of the spread, so it is the default rather than the rule: every
	glyph in this package sits inside a button that carries the name, and a call site
	that has one to say overrides it. -->
<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	{...rest}
>
	{#each ICONS[name] as [tag, attrs]}
		<svelte:element this={tag} {...attrs} />
	{/each}
</svg>
