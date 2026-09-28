<!--
  A door rather than an axis: picking a template lands its document, and the control
  returns to its prompt, the document being the reader's from then on. Drawn only over a
  served manifest with something in it.
-->
<script lang="ts">
	import type { Template } from './templates';

	interface Props {
		templates: Template[];
		/** Inert while an open is in flight: a pick mid-open would race it. */
		disabled: boolean;
		onOpen: (template: Template) => void;
	}

	let { templates, disabled, onOpen }: Props = $props();

	function choose(select: HTMLSelectElement): void {
		const template = templates[Number(select.value)];
		select.value = '';
		if (template) onOpen(template);
	}
</script>

<select
	class="qm-control"
	data-testid="pick-template"
	aria-label="Open a template"
	{disabled}
	value=""
	onchange={(e) => choose(e.currentTarget)}
>
	<option value="" disabled>Templates…</option>
	{#each templates as template, i (i)}
		<option value={String(i)} title={template.description}>{template.name}</option>
	{/each}
</select>
