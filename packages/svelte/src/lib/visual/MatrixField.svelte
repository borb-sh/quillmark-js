<!--
 A `matrix` field → grouped ticks over the roster, columns unfolding under a held
 member (VISUAL_EDITOR §"Structure mirrors the schema", canon `SCHEMAS.md` §Matrix).
 The roster's blocks are columns, as many abreast as the width holds and never more
 than there are blocks; each member is a real checkbox bound to its `held` cell with
 its title as the `<label for>`, an unheld member reading at the label ink and a held
 one at the value ink. A held member unfolds its columns beneath its title, drawn by
 {@link ObjectField} over the matrix's `properties` at the member's key, the way a
 variant unfolds its cells; zero columns is a checklist and unfolds nothing. An unheld
 member's retained columns are held but undrawn, the variant rule: in the document and
 not on the page.

 The control owns its label row, as an array does: the count of held members sits
 where an array's add chip sits, one piece of chrome with one answer, so {@link Field}
 skips its own label for it.

 Commit is whole: the sparse map, one `writer.set`. A tick writes the member object
 with an explicit `held`, an untick keeps the columns under `held: false`, and a member
 unheld with no columns leaves the map (`memberWrite`). What is blank per column is the
 engine's rule and not restated: a column control that clears drops its key, so the
 editor drops a member it has emptied rather than deciding skippability for itself.
 The read takes both rest forms — `true` and `{held, …columns}` — and the write lands
 one, on the member edited alone; every other member rides through as the document
 spelled it.
-->
<script lang="ts">
	import { tick as flush } from 'svelte';
	import { wording } from './strings.js';

	// The surface's words, ambient from the editor root; the package's English
	// off-tree, so this component renders standalone too.
	const t = wording();
	import type { Content, PathStep, QuillFieldSchema } from '@quillmark/wasm';
	import {
		MATRIX_HELD,
		commitMember,
		matrixBlocks,
		matrixColumns,
		matrixDeclares,
		matrixHeld,
		memberValue,
		memberWrite,
		type MatrixBlock
	} from './structure.js';
	import { splitDeep, unrouted, type DeepDiagnostic } from './diagnostics.js';
	import type { LandingBox } from './leaves.js';
	import { propertyDomIds } from './domid.js';
	import Icon from './icons/Icon.svelte';
	import FieldLabel from './FieldLabel.svelte';
	import ObjectField from './ObjectField.svelte';
	import DiagnosticList from './DiagnosticList.svelte';
	import './controls.css';

	interface Props {
		/** The stored sparse map, or undefined while the field is unset. */
		value: Record<string, unknown> | undefined;
		/** The field's own schema: `members` is the roster, `properties` the columns. */
		schema: QuillFieldSchema;
		/** Field label, the naming prefix a member's columns compose with. */
		label?: string;
		/** Schema `description`: the label's help affordance. */
		description?: string;
		/** The label's own DOM id: the group's name, each tick keeping its own `<label>`. */
		labelId?: string;
		/** Where the description parks, for the group's `aria-describedby`. */
		descriptionId?: string;
		/** The field's control id: the base a member's tick and columns derive their own
		 * names from, one `-m-<member id>` segment down. */
		idBase?: string;
		/** The boundary's nested content read, rooted at this field: a member's content
		 * column reads at `[id, column]` (`reader.getContentAt`). */
		contentAt: (path: PathStep[]) => Content | undefined;
		onCommit: (v: Record<string, unknown> | undefined) => void;
		/** The diagnostics routed into this field, each with its steps still to walk: one
		 * naming a member draws under that member, one naming nothing on the roster at the
		 * field's foot. */
		diagnostics?: readonly DeepDiagnostic[];
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
		onCommit,
		diagnostics
	}: Props = $props();

	const blocks = $derived(matrixBlocks(schema.members));
	const members = $derived(blocks.flatMap((b) => b.members));
	const hasColumns = $derived(Object.keys(schema.properties ?? {}).length > 0);
	const held = (id: string): boolean => matrixHeld(memberValue(value, id));
	const heldCount = $derived(members.filter((m) => held(m.id)).length);
	const routed = $derived(splitDeep(diagnostics));
	const foot = $derived(
		unrouted(routed, (step) => typeof step === 'string' && matrixDeclares(schema, step))
	);

	// A member with no field id space around it still needs an id: the tick is what its
	// title's `for` names. Stable across SSR and hydration, which a counter is not.
	const uid = $props.id();
	const memberBase = (id: string): string =>
		idBase != null ? `${idBase}-m-${id}` : `qm-${uid}-${id}`;
	/** The tick is the member's `held` cell, so its id is the one that cell's label
	 *  would take: the column subform below it derives its own names from the same base. */
	const tickId = (id: string): string => propertyDomIds(memberBase(id), MATRIX_HELD).control;

	// The member boxes, the ticks and the column subforms, keyed by member id — the
	// roster's own key, stable for the schema's life. `$state` for the binding's sake
	// (`ArrayField` keeps its element refs the same way).
	type Subform = {
		focus: () => void;
		focusPath: (steps: readonly PathStep[], pos?: number) => LandingBox;
	};
	const memberEls: Record<string, HTMLElement | undefined> = $state({});
	const tickEls: Record<string, HTMLInputElement | undefined> = $state({});
	const colEls: Record<string, Subform | undefined> = $state({});
	let blocksEl = $state<HTMLElement | undefined>();

	/** A native checkbox carries its own state, so a commit the document declines leaves
	 *  the face ticked over a map that says otherwise, `checked={held(id)}` having nothing
	 *  new to write. The reassert after the flush is what the styled controls get from
	 *  their synced local (`synced.svelte.ts`): the document is what the face reads. */
	async function tick(id: string, on: boolean, el: HTMLInputElement): Promise<void> {
		onCommit(commitMember(value, id, memberWrite(on, matrixColumns(memberValue(value, id)))));
		await flush();
		if (el.isConnected) el.checked = held(id);
	}
	/** A column edit lands on a held member: the subform draws under a tick alone. */
	function commitColumns(id: string, columns: Record<string, unknown>): void {
		onCommit(commitMember(value, id, memberWrite(true, columns)));
	}
	/** Arrow keys walk the members of one block, the way a listbox walks its options;
	 *  Space toggles, being the checkbox's own. */
	function onTickKey(e: KeyboardEvent, block: MatrixBlock, id: string): void {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		const ids = block.members.map((m) => m.id);
		const next = ids.indexOf(id) + (e.key === 'ArrowDown' ? 1 : -1);
		if (next < 0 || next >= ids.length) return;
		e.preventDefault();
		tickEls[ids[next]]?.focus();
	}

	/** Take the caret: the first member's tick. Reached by a label click and by the
	 *  editor's landing verbs, which ask one function so they cannot disagree. */
	export function focus(): void {
		const first = members[0];
		if (first) tickEls[first.id]?.focus();
	}
	/** The box an arrival wash blooms in: the roster, not the label row above it, this
	 *  component owning the field's label as an array does. */
	export function washBox(): HTMLElement | undefined {
		return blocksEl;
	}
	/**
	 * Land at `steps`: a member, or a column under it ({@link FieldControl.focusPath}).
	 * A member address and its `held` cell focus the tick; a column address focuses
	 * that column where the member is held and its columns are drawn, and the tick
	 * where they are not — the address names the column, and what is drawn for it is
	 * the tick that would open it. One rule keyed on the address, never on the
	 * document, so one address lands in one place. A member off the roster falls back
	 * to {@link focus}. The member's box comes back: it is the row the address named.
	 */
	export function focusPath(steps: readonly PathStep[], pos?: number): LandingBox {
		const [id, ...rest] = steps;
		if (typeof id !== 'string' || !matrixDeclares(schema, id)) {
			focus();
			return undefined;
		}
		const column = rest[0];
		const cells = colEls[id];
		if (column !== undefined && column !== MATRIX_HELD && cells) void cells.focusPath(rest, pos);
		else tickEls[id]?.focus();
		return memberEls[id];
	}
</script>

<div
	class="qm-matrix"
	role="group"
	aria-labelledby={label != null ? labelId : undefined}
	aria-describedby={description ? descriptionId : undefined}
>
	<div class="qm-matrix-header">
		{#if label != null}
			<FieldLabel {label} id={labelId} {descriptionId} onActivate={focus} {description} />
		{:else}
			<span></span>
		{/if}
		<span class="qm-matrix-count">{t.strings.matrixHeld(heldCount, members.length)}</span>
	</div>
	<div class="qm-matrix-blocks" bind:this={blocksEl}>
		{#each blocks as block, b (b)}
			<div class="qm-matrix-block" role="group" aria-label={block.group}>
				<!-- Drawn for an ungrouped block too, empty: the blocks stand abreast, and a
				     member with no title over it would float at the line its neighbours'
				     titles hold. -->
				<span class="qm-matrix-group">{block.group ?? ''}</span>
				{#each block.members as m (m.id)}
					{@const on = held(m.id)}
					{@const deep = routed.below.get(m.id)}
					<div class="qm-member" class:held={on} bind:this={memberEls[m.id]}>
						<div class="qm-member-head">
							<!-- A real checkbox with its face drawn here: the UA's face is shadow DOM no
							     dial reaches, so the input is `appearance: none` and the box and the
							     mark beside it read the rungs. The mark is the surface's one check
							     glyph, shown by the input's own state. -->
							<span class="qm-tick">
								<input
									type="checkbox"
									class="qm-tick-input qm-focus-ring"
									id={tickId(m.id)}
									checked={on}
									bind:this={tickEls[m.id]}
									onchange={(e) => tick(m.id, e.currentTarget.checked, e.currentTarget)}
									onkeydown={(e) => onTickKey(e, block, m.id)}
								/>
								<Icon name="check" class="qm-tick-mark" />
							</span>
							<label class="qm-member-title" for={tickId(m.id)}>{m.title}</label>
						</div>
						{#if on && hasColumns}
							<!-- The columns, one rung in, the way a variant's cells unfold under the
							     discriminant. Keyed by member id above, so a tick elsewhere leaves this
							     subform mounted and the caret in it. -->
							<ObjectField
								bind:this={colEls[m.id]}
								value={matrixColumns(memberValue(value, m.id))}
								properties={schema.properties}
								label={`${label ?? ''} ${m.title}`.trim()}
								idBase={memberBase(m.id)}
								contentAt={(path) => contentAt([m.id, ...path])}
								onCommit={(columns) => commitColumns(m.id, columns)}
								diagnostics={deep}
							/>
						{:else}
							<DiagnosticList diagnostics={deep?.map((d) => d.diagnostic)} />
						{/if}
					</div>
				{/each}
			</div>
		{/each}
	</div>
	<DiagnosticList diagnostics={foot} />
</div>

<style>
	.qm-matrix {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
	}
	/* The label row, the array's own shape: this component owns the label track
	 (`Field.svelte`), and the count stands where the add chip would. */
	.qm-matrix-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--_qm-space-2);
	}
	/* The count reads at the label rung: a fact about the field, never a value. */
	.qm-matrix-count {
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
		font-variant-numeric: tabular-nums;
	}
	/* The blocks abreast: as many columns as the width holds at the track floor and never
	 more than there are blocks, `auto-fit` collapsing the tracks it has no block for.
	 Nothing measures, and a block's members stack inside their column at every count.
	 Positioned for the wash's inset child (`washBox`), and rounded to the rung a row's
	 box draws, as an array's rows are. */
	.qm-matrix-blocks {
		position: relative;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(var(--_qm-track-min), 1fr));
		column-gap: var(--_qm-space-3);
		row-gap: var(--_qm-space-3);
		border-radius: var(--_qm-radius-inner);
	}
	.qm-matrix-block {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
		min-width: 0;
	}
	/* A block's name, at the label rung: it names a set the way a field label names a
	 control, and ranks under the field's label by position alone. */
	.qm-matrix-group {
		font-size: var(--_qm-text-label);
		font-weight: var(--_qm-weight-mid);
		line-height: var(--_qm-leading-tight);
		min-height: 1lh;
		color: var(--_qm-ink-label);
	}
	/* A member is a row: positioned for the wash a landing on it blooms, rounded to the
	 rung the rows around it draw. */
	.qm-member {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
		border-radius: var(--_qm-radius-inner);
	}
	/* The tick and its title on one line, the line holding the tap floor a tick alone
	 would not reach: the title is the target, the `for` carrying its press to the input. */
	.qm-member-head {
		display: flex;
		align-items: center;
		gap: var(--_qm-space-2);
		min-height: var(--_qm-tap-min);
	}
	.qm-tick {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
		width: var(--_qm-glyph-control);
		height: var(--_qm-glyph-control);
	}
	/* The box: a well, edged, since a mark this small has no plane under it to step off
	 by tone alone; held, it takes the accent the switch's track takes when checked. */
	.qm-tick-input {
		appearance: none;
		margin: 0;
		width: 100%;
		height: 100%;
		border: var(--_qm-border-width) solid var(--_qm-border);
		border-radius: calc(var(--_qm-radius-inner) / 2);
		background: var(--_qm-surface-well);
		cursor: pointer;
		transition:
			background-color var(--_qm-duration-fast) var(--_qm-ease-reverse),
			border-color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-tick-input:checked {
		background: var(--_qm-accent);
		border-color: var(--_qm-accent);
	}
	/* The mark rides over the input and takes no press of its own; it is drawn by the
	 input's state, in the ink the surface reads over the accent. */
	.qm-tick :global(.qm-tick-mark) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		color: var(--_qm-surface);
		opacity: 0;
		transition: opacity var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-tick:has(:checked) :global(.qm-tick-mark) {
		opacity: 1;
	}
	/* Unheld reads at the label ink, held at the value ink: the title is what the
	 document says once it is ticked, and until then it is the vocabulary. */
	.qm-member-title {
		font-size: var(--_qm-text-body);
		line-height: var(--_qm-leading-tight);
		color: var(--_qm-ink-label);
		cursor: pointer;
		min-width: 0;
		transition: color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-member.held .qm-member-title,
	.qm-member-title:hover {
		color: var(--_qm-ink);
	}
</style>
