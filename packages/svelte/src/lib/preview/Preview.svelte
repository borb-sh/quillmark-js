<!--
  `@quillmark/svelte/preview`'s Svelte wrapper: mounts `createPreview` over a
  container div on mount and tears it down on unmount. No logic beyond wiring;
  paint.ts/bridge.ts/controller.ts own the behavior. Exposes the
  `PreviewController` verbs as instance methods (`bind:this`) for a consumer
  that drives `refresh`/`scrollToField`/`focusPosition`/`endFollow`/`setZoom`
  imperatively (e.g. after `session.apply` elsewhere).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { createPreview, type PreviewController } from './controller.js';
	import { guardRebind } from '../core/rebind.svelte.js';
	import type { PreviewStringsInput } from './strings.js';
	import type { LiveSession, ChangeSet } from '@quillmark/wasm';
	import type { DocPath, Landing, Place } from '../core/address.js';
	import type { EditorErrorHandler } from '../core/errors.js';

	/**
	 * Remount contract. `createPreview` binds once, when its container mounts; a later
	 * change to any prop it closed over (`session`, `margin`, `onPick`, `onError`,
	 * `strings`) is not observed, and each reports `rebind-ignored` when swapped. Swap
	 * the session by remounting (`{#key session}`, as the playground does); drive
	 * in-place edits through the `refresh(change)` method, not a prop change.
	 *
	 * `onError` is itself once-bound, so a swapped handler means the report of its own
	 * swap reaches the handler it replaced. `class` and `style` are the exceptions:
	 * they land on the root element Svelte owns, so they stay live.
	 */
	interface Props {
		session: LiveSession;
		/** Appended to the root's own class: the surface is a mounted element the
		 *  consumer positions, so it needs a handle for layout it owns. */
		class?: string;
		/** Merged onto the root. Free: theming lands on `data-qm-root` (core/theme.css),
		 *  not this attribute. */
		style?: string;
		margin?: number;
		onPick?: (at: Landing) => void;
		/** A page paint the backend refused; the error message state shows either way. */
		onError?: EditorErrorHandler;
		/** The surface's wording, keyed and partial (`PreviewStrings`). */
		strings?: PreviewStringsInput;
	}

	let { session, margin, onPick, onError, strings, class: className, style }: Props = $props();

	let controller: PreviewController | undefined;

	guardRebind(
		() => ({ session, margin, onPick, onError, strings }),
		'Remount the preview ({#key session}) to rebind.'
	);

	function mountPreview(container: HTMLDivElement): () => void {
		return untrack(() => {
			const mounted = createPreview(session, { container, margin, onPick, onError, strings });
			controller = mounted;
			return () => {
				mounted.destroy();
				controller = undefined;
			};
		});
	}

	export function refresh(change: ChangeSet): void {
		controller?.refresh(change);
	}
	/** `false` when this compile places nothing at `field` ({@link PreviewController}). */
	export function scrollToField(field: DocPath): boolean {
		return controller?.scrollToField(field) ?? false;
	}
	/** Takes the editor's `onCaretMove` payload: `onCaretMove={preview.focusPosition}`. */
	export function focusPosition(at: Place): void {
		controller?.focusPosition(at);
	}
	/** The follow ends on a focus change ({@link PreviewController}), and the editor's
	 *  own signal is one: `onActiveLeafChange={preview.endFollow}`. */
	export function endFollow(): void {
		controller?.endFollow();
	}
	/** A fraction of actual size; `undefined` is the default fit ({@link PreviewController}). */
	export function setZoom(zoom: number | undefined): void {
		controller?.setZoom(zoom);
	}
</script>

<div {@attach mountPreview} class="qm-preview {className ?? ''}" {style} data-qm-root></div>

<style>
	/* A detached root: the preview is not a descendant of the editor, so it carries
	   `data-qm-root` for the page rungs paint.ts reads (core/theme.css).

	   The desk as well as the paper: a sheet is at `--_qm-surface` (paint.ts), so the
	   tone behind it is the sunken rung and the gutter is the margin the sheet floats
	   in. Paper is the brighter plane at both poles, exactly as a card is over the
	   editor's own column, so the two panes step the same way. Both are
	   the surface's own, so a bare `<div>` is a mounting site. The viewport fits the
	   pages to the content box, padding off.

	   A flex column, so the zoom pill's dock can take the space under pages shorter than
	   the pane and stand at its corner (viewport.ts). The gutter is reserved, so a
	   scrollbar arriving with a taller zoom narrows nothing the default fits against.
	   Scroll anchoring is off because the viewport holds the reader's place itself, on
	   every zoom and re-fit, and the browser's correction would land on top of it.
	   `touch-action` leaves a pinch to the viewport, which zooms the pages rather than
	   the host's page.

	   `:global(:where(…))` puts this promised class at zero rank (ARCHITECTURE §Styling). */
	:global(:where(.qm-preview)) {
		box-sizing: border-box;
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		/* The pane's width is the host's, never the document's, which is the same boundary
		   the editor states (`visual/VisualEditorInner.svelte` §`.qm-editor`): a page zoomed
		   wider than the pane scrolls inside it rather than widening it. `inline-size`, not
		   `size`: the column is as tall as the pages painted in it. */
		contain: inline-size;
		height: 100%;
		overflow: auto;
		scrollbar-gutter: stable;
		overflow-anchor: none;
		touch-action: pan-x pan-y;
		padding: var(--_qm-space-4);
		background: var(--_qm-surface-sunken);
	}

	/* Sticky to the pane's bottom edge and stretched across it, so the pill's corner is
	   the pane's however the pages scroll; zero height, so it displaces nothing. */
	:global(:where(.qm-preview-dock)) {
		order: 1;
		flex: none;
		position: sticky;
		bottom: 0;
		inset-inline-start: 0;
		height: 0;
		margin-top: auto;
	}

	/* Floats over the desk, so it lifts the way a floating surface does (ARCHITECTURE
	   §Styling), and says only the zoom: the label never changes. Tabular figures and a
	   floor as wide as `100%`, so a third digit never shifts its edge. It arrives at once and leaves on the reveal, so a glance at
	   it after a gesture still finds it. */
	:global(:where(.qm-preview-zoom)) {
		position: absolute;
		inset-inline-end: 0;
		bottom: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: calc(4ch + 2 * var(--_qm-space-2));
		min-height: var(--_qm-tap-min);
		padding: 0 var(--_qm-space-2);
		border: var(--_qm-border-width) solid var(--_qm-border);
		border-radius: var(--_qm-radius-pill);
		background: var(--_qm-surface-popover);
		backdrop-filter: blur(var(--_qm-blur));
		box-shadow: var(--_qm-lift);
		color: var(--_qm-ink-label);
		font-family: var(--_qm-font);
		font-size: var(--_qm-text-label);
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		user-select: none;
		transition:
			opacity var(--_qm-duration-fast) var(--_qm-ease-reverse),
			color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	:global(:where(.qm-preview-zoom:hover)) {
		color: var(--_qm-ink);
	}
	:global(:where(.qm-preview-zoom:active)) {
		background: var(--_qm-surface-hover);
	}
	:global(:where(.qm-preview-zoom[data-idle])) {
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--_qm-reveal);
	}
	/* A screen with no hover has no pointer to bring it back, and the pill is the way back
	   to the fit there, so it stays. */
	@media (hover: none) {
		:global(:where(.qm-preview-zoom[data-idle])) {
			opacity: 1;
			pointer-events: auto;
		}
	}
	:global(:where(.qm-preview-zoom:focus-visible)) {
		opacity: 1;
		pointer-events: auto;
		outline: var(--_qm-ring);
		outline-offset: var(--_qm-ring-offset);
	}
	@media (prefers-reduced-motion: reduce) {
		:global(:where(.qm-preview-zoom, .qm-preview-zoom[data-idle])) {
			transition: none;
		}
	}
</style>
