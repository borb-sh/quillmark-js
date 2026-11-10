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
		countId
	}: Props = $props();

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
	/* A label that lands focus says so. Only when it has somewhere to land: an
	   `ObjectField` property's label names a subform, not one control. */
	.qm-field-label.targeted {
		cursor: pointer;
	}
	/* The parked description: in the accessibility tree, out of the layout, and never
	 a focus stop. Clipped rather than `display: none` / `hidden`, which take a node
	 out of the tree entirely and would make the `aria-describedby` dangle. Out of
	 flow, so the classic recipe's `margin: -1px` has nothing left to counteract:
	 and it would mint a literal off every rung. */
	.qm-visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
