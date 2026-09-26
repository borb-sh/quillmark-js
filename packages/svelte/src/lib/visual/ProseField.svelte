<!--
 A Svelte mount of the codec's `createField` (VISUAL_EDITOR §Surface), which owns the
 PM state, the history and the per-keystroke commit, leaving this wrapper wiring and
 registration. `addr` is a live object the parent builds, so a card reorder re-targets
 this leaf's commits with the caret riding the untouched view.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { createField, type FieldController, type SlashState } from '../core/codec/index.js';
	import type { LeafRegistry } from './leaves.js';
	import SlashMenu from './SlashMenu.svelte';
	import { wording } from './strings.js';
	import './controls.css';
	import type { Document, Quill, Addr, Diagnostic } from '@quillmark/wasm';
	import type { EditorErrorHandler } from '../core/errors.js';

	interface Props {
		doc: Document;
		/** The schema this leaf reads its content through: `createField` binds a reader
		 *  off it, so a stored string decodes by its declared type. */
		quill: Quill;
		addr: Addr;
		inline?: boolean;
		plaintext?: boolean;
		/**
		 * Draw no box: the card body's leaf, and nothing else. Not `block`, which is a
		 * different predicate: a `richtext` field without `inline` is block prose and
		 * still a control in a row of controls, so only the caller knows what is paper.
		 */
		unframed?: boolean;
		/** Accessible name for a leaf nothing else names: an array element, or the
		 * card body. A leaf with a field label takes `labelledBy`. */
		label?: string;
		/** The field label's own id → `aria-labelledby` on the editable region. `for`
		 * cannot reach a `contenteditable`, so the association runs the other way and
		 * the label's click comes back through the controller's `focus`. */
		labelledBy?: string;
		/** The parked `description` (FieldLabel) → `aria-describedby`. */
		describedBy?: string;
		/** Ghost shown on the empty leaf: an inline leaf's resolved `default:` or
		 * nothing, a body's always text (`resolveBodyGhost`). */
		placeholder?: string;
		/** Registry identity, stamped on the DOM node so a remount is visible as one. */
		leafKey: string;
		onFocus?: (addr: Addr) => void;
		onCaretMove?: (addr: Addr, pos: number) => void;
		/** A commit landed on this leaf: the prose change lane. */
		onChange?: (addr: Addr) => void;
		onError?: EditorErrorHandler;
		/** The editor's leaf registry (`leaves.ts`). Registering the controller is what
		 *  makes this leaf a caret target and not merely a focus one. */
		leaves?: LeafRegistry;
		/** The diagnostics routed to this field: each set re-evaluates a hold
		 *  (`createField`), a re-validation being what follows an external write. */
		diagnostics?: Diagnostic[];
	}

	let {
		doc,
		quill,
		addr,
		inline,
		plaintext,
		unframed,
		label,
		labelledBy,
		describedBy,
		placeholder,
		leafKey,
		onFocus,
		onCaretMove,
		onChange,
		onError,
		leaves,
		diagnostics
	}: Props = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let held = $state(false);
	const uid = $props.id();
	const heldId = `${uid}-held`;

	// Handed to the codec as a getter: the island chrome redraws on each render, so a
	// locale swap reaches a mounted table without remounting the leaf and losing the caret.
	const t = wording();

	/** Pushed by the leaf's trigger plugin: the menu is the leaf's surface rather than
	 * the shell's (VISUAL_EDITOR §Chrome). A constrained leaf never receives one, the
	 * trigger mounting on the block schema alone. */
	let slash: SlashState | undefined = $state();

	// The codec's own schema predicate (`leafSchema`: `inline` is one textblock at either
	// type), so the box a leaf draws and the schema it holds cannot disagree.
	const block = $derived(!inline);

	let controller: FieldController | undefined;

	/** What the label's click calls. The controller's focus, not the container's, which
	 * leaves the PM selection unplaced. */
	export function focus(): void {
		controller?.focus();
	}

	onMount(() => {
		if (!containerEl) return;
		controller = createField({
			doc,
			quill,
			addr,
			container: containerEl,
			inline,
			plaintext,
			label,
			labelledBy,
			describedBy,
			placeholder,
			tableStrings: () => t.strings,
			onSlash: (next) => {
				slash = next;
			},
			onFocus,
			onCaretMove,
			onChange,
			onError,
			heldNoteId: heldId,
			onHold: (next) => {
				held = next;
			}
		});
		leaves?.registerProse(leafKey, controller);
		return () => {
			leaves?.unregisterProse(leafKey);
			controller?.destroy();
			controller = undefined;
		};
	});

	// A retype does not remount the leaf (its key is the card's session id), so the new
	// kind's ghost is pushed into the live view rather than paid for with the caret.
	$effect(() => {
		controller?.setPlaceholder(placeholder);
	});

	// Only a narrowed or a plain leaf can hold, so only one of them asks.
	$effect(() => {
		void diagnostics;
		if (inline || plaintext) controller?.applyExternal();
	});
</script>

<div
	bind:this={containerEl}
	class="qm-prose"
	class:qm-control-box={!unframed}
	class:qm-focus-ring-within={!unframed}
	class:qm-prose-block={block}
	data-leaf-key={leafKey}
>
	{#if held}
		<span id={heldId} class="qm-prose-held-note">{t.strings.proseHeld}</span>
	{/if}
</div>
<SlashMenu menu={slash} leaf={() => controller} label={t.strings.slashLabel} />

<style>
	/* The box is `.qm-control-box` (controls.css), the same rule the input beside it
	 draws, so the two agree on height by construction. No `min-height` with it:
	 `core/codec/prose.css` resets the paragraph box, so one line of prose in this box
	 measures one line of text in that one. */
	.qm-prose {
		/* Containing block for the arrival wash's inset child (`core/bloom.ts`). */
		position: relative;
	}
	/* A leaf the inline schema does not constrain grows, and opens at one line box: the
	 empty leaf is the height its first line will take, so the first keystroke displaces
	 nothing below it. `1em`, not a size rung, which is the rule below's to name.

	 On the editable rather than on the wrapper, which is what makes that line part of the
	 body: height the wrapper holds is height outside the `contenteditable`, where a press
	 lands no caret. */
	.qm-prose-block :global(.ProseMirror) {
		min-height: calc(1em * var(--_qm-leading-body));
	}
	/* Paper, and the withheld box is what says so. Not `block` alone: `inline` is the
	 quill's to declare, so a schema omitting it on a richtext field puts a block leaf in
	 a field row, where this rung would break the height agreement above. */
	.qm-prose-block:not(.qm-control-box) {
		font-size: var(--_qm-text-paper);
	}
	/* Paper's margin, which a field has none of. On the editable, so a press in the strip
	 lands a caret; carried by the card's inset it would be dead width. */
	.qm-prose-block:not(.qm-control-box) :global(.ProseMirror) {
		padding-inline: var(--_qm-space-2);
	}
	/* The caret is the body's focus indicator: a ring around the one surface in a card
	 that is paper reads as form chrome. So the contenteditable's own outline is dropped
	 everywhere, and a boxed leaf takes the shared ring on its wrapper instead
	 (`qm-focus-ring-within`, controls.css). */
	.qm-prose :global(.ProseMirror) {
		outline: none;
	}
	/* Empty-leaf ghost, at the rung every scalar's placeholder takes: a node decoration's
	 data attr, so it stays out of the document; `float`/`height: 0` keep it from
	 displacing the caret. The italic is what a leaf with no written neighbour has
	 instead of the step to `ink`. */
	.qm-prose :global(.ProseMirror .qm-prose-placeholder::before) {
		content: attr(data-placeholder);
		color: var(--_qm-ink-label);
		font-style: italic;
		float: left;
		height: 0;
		pointer-events: none;
	}
</style>
