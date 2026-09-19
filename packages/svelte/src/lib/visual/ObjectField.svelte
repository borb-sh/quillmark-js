<!--
 An `object` field → a nested subform over `properties` (declaration order),
 committing the whole object by value on any nested change. A scalar property draws its
 own control, a content property mounts the by-value prose leaf ({@link ProseValue}) over
 the boundary's nested read, and a nested `array` / `object` / `matrix` property mounts
 that container, which mounts this component again where its own items are objects.

 Depth is bounded by what is open, not by the schema: a repeater inside an open row is
 collapsed rows again, one open at a time, so an open tour under an open vector is one
 figure at two rungs of `--_qm-nest`.

 The nesting is a vertical at `--_qm-border`, the ladder's last stroke: the card's edge,
 an open section's vertical one `--_qm-nest` in where the field is in one, this one a rung
 further, the properties a rung inside it (ARCHITECTURE §"A plane is a tone").

 One figure wherever it mounts: a variant's cells under their discriminant and an array
 element's properties under its summary row sit at the depth a field-level subform sits
 at, and the box above them states position rather than depth.

 A property's ghosted `default:` is the static schema `sub.default`, not the
 resolved provenance the top-level ghosts read (FIELD_PROVENANCE): `resolve`
 carries no per-property row (an object field resolves as one row whose value is
 the whole object).

 Every caller hands down `contentAt`, which is `reader.getContentAt` with the field
 already bound: a field-level subform passes the property key through untouched, a
 variant passes its cell's, and an array's open row prefixes its index. So a cell
 reads at whatever depth it sits, which nothing here knows.
-->
<script lang="ts">
	import type { Content, PathStep, QuillFieldSchema } from '@quillmark/wasm';
	import { emptyContent } from '../core/codec/index.js';
	import { controlKind, obliged, propertyGrows, propertyLabel } from './structure.js';
	import { propertyDomIds } from './domid.js';
	import FieldLabel from './FieldLabel.svelte';
	import TextField from './TextField.svelte';
	import EnumField from './EnumField.svelte';
	import NumberField from './NumberField.svelte';
	import BooleanField from './BooleanField.svelte';
	import DateField from './DateField.svelte';
	import ProseValue from './ProseValue.svelte';
	import ArrayField from './ArrayField.svelte';
	import MatrixField from './MatrixField.svelte';
	import Self from './ObjectField.svelte';
	import './controls.css';

	interface Props {
		value: Record<string, unknown> | undefined;
		properties: Record<string, QuillFieldSchema> | undefined;
		/** The field label's own id. A subform is a group of controls, not one control
		 * `for` could reach, so the field's label names the set; each property carries
		 * its own `<label for>` inside it. */
		labelledBy?: string;
		/** The parked `description` (FieldLabel): announced on entering the group. */
		describedBy?: string;
		/**
		 * The parent control's DOM id: the base each property's own three names derive
		 * from ({@link propertyDomIds}). Absent — a subform mounted with no field around
		 * it — the properties fall back to `aria-label`, which names them without a
		 * `for` target to click.
		 */
		idBase?: string;
		/** Accessible-name prefix: the `aria-label` fallback above, and the name a nested
		 *  container composes its own elements' from. */
		label?: string;
		/** The boundary's nested content read, rooted at this subform: `path` is a
		 * `PathStep[]` from here to the leaf, which the caller prefixes with whatever
		 * stands between this subform and the field (`reader.getContentAt`). Asked only
		 * for a content-typed property: on any other the read is not content and throws.
		 * `undefined` for a property the stored value does not reach. */
		contentAt: (path: PathStep[]) => Content | undefined;
		onCommit: (obj: Record<string, unknown>) => void;
		/**
		 * Which figure the cells draw in. `subform` is the stacked one: its own vertical,
		 * its own query container, a label over each cell. `row` is one line of a table
		 * ({@link ArrayField}'s grid arm): the boxes collapse to `display: contents` so the
		 * cells land in the caller's columns, and each label goes visually hidden, the
		 * column header carrying those words once for a reader who can see them.
		 *
		 * The cells themselves are the same components either way, so a table is a
		 * presentation of the row rather than a second tree.
		 */
		layout?: 'subform' | 'row';
	}
	let {
		value,
		properties,
		labelledBy,
		describedBy,
		idBase,
		label,
		contentAt,
		onCommit,
		layout = 'subform'
	}: Props = $props();

	const entries = $derived(Object.entries(properties ?? {}));
	const obj = $derived((value ?? {}) as Record<string, unknown>);

	/** Obligation, read off the cell exactly as `fieldModels` reads it off a field
	 *  ({@link obliged}). `validate` anchors it per leaf, so a property with no
	 *  `default:` is obliged in its own right and the container around it holds none
	 *  (VISUAL_EDITOR §"Enum variants"). */
	const required = obliged;

	const title = propertyLabel;
	/** The `aria-label` fallback, for a subform mounted without a field's id space:
	 *  the field's name and the property's, since nothing else names the control. */
	const fallbackName = (key: string, sub: QuillFieldSchema): string =>
		`${label != null ? `${label} ` : ''}${title(key, sub)}`;
	/** Which properties draw their own label line: a repeater pairs the label with its add
	 *  chip and a matrix with its count, so both own the track (`ArrayField`, `MatrixField`)
	 *  exactly as they do one rung up in `Field`. */
	const ownsLabel = (kind: string): boolean => kind === 'array' || kind === 'matrix';

	/** The prose cells' handles, keyed by property name — which is stable, a subform
	 *  drawing its properties by declaration and never by position. A ref only where
	 *  the DOM cannot answer: a `contenteditable` matches no focusable selector, and
	 *  focusing the node is not focusing the view ({@link ProseValue.focus}). A scalar
	 *  control is resolved off the markup, so a handle each would be five refs
	 *  restating document order.
	 *
	 *  `$state` for the binding's sake: `bind:this` into a property of a plain object
	 *  is a write Svelte cannot track, and it says so once per cell per render
	 *  (`ArrayField` keeps its element refs the same way). */
	const proseEls: Record<
		string,
		{ focus: () => void; setCaret?: (pos: number) => void } | undefined
	> = $state({});
	/** The nested containers' handles, on the same keying and for the same reason: what
	 *  focusing one means is its own (a repeater lands on its first row or on the add
	 *  affordance that is all an empty one has), and a landing walks down through them. */
	const subEls: Record<
		string,
		| { focus: () => void; focusPath?: (path: PathStep[], pos?: number) => HTMLElement | undefined }
		| undefined
	> = $state({});
	let rootEl = $state<HTMLElement | undefined>();
	const FOCUSABLE = 'input, select, button, [tabindex]:not([tabindex="-1"])';
	/** Take the caret: the first property that has somewhere to put it, in document
	 * order — a subform has no single control of its own to land on. An empty subform
	 * lands nothing. */
	export function focus(): void {
		for (const cell of propCells()) if (landOn(cell)) return;
	}
	/** A label click for the properties `for` cannot reach: the date control, whose
	 *  focus lives on a segment, a prose cell, which is a `contenteditable`, and a nested
	 *  container, which owns what landing in it means. Scoped to that property's own cell,
	 *  so the click lands where the label is rather than on the subform's first control. */
	function focusProp(key: string): void {
		for (const cell of propCells()) if (cell.dataset.qmProp === key) return void landOn(cell);
	}
	// Matched on the dataset: a key is the schema's own string, and spelling one into a
	// selector needs `CSS.escape`, which the test DOM does not carry. Scoped to this
	// subform's own grid, so a nested container's properties are its own to find.
	function propCells(): HTMLElement[] {
		return [...(rootEl?.querySelectorAll<HTMLElement>('[data-qm-prop]') ?? [])].filter(
			(cell) => cell.closest('.qm-object') === rootEl
		);
	}
	/** Land in one property's cell, answering whether it took the caret. */
	function landOn(cell: HTMLElement): boolean {
		const key = cell.dataset.qmProp ?? '';
		const owner = proseEls[key] ?? subEls[key];
		if (owner) {
			owner.focus();
			return true;
		}
		// Past the label row: a property carrying a `description` opens with the hint
		// trigger, which is focusable and stands before the control it describes.
		const el = [...cell.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
			(n) => !n.closest('.qm-field-label-row')
		);
		el?.focus();
		return !!el;
	}
	/**
	 * Land at `path` inside this subform (`leaves.ts`): the first step is a property key,
	 * and the rest is that property's own to walk. A container consumes its step and hands
	 * the remainder down; a leaf takes the caret where it can hold one.
	 *
	 * The box that comes back is the innermost one the address named — a nested row where
	 * the walk reached one, this property's cell otherwise — so the arrival wash marks the
	 * rung the click resolved rather than the field around it.
	 */
	export function focusPath(path: PathStep[], pos?: number): HTMLElement | undefined {
		const [key, ...rest] = path;
		if (typeof key !== 'string') return undefined;
		const cell = propCells().find((c) => c.dataset.qmProp === key);
		if (!cell) return undefined;
		const nested = subEls[key];
		if (rest.length) return (nested?.focusPath?.(rest, pos) ?? undefined) || cell;
		const prose = proseEls[key];
		if (pos != null && prose?.setCaret) prose.setCaret(pos);
		else landOn(cell);
		return cell;
	}

	function commitProp(key: string, v: unknown): void {
		if (v === undefined) {
			// A nested control cleared (the unset rung): drop the key so the property
			// is absent in the committed object (resolving to its own `default:`)
			// rather than an `undefined` hole carried through `writer.set`.
			const rest = { ...obj };
			delete rest[key];
			onCommit(rest);
		} else {
			onCommit({ ...obj, [key]: v });
		}
	}
</script>

<!-- `role="group"` names the cell set for a reader entering it, which a table row does
     not need: its columns are named once in the header and again inside each cell. -->
<div
	bind:this={rootEl}
	class="qm-object"
	class:row={layout === 'row'}
	role={layout === 'row' ? undefined : 'group'}
	aria-labelledby={layout === 'row' ? undefined : labelledBy}
	aria-describedby={layout === 'row' ? undefined : describedBy}
>
	<div class="qm-object-grid qm-capacity">
		{#each entries as [key, sub] (key)}
			{@const kind = controlKind(sub)}
			{@const ids = idBase ? propertyDomIds(idBase, key) : undefined}
			{@const named = ids ? undefined : fallbackName(key, sub)}
			{@const describes = sub.description && ids ? ids.description : undefined}
			<!-- `for` reaches the four labelable controls; the date field's focus lives on a
			     segment and a prose cell is a `contenteditable`, so those take the click
			     handoff instead, exactly as `Field` does one level up. -->
			{@const labelable =
				kind === 'text' || kind === 'enum' || kind === 'number' || kind === 'boolean'}
			<div class="qm-object-prop" class:full={propertyGrows(sub)} data-qm-prop={key}>
				{#if ids && !ownsLabel(kind)}
					<FieldLabel
						label={title(key, sub)}
						controlId={labelable ? ids.control : undefined}
						id={ids.label}
						descriptionId={describes}
						onActivate={labelable ? undefined : () => focusProp(key)}
						required={required(sub)}
						description={sub.description}
					/>
				{/if}
				{#if kind === 'enum'}
					<EnumField
						label={named}
						id={ids?.control}
						describedBy={describes}
						value={obj[key] as string | undefined}
						values={sub.values ?? []}
						fallback={sub.default as string | undefined}
						onCommit={(v) => commitProp(key, v)}
					/>
				{:else if kind === 'number'}
					<NumberField
						label={named}
						id={ids?.control}
						describedBy={describes}
						value={obj[key] as number | undefined}
						integer={sub.type === 'integer'}
						fallback={sub.default as number | undefined}
						onCommit={(v) => commitProp(key, v)}
					/>
				{:else if kind === 'boolean'}
					<BooleanField
						label={named}
						id={ids?.control}
						describedBy={describes}
						value={obj[key] as boolean | undefined}
						fallback={sub.default as boolean | undefined}
						onCommit={(v) => commitProp(key, v)}
					/>
				{:else if kind === 'date'}
					<DateField
						label={named}
						labelledBy={ids?.label}
						describedBy={describes}
						value={obj[key] as string | undefined}
						fallback={sub.default != null ? String(sub.default) : undefined}
						onCommit={(v) => commitProp(key, v)}
					/>
				{:else if kind === 'prose'}
					<!-- Keyed by name, so a re-derive of the container this cell commits whole
					     leaves the leaf mounted and the caret in it. -->
					<ProseValue
						bind:this={proseEls[key]}
						content={() => contentAt([key]) ?? emptyContent()}
						plaintext={sub.type === 'plaintext'}
						label={named}
						labelledBy={ids?.label}
						describedBy={describes}
						onChange={(rt) => commitProp(key, rt)}
					/>
				{:else if kind === 'array'}
					<!-- The repeater one rung in. It takes the label track, and the read and the
					     write are the same two lanes at any depth: the path prefixes this
					     property's key, and the value commits whole up through the subform. -->
					<ArrayField
						bind:this={subEls[key]}
						value={obj[key] as unknown[] | undefined}
						schema={sub}
						label={title(key, sub)}
						required={required(sub)}
						description={sub.description}
						labelId={ids?.label}
						descriptionId={describes}
						idBase={ids?.control}
						contentAt={(path) => contentAt([key, ...path])}
						onCommit={(arr) => commitProp(key, arr)}
					/>
				{:else if kind === 'object'}
					<Self
						bind:this={subEls[key]}
						value={obj[key] as Record<string, unknown> | undefined}
						properties={sub.properties}
						label={fallbackName(key, sub)}
						idBase={ids?.control}
						labelledBy={ids?.label}
						describedBy={describes}
						contentAt={(path) => contentAt([key, ...path])}
						onCommit={(v) => commitProp(key, v)}
					/>
				{:else if kind === 'matrix'}
					<MatrixField
						bind:this={subEls[key]}
						value={obj[key] as Record<string, unknown> | undefined}
						schema={sub}
						label={title(key, sub)}
						description={sub.description}
						labelId={ids?.label}
						descriptionId={describes}
						idBase={ids?.control}
						contentAt={(path) => contentAt([key, ...path])}
						onCommit={(v) => commitProp(key, v)}
					/>
				{:else}
					<TextField
						label={named}
						id={ids?.control}
						describedBy={describes}
						value={obj[key] as string | undefined}
						placeholder={sub.default != null ? String(sub.default) : undefined}
						onCommit={(v) => commitProp(key, v)}
					/>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	/* The vertical and the rung between it and the properties, `--_qm-nest` being the step
	   the card and the section hold too.

	   `--_qm-border` and not `--_qm-border-faint`: this is the stroke that structures
	   (ARCHITECTURE §"A plane is a tone"), the one the card's edge and the section's
	   vertical read. `faint` separates without structuring — a table's interior lines
	   under a frame that is doing the structuring — which is the other job.

	   `padding-block` is the stroke's end caps, the same rung and the same reason as a
	   section's (`Card.svelte`). A cap and not a leading gap: what stands the subform off
	   the label or the box above it is still that stacker's own.

	   A query container over its own width, which is what makes the capacity ladder step
	   itself at every depth: `--cols` inherits, so a subform three rungs in would draw the
	   section's count over a box three `--_qm-nest` and three verticals narrower. Nothing
	   measures — the rungs are the same `@container` rule the section's fields read
	   (`.qm-capacity`, controls.css), one level down. */
	.qm-object {
		container-type: inline-size;
		border-inline-start: var(--_qm-vertical-width) solid var(--_qm-border);
		padding-inline-start: var(--_qm-nest);
		padding-block: var(--_qm-space);
	}
	/* The grid the capacity lands on. Separate from the box above it because a container
	   cannot query itself: the query is the subform's width, and what reads the answer is
	   the track count inside it.

	   The edges are not the section's: the inset is the nesting, and a cell lining up with
	   the field above it would claim a depth it is not at. */
	.qm-object-grid {
		display: grid;
		grid-template-columns: repeat(var(--cols), 1fr);
		gap: var(--_qm-space-2);
	}
	/* A property measures like a field: two tracks over the subform's own rows, so a
	   label wrapping in one column leaves its control on the row's baseline rather than a
	   line below it — `Field.svelte`'s rule for a row-sharing field, one level in. The
	   tracks are this grid's own; the section's belong to the fields.

	   `min-width: 0` because a property overflowing its `1fr` grows the track, and the
	   subform with it, past the field that holds it. */
	.qm-object-prop {
		display: grid;
		grid-row: span 2;
		grid-template-rows: subgrid;
		row-gap: var(--_qm-space-half);
		align-items: start;
		min-width: 0;
	}
	/* A subform of one takes half the capacity: at full capacity a single track reads as
	   truncated, and there are no sibling properties for it to line up with. A stranded
	   field takes the whole row instead (`placeFields`): the width it would leave empty is
	   the card's, where this one sits inside a figure the nesting has already narrowed. */
	.qm-object-prop:only-child {
		grid-column: span var(--cols-half);
	}
	/* A property whose height the document sets takes the row, the rule `placeFields`
	   holds one rung up (`grows`): a nested container and a block leaf each stand their
	   neighbour in a column of whitespace, and a container also draws a vertical, which
	   half a row reads as a rule rather than as a depth. Last, so it outranks the
	   half-capacity rule above at equal specificity. */
	.qm-object-prop.full {
		grid-column: 1 / -1;
	}
	/* ── One line of a table ───────────────────────────────────────────────────
	   The two boxes go away — no vertical, no inset, no grid and no query container of
	   its own — so each cell is a child of the caller's row grid and lands in the column
	   its position names. The cells are the same components the stacked figure draws;
	   what differs is whose tracks they sit in. */
	.qm-object.row,
	.qm-object.row .qm-object-grid {
		display: contents;
	}
	/* A cell is a plain block: its label sits over its control where the caller stacks
	   them, and goes off the page where the caller draws a header instead (`ArrayField`,
	   which owns that threshold). `min-width: 0` for the same reason it is on the stacked
	   property — a long value would otherwise grow its track and pull the columns out of
	   line with the rows above. */
	.qm-object.row .qm-object-prop {
		display: block;
		min-width: 0;
	}
</style>
