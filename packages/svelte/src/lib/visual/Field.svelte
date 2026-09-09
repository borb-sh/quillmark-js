<!--
 Type dispatch (VISUAL_EDITOR §"Structure mirrors the schema"). Given one projected
 {@link FieldModel} and its live value, render the label + the control the type
 maps to. Array controls own their label (paired with the add affordance in
 {@link ArrayField}); other types render the label here. Prose leaves take a
 parent-built live `addr` (its `card` a getter over the stable-id→index map) so
 a reorder re-targets without a remount; scalars, arrays, and objects commit
 their value up through `onCommitScalar`, which the parent lowers to the typed
 writer.

 `diagnostics` is the routed `Diagnostic[]` for this field (VisualEditor's
 `diagByKey`, merging `quill.validate`, local commit errors, and the external
 `diagnostics` prop (VISUAL_EDITOR §Diagnostics)) rendered via the shared
 `DiagnosticList`, non-gating.
-->
<script lang="ts">
	import type {
		Document,
		Quill,
		Addr,
		Content,
		Diagnostic,
		PathStep,
		ResolvedField
	} from '@quillmark/wasm';
	import { storedContentAt } from '../core/codec/index.js';
	import type { EditorErrorHandler } from '../core/errors.js';
	import type { LeafRegistry } from './leaves.js';
	import type { FieldModel, FieldSpan } from './structure.js';
	import { VARIANT_DISCRIMINANT, ghostDefault, stringifyGhost } from './structure.js';
	import type { FieldDomIds } from './domid.js';
	import ProseField from './ProseField.svelte';
	import TextField from './TextField.svelte';
	import EnumField from './EnumField.svelte';
	import NumberField from './NumberField.svelte';
	import BooleanField from './BooleanField.svelte';
	import DateField from './DateField.svelte';
	import ArrayField from './ArrayField.svelte';
	import ObjectField from './ObjectField.svelte';
	import VariantField from './VariantField.svelte';
	import DiagnosticList from './DiagnosticList.svelte';
	import FieldLabel from './FieldLabel.svelte';

	interface Props {
		field: FieldModel;
		/** This field's width in the section grid, from `placeFields`. */
		span: FieldSpan;
		value: unknown;
		/** This field's resolved provenance row (FIELD_PROVENANCE): the ghost's
		 * source. Feeds the placeholder / fallback only, never `value`. */
		provenance?: ResolvedField;
		doc: Document;
		/** The schema a prose leaf reads its content through (`ProseField`). */
		quill: Quill;
		/** This field's live address (getter-`card`, so a card reorder re-targets in
		 *  place): the prose leaf commits to it, and a focus reports it. */
		addr: Addr;
		leafKey: string;
		/** This field's three DOM names, derived from `leafKey` (see `domid.ts`): how
		 * the label and the control find each other. */
		domIds: FieldDomIds;
		onCommitScalar: (value: unknown) => void;
		/** Enum-option policy: `false` marks that option unavailable. Only the enum
		 * control reads this pair. */
		optionAllowed?: (value: string) => boolean;
		/** How a refused option draws: greyed (default) or left out. */
		enumDisallowed?: 'hide' | 'disable';
		onFocus?: (addr: Addr) => void;
		onCaretMove?: (addr: Addr, pos: number) => void;
		onChange?: (addr: Addr) => void;
		onError?: EditorErrorHandler;
		/** The editor's leaf registry (`leaves.ts`): a form control registers its
		 *  landing handle here, a prose leaf its controller from inside `ProseField`. */
		leaves?: LeafRegistry;
		diagnostics?: Diagnostic[];
	}
	let {
		field,
		span,
		value,
		provenance,
		doc,
		quill,
		addr,
		leafKey,
		domIds,
		onCommitScalar,
		optionAllowed,
		enumDisallowed,
		onFocus,
		onCaretMove,
		onChange,
		onError,
		leaves,
		diagnostics
	}: Props = $props();

	// The ghost the control shows when unset: the resolved `default:` (provenance,
	// `source === 'default'`). `ghost` is the raw typed value (enum/number/boolean
	// fallbacks); `defaultStr` its string form: the text placeholder and the date
	// control's `YYYY-MM-DD`. An object-valued default does not ghost.
	const ghost = $derived(ghostDefault(provenance));
	const defaultStr = $derived(stringifyGhost(ghost));
	// A variant resolves as one rung whose value is the whole container, so the
	// discriminant's ghost is that container's own discriminant cell.
	const ghostMember = $derived(
		(ghost as Record<string, unknown> | undefined)?.[VARIANT_DISCRIMINANT] as string | undefined
	);

	// `for` reaches a labelable control and the browser does the rest. The other four
	// are not labelable (the prose leaf's `contenteditable`, the date field's segment
	// container, the object subform, an array's N inputs) so `for` there would be
	// both inert and invalid markup; they take `aria-labelledby` and a click handoff.
	// A variant is labelable through its discriminant: the select is the one control
	// the field's label names, and its cells carry composed names of their own.
	const labelable = $derived(
		field.control === 'text' ||
			field.control === 'enum' ||
			field.control === 'variant' ||
			field.control === 'number' ||
			field.control === 'boolean'
	);
	// The parked description node renders only when the schema carries one, so the
	// reference must vanish with it: `aria-describedby` pointing at nothing describes
	// nothing, and silently.
	const describedBy = $derived(field.description ? domIds.description : undefined);

	/** The boundary's nested content read with this field's address already bound: an
	 * array's elements, an object's properties, a variant's cells, and a subform's cells
	 * under an open element. One door rather than one per depth, the walk down being
	 * each container prefixing its own step.
	 *
	 * The read is `storedContentAt` (`core/codec/field.ts`), which walks the field's
	 * whole stored value: an `Addr` names a field and never a value inside one, so no
	 * boundary verb takes this path. It reads `doc` live, so every call sees the commit
	 * before it. */
	function contentAt(path: PathStep[], plaintext = false): Content | undefined {
		return storedContentAt(doc, addr, path, plaintext);
	}

	// ── Focus: one answer, two callers (`leaves.ts`) ─────────────────────────────
	// A label click and the editor's `focusField`/`setCaret` ask the same question, so
	// they read the same function and cannot land in different places. The four
	// labelable controls are reached through the DOM id `for` already points at; the
	// rest own what focusing means and expose `focus()`, because it differs: a PM view
	// restores a selection, a date field lands on its first segment, an array lands on
	// its first element or on the add affordance that is all an empty one has, an
	// object on its first property.
	let proseEl = $state<{ focus: () => void } | undefined>();
	let dateEl = $state<{ focus: () => void } | undefined>();
	let arrayEl = $state<
		| {
				focus: () => void;
				focusElement: (k: number, pos?: number) => HTMLElement | undefined;
				washBox: () => HTMLElement | undefined;
		  }
		| undefined
	>();
	let objectEl = $state<{ focus: () => void } | undefined>();
	function focusControl(): void {
		const owner = proseEl ?? dateEl ?? arrayEl ?? objectEl;
		if (owner) return owner.focus();
		document.getElementById(domIds.control)?.focus();
	}
	/** The array's per-ELEMENT landing, for the addresses the preview mints under an
	 *  array field (`leaves.ts`); read at the call, so it tracks the mounted repeater.
	 *  The row it settled in comes back with it, the wash being the landing's own
	 *  granularity. */
	function focusElement(k: number, pos?: number): HTMLElement | undefined {
		return arrayEl?.focusElement(k, pos);
	}
	// Only where `for` cannot reach; the labelable four are the browser's own, and a
	// second handler over them would be a focus the label already placed.
	const onActivate = $derived(labelable ? undefined : focusControl);

	/**
	 * This field's landing handle. The wrapper is the bloom host rather than the
	 * control: `bloomInside` appends an inset child and an `<input>` holds none. The
	 * label is outside it, and stays out of the wash: an arrival marks where the caret
	 * landed, which is the control. The one control that owns its label is the array, so
	 * that one names its own box (`ArrayField.washBox`), read at the bloom the way
	 * `focusElement` is read at the call.
	 *
	 * A prose leaf is absent here — it registers its own controller from inside
	 * `ProseField`, carrying the codec seam this handle has no half of — and reactive
	 * rather than mount-once, because a retype can swap the control under a leaf key
	 * that does not remount.
	 *
	 * An array carries the per-element lane as well; no other control has elements for
	 * an address to name. `el` is the field-wide box, which an element landing does not
	 * wash: that lane hands back its own row (`leaves.ts`).
	 */
	let controlEl = $state<HTMLElement | undefined>();
	$effect(() => {
		if (field.control === 'prose' || !controlEl || !leaves) return;
		const key = leafKey;
		const registry = leaves;
		const wrapper = controlEl;
		registry.registerControl(key, {
			focus: focusControl,
			focusElement: field.control === 'array' ? focusElement : undefined,
			get el() {
				return arrayEl?.washBox() ?? wrapper;
			}
		});
		return () => registry.unregisterControl(key);
	});

	/**
	 * A form control has no controller to report its focus through, so the wrapper
	 * reports: `focusin` bubbles, so one handler covers a plain input, an array's N
	 * elements and an object's properties alike, and the active leaf names a scalar
	 * field the way it names a prose one. A prose leaf reports through its own
	 * controller — the source that drives its caret signals too — and is excluded here
	 * rather than counted twice.
	 */
	const reportFocus = $derived(field.control === 'prose' ? undefined : () => onFocus?.(addr));
</script>

<div class="qm-field" class:cell={span === 'cell'}>
	{#if field.control !== 'array'}
		<FieldLabel
			label={field.label}
			controlId={labelable ? domIds.control : undefined}
			id={domIds.label}
			descriptionId={domIds.description}
			{onActivate}
			required={field.required}
			description={field.description}
		/>
	{/if}
	<!-- The control and what hangs under it, in one grid cell: the diagnostics stack
	 inside the control's track rather than claiming a track of their own (the subgrid
	 rule below holds why). One markup for both spans; a field owning its row nests a
	 level and measures the same. -->
	<div class="qm-field-stack">
		<div class="qm-field-control" bind:this={controlEl} onfocusin={reportFocus}>
			{#if field.control === 'prose'}
				<ProseField
					{quill}
					bind:this={proseEl}
					{doc}
					{addr}
					inline={field.inline}
					plaintext={field.plaintext}
					placeholder={defaultStr}
					labelledBy={domIds.label}
					{describedBy}
					{leafKey}
					{onFocus}
					{onCaretMove}
					{onChange}
					{onError}
					{leaves}
				/>
			{:else if field.control === 'enum'}
				<EnumField
					value={value as string | undefined}
					values={field.schema.values ?? []}
					fallback={ghost as string | undefined}
					id={domIds.control}
					{describedBy}
					onCommit={onCommitScalar}
					{optionAllowed}
					{enumDisallowed}
				/>
			{:else if field.control === 'variant'}
				<VariantField
					value={value as Record<string, unknown> | undefined}
					schema={field.schema}
					{ghostMember}
					label={field.label}
					id={domIds.control}
					labelledBy={domIds.label}
					{describedBy}
					{contentAt}
					onCommit={onCommitScalar}
					{optionAllowed}
					{enumDisallowed}
				/>
			{:else if field.control === 'number'}
				<NumberField
					value={value as number | undefined}
					integer={field.schema.type === 'integer'}
					fallback={ghost as number | undefined}
					id={domIds.control}
					{describedBy}
					onCommit={onCommitScalar}
				/>
			{:else if field.control === 'boolean'}
				<BooleanField
					value={value as boolean | undefined}
					fallback={ghost as boolean | undefined}
					id={domIds.control}
					{describedBy}
					onCommit={onCommitScalar}
				/>
			{:else if field.control === 'date'}
				<DateField
					bind:this={dateEl}
					value={value as string | undefined}
					fallback={defaultStr}
					labelledBy={domIds.label}
					{describedBy}
					onCommit={onCommitScalar}
				/>
			{:else if field.control === 'array'}
				<ArrayField
					bind:this={arrayEl}
					value={value as unknown[] | undefined}
					items={field.schema.items}
					label={field.label}
					required={field.required}
					description={field.description}
					labelId={domIds.label}
					descriptionId={domIds.description}
					idBase={domIds.control}
					{contentAt}
					onCommit={onCommitScalar}
				/>
			{:else if field.control === 'object'}
				<ObjectField
					bind:this={objectEl}
					value={value as Record<string, unknown> | undefined}
					properties={field.schema.properties}
					label={field.label}
					idBase={domIds.control}
					labelledBy={domIds.label}
					{describedBy}
					{contentAt}
					onCommit={onCommitScalar}
				/>
			{:else}
				<TextField
					value={value as string | undefined}
					placeholder={defaultStr}
					id={domIds.control}
					{describedBy}
					onCommit={onCommitScalar}
				/>
			{/if}
		</div>

		<DiagnosticList {diagnostics} />
	</div>
</div>

<style>
	/* The `full` span, and the base every field starts from: its own row, a plain
	   stack. Nothing shares the row, so there are no internals to align against.

	   No inset at the end: the right edge is the track's and every control in a row ends
	   on it, a row action sitting inside the element that carries it (ArrayField) rather
	   than in a column every field would hold clear. */
	.qm-field {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
		grid-column: 1 / -1;
		min-width: 0;
	}
	/* A row-sharing field subgrids onto the section's row tracks instead of sizing its
	 own: two tracks, the label and the control's stack, taken from the parent, so
	 every control in a visual row starts at the same y however tall a neighbour's
	 label wrapped. Source order is track order; `align-items: start` keeps a short
	 control from stretching to a taller sibling's track. `row-gap` overrides the
	 section's inter-row gutter for the tracks this field spans: inside a field the
	 rhythm is tighter than between rows.

	 Two tracks, and not a third for the diagnostics: a track is permanent where a
	 diagnostic is occasional, and an empty track still costs the gutter above it, so
	 a third stands a rung of dead space under every field on the path where nothing
	 is wrong. That rung is the one place a field's box outruns its ink. It is what
	 makes a run of row-sharing fields read looser than the arrays and prose leaves
	 beside them, whose boxes end where their ink does. What a third track buys is the
	 diagnostics of one row starting at one y; the alignment a row is read by is the
	 controls', and the label track holds that. A diagnostic grows its row instead. */
	.qm-field.cell {
		display: grid;
		grid-column: span 1;
		grid-row: span 2;
		grid-template-rows: subgrid;
		row-gap: var(--_qm-space);
		align-items: start;
	}
	/* The stack the control's track holds: the control, and the diagnostics when
	 there are any. Its gap is the field's own, so a diagnostic sits the same rung
	 under its control that the control sits under its label. */
	.qm-field-stack {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
		min-width: 0;
	}
	/* Positioned for the arrival wash a landing inserts (`core/bloom.ts`), the way
	   `.qm-prose` is: an inset child over the control, since an `<input>` takes none.
	   The radius is the control's own, so the wash's corners are the box's rather than
	   square over a rounded one; on an array or a subform it bounds a group, where
	   there is no single box for it to disagree with. */
	.qm-field-control {
		position: relative;
		border-radius: var(--_qm-radius-inner);
	}
</style>
