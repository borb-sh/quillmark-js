<!--
 A field's label plus its guidance chrome.

 It names the control. A real `<label>`, so a click lands the caret in the field:
 the widest, easiest target in a dense row, and the most conventional affordance a
 form has. `for` reaches a labelable control (the inputs, the enum trigger, the
 switch) and the browser does the rest; a control `for` cannot reach (the prose
 leaf's `contenteditable`, the date field's segments, an array's N inputs) leaves
 `controlId` unset, points `aria-labelledby` back at this label's own `id`, and
 hands the click to `onActivate`. Both halves are needed: `for` on a non-labelable
 element is inert and invalid.

 One non-gating label decoration: the `description`. A short one (`isBrief`) stands in
 flow under the label, the row's second line, and is itself the node that describes the
 control. A longer one is an info marker raising a themed popover ({@link FieldHint}).

 The row's end says where the field stands against its `default:` (INVARIANTS §"The
 commitment ladder"). While the default is what prints, a tag says so in words, and the
 control is described by it. Once the field is written over a default, the same place
 holds the way back: one button for every control, arriving with the field's hover or
 focus as the guidance marker does, and named for its field.

 The description describes, it does not name. Behind a marker it is parked in an
 always-present visually-hidden node here and the control carries `aria-describedby`: name then
 role then description, which is the announcement the markup visually implies. In
 the name it would instead prepend ~110 characters of guidance (the reference
 quill's median) to every field's label on every focus. Parked rather than read off
 the popover because the popover exists only while open, and a dangling
 `aria-describedby` describes nothing.

 Shared by {@link Field} (scalars, object, prose) and {@link ArrayField} so every
 control's label decorates the same way.
-->
<script lang="ts">
	import FieldHint from './FieldHint.svelte';
	import { guidanceText, isBrief, renderGuidance } from './guidance.js';
	import { wording } from './strings.js';
	import './controls.css';

	const t = wording();

	interface Props {
		label: string;
		/** The labelable control this names: a `for` target. Unset for a control
		 * `for` cannot reach, which takes `id` + `onActivate` instead. */
		controlId?: string;
		/** This label's own id: what such a control's `aria-labelledby` points at. */
		id?: string;
		/** Where the description parks for the control's `aria-describedby`. */
		descriptionId?: string;
		/** Focus handoff for a control `for` cannot reach; a label click calls it. */
		onActivate?: () => void;
		/** Schema `description`, or undefined: the affordance renders only when set. */
		description?: string;
		/** A short description stands under the label ({@link isBrief}). Off where the
		 *  row has no second line to give, a table column's head. */
		brief?: boolean;
		/** A capped field's character count, drawn at the row's end. */
		count?: string;
		/** The count's own id, for the control's `aria-describedby`. */
		countId?: string;
		/** The field is unset and its `default:` is what prints. */
		defaulted?: boolean;
		/** The default tag's own id, for the control's `aria-describedby`. */
		defaultId?: string;
		/** Unset the field, where it is written over a `default:` that prints. */
		onReset?: () => void;
	}
	let {
		label,
		controlId,
		id,
		descriptionId,
		onActivate,
		description,
		brief = true,
		count,
		countId,
		defaulted = false,
		defaultId,
		onReset
	}: Props = $props();

	const resetId = $props.id();
	const inFlow = $derived(brief && description != null && isBrief(description));
	/** The description is DOM, not text (`renderGuidance`), so it is written in. */
	function paint(line: HTMLElement): void {
		line.replaceChildren(renderGuidance(description ?? ''));
	}
</script>

<div class={['qm-field-label-row', { briefed: inFlow }]}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
	<!-- The handler stands in for exactly what `for` would have done, on the controls
	     where `for` is inert. It adds no keyboard surface because it needs none: a
	     label is not a tab stop, and the control it hands focus to is already the
	     keyboard's own way in. -->
	<label
		class={['qm-field-label', { targeted: controlId != null || onActivate != null }]}
		{id}
		for={controlId}
		onclick={onActivate}
	>
		<span>{label}</span>
	</label>
	{#if inFlow}
		<!-- The node that describes the control is the line a reader sees. -->
		<div class="qm-field-brief" id={descriptionId} {@attach paint}></div>
	{:else if description}
		<!-- Outside the `<label>`, both of them: a trigger inside it would put its own
		 name in the control's, and the parked copy would put all ~110 characters
		 there. A `<button>` in a label is at least safe from the other hazard:
		 the spec makes a label's activation behaviour do nothing for a click
		 targeted at interactive content inside it; but the naming is reason
		 enough to keep both out. -->
		<FieldHint {description} {label} describedBy={descriptionId} />
		<span class="qm-visually-hidden" id={descriptionId}>{guidanceText(description)}</span>
	{/if}
	{#if defaulted}
		<span class="qm-field-default" id={defaultId}>{t.strings.fieldDefault}</span>
	{:else if onReset}
		<!-- Named by its own word and then the field's: `Reset Font size`. -->
		<button
			type="button"
			class="qm-field-reset qm-tap-floor qm-focus-ring"
			id={resetId}
			aria-labelledby={id ? `${resetId} ${id}` : undefined}
			onclick={onReset}>{t.strings.fieldReset}</button
		>
	{/if}
	{#if count != null}
		<span class="qm-field-count" id={countId}>{count}</span>
	{/if}
</div>

<style>
	/* The row, not the label, is the field's grid child: `Field`'s subgrid counts
	 two tracks and the hint sits beside the label rather than under it.

	 The marker's box is its glyph (`FieldHint`), so this gap is the whole of what
	 stands between it and the label. */
	.qm-field-label-row {
		display: flex;
		align-items: center;
		gap: var(--_qm-space);
		min-width: 0;
	}
	.qm-field-label {
		display: inline-flex;
		align-items: center;
		font-size: var(--_qm-text-label);
		font-weight: var(--_qm-weight-mid);
		line-height: var(--_qm-leading-tight);
		color: var(--_qm-ink-label);
		min-width: 0;
	}
	/* A short description, in flow: the row's own second line, so the field's grid still
	 counts one label track and a row-sharing neighbour's control starts level. Last
	 whatever stands at the first line's end. One weight under the label, which names
	 where this only describes. */
	.qm-field-label-row.briefed {
		flex-wrap: wrap;
		row-gap: 0;
	}
	.qm-field-brief {
		order: 1;
		flex: 0 0 100%;
		min-width: 0;
		font-size: var(--_qm-text-label);
		line-height: var(--_qm-leading-body);
		color: var(--_qm-ink-label);
	}
	.qm-field-brief :global(p) {
		margin: 0;
	}
	.qm-field-brief :global(code) {
		font-family: var(--_qm-font-mono);
		font-size: inherit;
	}
	.qm-field-count {
		margin-inline-start: auto;
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
		font-variant-numeric: tabular-nums;
	}
	/* The row's end, the count's side, and ahead of a count where both stand. Words at the
	   label rung and a step under the label's weight, which names the field where this
	   only qualifies it. */
	.qm-field-default,
	.qm-field-reset {
		flex: none;
		margin-inline-start: auto;
		font-size: var(--_qm-text-label);
		line-height: var(--_qm-leading-tight);
		color: var(--_qm-ink-label);
	}
	:is(.qm-field-default, .qm-field-reset) + .qm-field-count {
		margin-inline-start: 0;
	}
	/* Unboxed, as a link in a line is: the row is a line of text, and a chip's floor
	   would stand taller than it (`.qm-tap-floor` carries the target). At rest it is
	   absent, as the guidance marker is and for its reason: a card written over its
	   defaults would otherwise stand the word beside every label. The field that owns
	   the row brings it up (`Field.svelte`). */
	.qm-field-reset {
		padding: 0;
		border: 0;
		border-radius: var(--_qm-radius-inner);
		background: none;
		font-family: inherit;
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-field-reset:focus-visible {
		opacity: 1;
	}
	.qm-field-reset:hover {
		color: var(--_qm-ink);
		text-decoration: underline;
	}
	@media (hover: none) {
		.qm-field-reset {
			opacity: 1;
		}
	}
	/* A label that lands focus says so. Only when it has somewhere to land: an
	   `ObjectField` property's label names a subform, not one control. */
	.qm-field-label.targeted {
		cursor: pointer;
	}
</style>
