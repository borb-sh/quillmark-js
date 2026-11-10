<!--
 The slash menu. The leaf's own surface, not the
 shell's: the trigger belongs to one caret in one leaf, so it is mounted by
 `ProseField` beside the view it reads from, unlike the one shell-owned format
 popover that follows whichever leaf is active.

 The model is the codec's (`codec/slash.ts`: the trigger run, the query, the
 highlighted index, and what each pick does). This component draws it and nothing
 else. The keys are the leaf's keymap for the same reason: the caret stays in the
 contenteditable while the menu is open, so a focus-taking listbox would move the
 selection the insert is measured against. What is left here is mostly the pointer's
 half: buttons that pick, and that swallow their own mousedown so the caret stays put.

 The highlight has one lane: `data-highlighted` marks whichever item the codec's
 index names, and a pointer entering an item moves that index rather than painting a
 second highlight the keyboard cannot reach (controls.css, the shared menu recipe).
 The keyboard's one claim here is the scroll: the arrows move an index, and only the
 chrome knows the port that index has to stay inside.

 Focus never reaches an item, so nothing a screen reader follows says which one is
 highlighted: a polite live region beside the menu speaks the highlighted row and its
 place as the index moves. It is mounted with the leaf, since a region inserted with the
 text it carries is not announced.
-->
<script lang="ts">
	import { Popover } from 'bits-ui';
	import type { FieldController, SlashState } from '../core/codec/index.js';
	import './controls.css';

	interface Props {
		/** The live menu, or `undefined` when closed: the codec's report channel. Named
		 *  `menu` rather than `state`, which is the rune's word in this file. */
		menu: SlashState | undefined;
		/** The leaf the trigger is in; `slashFocus` / `slashPick` drive it. */
		leaf: () => FieldController | undefined;
		/** The menu's accessible name. */
		label: string;
		/** A command's row name, by its token. */
		name: (command: string) => string;
		/** What the live region says of the highlighted row. */
		position: (name: string, index: number, count: number) => string;
	}
	let { menu, leaf, label, name: nameOf, position }: Props = $props();

	let open = $derived(!!menu && menu.items.length > 0);
	const announced = $derived(
		open && menu ? position(nameOf(menu.items[menu.index]), menu.index + 1, menu.items.length) : ''
	);

	/** The root to portal into, resolved from the leaf's own DOM so the menu lands
	 * inside whichever `[data-qm-root]` raised it and inherits the consumer's dials;
	 * `undefined` falls back to bits-ui's `document.body`. */
	const portalTarget = $derived(leaf()?.el.closest<HTMLElement>('[data-qm-root]') ?? undefined);

	/** Keep the keyboard's cursor in the port: the arrows move an index rather than a
	 *  focus, so a row the list scrolled past has nothing bringing it back. `nearest`
	 *  scrolls the least that works, and no ancestor the row is already visible in. */
	function followHighlight(surface: HTMLElement): void {
		void menu?.index;
		surface.querySelector('[data-highlighted]')?.scrollIntoView({ block: 'nearest' });
	}

	/** Swallow the item's own mousedown: without it the browser focuses the item and
	 *  blurs the leaf, taking the trigger run's caret with it. */
	function keepFocus(e: MouseEvent): void {
		e.preventDefault();
	}
</script>

<span class="qm-visually-hidden" aria-live="polite">{announced}</span>

<Popover.Root bind:open>
	<Popover.Portal to={portalTarget}>
		<!-- Hung off the trigger and flush against it: the anchor is the `/` itself
		     (`codec/slash.ts`), so the surface's top left corner sits at the line's bottom
		     edge under the character that opened the menu, and stays there as the query is
		     typed. Zero offset, because a gap reads as a surface floating near the caret
		     rather than one growing out of it. -->
		<!-- The boundary is the root the surface portals into, the box that clips it where
		     the consumer scrolls one ({@link FormatPopover} states it in full). It is also
		     what keeps the row scroll above inside the list: `nearest` scrolls any ancestor
		     the row is not visible in, and a surface raised into room the pane clips leaves
		     the pane one of them — so the scroll moves the pane, and with it the caret this
		     menu is anchored to. -->
		<Popover.Content
			customAnchor={menu?.anchor ?? null}
			collisionBoundary={portalTarget ?? []}
			side="bottom"
			align="start"
			trapFocus={false}
			sideOffset={0}
			onOpenAutoFocus={(e: Event) => e.preventDefault()}
			onCloseAutoFocus={(e: Event) => e.preventDefault()}
		>
			{#snippet child({ props, wrapperProps, open: raised })}
				<div {...wrapperProps}>
					<!-- `role="group"`, not `listbox`: the caret never leaves the leaf, so no
					     item is ever the focused option an `option` promises, and the buttons
					     carry no roving tabindex. A labelled group of real buttons is the honest
					     description, and it is the shape the format popover already takes.
					     `inert` is the dismissal's other half: a surface on its way out is not
					     a thing to click, tab into, or read. -->
					<div
						{...props}
						{@attach followHighlight}
						class="qm-slash-menu qm-menu-surface"
						data-qm-root
						role="group"
						aria-label={label}
						inert={!raised}
					>
						<!-- The row is the command's name, and at its end the command as typed,
						     leading `/` and all: the menu is a completion of the run in the text,
						     so the token is what the run reads as, and the name is what a reader
						     who has not learned the tokens picks by. -->
						{#each menu?.items ?? [] as name, i (name)}
							<button
								type="button"
								class="qm-menu-item qm-slash-item"
								data-highlighted={i === menu?.index ? '' : undefined}
								onmousedown={keepFocus}
								onclick={() => leaf()?.slashPick(name)}
								onpointerenter={() => leaf()?.slashFocus(name)}
							>
								<span class="qm-slash-name">{nameOf(name)}</span>
								<span class="qm-slash-token" aria-hidden="true">/{name}</span>
							</button>
						{/each}
					</div>
				</div>
			{/snippet}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>

<style>
	/* The surface, its inset, its item pad and the rung a highlight fills with are all
	   `.qm-menu-surface` / `.qm-menu-item` (controls.css): the same recipe the enum
	   listbox and the card stack's kind menu draw, because all three are lists picked
	   from. What is here is this menu's own: a measure, so a long label does not stretch
	   the surface across the card, and a scroll for a filtered list that stays long. */
	.qm-slash-menu {
		min-width: 14rem;
		max-height: 16rem;
		overflow-y: auto;
	}
	/* An item is a row of text, not a glyph: the whole row is the target, and the label
	   is the accessible name with nothing beside it. A button is a button, so the UA's
	   own box is taken back; what is left is the shared item recipe. The fill is not
	   taken back here: a scoped block is unlayered, so a reset would outrank the recipe's
	   highlight; the resting transparent is the recipe's own (controls.css). */
	.qm-slash-item {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--_qm-space-3);
		width: 100%;
		border: none;
		font: inherit;
		color: inherit;
		text-align: left;
		white-space: nowrap;
	}
	/* The token in the face the surface spells a literal in (the `code` mark,
	   `codec/prose.css`), at the label ink and rung: the name is the row, and the token is
	   the shortcut a menu row carries at its end. Hidden from the accessible name, which
	   would read the command twice. */
	.qm-slash-token {
		font-family: var(--_qm-font-mono);
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
	}
</style>
