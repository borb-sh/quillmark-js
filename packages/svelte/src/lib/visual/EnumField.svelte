<!--
 A `type: enum` field → a styled listbox over its `values`, on bits-ui. When
 nothing is authored the list shows a distinct unset
 sentinel that ghosts the `default:` (muted, shown-never-written), distinguishable
 from an authored pick and re-selectable; so re-picking the default fires a
 change. The sentinel commits nothing; any real pick: including the
 value that equals the default: commits via the parent's typed `writer.set`.
 Explicitly picking the default is the one place "commit the default" is genuine
 intent, expressible. The sentinel stays in the list once a value is authored, as
 the "clear back to default" (unset) affordance.

 Styled rather than a native `<select>`: the dropdown list is UA-owned and reaches
 no dial. Listbox semantics and typeahead come with the primitive.
-->
<script lang="ts">
	import { Select } from 'bits-ui';
	import Icon from './icons/Icon.svelte';
	import { syncedLocal } from './synced.svelte.js';
	import { wording } from './strings.js';
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

	// Local selection synced to `value` (sentinel when unauthored); own-picks stay
	// local, only an external change reconciles back in (see `syncedLocal`). Driven
	// controlled (`value` + `onValueChange`, never `bind:`) so reconciliation stays
	// the package's rather than the primitive's.
	const local = syncedLocal(() => value ?? UNSET);

	/** The blank has no glyph of its own: the quill's `ui.blank_title` stands in for
	 * it, else an em dash. */
	const dash = (v: string | undefined) => v || blankTitle || '—';

	const unset = $derived(local.value === UNSET);
	const ghostText = $derived(optional ? t.strings.optionalGhost : dash(fallback));
	/** What the closed trigger shows: the pick, or the ghosted default while unset. */
	const shown = $derived(unset ? ghostText : dash(local.value));

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
		value={local.value}
		onValueChange={(v) => {
			if (v == null) return;
			local.value = v;
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
			data-ghosted={unset ? '' : undefined}
		>
			<span class="qm-select-shown">{shown}</span>
			<Icon name="chevron-down" class="qm-select-chevron" size={14} />
		</Select.Trigger>
		<Select.Portal to={portalTarget}>
			<Select.Content collisionBoundary={portalTarget ?? []} sideOffset={4}>
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
						<!-- The sentinel renders the `default:`'s own text, so a defaulted enum
						     lists that word twice: this row, and the member below it. The tag has
						     to be a word rather than a tone — the ghost is already `ink-label`,
						     and while the field is unset this is the selected row, so the weight
						     step pulls the other way. It rides the accessible name for the same
						     reason. -->
						<Select.Item
							class="qm-menu-item qm-select-item qm-select-unset"
							value={UNSET}
							label={`${ghostText} ${t.strings.enumUnsetTag}`}
						>
							<span class="qm-select-ghost">{ghostText}</span>
							<span class="qm-select-tag">{t.strings.enumUnsetTag}</span>
						</Select.Item>
						<!-- A refused option still draws under `'disable'`, and under either
						     policy when it is the one selected: a listbox whose selected value
						     has no row shows nothing for what the document says, and offers none
						     for the primitive to mark, type-ahead to, or key onto
						     (VISUAL_EDITOR §"Enum policy"). Off `local.value`, not `value`: the
						     row that exists is the row the control has selected, through the
						     window where an own pick has not reconciled back. -->
						{#each values as v (v)}
							{@const allowed = optionAllowed?.(v) !== false}
							{#if allowed || enumDisallowed === 'disable' || v === local.value}
								<Select.Item
									class="qm-menu-item qm-select-item"
									value={v}
									label={dash(v)}
									disabled={!allowed}
								>
									{dash(v)}
								</Select.Item>
							{/if}
						{/each}
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
	.qm-select-wrap :global(.qm-select-chevron) {
		flex-shrink: 0;
	}
	/* The focus ring rides `.qm-focus-ring` on the trigger (controls.css). */
	/* Shown-never-written: the closed control reads muted while unset, matching the
	   ghosted placeholder the text/number controls show. */
	.qm-select-wrap :global(.qm-select[data-ghosted]) {
		color: var(--_qm-ink-label);
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
	.qm-select-content :global(.qm-select-item[data-selected]) {
		font-weight: var(--_qm-weight-strong);
	}
	/* Consumer policy, for a refused option the list still draws: offered, unpickable. */
	.qm-select-content :global(.qm-select-item[data-disabled]) {
		opacity: var(--_qm-opacity-muted);
		cursor: default;
	}
	.qm-select-ghost {
		color: var(--_qm-ink-label);
	}
	/* The sentinel's row: the ghost at one end, the tag at the other, so the pair reads
	   as a value and a note about it rather than as two words. Only this row takes the
	   split; a member's row is one string and has nothing to distribute. */
	.qm-select-content :global(.qm-select-unset) {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--_qm-space-2);
	}
	/* A step down the size ramp, which is what says this is chrome and the word beside
	   it is the value. The ink is the ghost's own: a second tone here would rank the
	   tag against the thing it annotates, and there is no rung under `label` to take
	   (theme.css, "Two rungs, and there is no third"). */
	.qm-select-tag {
		flex-shrink: 0;
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
	}
</style>
