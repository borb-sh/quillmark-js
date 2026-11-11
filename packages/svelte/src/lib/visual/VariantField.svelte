<!--
 An `enum` declaring `variants:` → the discriminant's select, and under it the cells
 the chosen world brings into play (INVARIANTS §Enums). The field rests as
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
	import ReviewRows from './ReviewRows.svelte';
	import type { DeepDiagnostic } from './diagnostics.js';
	import { shownValue, splitReview, type DeepReview } from './review.js';
	import { review as reviewState } from './review.svelte.js';
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
		 * a `text` cell's path is its own name ({@link ObjectField}). */
		contentAt: (path: PathStep[]) => Content | undefined;
		onCommit: (v: Record<string, unknown> | undefined) => void;
		optionAllowed?: (value: string) => boolean;
		enumDisallowed?: 'hide' | 'disable';
		/** The diagnostics routed into this field, each with its steps still to walk: one
		 * naming a live cell draws under it; the rest — the discriminant's, a dormant
		 * world's — draw at the field's foot. */
		diagnostics?: readonly DeepDiagnostic[];
		/** The review items naming a place inside this field, each with its steps still to
		 *  walk: the discriminant's drawn on its select, a live cell's in that cell, and the
		 *  rest at the field's foot. */
		review?: readonly DeepReview[];
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
		diagnostics,
		review
	}: Props = $props();

	const reviewing = reviewState();
	const reviewed = $derived(splitReview(review));
	/** The discriminant's own proposal: the select shows the member it would pick, and the
	 *  cells of that member's world. */
	const pick = $derived(reviewed.below.get(VARIANT_DISCRIMINANT)?.find((e) => !e.steps.length));
	const discriminant = $derived(
		shownValue(pick?.item, value?.[VARIANT_DISCRIMINANT]) as string | undefined
	);
	const member = $derived(
		variantMember(pick ? { ...value, [VARIANT_DISCRIMINANT]: discriminant } : value, ghostMember)
	);
	const cells = $derived(variantCells(schema, member));
	/** The cells' items, by the live world's keys; the rest stand at the foot. */
	const cellReview = $derived(
		[...reviewed.below]
			.filter(([step]) => live(step))
			.flatMap(([step, list]) => list.map((e) => ({ steps: [step, ...e.steps], item: e.item })))
	);
	const reviewFoot = $derived([
		...reviewed.here,
		...[...reviewed.below]
			.filter(([step]) => !live(step) && step !== VARIANT_DISCRIMINANT)
			.flatMap(([step, list]) => list.map((e) => ({ steps: [step, ...e.steps], item: e.item })))
	]);
	/** A pick under the discriminant's proposal answers it: its member accepts, any other is
	 *  written and dismisses it. */
	function commitPick(v: string | undefined): void {
		const next = commitDiscriminant(value, v);
		if (pick && reviewing.answerWith(pick.item.id, next?.[VARIANT_DISCRIMINANT])) return;
		onCommit(next);
	}

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
		blankTitle={schema.ui?.blank_title}
		{id}
		{describedBy}
		onCommit={commitPick}
		proposing={!!pick}
		{optionAllowed}
		{enumDisallowed}
	/>
	<ReviewRows entries={reviewed.below.get(VARIANT_DISCRIMINANT)} />
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
				review={cellReview}
			/>
		{/key}
	{/if}
	<!-- The field's own foot, drawn whether or not a world is: what the live world
	     cannot hold belongs under the field rather than inside the box its cells sit in. -->
	<DiagnosticList diagnostics={foot} />
	<ReviewRows entries={reviewFoot} />
</div>

<style>
	/* The distance from the discriminant to the cells it unfolds is the one an array row
	 and a matrix member keep from what they unfold. */
	.qm-variant {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
	}
</style>
