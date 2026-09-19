<!--
 One card block, its fields grouped by `ui.group`/`ui.compact`. `main` is headerless
 and takes no controls. Every prose leaf takes a parent-built live address, so a card
 reorder re-targets its commits without a remount.
-->
<script lang="ts">
	import { wording } from './strings.js';

	// Ambient from the editor root, with the package's English off-tree, so this
	// component renders standalone too.
	const t = wording();
	import { untrack } from 'svelte';
	import Icon from './icons/Icon.svelte';
	import type { Document, Quill, Addr, Diagnostic } from '@quillmark/wasm';
	import type { EditorErrorHandler } from '../core/errors.js';
	import type { LeafRegistry } from './leaves.js';
	import type { CardModel, FieldModel } from './structure.js';
	import { placeFields, humanize, initialExpandedGroup } from './structure.js';
	import { holdInView } from './hold.js';
	import type { FieldDomIds } from './domid.js';
	import Field from './Field.svelte';
	import ProseField from './ProseField.svelte';
	import CardControls from './CardControls.svelte';
	import DiagnosticList from './DiagnosticList.svelte';

	/** The per-card operation bundle the VisualEditor builds (all resolve id→index lazily). */
	interface CardOps {
		makeAddr: (field?: string) => Addr;
		leafKey: (field?: string) => string;
		domIds: (field?: string) => FieldDomIds;
		panelId: (group: string) => string;
		commit: (name: string, value: unknown) => void;
		move: (dir: -1 | 1) => void;
		remove: () => void;
		retype: (kind: string) => void;
		rename: (title: string) => void;
		diagFor: (field?: string) => Diagnostic[] | undefined;
		/** Consumer enum-option policy for a field; true when no hook set. */
		enumAllowed: (field: string, value: string) => boolean;
	}

	interface Props {
		card: CardModel;
		doc: Document;
		quill: Quill;
		isFirst: boolean;
		isLast: boolean;
		kinds: string[];
		ops: CardOps;
		enumDisallowed?: 'hide' | 'disable';
		onFocus?: (addr: Addr) => void;
		onCaretMove?: (addr: Addr, pos: number) => void;
		onChange?: (addr: Addr) => void;
		onError?: EditorErrorHandler;
		/** Every field in this card registers its landing handle here, which is what the
		 *  editor's `focusField`/`setCaret` resolve a `DocPath` to. */
		leaves?: LeafRegistry;
	}
	let {
		card,
		doc,
		quill,
		isFirst,
		isLast,
		kinds,
		ops,
		enumDisallowed,
		onFocus,
		onCaretMove,
		onChange,
		onError,
		leaves
	}: Props = $props();

	// Local title reconcile (external change only), like the scalar controls.
	// svelte-ignore state_referenced_locally
	let localTitle = $state(card.titleOverride);
	$effect(() => {
		const incoming = card.titleOverride;
		untrack(() => {
			if (incoming !== localTitle) localTitle = incoming;
		});
	});

	// The pre-edit value Escape rolls back to; the rename itself stays live on input.
	let titleAtFocus = '';
	function onTitleFocus(e: FocusEvent): void {
		titleAtFocus = localTitle;
		(e.currentTarget as HTMLInputElement).select();
	}
	// A press on an unfocused title would place a caret on mouseup, collapsing the
	// focus-time select-all. A press while already focused stays normal, so clicking
	// mid-title to place the caret still works.
	function onTitleMousedown(e: MouseEvent): void {
		const el = e.currentTarget as HTMLInputElement;
		if (document.activeElement !== el) {
			e.preventDefault();
			el.focus();
		}
	}
	// A press on the region's empty width enters the title edit, and starts no text
	// selection on the wrapper. A press on the input itself is `onTitleMousedown`'s.
	function onRenameMousedown(e: MouseEvent): void {
		const input = (e.currentTarget as HTMLElement).querySelector('input');
		if (!input || e.target === input) return;
		e.preventDefault();
		input.focus();
	}
	function onTitleKeydown(e: KeyboardEvent): void {
		const el = e.currentTarget as HTMLInputElement;
		if (e.key === 'Enter') {
			e.preventDefault();
			el.blur(); // commit: the live value already persisted on input
		} else if (e.key === 'Escape') {
			e.preventDefault();
			if (localTitle !== titleAtFocus) {
				localTitle = titleAtFocus;
				ops.rename(titleAtFocus); // roll back the live edits
			}
			el.blur();
		}
	}

	/** Not `--_qm-glyph-control`: that rung centres a glyph in a tap target, where this
	 * one stands in a run of text at the body rung and is sized to sit level with it. */
	const CHEVRON = 16;

	const ungrouped = $derived(card.sections.filter((s) => s.group == null));
	const grouped = $derived(card.sections.filter((s) => s.group != null));

	// A schema that declares no fields still gets a body, and an empty payload block is
	// worse than none: its two rules land on one y and paint as a single stroke of twice
	// the width, and the card's gap counts the block twice besides.
	const hasMeta = $derived(ungrouped.length > 0 || grouped.length > 0);

	// Seeded once from the card's shape. Card is keyed by stable id, so this survives the
	// VisualEditor re-derive that reassigns `card` and resets only on a remount. Not
	// reconciled to later section changes: a retype is the one reshape, and the open
	// group stays where it still exists.
	// svelte-ignore state_referenced_locally
	let expanded = $state<string | null>(initialExpandedGroup(card.sections));
	let headers = $state<Record<string, HTMLButtonElement | undefined>>({});
	let panels = $state<Record<string, HTMLElement | undefined>>({});
	/** Whether the panels animate the move `expanded` is about to make. False for a reveal
	 *  ({@link revealLeaf}), restored by the header gesture the motion is there for, so its
	 *  return needs no timer. */
	let animate = $state(true);
	/**
	 * Move to `next` (`null` = all closed). A closing panel goes `inert` with whatever it
	 * held still focused, and `inert` does not say where focus should go — the browser
	 * drops it on the body — so the close hands focus to the header, which is what
	 * reopens the section. Every write to `expanded` goes through here: a group also
	 * closes when another opens.
	 */
	function setExpanded(next: string | null): void {
		const closing = expanded;
		if (closing !== null && closing !== next && panels[closing]?.contains(document.activeElement))
			headers[closing]?.focus();
		expanded = next;
	}
	/** The header is the anchor: a section closing above it is what would carry it off the
	 *  fold, and a section opens under its own header (`hold.ts`). */
	function toggleGroup(group: string): void {
		animate = true;
		holdInView(headers[group], () => setExpanded(expanded === group ? null : group));
	}

	/**
	 * Open the group holding leaf `key`: a caret placed in a collapsed panel does not
	 * land at all. `VisualEditor.setCaret` calls this on every card and then waits a
	 * flush before landing, since `inert` clears when the panel renders open, not when
	 * `expanded` is assigned.
	 *
	 * The move is instant, because that same flush is when the landing measures its target:
	 * an animating track still reads its start value there, and the trip would be computed
	 * against a panel that has not moved yet. The motion explains a header click, and a
	 * click in the preview is not one.
	 *
	 * A call, not a prop: a reveal is an event, and modelling it as state needs a
	 * fresh-identity wrapper to re-fire and an `untrack` to keep the per-keystroke
	 * re-derive from reopening the accordion under the user.
	 */
	export function revealLeaf(key: string): void {
		const section = grouped.find((s) => s.fields.some((f) => ops.leafKey(f.name) === key));
		if (!section?.group) return;
		animate = false;
		setExpanded(section.group);
	}

	let el = $state<HTMLElement | undefined>(undefined);
	/**
	 * Bring this card into view after the structure mutation that placed it: `center` for
	 * an insert, `nearest` for a reorder. The reduced-motion guard is JS rather than the
	 * CSS the accordion uses: a scroll's behaviour is an argument, not a transition a
	 * media query can cancel.
	 *
	 * The caller is what waits out a reorder's own trip before asking: the run holds the
	 * slot this card sits in, and the slot is the stack's (`VisualEditorInner`).
	 */
	export function scrollIntoViewCard(block: ScrollLogicalPosition): void {
		const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block });
	}
</script>

<!-- `data-qm-card` names the island for a floating surface that has to stay inside one
 ({@link FieldHint}). A surface portals to `[data-qm-root]`, so the card is not its
 ancestor and nothing else marks the box its guidance belongs in. -->
<section
	bind:this={el}
	class="qm-card"
	data-qm-card
	class:qm-main={card.isMain}
	class:qm-unschemable={card.unschemable}
>
	{#if card.unschemable}
		{@render recoveryShell()}
	{:else}
		{#if !card.isMain}
			<header class="qm-card-header">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="qm-card-rename" onmousedown={onRenameMousedown}>
					<span class="qm-card-title-sizer" data-value={localTitle || card.titlePlaceholder}>
						<input
							class="qm-card-title qm-focus-ring"
							value={localTitle}
							placeholder={card.titlePlaceholder}
							aria-label={t.strings.cardTitle}
							size="1"
							onmousedown={onTitleMousedown}
							onfocus={onTitleFocus}
							onkeydown={onTitleKeydown}
							oninput={(e) => {
								localTitle = (e.currentTarget as HTMLInputElement).value;
								ops.rename(localTitle);
							}}
						/>
					</span>
				</div>
				<div class="qm-card-header-right">
					<CardControls
						{isFirst}
						{isLast}
						onMoveUp={() => ops.move(-1)}
						onMoveDown={() => ops.move(1)}
						onDelete={() => ops.remove()}
					/>
				</div>
			</header>
		{/if}

		<div class="qm-card-body">
			{#if hasMeta}
				<div
					class="qm-card-meta"
					class:qm-meta-top={!card.isMain}
					class:qm-meta-bottom={card.hasBody}
				>
					{#each ungrouped as section (section.group ?? '_ungrouped')}
						<div class="qm-section">
							{@render sectionFields(section.fields)}
						</div>
					{/each}

					<!-- One open at a time. Rendered only when a card has groups, so an empty
				     accordion does not stand a gap under the ungrouped fields. -->
					{#if grouped.length}
						<div class="qm-groups" class:qm-instant={!animate}>
							{#each grouped as section (section.group)}
								{@const group = section.group as string}
								{@const isOpen = expanded === group}
								{@const panelId = ops.panelId(group)}
								<div class="qm-group" class:qm-open={isOpen}>
									<button
										type="button"
										class="qm-group-header"
										bind:this={headers[group]}
										aria-expanded={isOpen}
										aria-controls={panelId}
										onclick={() => toggleGroup(group)}
									>
										<Icon
											name="chevron-right"
											class="qm-group-chevron"
											size={CHEVRON}
										/>{section.label}
									</button>
									<!-- The panel is clipped, not unmounted, so without `inert` every field
								     in a hidden section keeps its place in the tab order and in the a11y
								     tree, under a header announcing `aria-expanded="false"`. -->
									<div
										class="qm-group-panel"
										id={panelId}
										inert={!isOpen}
										bind:this={panels[group]}
									>
										<div class="qm-group-panel-inner">
											{@render sectionFields(section.fields)}
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Unframed: the body is the only surface at the card's own tone, where every
		 other typed value sits in a well cut into it, and that is what makes it read as
		 paper instead of as one more field. -->
			{#if card.hasBody}
				<div class="qm-body-leaf">
					<ProseField
						{doc}
						{quill}
						addr={ops.makeAddr(undefined)}
						unframed
						label={t.strings.bodyLabel}
						placeholder={card.bodyGhost}
						leafKey={ops.leafKey(undefined)}
						{onFocus}
						{onCaretMove}
						{onChange}
						{onError}
						{leaves}
					/>
					<DiagnosticList diagnostics={ops.diagFor(undefined)} />
				</div>
			{/if}
		</div>
	{/if}
</section>

{#snippet sectionFields(fields: FieldModel[])}
	<div class="qm-fields qm-tracks">
		{#each placeFields(fields) as { field: f, span } (f.name)}
			<Field
				field={f}
				{span}
				value={card.values[f.name]}
				provenance={card.provenance[f.name]}
				{doc}
				{quill}
				addr={ops.makeAddr(f.name)}
				leafKey={ops.leafKey(f.name)}
				domIds={ops.domIds(f.name)}
				onCommitScalar={(v) => ops.commit(f.name, v)}
				optionAllowed={(v) => ops.enumAllowed(f.name, v)}
				{enumDisallowed}
				{onFocus}
				{onCaretMove}
				{onChange}
				{onError}
				{leaves}
				diagnostics={ops.diagFor(f.name)}
			/>
		{/each}
	</div>
{/snippet}

<!-- A card whose `kind` has no schema stays visible and removable, its fields, body and
 `$ext` intact in the Document, so it is never a data trap. A retype swaps the kind and
 leaves payload and body untouched, so it drops no field; with no kinds to offer, delete
 is the only exit. -->
{#snippet recoveryShell()}
	<header class="qm-card-header">
		<span class="qm-card-title-static">{humanize(card.kind)}</span>
		<div class="qm-card-header-right">
			<CardControls
				{isFirst}
				{isLast}
				onMoveUp={() => ops.move(-1)}
				onMoveDown={() => ops.move(1)}
				onDelete={() => ops.remove()}
			/>
		</div>
	</header>
	<div class="qm-card-recovery">
		<p class="qm-recovery-note">
			{t.strings.unknownKind(card.kind)}
		</p>
		{#if kinds.length}
			<label class="qm-recovery-retype">
				{t.strings.retypeLabel}
				<select
					onchange={(e) => {
						const el = e.currentTarget as HTMLSelectElement;
						if (el.value) ops.retype(el.value);
					}}
				>
					<option value="" disabled selected>{t.strings.retypePlaceholder}</option>
					{@render kindOptions()}
				</select>
			</label>
		{:else}
			<p class="qm-recovery-note">
				{t.strings.noCardKinds}
			</p>
		{/if}
	</div>
{/snippet}

{#snippet kindOptions()}
	{#each kinds as k (k)}
		<option value={k}>{humanize(k)}</option>
	{/each}
{/snippet}

<style>
	/* An island: the card is the base plane, the column behind it the sunken one, and the
	 hairline closes it (ARCHITECTURE §Styling). The block half is the same rung as the
	 gap: the payload stands that far off the card's edge and off the body below it. The
	 header insets itself to the section-heading column (`.qm-card-header`). The inline
	 half stands a step tighter than the nesting rung the verticals inside keep: this
	 edge closes the block rather than nesting one, and the rules it holds run that much
	 further for it. */
	.qm-card {
		border: var(--_qm-border-width) solid var(--_qm-border);
		border-radius: var(--_qm-radius);
		padding: var(--_qm-space-3) var(--_qm-space-2);
		background: var(--_qm-surface);
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space-3);
	}
	/* Headerless, the payload faces that edge with nothing between. A field row
	 leading it stands the edge's own inset off the top, as it does off the side:
	 this rung plus the section's block padding is the inline inset. A card that
	 opens on its body keeps the full inset — prose is neither a heading nor a
	 field row. */
	.qm-card.qm-main:has(> .qm-card-body > .qm-card-meta:first-child) {
		padding-top: var(--_qm-space);
	}
	/* A section heading leading it: the vertical starts at the content's
	 top-left, so the top inset is the inline one and the tip is a square
	 corner of the card. */
	.qm-card.qm-main:has(> .qm-card-body > .qm-card-meta:first-child > .qm-groups:first-child) {
		padding-top: var(--_qm-space-2);
	}
	.qm-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--_qm-space-2);
		/* The group's vertical plus the rung the chevron stands off it: the title
		 shares that column. Inline only. The block pull is half the card's block
		 inset, so the header sits that far off the hairline and the rule. */
		padding-inline: calc(var(--_qm-space) + var(--_qm-vertical-width));
		margin-block: calc(-1 * var(--_qm-space-3) / 2);
	}
	.qm-card-header-right {
		display: flex;
		align-items: center;
		gap: var(--_qm-space-2);
		/* The overhang is the tap target's own centring given back, so the delete
		 glyph sits on the header's inset rather than the pad around it. The fill is
		 what crosses the line. */
		margin-inline-end: calc(-1 * (var(--_qm-tap-min) - var(--_qm-glyph-control)) / 2);
	}
	/* Focus as well as hover, so a caret in any leaf, the title, or a chevron holds the
	 reveal: hover alone would strand the pair on keyboard and touch. */
	.qm-card:hover :global(.qm-card-reorder),
	.qm-card:focus-within :global(.qm-card-reorder) {
		opacity: 1;
	}
	/* The rename hit region is the header's free width at full height, so a press
	 anywhere left of the controls enters the title edit. `align-self: stretch` beats the
	 header's centring, which is also what keeps the target legal with no padding: WCAG
	 2.5.8's floor is the row's, which the chips hold at `--_qm-tap-min`. */
	.qm-card-rename {
		flex: 1;
		min-width: 0;
		align-self: stretch;
		display: flex;
		align-items: center;
		cursor: text;
	}
	/* Autosize: the ::after mirrors the text into the same grid cell as the input, so the
	 overlaid input tracks its content width. Both carry the same nothing for a box model
	 and inherit the same type tokens, which is what makes the two measure alike.

	 The type is the group header's, down to the ink and its hover step below: a card
	 title and a section header both name a block of fields, so they read as one register
	 and what ranks them is position rather than a size step. */
	.qm-card-title-sizer {
		display: inline-grid;
		align-items: center;
		min-width: 0;
		max-width: 100%;
		font-size: var(--_qm-text-body);
		font-weight: var(--_qm-weight-mid);
		line-height: var(--_qm-leading-tight);
		font-family: inherit;
	}
	.qm-card-title-sizer::after {
		content: attr(data-value) ' ';
		grid-area: 1 / 1;
		visibility: hidden;
		white-space: pre;
		min-width: 2ch;
	}
	/* The title draws no box in any state: a card title is already the one line that
	 reads as the card's name, and the region's `cursor: text` says the rest. The ink step
	 replaces it, the same cue the group header takes — a wide borderless target has no
	 other way to answer the pointer. */
	.qm-card-title {
		grid-area: 1 / 1;
		width: 100%;
		min-width: 0;
		font: inherit;
		/* `font: inherit` does not carry colour: a form control defaults to the UA's own
		 text colour rather than the header's ink without this line. */
		color: var(--_qm-ink-label);
		border: none;
		padding: 0;
		background: transparent;
		transition: color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-card-title:hover,
	.qm-card-title:focus {
		color: var(--_qm-ink);
	}
	.qm-card-body {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space-3);
	}
	.qm-card-meta,
	.qm-groups {
		display: flex;
		flex-direction: column;
	}
	/* One rung between the payload's two kinds of section, and none inside the accordion:
	 what stands one disclosure row off the next is the two headers' own block padding and
	 nothing else, so the rows tile and their targets with them. A run of one-line rows
	 wants the tighter rhythm — the `--_qm-space-3` the fields keep between their own rows
	 is calibrated for a label over a well, and reads as a float between two lines of text.

	 `--stroke-reach` is what a box standing a field row off a rule has left to spend: the
	 rung is `--_qm-nest`, of which its own block padding is already `--_qm-space`. */
	.qm-card-meta {
		gap: var(--_qm-space);
		--stroke-reach: calc(var(--_qm-nest) - var(--_qm-space));
	}
	/* The card's two horizontals, and ranking is the one thing a horizontal is for: they
	 stand the payload against the title above it and the body below it, where saying what
	 sits inside what is the verticals' (ARCHITECTURE §"A plane is a tone"). Each is
	 conditional on what it ranks against: `main` is headerless, and a card with no body
	 has nothing under the payload to divide it from.

	 Neither insets: a rule is drawn on the edge of the box it faces, and the air is that
	 box's own. So the section carries what its ink stands off a rule — the inset of the
	 ink facing it, which is what squares the corner: `--_qm-nest` for a field row,
	 `--_qm-space` for a heading, each the rung that ink stands off a vertical inline. The
	 air outside the pair is the `--_qm-space-3` the card spends between its blocks. */
	.qm-meta-top {
		border-top: var(--_qm-border-width) solid var(--_qm-border);
	}
	.qm-meta-bottom {
		border-bottom: var(--_qm-border-width) solid var(--_qm-border);
	}
	/* A section's share of the boundary between sections, one rung at each end. The
	 accordion spends the same rung from its header and its panel, where it also caps the
	 vertical those two edges hold.

	 No stroke: a vertical would mark a section a reader has no name for. The start
	 inset is the heading's — the group's vertical plus the rung the chevron stands
	 off it — so a top-level field and a section heading share a column. */
	.qm-section {
		padding-block: var(--_qm-space);
		padding-inline-start: calc(var(--_qm-space) + var(--_qm-vertical-width));
	}
	/* Where it faces a rule, the rung a heading already stands off one. The fields
	 sit on the heading column, not the card's edge. */
	.qm-meta-top > .qm-section:first-child {
		padding-top: var(--_qm-space-2);
	}
	.qm-meta-bottom > .qm-section:last-child {
		padding-bottom: var(--_qm-space-2);
	}
	/* Two query containers, one per kind of section, so capacity follows the width the
	 fields actually get: a panel's inset makes that narrower than the card. */
	.qm-section,
	.qm-group-panel-inner {
		container-type: inline-size;
	}
	/* The count is the ladder's (`.qm-tracks`, controls.css), stepped by the container
	 above; what this block owns is the grid the count fills. */
	.qm-fields {
		display: grid;
		grid-template-columns: repeat(var(--cols), 1fr);
		column-gap: var(--_qm-space-2);
		row-gap: var(--_qm-space-3);
	}
	/* The nesting vertical, one `--_qm-nest` in from the card's edge with the panel's
	 fields the same rung off it (ARCHITECTURE §"A plane is a tone"). `--_qm-border` and
	 not `--_qm-accent`: a card's edge and the verticals inside it are one stroke at three
	 depths, and a tone that changed as it went in would read as unrelated lines rather
	 than one figure. A named section is what earns it, which is why the ungrouped block
	 above draws none.

	 On the group rather than on its panel: what the stroke marks is the section, and a
	 section is its header and what hangs under it. Drawn transparent when closed rather
	 than absent, so a toggle moves no text — and closed, there is nothing under the header
	 for it to gather.

	 A free end of the stroke caps at `--_qm-space`, the rung the subform's own vertical
	 caps at (`ObjectField`), grown as padding and handed straight back as margin so the
	 stroke lengthens and no boundary moves. Above, that is also the rung the header stands
	 off it, so the top end is the same number whether it caps free or lands on a rule.
	 One section open at a time, so no two strokes are ever visible to meet in between. */
	.qm-group {
		display: flex;
		flex-direction: column;
		border-left: var(--_qm-vertical-width) solid transparent;
		padding-bottom: var(--_qm-space);
		margin-bottom: calc(-1 * var(--_qm-space));
		transition:
			border-color var(--_qm-duration-slow) var(--_qm-ease-reverse),
			padding-bottom var(--_qm-duration-slow) var(--_qm-ease-reverse),
			margin-bottom var(--_qm-duration-slow) var(--_qm-ease-reverse);
	}
	/* Open, the cap is air as well as stroke: a section ending on a field row stands the
	 longer rung off what follows, and three of `--_qm-space` are what that comes to — the
	 panel's own, this cap, and the next header's. Shut, a section ends on its header and
	 stands the header's rung, so there is nothing to cap and the padding is handed back. */
	.qm-group.qm-open {
		border-left-color: var(--_qm-border);
		margin-bottom: 0;
	}
	/* The one end that lands on a rule, where the padding is real and the rule is this
	 box's own bottom edge — so the stroke ends on the rule at every frame of a fold rather
	 than at the two ends of one, and the fields inside stand `--_qm-nest` off it. Shut,
	 the box ends on the header's block padding and the rule takes the heading's rung
	 there, the same one the rule above it takes. */
	.qm-meta-bottom > .qm-groups:last-child > .qm-group:last-child {
		padding-bottom: 0;
		margin-bottom: 0;
	}
	.qm-meta-bottom > .qm-groups:last-child > .qm-group:last-child.qm-open {
		padding-bottom: var(--stroke-reach);
	}
	/* One rung on three sides and zero on the end, the end because the row is the target
	 and an inset there is target given back. The rung is `--_qm-space` in both axes, and
	 neither is free: the block padding is the tightest that still clears WCAG 2.5.8's
	 24×24 floor, and it is the whole air a heading opening the payload keeps under its
	 rule, which a rule cannot inset past — so the inline inset is that same number or the
	 corner is square on one axis alone. The heading rides the vertical there, one
	 nesting step out from the fields under it, which is what states that it holds them.
	 What the glyph gives up for the step is the gutter: it stands in the clearance itself,
	 with only its own bearing between ink and stroke, and the rotation swaps which bearing
	 faces which.

	 `font: inherit` because a UA button inherits no face, then the body rung, one step
	 over the field labels beneath it: at the label rung the two read as one register and
	 the accordion stops looking like structure. Size, weight and leading sit after
	 `font`, a shorthand that carries `line-height`. */
	.qm-group-header {
		/* Positioned, and paint is not what it buys: a group's box grows by
		 `--stroke-reach` at both ends and hands the growth back as margin, so
		 consecutive boxes overlap in a band at every seam, and a closed group's header
		 ends inside the next group's box. In flow, the later sibling takes the presses
		 that land in the band and the bottom of the header is a dead strip; positioned,
		 the control holds its own box, and the band paints the same either way. */
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--_qm-space);
		width: 100%;
		border: none;
		background: transparent;
		padding: var(--_qm-space) 0 var(--_qm-space) var(--_qm-space);
		font: inherit;
		font-size: var(--_qm-text-body);
		font-weight: var(--_qm-weight-mid);
		line-height: var(--_qm-leading-tight);
		cursor: pointer;
		color: var(--_qm-ink-label);
		text-align: left;
		transition: color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-group-header :global(.qm-group-chevron) {
		flex-shrink: 0;
		display: block;
		transform: rotate(0deg);
		transform-origin: center;
		transition: transform var(--_qm-duration-slow) var(--_qm-ease-reverse);
	}
	/* Open shares hover's ink step: a big borderless target draws no box, so the ink is
	 the only cue an open section keeps once the pointer leaves it. The chevron's
	 rotation is the other cue, and stays open-only below. */
	.qm-group-header:hover,
	.qm-group.qm-open .qm-group-header {
		color: var(--_qm-ink);
	}
	.qm-group.qm-open .qm-group-header :global(.qm-group-chevron) {
		transform: rotate(90deg);
	}
	.qm-group-panel {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows var(--_qm-duration-slow) var(--_qm-ease-reverse);
	}
	.qm-group.qm-open .qm-group-panel {
		grid-template-rows: 1fr;
	}
	/* What a toggle moves is the panel's track, and the box's own bottom edge where the
	 last section is the one toggling. A reveal's landing measures its target one flush
	 after asking — where either, mid-flight, still reads its start value — so nothing
	 about the accordion animates for it. Both panels of the move are inside the group box,
	 so the opening one and the closing one above it stand still together (`revealLeaf`). */
	.qm-groups.qm-instant .qm-group-panel,
	.qm-groups.qm-instant .qm-group {
		transition: none;
	}
	/* Two boxes because the axes clip differently, and the track is the only thing that
	 animates: a field sits at its open position from the first frame of the reveal.

	 The clip box takes the inline inset, which costs a shut panel no height and holds the
	 queried width still. The block inset goes on the content, where a `0fr` track clips
	 it: declared one box out it collapses the content but not itself, and stands under a
	 shut header as dead space. Neither is animated, and neither is qualified by open.

	 A field ends on the clip box at the end edge, where no inset hides its ring the way
	 the start edge's does. The pad carries the clip past it and the margin takes the same
	 distance back, so the width the fields are packed and queried at is unmoved. */
	.qm-group-panel-inner {
		min-height: 0;
		overflow: hidden;
		padding-inline-start: var(--_qm-nest);
		padding-inline-end: var(--_qm-ring-reach);
		margin-inline-end: calc(-1 * var(--_qm-ring-reach));
	}
	/* The lower of the two caps an open section's vertical takes (`.qm-group`). */
	.qm-group-panel-inner > .qm-fields {
		padding-block: var(--_qm-space);
	}
	.qm-body-leaf {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
	}
	/* The state is in the stroke's pattern, every card being closed by one already. */
	.qm-card.qm-unschemable {
		border-style: dashed;
	}
	/* One typographic role with the editable title above. */
	.qm-card-title-static {
		font-size: var(--_qm-text-body);
		font-weight: var(--_qm-weight-mid);
		line-height: var(--_qm-leading-tight);
		color: var(--_qm-ink-label);
	}
	.qm-card-recovery {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space-2);
	}
	.qm-recovery-note {
		margin: 0;
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
	}
	.qm-recovery-retype {
		display: inline-flex;
		align-items: center;
		gap: var(--_qm-space-2);
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
	}
	/* The one native control the surface draws, on the box's own recipe (controls.css). */
	.qm-recovery-retype select {
		font: inherit;
		border: none;
		border-radius: var(--_qm-radius-inner);
		background: var(--_qm-surface-well);
		padding: var(--_qm-space-half) var(--_qm-space-2);
	}
</style>
