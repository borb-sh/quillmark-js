<!--
 The formatting selection popover (VISUAL_EDITOR §Chrome). One popover,
 shell-owned, observing the active leaf through
 `getActiveLeaf`: the VisualEditor's accessor over its `leaves` registry, and
 the whole of what this surface knows about the editor. The active leaf is a
 field's or a by-value one (an array's element, a subform's cell), reached through
 its views. A non-empty selection in the active leaf
 raises it over that leaf's selection rect; each button dispatches a PM `toggleMark`
 command straight at the leaf's `EditorView`, whose own `dispatchTransaction` commits
 the result as it commits a keystroke: a field's lowers it to `markOps` through
 `applyChange` (field.ts), a by-value leaf's hands the re-encoded value to its parent
 (`ProseValue`). This component never touches the content. The keymap mirror
 (Mod-b/i/u) lives in the codec's keymap (field.ts); this is the pointer
 affordance for all six marks. Mod-K is this surface's own key, the prompt it raises
 being this surface's: a document `keydown` the leaf's keymap left unclaimed. Over a
 leaf that holds lists, two more buttons number or bullet every selected line, or take
 the marker off where every one carries it: the codec's `toggleList`, whose keys
 (Mod-Shift-7/8) the leaf's keymap binds. Over a leaf whose schema holds the font mark, a
 menu sets the selection's family out of the registry the editor was handed (`fonts.ts`,
 FormatMenu), or takes the families it draws in off. It shows what the whole selection is
 set in, or that it is set in more than one; a family the registry does not hold shows as
 unavailable and is not offered.

 Selection observation. The view's `dispatchTransaction` is the leaf's
 (read-only), so there is no hook to observe transactions from outside.
 Fallback: a document-level `selectionchange` listener, coalesced to one
 `requestAnimationFrame`-deferred check (see `deferredSync` below: a bare
 microtask is not late enough; verified a "select all" gesture fires several
 transient `selectionchange` events first). `focusout` keeps the popover honest
 when focus leaves the leaf.

 A press holds it down, which is what makes the surface answer a selection rather
 than a pointer: a drag fires `selectionchange` on every frame, so a surface driven
 by that alone rises on the first character and rides the cursor across the text it
 is covering. Keyboard selection holds nothing, so it waits instead: a rise with no
 release behind it comes once the selection has stood still for `SETTLE_MS`, so a
 Shift-arrow run, or a select-all on its way to a cut, raises nothing until it stops.
 A lowering never waits, and an open surface follows each step.

 Nothing here watches scroll. `sync` decides whether the surface is up, which a
 scroll does not change; where it sits is the anchor's own question, and the anchor
 answers it by measuring when floating-ui asks rather than by being handed a rect
 (`codec/anchor.ts`).

 Focus discipline. Three failure modes a naive Popover.Content invites:
 (1) its default `trapFocus` (true) redirects any focus landing outside its
 DOM back inside; which would make it impossible to click back into
 the editor to change the selection while the popover is showing. Fixed
 by `trapFocus={false}`.
 (2) its open-auto-focus (unconditional on mount, regardless of trapFocus;
 verified against bits-ui's FocusScope) would steal focus from the
 editor onto the first button the instant the popover appears. Fixed by
 `onOpenAutoFocus` calling `preventDefault`.
 (3) its default `onCloseAutoFocus` returns focus to the element focused
 before open (the prose leaf holding the selection). Clicking a native
 input (card-title, TextField, NumberField) while the popover is open
 bounces focus off that input back to the leaf; ProseMirror re-asserts
 the retained selection and the browser scrolls it into view, yanking
 the viewport off the clicked field. Fixed by `onCloseAutoFocus`
 calling `preventDefault`: the intentional returns after mark toggle
 / link submit go through `view.focus` in `toggle`/`submitLink`.
 A mark button also swallows its own `mousedown` (prosemirror-menu's own
 trick): without it, the browser's default mousedown action focuses the
 button before `click` fires, blurring the editor and collapsing the
 selection the command is supposed to act on.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { wording } from './strings.js';

	// The surface's words, ambient from the editor root; the package's English
	// off-tree, so this component renders standalone too.
	const t = wording();
	import { toggleMark } from 'prosemirror-commands';
	import { keydownHandler } from 'prosemirror-keymap';
	import { TextSelection, type Command } from 'prosemirror-state';
	import type { EditorView } from 'prosemirror-view';
	import type { MarkType } from 'prosemirror-model';
	import { Popover } from 'bits-ui';
	import Icon from './icons/Icon.svelte';
	import type { IconName } from './icons/nodes.js';
	import {
		cssString,
		fontAlias,
		hasMarks,
		rangeAnchor,
		removeFontFamily,
		selectionFamily,
		setFontFamily,
		toggleList,
		type RangeAnchor
	} from '../core/codec/index.js';
	import type { ActiveProse } from './leaves.js';
	import FormatMenu from './FormatMenu.svelte';
	import { fontRegistry } from './fonts.js';
	import { clearLink, hrefInSelection, normalizeHref, setLink } from './links.js';
	import { spacePx } from '../core/rungs.js';
	import './controls.css';

	interface Props {
		/** The observation seam VisualEditor exposes over its `leaves` registry. */
		getActiveLeaf: () => ActiveProse | undefined;
	}
	let { getActiveLeaf }: Props = $props();

	const SETTLE_MS = 450;
	/** The six content formatting marks. `anchor` is withheld: it draws nothing until
	 *  comments do. One string per mark carries both the tooltip and the accessible name. */
	const MARKS: { name: string; icon: IconName; title: string }[] = $derived([
		{ name: 'strong', icon: 'bold', title: t.strings.formatBold },
		{ name: 'em', icon: 'italic', title: t.strings.formatEmphasis },
		{ name: 'underline', icon: 'underline', title: t.strings.formatUnderline },
		{ name: 'strike', icon: 'strikethrough', title: t.strings.formatStrikethrough },
		{ name: 'code', icon: 'code', title: t.strings.formatCode },
		{ name: 'link', icon: 'link', title: t.strings.formatLink }
	]);

	const LISTS: { ordered: boolean; icon: IconName; title: string }[] = $derived([
		{ ordered: true, icon: 'list-ordered', title: t.strings.formatNumberedList },
		{ ordered: false, icon: 'list', title: t.strings.formatBulletedList }
	]);

	const registry = fontRegistry();
	/** The family menu's row taking the families the selection draws in off. */
	const REMOVE_FAMILY = '__qm_remove__';

	let open = $state(false);
	/** The view the surface was raised over. The family menu takes the focus, and a cell
	 *  view without it is no longer the leaf's `focusedView`. */
	let surfaceView: EditorView | undefined;
	/** Whether the leaf under the selection holds the font mark: a `text` leaf does not. */
	let fontable = $state(false);
	/** The family the whole selection is set in, `null` for none, `undefined` for more
	 *  than one. */
	let family = $state<string | null | undefined>(null);
	/** Whether the leaf under the selection holds lists: a body does, a one-line field
	 *  and a table cell do not. */
	let listable = $state(false);
	/** A pointer is down outside this surface: the selection is still being made. */
	let pressed = false;
	let linkPromptOpen = $state(false);
	/** Whether the selection carried a link when the prompt was raised. */
	let linkPresent = $state(false);
	let linkValue = $state('');
	/** The view the prompt was raised over. The prompt takes the focus, and a cell view
	 *  without it is no longer the leaf's `focusedView`. */
	let promptView: EditorView | undefined;
	let promptInput = $state<HTMLInputElement | undefined>(undefined);
	let contentEl = $state<HTMLElement | undefined>(undefined);
	/** The root to portal into: `document.body` escapes the editor's subtree and
	 * the consumer's dials with it, so a pane-scoped palette misses this surface.
	 * Resolved from the active leaf's own DOM, so the popover lands inside whichever
	 * root raised it; `undefined` falls back to bits-ui's `document.body` for a leaf
	 * mounted outside any root. */
	let portalTarget = $state<HTMLElement | undefined>(undefined);

	/** The selection the surface hangs off, live rather than measured (`codec/anchor.ts`): floating-ui re-reads it through every scroll and reflow, so `sync` mints one only when the range moves. A new object each time it does, so bits-ui's `watch( => opts.customAnchor.current, …)` sees the change and repositions (a mutated-in-place object would not). */
	let anchor = $state<RangeAnchor | undefined>(undefined);

	/** The view the caret is actually in: the leaf's own, or the nested cell view of a
	 * table island (`codec/table-view.ts`). The six marks are the inline schema's
	 * too, so a selection in a cell raises the same popover and toggles the same
	 * commands. */
	function activeLeafView(): EditorView | undefined {
		return getActiveLeaf()?.views.focusedView();
	}

	function sync(wait = false): void {
		clearTimeout(settling);
		const insidePopover =
			!!contentEl && !!document.activeElement && contentEl.contains(document.activeElement);
		// Interacting with the popover itself (e.g. the link input): leave state as-is.
		// Costs nothing to hold: the anchor minted below goes on measuring while this
		// returns early, so a surface frozen here still tracks the selection it covers.
		if (insidePopover) return;
		if (pressed) return;
		const view = activeLeafView();
		// A non-empty text selection. A node selection is non-empty too and has nothing
		// to format: it covers a leaf block (an island, a rule), which is exactly where
		// Escape out of a table cell lands.
		const selection = view?.state.selection;
		const formattable = selection instanceof TextSelection && !selection.empty;
		// …in a leaf that has formatting at all. A `text` leaf declares no mark types
		// (`plaintextSchema`, `plainSchema`), so this surface withholds itself over one
		// entirely, the way it never rises over a form control: the value is literal
		// text, and a mark on it is a value the boundary refuses to coerce back.
		if (
			!view ||
			!view.hasFocus() ||
			!formattable ||
			!hasMarks(view.state.schema) ||
			!hasText(view)
		) {
			open = false;
			linkPromptOpen = false;
			return;
		}
		if (wait && !open) {
			settling = setTimeout(() => sync(), SETTLE_MS);
			return;
		}
		portalTarget = view.dom.closest<HTMLElement>('[data-qm-root]') ?? undefined;
		listable = !!view.state.schema.nodes.list_item;
		surfaceView = view;
		fontable = !!view.state.schema.marks.font_family;
		family = selectionFamily(view.state);
		const { from, to } = view.state.selection;
		anchor = rangeAnchor(view, from, to);
		open = true;
	}

	/** Whitespace alone is a selection the pointer makes by accident, at the end of a
	 *  line or between two words, and every mark over it is invisible. */
	function hasText(view: EditorView): boolean {
		const { from, to } = view.state.selection;
		return view.state.doc.textBetween(from, to, ' ', ' ').trim().length > 0;
	}

	// A burst of DOM events (verified: browser "select all" processing fires
	// `selectionchange` several times, transiently empty before landing on the
	// final range) must coalesce to one settled check, not one `sync()` per
	// event: reacting to each intermediate state mounts/unmounts
	// `Popover.Content` repeatedly within a few event-loop turns, which is both
	// visibly unstable (a moving, momentarily detached click target) and races
	// bits-ui's own internal effects (observed: Svelte's
	// `derived_inert` warning from a stale read after a too-fast unmount). A
	// microtask is not late enough: those transient events are themselves
	// separated by microtasks. `requestAnimationFrame` is: it runs once
	// per-frame, after the browser has finished dispatching every synchronous
	// consequence of the user gesture, so it always reads the final, settled
	// selection. `pending` collapses a burst to a single scheduled callback.
	let pending = false;
	let rafHandle = 0;
	/** The check in flight answers a pointer's release, which raises at once. */
	let released = false;
	let settling: ReturnType<typeof setTimeout> | undefined;
	function deferredSync(): void {
		if (pending) return;
		pending = true;
		rafHandle = requestAnimationFrame(() => {
			pending = false;
			const wait = !released;
			released = false;
			sync(wait);
		});
	}

	/** Whether `node` is in the open family menu's list (FormatMenu). */
	function inMenu(node: EventTarget | null): boolean {
		return node instanceof Element && !!node.closest('[data-qm-format-menu]');
	}

	function onPointerDown(e: PointerEvent): void {
		// A press on the surface is not a selection gesture, and lowering it here would
		// take the button out from under the pointer before its click. The family menu's
		// list is the surface's too, though it portals out of it.
		if (contentEl?.contains(e.target as Node) || inMenu(e.target)) return;
		pressed = true;
		open = false;
	}
	function onPointerUp(): void {
		if (!pressed) return;
		pressed = false;
		released = true;
		deferredSync();
	}

	// A burst-coalescing rAF or a settling rise may still be in flight at teardown;
	// cancel both so `sync()` never runs against the destroyed component.
	onDestroy(() => {
		if (pending) cancelAnimationFrame(rafHandle);
		pending = false;
		clearTimeout(settling);
	});

	// Any close path that bypasses `sync` (e.g. Escape while the link input holds
	// focus: bits-ui flips `open` itself) must not leave a stale prompt for the
	// next open.
	$effect(() => {
		if (!open) linkPromptOpen = false;
	});

	// The prompt takes its own focus. Nothing else moves it: open-auto-focus is
	// prevented (focus discipline above), and the prompt replaces the buttons on a
	// surface already open, so without this the URL is typed into the document.
	// Selected rather than merely focused, the input arriving seeded and replacing
	// that value being what the prompt is usually raised for.
	function focusPrompt(input: HTMLInputElement): void {
		input.focus();
		input.select();
	}

	/** Swallow the button's mousedown so focus/selection never leave the leaf. */
	function keepFocus(e: MouseEvent): void {
		e.preventDefault();
	}

	// A link is a value, so its button raises the prompt rather than toggling — one
	// meaning whether or not the selection carries one, and the seeded prompt is the
	// only place the document's href is legible. Removal is an arm inside the
	// prompt, not a second meaning for the button. The five value-less marks keep
	// the toggle.
	function toggle(name: string): void {
		const view = activeLeafView();
		if (!view) return;
		const type: MarkType | undefined = view.state.schema.marks[name];
		if (!type) return;
		if (name === 'link') {
			linkValue = hrefInSelection(view.state);
			linkPresent = linkValue.length > 0;
			promptView = view;
			linkPromptOpen = true;
			return;
		}
		toggleMark(type)(view.state, view.dispatch);
		view.focus();
		sync();
	}

	function toggleLines(ordered: boolean): void {
		const view = activeLeafView();
		if (!view) return;
		toggleList(ordered)(view.state, view.dispatch);
		view.focus();
		sync();
	}

	/** Every exit from the prompt: lower it, run `cmd` if there is one, and hand the
	 *  leaf back its focus and the surface its buttons. */
	function closePrompt(cmd?: Command): void {
		linkPromptOpen = false;
		const view = promptView && !promptView.isDestroyed ? promptView : activeLeafView();
		promptView = undefined;
		if (view) {
			cmd?.(view.state, view.dispatch);
			view.focus();
		}
		sync();
	}

	/** Apply the typed value, normalized (`links.ts`). A blank value is nothing to
	 *  apply and only closes the prompt: removal has its own arm, and a second door
	 *  onto it would be a second thing to keep true. */
	function submitLink(): void {
		closePrompt(setLink(normalizeHref(linkValue)));
	}

	/** Mod-K is a press of the Link button: claimed only where the surface would stand
	 *  over the selection, and a second press while the prompt is up hands it the focus. */
	function raiseLink(view: EditorView): boolean {
		const inside = !!contentEl?.contains(document.activeElement);
		if (inside && linkPromptOpen) return true;
		if (!inside && !view.hasFocus()) return false;
		sync();
		if (!open) return false;
		const reraised = linkPromptOpen;
		toggle('link');
		if (reraised && promptInput) focusPrompt(promptInput);
		return true;
	}

	const linkKey = keydownHandler({
		'Mod-k': (_state, _dispatch, view) => !!view && raiseLink(view)
	});

	function onKeyDown(e: KeyboardEvent): void {
		if (e.defaultPrevented) return;
		const view = activeLeafView();
		if (view && linkKey(view, e)) e.preventDefault();
	}

	function removeLink(): void {
		closePrompt(clearLink);
	}

	const families = $derived(registry?.families() ?? []);
	/** The registry's spelling of the family the selection is set in, where it holds it:
	 *  the engine matches a family lowercased, so a run naming `carlito` is the registry's
	 *  `Carlito`. */
	const heldFamily = $derived(
		typeof family === 'string'
			? families.find((f) => f.toLowerCase() === family?.toLowerCase())
			: undefined
	);
	const familyItems = $derived([
		...families.map((f) => ({
			value: f,
			label: f,
			face: `${cssString(fontAlias(f))}, var(--_qm-font)`
		})),
		...(typeof family === 'string' && !heldFamily
			? [{ value: family, label: t.strings.formatFontMissing(family), disabled: true }]
			: []),
		...(family === null ? [] : [{ value: REMOVE_FAMILY, label: t.strings.formatFontRemove }])
	]);
	/** A registry to pick from, or a selection set in some family to take off. */
	const familyOffered = $derived(fontable && (families.length > 0 || family !== null));

	/** Run a family pick at the view the surface stands over. */
	function setFont(cmd: Command): void {
		const view = surfaceView && !surfaceView.isDestroyed ? surfaceView : activeLeafView();
		if (view) cmd(view.state, view.dispatch);
	}

	/** The family menu closed: the leaf takes the focus back, and the surface reads the
	 *  selection the pick left. */
	function closeMenu(): void {
		const view = surfaceView && !surfaceView.isDestroyed ? surfaceView : activeLeafView();
		view?.focus();
		sync();
	}

	function cancelLink(): void {
		closePrompt();
	}
</script>

<!-- The pointer handlers capture, so the gesture is seen whatever a view in the middle of
     it does with the event. `pointercancel` is the release a gesture the browser takes
     over gets. -->
<svelte:document
	onkeydown={onKeyDown}
	onselectionchange={deferredSync}
	onfocusout={deferredSync}
	onpointerdowncapture={onPointerDown}
	onpointerupcapture={onPointerUp}
	onpointercancelcapture={onPointerUp}
/>

<Popover.Root bind:open>
	<Popover.Portal to={portalTarget}>
		<!-- A flip is measured against the root the surface portals into, which is the box
		 that clips it where the consumer scrolls one (`.qm-pane`). The default boundary is
		 the viewport, which knows nothing of that: a selection on the pane's first visible
		 line raises the surface into the room above, where the pane's `overflow` cuts
		 it. -->
		<Popover.Content
			customAnchor={anchor ?? null}
			collisionBoundary={portalTarget ?? []}
			side="top"
			align="center"
			trapFocus={false}
			sideOffset={spacePx(portalTarget, 2)}
			onOpenAutoFocus={(e: Event) => e.preventDefault()}
			onCloseAutoFocus={(e: Event) => e.preventDefault()}
			onInteractOutside={(e: Event) => {
				if (inMenu(e.target)) e.preventDefault();
			}}
		>
			<!-- The `child` snippet, so the surface is the primitive's content node
			 rather than a pill inside it: the dismissal is a CSS animation and the
			 primitive unmounts on the content node's own animations finishing. It
			 also keeps the recipe reachable from this
			 component's scoped styles, which a class handed to a primitive as a
			 string never picks up the scoping hash for. `wrapperProps` is
			 floating-ui's positioning box: spread, never styled. `inert` is the half
			 of the dismissal the recipe cannot carry: the surface is still on screen
			 for the length of the fade, and a surface on its way out is not a thing
			 to click, tab into, or read. -->
			{#snippet child({ props, wrapperProps, open: raised })}
				<div {...wrapperProps}>
					<div
						bind:this={contentEl}
						{...props}
						class="qm-format-popover qm-popover-surface"
						data-qm-root
						inert={!raised}
					>
						{#if linkPromptOpen}
							<form
								class="qm-link-prompt"
								onsubmit={(e) => {
									e.preventDefault();
									submitLink();
								}}
							>
								<input
									{@attach focusPrompt}
									bind:this={promptInput}
									class="qm-link-input qm-focus-ring"
									type="text"
									placeholder={t.strings.linkPlaceholder}
									aria-label={t.strings.formatLink}
									bind:value={linkValue}
								/>
								<button type="submit" class="qm-icon-btn qm-mark-btn qm-focus-ring"
									>{t.strings.linkApply}</button
								>
								<!-- Only where there is a link to remove: an arm that does nothing is
								     an arm to read past on every other visit to the prompt. -->
								{#if linkPresent}
									<button
										type="button"
										class="qm-icon-btn qm-mark-btn qm-focus-ring"
										onmousedown={keepFocus}
										onclick={removeLink}>{t.strings.linkRemove}</button
									>
								{/if}
								<button
									type="button"
									class="qm-icon-btn qm-mark-btn qm-focus-ring"
									onmousedown={keepFocus}
									onclick={cancelLink}>{t.strings.linkCancel}</button
								>
							</form>
						{:else}
							<!-- `role="group"`, not `toolbar`: these buttons carry no roving-tabindex /
							     arrow-key navigation, so the ARIA toolbar contract would be a lie;
							     a labelled group is the honest description. -->
							<div class="qm-format-buttons" role="group" aria-label={t.strings.formatGroup}>
								{#each MARKS as m (m.name)}
									<button
										type="button"
										class="qm-icon-btn qm-mark-btn qm-focus-ring"
										title={m.title}
										aria-label={m.title}
										onmousedown={keepFocus}
										onclick={() => toggle(m.name)}><Icon name={m.icon} /></button
									>
								{/each}
								{#if listable}
									<span class="qm-format-divider" aria-hidden="true"></span>
									{#each LISTS as l (l.icon)}
										<button
											type="button"
											class="qm-icon-btn qm-mark-btn qm-focus-ring"
											title={l.title}
											aria-label={l.title}
											onmousedown={keepFocus}
											onclick={() => toggleLines(l.ordered)}><Icon name={l.icon} /></button
										>
									{/each}
								{/if}
								{#if familyOffered}
									<span class="qm-format-divider" aria-hidden="true"></span>
									<FormatMenu
										label={t.strings.formatFont}
										value={family === null ? undefined : (heldFamily ?? family)}
										shown={family === undefined
											? t.strings.formatFontMixed
											: family === null
												? t.strings.formatFontDefault
												: (heldFamily ?? t.strings.formatFontMissing(family))}
										items={familyItems}
										{portalTarget}
										onPick={(v) =>
											setFont(v === REMOVE_FAMILY ? removeFontFamily : setFontFamily(v))}
										onClose={closeMenu}
									/>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			{/snippet}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>

<style>
	/* This surface portals out of the leaf's DOM but into the nearest `[data-qm-root]`
	   (the target is resolved in `sync`), so it inherits the consumer's dials like
	   every other surface. It carries the marker itself too: floating over content is
	   still a detached subtree for the derivation's purposes, and the marker is what
	   applies it (core/theme.css). */
	/* The lift, the translucency, the blur and the scale-in come from
	   `.qm-popover-surface` (controls.css); this surface's own is a row and an inset. */
	.qm-format-popover {
		display: flex;
		padding: var(--_qm-space);
	}
	.qm-format-buttons {
		display: flex;
		gap: var(--_qm-space-half);
	}
	/* Chrome, type, target floor, hover fill and disabled recede come from
	 `.qm-icon-btn` (controls.css). The ink is stated because the family deliberately
	 declares none: its callers disagree, and a popover over content reads at the card's.

	 No state for a mark the selection already carries: a run may carry one over part of
	 itself, which a two-state button has no third face for. */
	.qm-format-divider {
		align-self: stretch;
		width: 1px;
		margin: var(--_qm-space-half) 0;
		background: var(--_qm-rule);
	}
	.qm-mark-btn {
		padding: var(--_qm-space) var(--_qm-space-2);
		color: var(--_qm-ink);
	}
	.qm-link-prompt {
		display: flex;
		gap: var(--_qm-space);
		align-items: center;
	}
	/* The box's recipe without `.qm-input`, which adds the `width: 100%` that would
	   stretch this to the popover. The fill is the box's own rung and there is no
	   edge, as everywhere else a value is typed (controls.css). */
	.qm-link-input {
		font: inherit;
		font-size: var(--_qm-text-body);
		padding: var(--_qm-inset-control);
		border: none;
		border-radius: var(--_qm-radius-inner);
		background: var(--_qm-surface-well);
		min-width: 12rem;
	}
</style>
