<!--
 Inline diagnostic display (VISUAL_EDITOR §Diagnostics). Errors only, non-gating:
 purely additive, never disables the field it sits under. Shared by `Field.svelte`
 (a scalar/prose field) and `Card.svelte` (the body leaf, which has no
 `Field.svelte` wrapper), so a card's body diagnostics render the same way a
 field's do.
-->
<script lang="ts">
	import type { Diagnostic } from '@quillmark/wasm';
	import { diagnosticText, wording } from './strings.js';

	// The consumer's formatter, ambient from the editor root. The fallback to
	// `d.message` is load-bearing rather than defensive: the parse and render lanes
	// carry their parameters only inside that English string, so a formatter that
	// routes on `code` has nothing to build from and says so by returning
	// `undefined` (FormatDiagnostic). That text is the whole rendering: no `hint`
	// beside it, which would ship a two-language diagnostic.
	const t = wording();

	interface Props {
		diagnostics: Diagnostic[] | undefined;
	}
	let { diagnostics }: Props = $props();

	const CONTROLS =
		'[contenteditable="true"], input, button.qm-select, [role="switch"], [role="checkbox"], [role="spinbutton"]';

	/** Under a field's or a property's own control, the list marks that control
	 *  `aria-invalid` for as long as it stands, so the state reaches assistive tech with
	 *  the ring the stack draws (controls.css). */
	function markInvalid(node: HTMLElement) {
		const stack = node.parentElement;
		if (!stack?.matches('.qm-field-stack, .qm-prop-stack')) return;
		const marked = [...stack.querySelectorAll<HTMLElement>(CONTROLS)];
		for (const el of marked) el.setAttribute('aria-invalid', 'true');
		return () => {
			for (const el of marked) el.removeAttribute('aria-invalid');
		};
	}
</script>

{#if diagnostics && diagnostics.length}
	<!-- role=status: commit errors appear mid-typing; announce without stealing focus. -->
	<div class="qm-diag-list" role="status" {@attach markInvalid}>
		{#each diagnostics as d, i (i)}
			<span class="qm-diag-line">{diagnosticText(d, t.formatDiagnostic, t.strings)}</span>
		{/each}
	</div>
{/if}

<style>
	.qm-diag-list {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space-half);
	}
	.qm-diag-line {
		font-size: var(--_qm-text-label);
		color: var(--_qm-danger);
	}
</style>
