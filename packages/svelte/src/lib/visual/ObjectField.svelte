<!--
 An `object` field → a nested subform over `properties` (declaration order),
 committing the whole object by value on any nested change. A scalar property draws
 its own control, a content property mounts the by-value prose leaf ({@link
 ProseValue}) over the boundary's nested read, and a container property — an `array`,
 an `object`, a `matrix`, a variant — mounts its own control here, at the next rung of
 the same figure. Depth is bounded by what is open, not by the schema: a repeater inside
 a subform is collapsed rows again, one open at a time, so an open row under an open
 row is one figure two rungs in.

 The nesting is a vertical at `--_qm-border`, the ladder's last stroke: the card's edge,
 an open section's vertical one `--_qm-nest` in where the field is in one, this one a rung
 further, the properties a rung inside it (ARCHITECTURE §"A plane is a tone").

 One figure wherever it mounts, and where its stroke lands is the stacker's. A
 variant's cells and a matrix member's columns sit at the depth a field-level subform
 sits at: each stands beside the cell it is stored with — the discriminant, the tick —
 rather than inside it, so the box says which world or which member and not how deep.
 An array element's properties hang a rung further in ({@link ArrayField}), the summary
 above them standing for the whole row.

 A property's ghosted `default:` is the static schema `sub.default`, not the
 resolved provenance the top-level ghosts read (FIELD_PROVENANCE): `resolve`
 carries no per-property row (an object field resolves as one row whose value is
 the whole object).

 Every caller hands down `contentAt`, which is `reader.getContentAt` with the field
 already bound: a field-level subform passes the property key through untouched, a
 variant passes its cell's, an array's open row prefixes its index and a matrix its
 member's id. So a cell reads at whatever depth it sits, which nothing here knows.

 `bare` is the table's row: the same cells with no labels and no figure of their own,
 laid onto the tracks the table's header names ({@link ArrayField}).
-->
<script lang="ts">
	import type { Content, PathStep, QuillFieldSchema } from '@quillmark/wasm';
	import { emptyContent } from '../core/codec/index.js';
	import {
		arrayLayout,
		baseType,
		controlKind,
		exampleGhost,
		humanize,
		isContainer,
		obliged,
		optionalCell,
		shortCell,
		stringifyGhost
	} from './structure.js';
	import { splitDeep, unrouted, type DeepDiagnostic } from './diagnostics.js';
	import type { LandingBox } from './leaves.js';
	import { wording } from './strings.js';
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
	import VariantField from './VariantField.svelte';
	import DiagnosticList from './DiagnosticList.svelte';
	import ObjectField from './ObjectField.svelte';
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
		 * it, or a table's row — the properties fall back to `aria-label`, which names
		 * them without a `for` target to click.
		 */
		idBase?: string;
		/** Accessible-name prefix used only on the `aria-label` fallback above. */
		label?: string;
		/** The boundary's nested content read, rooted at this subform: `path` is a
		 * `PathStep[]` from here to the leaf, which the caller prefixes with whatever
		 * stands between this subform and the field (`reader.getContentAt`). Asked only
		 * for a content-typed property: on any other the read is not content and throws.
		 * `undefined` for a property the stored value does not reach. */
		contentAt: (path: PathStep[]) => Content | undefined;
		onCommit: (obj: Record<string, unknown>) => void;
		/** A table's row: the cells alone, on the tracks the table's header names, with
		 * no labels and no vertical of their own. */
		bare?: boolean;
		/** Raw keydown off a text or prose cell, for a row whose own keys run through its
		 * cells: the table's Enter and Backspace ({@link ArrayField}). */
		onCellKey?: (e: KeyboardEvent, key: string) => void;
		/** The diagnostics routed into this subform, each with its steps still to walk:
		 * one naming a property draws under that property's control, and one naming
		 * nothing this subform holds draws at its foot (`diagnostics.ts`). */
		diagnostics?: readonly DeepDiagnostic[];
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
		bare = false,
		onCellKey,
		diagnostics
	}: Props = $props();

	const t = wording();
	const entries = $derived(Object.entries(properties ?? {}));
	const obj = $derived((value ?? {}) as Record<string, unknown>);
	const has = (key: string): boolean => Object.hasOwn(properties ?? {}, key);
	const routed = $derived(splitDeep(diagnostics));
	const foot = $derived(unrouted(routed, (step) => typeof step === 'string' && has(step)));

	/** Obligation, read off the cell exactly as `fieldModels` reads it off a field
	 *  ({@link obliged}). `validate` anchors it per leaf, so a property with no
	 *  `default:` is obliged in its own right and the container around it holds none
	 *  (VISUAL_EDITOR §"Enum variants"). */
	const required = obliged;

	const title = (key: string, sub: QuillFieldSchema): string => sub.title ?? humanize(key);
	/** What a cell ghosts at rest, which is what it prints unset: its `default:`, or the
	 *  `none` an optional cell prints. */
	const restGhost = (sub: QuillFieldSchema): string | undefined =>
		stringifyGhost(sub.default) ?? (optionalCell(sub) ? t.strings.optionalGhost : undefined);
	/** What an unset free-text cell ghosts while it holds the focus ({@link exampleGhost}). */
	const exampleOf = (key: string, sub: QuillFieldSchema): string | undefined =>
		obj[key] == null ? exampleGhost(sub) : undefined;
	/** The `aria-label` fallback, for a subform mounted without a field's id space:
	 *  the field's name and the property's, since nothing else names the control. */
	const fallbackName = (key: string, sub: QuillFieldSchema): string =>
		`${label != null ? `${label} ` : ''}${title(key, sub)}` +
		(required(sub) ? ` ${t.strings.fieldRequired}` : '');

	/** The handles of the cells the DOM cannot answer for, keyed by property name —
	 *  which is stable, a subform drawing its properties by declaration and never by
	 *  position. A prose cell, because a `contenteditable` matches no focusable
	 *  selector and focusing the node is not focusing the view ({@link ProseValue.focus});
	 *  a container cell, because its focus and its landing are its own. A scalar control
	 *  is resolved off the markup, so a handle each would be five refs restating document
	 *  order.
	 *
	 *  `$state` for the binding's sake: `bind:this` into a property of a plain object
	 *  is a write Svelte cannot track, and it says so once per cell per render
	 *  (`ArrayField` keeps its element refs the same way). */
	const proseEls: Record<
		string,
		{ focus: () => void; setCaret: (pos: number) => void } | undefined
	> = $state({});
	const nestedEls: Record<
		string,
		| { focus: () => void; focusPath: (steps: readonly PathStep[], pos?: number) => LandingBox }
		| undefined
	> = $state({});
	let rootEl = $state<HTMLElement | undefined>();
	/** A handle by property name, own keys only: a property can be named `constructor`. */
	const ref = <T,>(map: Record<string, T | undefined>, key: string): T | undefined =>
		Object.hasOwn(map, key) ? map[key] : undefined;
	const FOCUSABLE = 'input, select, button, [tabindex]:not([tabindex="-1"])';
	/** Take the caret: the first property that has somewhere to put it, in document
	 * order — a subform has no single control of its own to land on. An empty subform
	 * lands nothing. */
	export function focus(): void {
		for (const cell of propCells()) if (landOn(cell)) return;
	}
	/**
	 * Land at `steps` inside this subform: the property the first step names, and the
	 * rest of the walk inside it where that property is a container ({@link
	 * FieldControl.focusPath}). A prose cell takes the offset; a scalar takes the bare
	 * focus. A step naming no property here falls back to {@link focus}. What comes back
	 * is the innermost row the walk opened, which a property of this subform never is:
	 * the caller washes its own box for a landing that ends here.
	 */
	export function focusPath(steps: readonly PathStep[], pos?: number): LandingBox {
		const [key, ...rest] = steps;
		if (typeof key !== 'string' || !has(key)) {
			focus();
			return undefined;
		}
		const nested = ref(nestedEls, key);
		if (nested) return nested.focusPath(rest, pos);
		const prose = ref(proseEls, key);
		if (prose) {
			if (pos != null) prose.setCaret(pos);
			else prose.focus();
			return undefined;
		}
		focusProp(key);
		return undefined;
	}
	/** A label click for the properties `for` cannot reach: the date control, whose
	 *  focus lives on a segment, a prose cell, which is a `contenteditable`, and a
	 *  nested subform. Scoped to that property's own cell, so the click lands where the
	 *  label is rather than on the subform's first control. */
	function focusProp(key: string): void {
		for (const cell of propCells()) if (cell.dataset.qmProp === key) return void landOn(cell);
	}
	// Matched on the dataset: a key is the schema's own string, and spelling one into a
	// selector needs `CSS.escape`, which the test DOM does not carry. `:scope >` keeps a
	// nested subform's cells out of this one's walk: they are its own to land in.
	function propCells(): HTMLElement[] {
		return [
			...(rootEl?.querySelectorAll<HTMLElement>(':scope > .qm-object-grid > [data-qm-prop]') ?? [])
		];
	}
	/** Land in one property's cell, answering whether it took the caret. */
	function landOn(cell: HTMLElement): boolean {
		const key = cell.dataset.qmProp ?? '';
		const owned = ref(nestedEls, key) ?? ref(proseEls, key);
		if (owned) {
			owned.focus();
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

<div
	bind:this={rootEl}
	class="qm-object"
	class:qm-object-bare={bare}
	role="group"
	aria-labelledby={labelledBy}
	aria-describedby={describedBy}
>
	<!-- The grid is one box in, so the wrapper can be the query container it reads its
	     capacity from: a container cannot query itself. -->
	<div class="qm-object-grid qm-tracks">
		{#each entries as [key, sub] (key)}
			{@const kind = controlKind(sub)}
			{@const ids = idBase && !bare ? propertyDomIds(idBase, key) : undefined}
			{@const named = ids ? undefined : fallbackName(key, sub)}
			{@const describes = sub.description && ids ? ids.description : undefined}
			{@const deep = routed.below.get(key)}
			{@const own = isContainer(kind) ? undefined : deep?.map((d) => d.diagnostic)}
			<!-- `for` reaches the labelable controls, a variant through its discriminant; the
			     date field's focus lives on a segment and a prose cell is a `contenteditable`,
			     so those take the click handoff instead, exactly as `Field` does one level up. -->
			{@const labelable =
				kind === 'text' ||
				kind === 'enum' ||
				kind === 'variant' ||
				kind === 'number' ||
				kind === 'boolean'}
			<!-- A container takes the full span at every depth: its rows are the document's
			     to count, and a track beside it would stand in a column of whitespace
			     (`packable`). A block prose cell spans it too, and keeps its label row. -->
			{@const block = kind === 'prose' && !shortCell(sub)}
			<div
				class="qm-object-prop"
				class:qm-prop-full={isContainer(kind)}
				class:qm-prop-wide={block}
				data-qm-prop={key}
			>
				{#if ids && kind !== 'array' && kind !== 'matrix'}
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
						blankTitle={sub.ui?.blank_title}
						optional={optionalCell(sub)}
						onCommit={(v) => commitProp(key, v)}
					/>
				{:else if kind === 'number'}
					<NumberField
						label={named}
						id={ids?.control}
						describedBy={describes}
						value={obj[key] as number | undefined}
						integer={baseType(sub) === 'integer'}
						placeholder={restGhost(sub)}
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
				{:else if kind === 'text'}
					<TextField
						label={named}
						id={ids?.control}
						describedBy={describes}
						value={obj[key] as string | undefined}
						placeholder={restGhost(sub)}
						example={exampleOf(key, sub)}
						onCommit={(v) => commitProp(key, v)}
						onKey={onCellKey ? (e) => onCellKey(e, key) : undefined}
					/>
				{:else if kind === 'prose'}
					<!-- Keyed by name, so a re-derive of the container this cell commits whole
					     leaves the leaf mounted and the caret in it. -->
					<ProseValue
						bind:this={proseEls[key]}
						content={() => contentAt([key]) ?? emptyContent()}
						plaintext={baseType(sub) === 'plaintext'}
						placeholder={restGhost(sub)}
						example={exampleOf(key, sub)}
						{block}
						label={named}
						labelledBy={ids?.label}
						describedBy={describes}
						onChange={(rt) => commitProp(key, rt)}
						onKey={onCellKey ? (e) => onCellKey(e, key) : undefined}
					/>
				{:else if kind === 'array'}
					<!-- The repeater owns its label row, the add chip sharing it (`Field` skips
					     its own label for one too), so the names are handed down rather than
					     drawn here. Its rows are collapsed rows again, one open at a time: the
					     depth an open row under an open row costs is two rungs of the ladder
					     and one figure. -->
					<ArrayField
						bind:this={nestedEls[key]}
						value={obj[key] as unknown[] | undefined}
						items={sub.items}
						layout={arrayLayout(sub)}
						max={sub.max}
						label={title(key, sub)}
						required={required(sub)}
						description={sub.description}
						labelId={ids?.label}
						descriptionId={describes}
						idBase={ids?.control}
						contentAt={(path) => contentAt([key, ...path])}
						onCommit={(v) => commitProp(key, v)}
						diagnostics={deep}
					/>
				{:else if kind === 'object'}
					<ObjectField
						bind:this={nestedEls[key]}
						value={obj[key] as Record<string, unknown> | undefined}
						properties={sub.properties}
						label={ids ? undefined : fallbackName(key, sub)}
						idBase={ids?.control}
						labelledBy={ids?.label}
						describedBy={describes}
						contentAt={(path) => contentAt([key, ...path])}
						onCommit={(v) => commitProp(key, v)}
						diagnostics={deep}
					/>
				{:else if kind === 'matrix'}
					<MatrixField
						bind:this={nestedEls[key]}
						value={obj[key] as Record<string, unknown> | undefined}
						schema={sub}
						label={title(key, sub)}
						description={sub.description}
						labelId={ids?.label}
						descriptionId={describes}
						idBase={ids?.control}
						contentAt={(path) => contentAt([key, ...path])}
						onCommit={(v) => commitProp(key, v)}
						diagnostics={deep}
					/>
				{:else if kind === 'variant'}
					<VariantField
						bind:this={nestedEls[key]}
						value={obj[key] as Record<string, unknown> | undefined}
						schema={sub}
						ghostMember={sub.default as string | undefined}
						label={title(key, sub)}
						id={ids?.control}
						labelledBy={ids?.label}
						describedBy={describes}
						contentAt={(path) => contentAt([key, ...path])}
						onCommit={(v) => commitProp(key, v)}
						diagnostics={deep}
					/>
				{:else}
					<TextField
						label={named}
						id={ids?.control}
						describedBy={describes}
						value={obj[key] as string | undefined}
						onCommit={(v) => commitProp(key, v)}
					/>
				{/if}
				<DiagnosticList diagnostics={own} />
			</div>
		{/each}
	</div>
	<DiagnosticList diagnostics={foot} />
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

	   A query container over its own width: the capacity its grid steps is the width the
	   properties get, which three rungs in is three `--_qm-nest` and three verticals
	   narrower than the section's, and a subform reading the section's count over that
	   box draws four tracks where two fit. The ladder itself is the one shared recipe
	   (`.qm-tracks`, controls.css), so this container and the section's step at the same
	   widths. Not on a table's row, which is a subgrid of the table and sizes nothing of
	   its own. */
	.qm-object {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
	}
	.qm-object:not(.qm-object-bare) {
		container-type: inline-size;
		border-inline-start: var(--_qm-vertical-width) solid var(--_qm-border);
		padding-inline-start: var(--_qm-nest);
		padding-block: var(--_qm-space);
	}
	/* The tracks are this subform's own count over its own width (`.qm-tracks`); the
	   edges are not the section's: the inset is the nesting, and a cell lining up with the
	   field above it would claim a depth it is not at. */
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
	/* A block prose property holds paragraphs, so a track beside it stands in whitespace
	   once it grows (`packable`); its label still rides the row above it. */
	.qm-object-prop.qm-prop-wide,
	.qm-object-prop.qm-prop-wide:only-child {
		grid-column: 1 / -1;
	}
	/* A container property takes the whole row and its own rows: its label rides inside
	   the control it draws (a repeater's header, a matrix's) or above a subform of its
	   own, and neither is a track a scalar's label shares. */
	.qm-object-prop.qm-prop-full,
	.qm-object-prop.qm-prop-full:only-child {
		grid-column: 1 / -1;
		grid-row: auto;
		grid-template-rows: none;
		row-gap: var(--_qm-space);
	}
	/* ── A table's row ──────────────────────────────────────────────────────────
	   The cells alone, each on the track the header names: this box and its grid both
	   subgrid onto the row that holds them, so a cell's edge is the column's. No
	   vertical, no inset, no capacity of its own, and one row per cell, the label having
	   moved up to the header. `.qm-array-row` is the row (`ArrayField`), which spends
	   the last track on the row's remove; this box takes the rest. */
	.qm-object-bare {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -2;
	}
	.qm-object-bare > .qm-object-grid {
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
		/* The table's own gutter, not the subform's: a subgrid that states a wider gap
		   than its parent's shifts its items half the difference off the tracks the
		   header cells sit on. */
		column-gap: var(--_qm-space);
	}
	.qm-object-bare .qm-object-prop,
	.qm-object-bare .qm-object-prop:only-child {
		grid-column: auto;
		grid-row: auto;
		grid-template-rows: none;
		row-gap: var(--_qm-space-half);
		/* A row is one line of controls, so a cell shorter than the box beside it stands
		   on that line: a switch held at the top of a row a text box set the height of
		   reads as a cell that slipped its track. */
		align-items: center;
	}
	/* What the row could not hand down stands across it: a diagnostic in the first
	   column alone would read as that column's. */
	.qm-object-bare > :global(.qm-diag-list) {
		grid-column: 1 / -1;
	}
</style>
