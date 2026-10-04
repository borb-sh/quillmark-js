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

 Two non-gating label decorations:
 • a persistent required `*` for a field the schema obliges — one that declares no
 `default:` (DOCUMENT_MODEL). Its
 accessible name is "required", so a screen reader announces the word, not the
 glyph; inside the `<label>`, so it names the control along with the text
 ("Subject required") rather than announcing as a node adjacent to it;

 • the `description` as an info marker raising a themed popover
 ({@link FieldHint}).

 The description describes, it does not name. It is parked in an always-present
 visually-hidden node here and the control carries `aria-describedby`: name then
 role then description, which is the announcement the markup visually implies. In
 the name it would instead prepend ~110 characters of guidance (the reference
 quill's median) to every field's label on every focus. Parked rather than read off
 the popover because the popover exists only while open, and a dangling
 `aria-describedby` describes nothing.

 Shared by {@link Field} (scalars, object, prose) and {@link ArrayField} so every
 control's label decorates the same way.
-->
<script lang="ts">
	import { wording } from './strings.js';

	// The surface's words, ambient from the editor root; the package's English
	// off-tree, so this component renders standalone too.
	const t = wording();
	import FieldHint from './FieldHint.svelte';

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
		/** No-default field → a persistent required `*`. */
		required?: boolean;
		/** Schema `description`, or undefined: the affordance renders only when set. */
		description?: string;
	}
	let { label, controlId, id, descriptionId, onActivate, required, description }: Props = $props();
</script>

<div class="qm-field-label-row">
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
		{#if required}
			<span class="qm-field-required" aria-label={t.strings.fieldRequired}>*</span>
		{/if}
	</label>
	{#if description}
		<!-- Outside the `<label>`, both of them: a trigger inside it would put its own
		 name in the control's, and the parked copy would put all ~110 characters
		 there. A `<button>` in a label is at least safe from the other hazard:
		 the spec makes a label's activation behaviour do nothing for a click
		 targeted at interactive content inside it; but the naming is reason
		 enough to keep both out. -->
		<FieldHint {description} {label} describedBy={descriptionId} />
		<span class="qm-visually-hidden" id={descriptionId}>{description}</span>
	{/if}
</div>

<style>
	/* The row, not the label, is the field's grid child: `Field`'s subgrid counts
	 two tracks and the hint sits beside the label rather than under it.

	 A rung wider than the label's own gap below, so the two separations rank: the
	 required glyph is part of the name and sits at the tighter one, the guidance
	 marker is a second affordance beside it. The marker's box is its glyph
	 (`FieldHint`), so this gap is the whole of what stands between them. */
	.qm-field-label-row {
		display: flex;
		align-items: center;
		gap: var(--_qm-space);
		min-width: 0;
	}
	.qm-field-label {
		display: inline-flex;
		align-items: center;
		gap: var(--_qm-space-half);
		font-size: var(--_qm-text-label);
		font-weight: var(--_qm-weight-mid);
		line-height: var(--_qm-leading-tight);
		color: var(--_qm-ink-label);
		min-width: 0;
	}
	/* A label that lands focus says so. Only when it has somewhere to land: an
	   `ObjectField` property's label names a subform, not one control. */
	.qm-field-label.targeted {
		cursor: pointer;
	}
	/* Required marker: a quiet accent glyph, not an alarm; required-ness is guidance,
	 the document still edits and renders unmet. */
	.qm-field-required {
		display: inline-flex;
		align-items: center;
		color: var(--_qm-danger);
		line-height: 1;
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
