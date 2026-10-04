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
		/** The message-state wording, keyed and partial (`PreviewStrings`). */
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
	export function setZoom(scale: number): void {
		controller?.setZoom(scale);
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
	   the surface's own, so a bare `<div>` is a mounting site. The
	   padding is safe against the paint loop: a slot is a `width: 100%` child and
	   measures the content box, and the container's own `clientWidth` is read only as
	   a change detector, which a constant inset does not disturb.

	   `:global(:where(…))` puts this promised class at zero rank (ARCHITECTURE §Styling). */
	:global(:where(.qm-preview)) {
		box-sizing: border-box;
		position: relative;
		width: 100%;
		/* The width is the host's, never the document's, which is the same boundary the
		   editor states (`visual/VisualEditorInner.svelte` §`.qm-editor`): a mount standing
		   in a column that floors at what it holds is asked for nothing the sheets in it
		   are. `inline-size`, not `size`: the column is as tall as the pages painted in
		   it. */
		contain: inline-size;
		height: 100%;
		overflow-y: auto;
		padding: var(--_qm-space-4);
		background: var(--_qm-surface-sunken);
	}
</style>
