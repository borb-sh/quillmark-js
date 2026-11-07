<!--
 A `type: enum` field → a styled listbox over its `values`, on bits-ui. The list is
 the members, one row each, the current one checked and the `default:`'s tagged.
 Unset, the trigger ghosts the default (muted, shown-never-written) and the default's
 row carries the check, since that is what prints; picking it writes it, so "commit
 the default" stays expressible as genuine intent. Once a value is authored a reset
 row stands under a divider, the unset sentinel: it commits nothing, clearing back to
 the default (or to nothing, where none prints).

 Styled rather than a native `<select>`: the dropdown list is UA-owned and reaches
 no dial. Listbox semantics and typeahead come with the primitive.
-->
<script lang="ts">
	import { Select } from 'bits-ui';
	import Icon from './icons/Icon.svelte';
	import { wording } from './strings.js';
	import { spacePx } from '../core/rungs.js';
	import './controls.css';

	const t = wording();

	interface Props {
		value: string | undefined;
		values: string[];
		fallback?: string;
		/** The schema's `ui.blank_title`: what the blank draws as, in place of the em dash. */
		blankTitle?: string;
		/** An `enum?` cell, which prints `none` unset rather than its blank, and so ghosts
		 *  `strings.optionalGhost` there. */
		optional?: boolean;
		/** Accessible name for a trigger nothing else names: an object property, whose
		 * name is the field label plus the property's. A field's own trigger takes `id`
		 * instead and is named by the `<label for>` beside it (the trigger is a
		 * `<button>`, so `for` reaches it and a label click opens the list: what the
		 * native `<select>` this replaces would have done). */
		label?: string;
		/** `<label for>` target. Set → the label names this trigger, so `aria-label`
		 * comes off: two names is where implementations disagree about which wins. */
		id?: string;
		/** The parked `description` (FieldLabel): announced after the name. */
		describedBy?: string;
		onCommit: (v: string | undefined) => void;
		/** Consumer policy: `false` marks an option unavailable, so it can't be picked.
		 * The unset sentinel is exempt: clear-to-default always works. */
		optionAllowed?: (value: string) => boolean;
		/** How a refused option draws: greyed and unpickable, or left out of the list. */
		enumDisallowed?: 'hide' | 'disable';
	}
	let {
		value,
		values,
		fallback,
		blankTitle,
		optional = false,
		label,
		id,
		describedBy,
		onCommit,
		optionAllowed,
		enumDisallowed = 'disable'
	}: Props = $props();

	// The sentinel's option value: a namespaced marker that no schema-authored
	// enum member would ever be (`values` are classification markings, seal ids, and
	// the like), so it never collides with a real option.
	const UNSET = '__qm_unset__';

	// Driven controlled (`value` + `onValueChange`, never `bind:`) so reconciliation
	// stays the package's rather than the primitive's.
	let local = $derived(value ?? UNSET);

	/** The blank has no glyph of its own: the quill's `ui.blank_title` stands in for
	 * it, else an em dash. */
	const dash = (v: string | undefined) => v || blankTitle || '—';

	const unset = $derived(local === UNSET);
	/** The ghost is a member the render prints, rather than a word for the blank or for
	 *  `none`: it draws at the default rung (theme.css). */
	const ghostsMember = $derived(!optional && !!fallback);
	const ghostText = $derived(optional ? t.strings.optionalGhost : dash(fallback));
	/** The reset row says where it goes: back to the default, or to nothing. */
	const reset = $derived(ghostsMember ? t.strings.enumReset : t.strings.enumClear);
	/** The member the list checks: the pick, or the default that prints while unset. */
	const checked = $derived(unset ? (ghostsMember ? fallback : undefined) : local);
	/** What the closed trigger shows: the pick, or the ghosted default while unset. */
	const shown = $derived(unset ? ghostText : dash(local));

	/** The root to portal into: `document.body` would escape the consumer's dials
	 * along with the editor's subtree. `undefined` falls back to bits-ui's default. */
	let wrapEl = $state<HTMLElement | undefined>(undefined);
	const portalTarget = $derived(wrapEl?.closest<HTMLElement>('[data-qm-root]') ?? undefined);
</script>

<span class="qm-select-wrap" bind:this={wrapEl}>
	<!-- `allowDeselect={false}`: the unset sentinel is the clear-to-default
	 affordance, so the primitive's own deselect must stay off. It reports a
	 deselect as `''`, the boundary's blank: a written value, where the sentinel's
	 clear is an absence. -->
	<Select.Root
		type="single"
		allowDeselect={false}
		value={local}
		onValueChange={(v) => {
			if (v == null) return;
			local = v;
			// Sentinel → unset (parent `removeField`, default renders); any real pick
			// (incl. the default value) → a genuine write.
			onCommit(v === UNSET ? undefined : v);
		}}
	>
		<Select.Trigger
			class="qm-select qm-control-box qm-focus-ring"
			{id}
			aria-label={id ? undefined : label}
			aria-describedby={describedBy}
			data-ghosted={unset ? (ghostsMember ? 'default' : '') : undefined}
		>
			<span class="qm-select-shown">{shown}</span>
			<Icon name="chevron-down" class="qm-select-chevron" />
		</Select.Trigger>
		<Select.Portal to={portalTarget}>
			<Select.Content collisionBoundary={portalTarget ?? []} sideOffset={spacePx(wrapEl)}>
				<!-- The list portals out of the trigger's DOM but into the nearest
				     `[data-qm-root]`, and carries the marker itself, like FormatPopover.
				     That root is the boundary a flip is measured against too, being the box
				     that clips the surface where the consumer scrolls one; the viewport
				     default knows nothing of that. The pill is this
				     element (not the primitive's) because scoped CSS keys off which
				     component owns the markup: a `class` passed to a primitive is a
				     plain string and never picks up the scoping hash. -->
				<div class="qm-menu-surface qm-select-content" data-qm-root>
					<Select.Viewport>
						<!-- A refused option still draws under `'disable'`, and under either
						     policy when it is the one selected: a listbox whose selected value
						     has no row shows nothing for what the document says, and offers none
						     for the primitive to mark, type-ahead to, or key onto
						     (INVARIANTS §Enums). Off `local`, not `value`: the
						     row that exists is the row the control has selected, through the
						     window where an own pick has not reconciled back. -->
						{#each values as v (v)}
							{@const allowed = optionAllowed?.(v) !== false}
							{#if allowed || enumDisallowed === 'disable' || v === local}
								<Select.Item
									class="qm-menu-item qm-select-item"
									value={v}
									label={dash(v)}
									disabled={!allowed}
									data-checked={v === checked ? '' : undefined}
								>
									<span class="qm-select-check" aria-hidden="true">
										{#if v === checked}<Icon name="check" />{/if}
									</span>
									<span class="qm-select-label">{dash(v)}</span>
									{#if ghostsMember && v === fallback}
										<span class="qm-select-tag">{t.strings.enumUnsetTag}</span>
									{/if}
								</Select.Item>
							{/if}
						{/each}
						<!-- The reset is the sentinel, offered once there is something to reset:
						     unset, the list's check already stands where a reset would land. -->
						{#if !unset}
							<div class="qm-select-divider" role="separator"></div>
							<Select.Item
								class="qm-menu-item qm-select-item qm-select-unset"
								value={UNSET}
								label={reset}
							>
								<span class="qm-select-check" aria-hidden="true"></span>
								<span class="qm-select-ghost">{reset}</span>
							</Select.Item>
						{/if}
					</Select.Viewport>
				</div>
			</Select.Content>
		</Select.Portal>
	</Select.Root>
</span>

<style>
	/* A primitive renders its own element, which a scoped selector cannot reach:
	 styled through the wrapper with `:global`. */
	/* The box is `.qm-control-box` (controls.css), carried on the primitive's own
	   element the same way `.qm-focus-ring` is; only what a trigger adds over a typed
	   value's box is here. */
	.qm-select-wrap :global(.qm-select) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--_qm-space);
		width: 100%;
		box-sizing: border-box;
		text-align: left;
		cursor: pointer;
	}
	/* The value is one line however long it runs, and the glyph beside it keeps its rung:
	   the box is an inset plus one line box (controls.css), which a value that wraps
	   stands two lines tall, and a flex glyph with nothing holding it gives its width up
	   to the text first and is gone by the time the row is tight. The pair is the same
	   guard the element summary takes over its own title, and `min-width` is the half
	   that lets the text shrink at all. */
	.qm-select-shown {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The chevron is chrome, so it takes the label rung the other chrome glyphs take: at
	   `ink` beside a written value it read as part of the value. */
	.qm-select-wrap :global(.qm-select-chevron) {
		flex-shrink: 0;
		color: var(--_qm-ink-label);
		width: var(--_qm-glyph-control);
		height: var(--_qm-glyph-control);
	}
	/* The focus ring rides `.qm-focus-ring` on the trigger (controls.css). */
	/* Shown-never-written: the closed control reads muted while unset, at the rung of
	   what it shows — the default member the render prints, or a word for the blank. */
	.qm-select-wrap :global(.qm-select[data-ghosted]) {
		color: var(--_qm-ink-label);
	}
	.qm-select-wrap :global(.qm-select[data-ghosted='default']) {
		color: var(--_qm-ink-default);
	}
	/* The open list is `.qm-menu-surface` and its rows `.qm-menu-item` (controls.css):
	 the lift, the inset and the highlight are the shared menu recipe. What a listbox
	 adds over a menu is here: it spans its trigger rather than its own content, it
	 scrolls past a screenful, and it marks the value already stored. */
	.qm-select-content {
		min-width: var(--bits-select-anchor-width);
		max-height: 16rem;
		overflow-y: auto;
	}
	/* A row is a check track, the member, and the default's tag at the end. */
	.qm-select-content :global(.qm-select-item) {
		display: flex;
		align-items: center;
		gap: var(--_qm-space);
	}
	.qm-select-check {
		flex-shrink: 0;
		display: inline-flex;
		width: var(--_qm-glyph-control);
		height: var(--_qm-glyph-control);
	}
	.qm-select-check :global(svg) {
		width: 100%;
		height: 100%;
	}
	.qm-select-label {
		flex: 1;
		min-width: 0;
	}
	.qm-select-divider {
		height: var(--_qm-border-width);
		margin: var(--_qm-space) var(--_qm-space-2);
		background: var(--_qm-border);
	}
	/* Consumer policy, for a refused option the list still draws: offered, unpickable. */
	.qm-select-content :global(.qm-select-item[data-disabled]) {
		opacity: var(--_qm-opacity-muted);
		cursor: default;
	}
	.qm-select-ghost {
		color: var(--_qm-ink-label);
	}
	/* A step down the size ramp, which is what says this is chrome and the member beside
	   it is the value. The ink is the label rung, there being none under it to take
	   (theme.css, "nothing under the last"). */
	.qm-select-tag {
		flex-shrink: 0;
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
	}
</style>
