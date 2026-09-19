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
 rather than raising.
-->
<script lang="ts">
	import type { Content, PathStep, QuillFieldSchema } from '@quillmark/wasm';
	import EnumField from './EnumField.svelte';
	import ObjectField from './ObjectField.svelte';
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
		enumDisallowed
	}: Props = $props();

	const member = $derived(variantMember(value, ghostMember));
	const cells = $derived(variantCells(schema, member));
	const discriminant = $derived(value?.[VARIANT_DISCRIMINANT] as string | undefined);

	let cellsEl = $state<
		| { focus: () => void; focusPath: (path: PathStep[], pos?: number) => HTMLElement | undefined }
		| undefined
	>();
	/** Take the caret: the first cell of the live world, or the discriminant when that
	 *  world declares none — which is then the whole of the control. */
	export function focus(): void {
		if (cellsEl) return cellsEl.focus();
		document.getElementById(id ?? '')?.focus();
	}
	/**
	 * Land at `path` (`leaves.ts`): the discriminant cell is the field's own control, and
	 * every other step names a cell of the live world, which is the object subform's to
	 * walk. A cell of a world that is not drawn resolves to nothing — it is in the
	 * document and not on the page (VISUAL_EDITOR §"Enum variants") — and the landing
	 * falls back to the field.
	 */
	export function focusPath(path: PathStep[], pos?: number): HTMLElement | undefined {
		if (path[0] === VARIANT_DISCRIMINANT) {
			document.getElementById(id ?? '')?.focus();
			return undefined;
		}
		return cellsEl?.focusPath(path, pos);
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
			/>
		{/key}
	{/if}
</div>

<style>
	.qm-variant {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space-2);
	}
</style>
