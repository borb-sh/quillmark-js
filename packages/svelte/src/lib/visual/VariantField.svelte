<!--
 An `enum` declaring `variants:` → the discriminant's select, and under it the cells
 the chosen world brings into play (VISUAL_EDITOR §"Enum variants"). The field rests as
 a container, `{value: <member>, …that member's fields}`, and commits whole: it is one
 cell to `Addr`, so there is no per-cell write address.

 The cells are {@link ObjectField}, which already draws a leaf field set keyed by
 name over a container its parent commits by value. It takes the whole container as its
 `value` and the world's declaration as its `properties`, so what it hands back is the
 container with one cell written — and cells outside the drawn world ride through
 untouched rather than needing to be merged back. A content cell reads at the key it
 declares: the boundary's schema walk unions the worlds, so a dormant cell reads absent
 rather than raising. A cell may be a container of its own, which the subform draws at
 the next rung.
-->
<script lang="ts">
	import type { Content, PathStep, QuillFieldSchema } from '@quillmark/wasm';
	import EnumField from './EnumField.svelte';
	import ObjectField from './ObjectField.svelte';
	import DiagnosticList from './DiagnosticList.svelte';
	import type { DeepDiagnostic } from './diagnostics.js';
	import type { LandingBox } from './leaves.js';
	import {
		VARIANT_DISCRIMINANT,
		commitDiscriminant,
		variantCells,
		variantMember
	} from './structure.js';

	interface Props {
		/** The stored container, or undefined while the field is unset. */
		value: Record<string, unknown> | undefined;
		schema: QuillFieldSchema;
		/** The resolved `default:`'s member: what an unset field renders as. */
		ghostMember: string | undefined;
		/** Field label, the naming prefix the cells' controls compose with. */
		label: string;
		/** `<label for>` target: the discriminant trigger, this control's one labelable
		 * element. The cells are named by their own composed labels. */
		id?: string;
		labelledBy?: string;
		describedBy?: string;
		/** The boundary's nested content read for this field, which the cells take
		 * unprefixed: a variant's cell is one key in from the container it rests as, so
		 * a `plaintext` cell's path is its own name ({@link ObjectField}). */
		contentAt: (path: PathStep[]) => Content | undefined;
		onCommit: (v: Record<string, unknown> | undefined) => void;
		optionAllowed?: (value: string) => boolean;
		enumDisallowed?: 'hide' | 'disable';
		/** The diagnostics routed into this field, each with its steps still to walk: one
		 * naming a live cell draws under it; the rest — the discriminant's, a dormant
		 * world's — draw at the field's foot. */
		diagnostics?: readonly DeepDiagnostic[];
	}
	let {
		value,
		schema,
		ghostMember,
		label,
		id,
		labelledBy,
		describedBy,
		contentAt,
		onCommit,
		optionAllowed,
		enumDisallowed,
		diagnostics
	}: Props = $props();

	const member = $derived(variantMember(value, ghostMember));
	const cells = $derived(variantCells(schema, member));
	const discriminant = $derived(value?.[VARIANT_DISCRIMINANT] as string | undefined);

	type Subform = {
		focus: () => void;
		focusPath: (steps: readonly PathStep[], pos?: number) => LandingBox;
	};
	let cellsEl = $state<Subform | undefined>();

	/** Whether a step names a cell the live world draws. The one test the landing and
	 *  the diagnostics both read, so the cell a caret lands in is the cell a message
	 *  draws under. The discriminant is the field's own control and no world's cell. */
	function live(step: PathStep | undefined): boolean {
		return (
			typeof step === 'string' &&
			step !== VARIANT_DISCRIMINANT &&
			!!cells &&
			Object.hasOwn(cells, step)
		);
	}
	// The cells' own, and the field's: a diagnostic naming the discriminant or a world
	// that is not drawn has no cell to sit under, and the subform's foot is inside a box
	// holding the live world alone. So it draws under the field, where the control it is
	// about is.
	const inside = $derived((diagnostics ?? []).filter((d) => live(d.steps[0])));
	const foot = $derived(
		(diagnostics ?? []).filter((d) => !live(d.steps[0])).map((d) => d.diagnostic)
	);

	/** Take the caret: the discriminant's trigger, the field's own control. */
	export function focus(): void {
		if (id) document.getElementById(id)?.focus();
	}
	/** Land at `steps`: a live cell, and the rest of the walk inside it where the cell is
	 *  a container; the discriminant, a dormant world's cell and a key no world declares
	 *  land on the trigger ({@link FieldControl.focusPath}). */
	export function focusPath(steps: readonly PathStep[], pos?: number): LandingBox {
		if (live(steps[0]) && cellsEl) return cellsEl.focusPath(steps, pos);
		focus();
		return undefined;
	}
</script>

<div class="qm-variant">
	<EnumField
		value={discriminant}
		values={schema.values ?? []}
		fallback={ghostMember}
		{id}
		{describedBy}
		onCommit={(v) => onCommit(commitDiscriminant(value, v))}
		{optionAllowed}
		{enumDisallowed}
	/>
	<!-- Keyed on the member so a flip remounts the cells rather than re-targeting
	     them: two worlds' cells are different fields that happen to occupy one place,
	     and a control carrying local state (an unreconciled pick, a caret) across the
	     flip would carry it between them. -->
	{#if cells}
		{#key member}
			<ObjectField
				bind:this={cellsEl}
				value={value ?? {}}
				properties={cells}
				{label}
				idBase={id}
				{labelledBy}
				{describedBy}
				{contentAt}
				onCommit={(obj) => onCommit(obj)}
				diagnostics={inside}
			/>
		{/key}
	{/if}
	<!-- The field's own foot, drawn whether or not a world is: what the live world
	     cannot hold belongs under the field rather than inside the box its cells sit in. -->
	<DiagnosticList diagnostics={foot} />
</div>

<style>
	.qm-variant {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space-2);
	}
</style>
