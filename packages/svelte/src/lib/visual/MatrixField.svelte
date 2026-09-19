<!--
 A `matrix` field → grouped ticks over the whole vocabulary, columns unfolding under a
 held member (VISUAL_EDITOR §"The matrix is a roster someone ticks").

 The boundary hands over the roster and the columns and nothing between them: `members`
 is ordered blocks of `id: Title`, `properties` is the column set every member carries,
 and the `{held, …columns}` object each member desugars to is derived at load and never
 serialized. So this component composes it — `members` × `properties` — rather than
 reading it back.

 **A member has two rest forms and the read takes both.** Key presence is the tick unless
 the mapping spells otherwise, the variant precedent one type over: `cyber_200: true` is
 to `{held: true}` what `classification: CUI` is to `{value: CUI}`. A document through the
 transport door has been conformed through neither, so `matrixHeld` reads the stored
 payload rather than a normalized one; the write always lands the object form.

 The whole map commits by value, one `writer.set`, sparse: a member unheld with no written
 column is absent from it, and an untick writes `held: false` and keeps the columns — so
 tick, type, untick, retick loses nothing, and what the render does with an unheld member's
 retained answer is the engine's rule rather than a second copy of it here.

 An unheld member's columns are held and undrawn, the variant rule at a second type: in
 the document and not on the page.
-->
<script lang="ts">
	import type { Content, PathStep, QuillFieldSchema } from '@quillmark/wasm';
	import { wording } from './strings.js';
	import {
		MATRIX_HELD,
		matrixColumns,
		matrixCommit,
		matrixGroups,
		matrixHeld,
		matrixHeldCount,
		matrixMember,
		matrixMemberAt
	} from './structure.js';
	import { propertyDomIds } from './domid.js';
	import FieldLabel from './FieldLabel.svelte';
	import ObjectField from './ObjectField.svelte';
	import './controls.css';

	const t = wording();

	interface Props {
		/** The stored sparse map, or undefined while the field is unset. */
		value: Record<string, unknown> | undefined;
		schema: QuillFieldSchema;
		/** Field label: this control owns its label track, the count sitting in the slot an
		 * array spends on its add chip. */
		label: string;
		/** No-default column set → nothing here; a matrix is a namespace and obliges
		 * nothing of its own (`obliged`). Kept so the label row reads like every other. */
		description?: string;
		/** The label's own DOM id. A matrix is a group of N checkboxes with no single
		 * `for` target, so the label names the set and each member carries its own. */
		labelId?: string;
		descriptionId?: string;
		/** The field's control id: the base each member's three names derive from, one
		 * `-p-<member>` segment down, so a tick is a real `<label for>` pair. */
		idBase?: string;
		/** The boundary's nested content read, rooted at this field: a column's path is
		 * `[memberId, key]`, which is the same walk `properties` takes anywhere else. */
		contentAt: (path: PathStep[]) => Content | undefined;
		onCommit: (v: Record<string, unknown> | undefined) => void;
	}
	let {
		value,
		schema,
		label,
		description,
		labelId,
		descriptionId,
		idBase,
		contentAt,
		onCommit
	}: Props = $props();

	const groups = $derived(matrixGroups(schema));
	const columns = $derived(schema.properties ?? {});
	/** Zero columns is a checklist: a tick unfolds nothing, and the member is the whole
	 *  of what the roster carries. */
	const hasColumns = $derived(Object.keys(columns).length > 0);
	const held = $derived(matrixHeldCount(schema, value));
	const total = $derived(groups.reduce((n, g) => n + g.members.length, 0));

	const boxes: Record<string, HTMLInputElement | undefined> = $state({});
	const subEls: Record<
		string,
		| { focus: () => void; focusPath?: (path: PathStep[], pos?: number) => HTMLElement | undefined }
		| undefined
	> = $state({});
	const memberEls: Record<string, HTMLElement | undefined> = $state({});
	let groupsEl = $state<HTMLElement | undefined>();

	/** Every member id in display order: what an arrow key walks and what the count sums.
	 *  Flat, because the walk is per group and the lookup is not. */
	const order = $derived(groups.map((g) => g.members.map((m) => m.id)));

	function tick(id: string, on: boolean): void {
		onCommit(matrixCommit(value, id, matrixMember(on, matrixColumns(matrixMemberAt(value, id)))));
	}
	/** A column written: the member is held by having been filled in, exactly as key
	 *  presence is the tick. An emptied column has already left the object by the time
	 *  this reads it, so a member the user has cleared back to nothing and unticked drops. */
	function commitColumns(id: string, cols: Record<string, unknown>): void {
		onCommit(matrixCommit(value, id, matrixMember(matrixHeld(matrixMemberAt(value, id)), cols)));
	}

	/** Take the caret: the first member's box. An empty roster lands nothing. */
	export function focus(): void {
		for (const g of order) if (g.length) return void boxes[g[0]]?.focus();
	}
	/** The box an arrival wash blooms in (`core/bloom.ts`): the roster, not the header
	 *  above it. This control owns the field's label track, so the wrapper `Field` blooms
	 *  every other control inside would wash the label and the count here too — the rule
	 *  a repeater already holds for its own rows. */
	export function washBox(): HTMLElement | undefined {
		return groupsEl;
	}
	/**
	 * Land at `path` (`leaves.ts`): the first step is a member id, and the rest is that
	 * member's column path. A held member with a column named lands in the column; a bare
	 * member, an unheld one, or the synthesized `held` cell lands on the tick, which is
	 * the control the address names.
	 */
	export function focusPath(path: PathStep[], pos?: number): HTMLElement | undefined {
		const [id, ...rest] = path;
		if (typeof id !== 'string') return undefined;
		// An own key, never `Object.prototype`'s: the id is a string off an address, and
		// this map is a plain object, so `boxes['toString']` answers with a function.
		const box = Object.hasOwn(boxes, id) ? boxes[id] : undefined;
		if (!box) {
			focus();
			return undefined;
		}
		const sub = subEls[id];
		const column = rest.length && rest[0] !== MATRIX_HELD;
		if (column && sub) return sub.focusPath?.(rest, pos) ?? memberEls[id];
		box.focus();
		return memberEls[id];
	}

	/** Arrow keys walk the members of one group, which is the block a reader reads as a
	 *  list; Tab is untouched, so every box stays its own stop and a held member's columns
	 *  are the next ones. Clamped at either end: a group is a list, not a ring, and a wrap
	 *  would move focus past a heading the arrow never named. */
	function onMemberKey(e: KeyboardEvent, gi: number, mi: number): void {
		const step =
			e.key === 'ArrowDown' || e.key === 'ArrowRight'
				? 1
				: e.key === 'ArrowUp' || e.key === 'ArrowLeft'
					? -1
					: 0;
		if (!step || e.altKey || e.ctrlKey || e.metaKey) return;
		const next = order[gi]?.[mi + step];
		if (next === undefined) return;
		e.preventDefault();
		boxes[next]?.focus();
	}
</script>

<div
	class="qm-matrix"
	role="group"
	aria-labelledby={labelId}
	aria-describedby={description ? descriptionId : undefined}
>
	<div class="qm-matrix-header">
		<FieldLabel {label} id={labelId} {descriptionId} onActivate={focus} {description} />
		<!-- The count sits where an array's add chip sits: one piece of chrome with one
		     answer, and a roster the page prints in full has no add to offer. -->
		<span class="qm-matrix-count">{t.strings.matrixHeld(held, total)}</span>
	</div>
	<div class="qm-matrix-groups" bind:this={groupsEl}>
		<!-- Keyed on position: a roster's blocks are a static, positional list, and two
		     that share a heading are a quill the loader accepts — keying on the label
		     would take the whole surface down on a duplicate key. -->
		{#each groups as group, gi (gi)}
			<div class="qm-matrix-group">
				{#if group.label}
					<span class="qm-matrix-group-label">{group.label}</span>
				{/if}
				{#each group.members as member, mi (member.id)}
					{@const ids = idBase ? propertyDomIds(idBase, member.id) : undefined}
					{@const on = matrixHeld(matrixMemberAt(value, member.id))}
					<div class="qm-matrix-member" bind:this={memberEls[member.id]}>
						<div class="qm-matrix-tick">
							<input
								type="checkbox"
								class="qm-matrix-box qm-focus-ring qm-tap-floor"
								bind:this={boxes[member.id]}
								id={ids?.control}
								aria-label={ids ? undefined : `${label} ${member.title}`}
								checked={on}
								onchange={(e) => tick(member.id, e.currentTarget.checked)}
								onkeydown={(e) => onMemberKey(e, gi, mi)}
							/>
							<label class="qm-matrix-title" class:on id={ids?.label} for={ids?.control}
								>{member.title}</label
							>
						</div>
						<!-- A held member unfolds its columns the way a variant unfolds its cells:
						     the object subform over the field's `properties`, reading and committing
						     at this member's key. -->
						{#if on && hasColumns}
							<ObjectField
								bind:this={subEls[member.id]}
								value={matrixColumns(matrixMemberAt(value, member.id))}
								properties={columns}
								label={`${label} ${member.title}`}
								idBase={ids?.control}
								labelledBy={ids?.label}
								contentAt={(path) => contentAt([member.id, ...path])}
								onCommit={(cols) => commitColumns(member.id, cols)}
							/>
						{/if}
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.qm-matrix {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
	}
	/* The label line, and the count at the end of it: the array header's own shape, so a
	 field that owns its label track reads the same whichever control owns it. */
	.qm-matrix-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--_qm-space-2);
	}
	.qm-matrix-count {
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
		font-variant-numeric: tabular-nums;
	}
	/* Groups as columns, stepped by the container query: one column at phone width, up to
	 one per group. `auto-fit` rather than a capacity rung, because the count that matters
	 here is the schema's — a roster of four blocks wants four columns and no more, and
	 `auto-fit` collapses the tracks it does not fill. */
	.qm-matrix-groups {
		/* The box `washBox` names, so it is the box the wash resolves against:
		 `bloomInside` insets an absolute child, which takes its corners from here and
		 its edges from the nearest positioned ancestor — the field, whose box starts at
		 the label this control draws. */
		position: relative;
		border-radius: var(--_qm-radius-inner);
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--_qm-space-3);
	}
	@container (min-width: 28rem) {
		.qm-matrix-groups {
			grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		}
	}
	.qm-matrix-group {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
		min-width: 0;
	}
	/* A block heading, at the register a group's own name takes on this surface. */
	.qm-matrix-group-label {
		font-size: var(--_qm-text-label);
		font-weight: var(--_qm-weight-mid);
		color: var(--_qm-ink-label);
	}
	.qm-matrix-member {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
		min-width: 0;
		/* The box a landing on this member blooms in, positioned for the wash's inset
		   child the way every other landing box is (`core/bloom.ts`). */
		position: relative;
		border-radius: var(--_qm-radius-inner);
	}
	.qm-matrix-tick {
		display: flex;
		align-items: center;
		gap: var(--_qm-space);
		min-width: 0;
	}
	/* The platform's own box, tinted to the surface's accent: a tick is the one control
	 whose mark every platform already draws, and redrawing it would be a second glyph to
	 keep true in two themes. The tap floor is the family's, the painted box being below
	 WCAG 2.5.8's threshold on every platform that draws it small. */
	.qm-matrix-box {
		flex-shrink: 0;
		accent-color: var(--_qm-accent);
		margin: 0;
	}
	/* An unheld member reads at the label ink and a held one at the value ink: the step
	 every other unset rung on this surface takes, over a row whose words are the same
	 either way. */
	.qm-matrix-title {
		color: var(--_qm-ink-label);
		cursor: pointer;
		min-width: 0;
		transition: color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-matrix-title.on {
		color: var(--_qm-ink);
	}
</style>
