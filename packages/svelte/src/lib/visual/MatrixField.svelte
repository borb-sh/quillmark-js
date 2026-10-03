<!--
 A `matrix` field → ticks over the roster, columns unfolding under a held member
 (VISUAL_EDITOR §"The matrix", canon `SCHEMAS.md` §Matrix). The roster is one flat
 list, one member to a row, or abreast on the section's track ladder under
 `ui.compact`; each member is a real checkbox whose checked state is the member's
 presence, with its title as the `<label for>`, an unheld member reading at the label
 ink and a held one at the value ink. A held member unfolds its columns beneath its
 title, drawn by {@link ObjectField} over the matrix's `properties` at the member's key;
 zero columns is a checklist and unfolds nothing.

 An open matrix's added items follow the roster in id order, as the plate prints them:
 held by being present, so each draws a fixed tick, its `title` as an input, a remove,
 and the same columns. The add box closes the list ({@link MatrixAdd}): it searches
 every checklist of the document before it offers to add what was typed.

 The control owns its label row, as an array does: the count of held items sits
 where an array's add chip sits, so {@link Field} skips its own label for it.

 Commit is whole: the sparse map, one `writer.set`. A tick writes the member, its
 columns or the bare `true`; an untick removes it. Its columns are kept here, for this
 mount, so a retick restores them: the document keeps no answer for a member it does not
 hold. Every other member rides through as the document spelled it. An unset matrix
 whose `default:` holds members draws that set at the default rung, and the first
 gesture writes it whole with the change in it.
-->
<script lang="ts">
	import { tick as flush } from 'svelte';
	import { wording } from './strings.js';

	// The surface's words, ambient from the editor root; the package's English
	// off-tree, so this component renders standalone too.
	const t = wording();
	import type { Content, PathStep, QuillFieldSchema } from '@quillmark/wasm';
	import {
		MATRIX_TITLE,
		addedId,
		addedItems,
		baseType,
		commitMember,
		declaredContent,
		matrixColumns,
		matrixDeclares,
		matrixEmpty,
		matrixHeld,
		matrixMembers,
		memberValue,
		memberWrite,
		onRoster,
		schemaAt
	} from './structure.js';
	import {
		checklists,
		matrixPrinted,
		searchChecklists,
		type AddOption,
		type Checklist,
		type ChecklistHit,
		type Searchable
	} from './checklists.js';
	import { splitDeep, unrouted, type DeepDiagnostic } from './diagnostics.js';
	import type { LandingBox } from './leaves.js';
	import { propertyDomIds } from './domid.js';
	import { bloomInside } from '../core/bloom.js';
	import Icon from './icons/Icon.svelte';
	import FieldLabel from './FieldLabel.svelte';
	import ObjectField from './ObjectField.svelte';
	import MatrixAdd from './MatrixAdd.svelte';
	import DiagnosticList from './DiagnosticList.svelte';
	import './controls.css';

	interface Props {
		/** The stored sparse map, or undefined while the field is unset. */
		value: Record<string, unknown> | undefined;
		/** The field's own schema: `members` is the roster, `properties` the columns,
		 *  `open` whether a document may add items. */
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
		 *  names from, one `-m-<member id>` segment down. */
		idBase?: string;
		/** The field's leaf key, where it is a card's own field: how the add box tells
		 *  this list from the rest of the document's (`checklists.ts`). */
		listKey?: string;
		/** The boundary's nested content read, rooted at this field: a member's content
		 *  column reads at `[id, column]` (`reader.getContentAt`). */
		contentAt: (path: PathStep[]) => Content | undefined;
		onCommit: (v: Record<string, unknown> | undefined) => void;
		/** The diagnostics routed into this field, each with its steps still to walk: one
		 *  naming a drawn item draws under it, any other at the field's foot. */
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
		listKey,
		contentAt,
		onCommit,
		diagnostics
	}: Props = $props();

	// A card's own matrix searches the document's lists; one nested in a container is
	// not indexed, and searches its own items alone.
	const index = checklists();
	const others = (): readonly Checklist[] => (listKey != null ? (index?.list() ?? []) : []);
	const members = $derived(matrixMembers(schema.members));
	const compact = $derived(!!schema.ui?.compact);
	const hasColumns = $derived(Object.keys(schema.properties ?? {}).length > 0);
	/** The held set as it prints: the stored map, else the declared `default:`. */
	const map = $derived(matrixPrinted(value, schema));
	const defaulted = $derived(value == null && map != null && Object.keys(map).length > 0);
	const added = $derived(addedItems(schema, map));
	const held = (id: string): boolean => matrixHeld(memberValue(map, id));
	const heldCount = $derived(members.filter((m) => held(m.id)).length + added.length);
	/** Whether `id` is an item this control draws: a roster member or a held added item. */
	const drawn = (id: string): boolean =>
		onRoster(schema, id) || added.some((item) => item.id === id);
	const routed = $derived(splitDeep(diagnostics));
	const foot = $derived(unrouted(routed, (step) => typeof step === 'string' && drawn(step)));

	// A member with no field id space around it still needs an id: the tick is what its
	// title's `for` names. Stable across SSR and hydration, which a counter is not.
	const uid = $props.id();
	const base = $derived(idBase ?? `qm-${uid}`);
	const memberBase = (id: string): string => `${base}-m-${id}`;
	/** A member's own address is its tick, so the tick takes the id its label names and
	 *  the column subform under it derives its own names from the same base. */
	const tickId = (id: string): string => `${memberBase(id)}-tick`;
	const titleId = (id: string): string => `${memberBase(id)}-title`;
	/** An added item's title input: the `title` cell's own control id. */
	const itemTitleId = (id: string): string => propertyDomIds(memberBase(id), MATRIX_TITLE).control;

	/** The columns an untick took, by member id, for a retick in this mount to restore. */
	const stash = new Map<string, Record<string, unknown>>();
	/** Commit the map; one holding nothing is the field's empty answer (`matrixEmpty`). */
	const commit = (next: Record<string, unknown> | undefined): void =>
		onCommit(next ?? matrixEmpty(schema));

	// The item boxes, the ticks, the title inputs and the column subforms, keyed by
	// member id — stable for the item's life. `$state` for the binding's sake
	// (`ArrayField` keeps its element refs the same way).
	type Subform = {
		focus: () => void;
		focusPath: (steps: readonly PathStep[], pos?: number) => LandingBox;
	};
	const memberEls: Record<string, HTMLElement | undefined> = $state({});
	const tickEls: Record<string, HTMLInputElement | undefined> = $state({});
	const titleEls: Record<string, HTMLInputElement | undefined> = $state({});
	const colEls: Record<string, Subform | undefined> = $state({});
	let rosterEl = $state<HTMLElement | undefined>();
	let addEl = $state<{ focus: () => void } | undefined>();
	/** A ref by member id, own keys only: an id can be spelled `constructor`. */
	const ref = <T,>(refs: Record<string, T | undefined>, id: string): T | undefined =>
		Object.hasOwn(refs, id) ? refs[id] : undefined;

	/** The rows' content read: the boundary's, or, while the set is the default, the
	 *  literal's own leaf at the codec its declared type names. */
	function readAt(path: PathStep[]): Content | undefined {
		if (!defaulted) return contentAt(path);
		const leaf = schemaAt(schema, path);
		let v: unknown = map;
		for (const step of path) v = (v as Record<string | number, unknown> | undefined)?.[step];
		return leaf ? declaredContent(v, baseType(leaf) === 'richtext') : undefined;
	}

	/** The held member `id` as a tick writes it: the columns its untick took, if any. */
	function ticked(id: string): unknown {
		const columns = stash.get(id) ?? {};
		stash.delete(id);
		return memberWrite(columns);
	}
	/** The map with `id` unticked, its columns stashed for a retick. */
	function unticked(id: string): Record<string, unknown> | undefined {
		const columns = matrixColumns(memberValue(map, id));
		if (Object.keys(columns).length) stash.set(id, columns);
		else stash.delete(id);
		return commitMember(map, id, undefined);
	}

	/** A native checkbox carries its own state, so a commit the document declines leaves
	 *  the face ticked over a map that says otherwise, `checked={held(id)}` having nothing
	 *  new to write. */
	async function tick(id: string, on: boolean, el: HTMLInputElement): Promise<void> {
		commit(on ? commitMember(map, id, ticked(id)) : unticked(id));
		await flush();
		if (el.isConnected) el.checked = held(id);
	}
	/** A column edit lands on a held item, an added one keeping its `title`. */
	function commitColumns(id: string, columns: Record<string, unknown>): void {
		const title = onRoster(schema, id) ? undefined : itemTitle(id);
		commit(commitMember(map, id, memberWrite(columns, title)));
	}
	function itemTitle(id: string): string {
		const stored = memberValue(map, id) as Record<string, unknown> | undefined;
		return String(stored?.[MATRIX_TITLE] ?? '');
	}
	function retitle(id: string, title: string): void {
		commit(commitMember(map, id, memberWrite(matrixColumns(memberValue(map, id)), title)));
	}
	async function removeItem(id: string): Promise<void> {
		const at = added.findIndex((item) => item.id === id);
		commit(commitMember(map, id, undefined));
		await flush();
		// The caret goes where the row was: the next added item, else the add box.
		const next = added[at] ?? added[at - 1];
		if (next) ref(titleEls, next.id)?.focus();
		else addEl?.focus();
	}

	// ── The add box ────────────────────────────────────────────────────────────
	/** A result's list: this one, or another of the document's. */
	type Hit = ChecklistHit<Checklist | undefined>;
	function options(query: string): AddOption[] {
		const own: Searchable<Checklist | undefined> = { list: undefined, schema, value: map };
		const lists: Searchable<Checklist | undefined>[] = others()
			.filter((l) => l.key !== listKey)
			.map((l) => ({ list: l, schema: l.schema, value: l.value }));
		const hits = searchChecklists(query, [own, ...lists]);
		const out: AddOption[] = hits.map((h, k) => ({
			key: `hit-${k}`,
			title: h.title,
			note:
				[
					h.list ? t.strings.matrixIn(h.list.label) : undefined,
					h.held ? t.strings.matrixHeldTag : undefined
				]
					.filter(Boolean)
					.join(' · ') || undefined,
			strong: h.strong,
			payload: h
		}));
		// Offered last, and not where an item of this list already carries the words.
		const fold = (s: string) => s.trim().toLowerCase();
		const dup = hits.some((h) => h.list === undefined && fold(h.title) === fold(query));
		if (!dup) out.push({ key: 'add', title: t.strings.matrixAddNew(query), add: true });
		return out;
	}
	async function choose(option: AddOption, query: string): Promise<void> {
		if (option.add) return add(query);
		const hit = option.payload as Hit;
		const other = hit.list;
		if (other) {
			if (!hit.held) other.commit(commitMember(other.value, hit.id, memberWrite({})));
			index?.land(`${other.path}.${hit.id}`);
			return;
		}
		if (!hit.held) commit(commitMember(map, hit.id, ticked(hit.id)));
		await flush();
		focusPath([hit.id]);
		const box = ref(memberEls, hit.id);
		if (box) bloomInside(box);
	}
	async function add(title: string): Promise<void> {
		const taken = (id: string) => onRoster(schema, id) || (map != null && Object.hasOwn(map, id));
		const id = addedId(title, taken);
		commit(commitMember(map, id, memberWrite({}, title)));
		await flush();
		const box = ref(memberEls, id);
		// The item's columns are what the author came to fill; a checklist has none, and
		// the box stays where the next item is typed.
		const first = Object.keys(schema.properties ?? {})[0];
		if (first !== undefined) ref(colEls, id)?.focusPath([first]);
		if (box) bloomInside(box);
	}

	/** Take the caret: the first item's control, else the add box. */
	export function focus(): void {
		const first = members[0];
		if (first) return ref(tickEls, first.id)?.focus();
		const item = added[0];
		if (item) return ref(titleEls, item.id)?.focus();
		addEl?.focus();
	}
	/** The box an arrival wash blooms in: the roster, not the label row above it, this
	 *  component owning the field's label as an array does. */
	export function washBox(): HTMLElement | undefined {
		return rosterEl;
	}
	/**
	 * Land at `steps`: an item, or a cell under it ({@link FieldControl.focusPath}). A
	 * member's own address is its tick, and an added item's its title, as is its `title`
	 * cell; a column address focuses that column where the item is held and its columns
	 * are drawn, and the item's own control where they are not — the address names the
	 * column, and what is drawn for it is the tick that would open it. One rule keyed on
	 * the address, never on the document, so one address lands in one place. An item
	 * this control does not draw falls back to {@link focus}. The innermost row the walk
	 * opened comes back, else the item's box: the item is the row the address named.
	 */
	export function focusPath(steps: readonly PathStep[], pos?: number): LandingBox {
		const [id, ...rest] = steps;
		if (typeof id !== 'string' || !matrixDeclares(schema, id) || !drawn(id)) {
			focus();
			return undefined;
		}
		const column = rest[0];
		const cells = ref(colEls, id);
		const member = ref(memberEls, id);
		if (column !== undefined && column !== MATRIX_TITLE && cells) {
			const inner = cells.focusPath(rest, pos);
			return inner instanceof Promise ? inner.then((box) => box ?? member) : (inner ?? member);
		}
		(ref(tickEls, id) ?? ref(titleEls, id))?.focus();
		return member;
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
		<span class="qm-matrix-count">
			{t.strings.matrixHeld(heldCount, members.length + added.length)}
		</span>
	</div>
	<div
		class="qm-matrix-roster"
		class:qm-tracks={compact}
		class:compact
		data-default={defaulted ? '' : undefined}
		bind:this={rosterEl}
	>
		{#each members as m (m.id)}
			{@const on = held(m.id)}
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
						/>
						<Icon name="check" class="qm-tick-mark" />
					</span>
					<label class="qm-member-title" id={titleId(m.id)} for={tickId(m.id)}>{m.title}</label>
				</div>
				{@render columns(m.id, m.title, on)}
			</div>
		{/each}
		{#each added as item, k (item.id)}
			{@const name = item.title || t.strings.matrixItemTitle(label ?? '', k + 1)}
			<div class="qm-member held added" bind:this={memberEls[item.id]}>
				<div class="qm-member-head">
					<!-- Held by being present: the tick is fixed, and the remove is its untick. -->
					<span class="qm-tick" aria-hidden="true">
						<span class="qm-tick-input qm-tick-fixed"></span>
						<Icon name="check" class="qm-tick-mark" />
					</span>
					<input
						class="qm-input qm-focus-ring qm-member-title-input"
						type="text"
						id={itemTitleId(item.id)}
						aria-label={t.strings.matrixItemTitle(label ?? '', k + 1)}
						value={item.title}
						bind:this={titleEls[item.id]}
						oninput={(e) => retitle(item.id, e.currentTarget.value)}
					/>
					<span class="qm-member-title" id={titleId(item.id)} hidden>{name}</span>
					<button
						type="button"
						class="qm-icon-btn qm-focus-ring qm-member-remove"
						title={t.strings.matrixRemove(name)}
						aria-label={t.strings.matrixRemove(name)}
						onclick={() => removeItem(item.id)}><Icon name="x" /></button
					>
				</div>
				{@render columns(item.id, name, true)}
			</div>
		{/each}
	</div>
	{#if schema.open}
		<MatrixAdd
			bind:this={addEl}
			id={`${base}-add`}
			placeholder={t.strings.matrixAdd(label ?? '')}
			{options}
			onChoose={choose}
		/>
	{/if}
	<DiagnosticList diagnostics={foot} />
</div>

<!-- A held item's columns, one rung in, the way a variant's cells unfold under the
     discriminant; an unheld one's diagnostics under its head. Keyed by item id above, so
     a tick elsewhere leaves this subform mounted and the caret in it. -->
{#snippet columns(id: string, title: string, on: boolean)}
	{@const deep = routed.below.get(id)}
	{#if on && hasColumns}
		<ObjectField
			bind:this={colEls[id]}
			value={matrixColumns(memberValue(map, id))}
			properties={schema.properties}
			label={`${label ?? ''} ${title}`.trim()}
			idBase={memberBase(id)}
			labelledBy={titleId(id)}
			contentAt={(path) => readAt([id, ...path])}
			onCommit={(cols) => commitColumns(id, cols)}
			diagnostics={deep?.filter((d) => d.steps[0] !== MATRIX_TITLE)}
		/>
		<DiagnosticList
			diagnostics={deep?.filter((d) => d.steps[0] === MATRIX_TITLE).map((d) => d.diagnostic)}
		/>
	{:else}
		<DiagnosticList diagnostics={deep?.map((d) => d.diagnostic)} />
	{/if}
{/snippet}

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
	/* The roster, one member to a row in declaration order. Positioned for the wash's
	 inset child (`washBox`), and rounded to the rung a row's box draws, as an array's
	 rows are. */
	.qm-matrix-roster {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
		min-width: 0;
		border-radius: var(--_qm-radius-inner);
	}
	/* Compact, the members stand abreast in reading order at the count the ladder gives
	 the width (`.qm-tracks`, controls.css), a held member's columns unfolding inside its
	 own track. */
	.qm-matrix-roster.compact {
		display: grid;
		grid-template-columns: repeat(var(--cols), 1fr);
		align-items: start;
		column-gap: var(--_qm-space-2);
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
	.qm-tick-input:checked,
	.qm-tick-fixed {
		background: var(--_qm-accent);
		border-color: var(--_qm-accent);
	}
	.qm-tick-fixed {
		box-sizing: border-box;
		cursor: default;
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
	.qm-tick:has(:checked, .qm-tick-fixed) :global(.qm-tick-mark) {
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
	/* An added item's title is its value, an input drawn as the roster's titles are: its
	 text starts where theirs does, one gap past the tick, and its well comes up under
	 the pointer and the focus, flush with the tick, so at rest the row reads as the rows
	 above it. */
	.qm-member-title-input {
		flex: 1;
		min-width: 0;
		margin-inline-start: calc(-1 * var(--_qm-space-2));
		padding-inline-start: var(--_qm-space-2);
		background: transparent;
		transition: background-color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-member-title-input:hover {
		background: var(--_qm-surface-hover);
	}
	.qm-member-title-input:focus {
		background: var(--_qm-surface-well);
	}
	/* The remove is offered by the row the pointer or the focus is in, as an array row's
	 is, and says destructive under the pointer. */
	.qm-member-remove {
		flex-shrink: 0;
		color: var(--_qm-ink-label);
		opacity: var(--_qm-opacity-idle);
		transition:
			opacity var(--_qm-duration-fast) var(--_qm-ease-reverse),
			background-color var(--_qm-duration-fast) var(--_qm-ease-reverse),
			color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-member.added:hover > .qm-member-head > .qm-member-remove,
	.qm-member.added:focus-within > .qm-member-head > .qm-member-remove {
		opacity: 1;
	}
	.qm-member-remove:hover {
		background: var(--_qm-danger-tint);
		color: var(--_qm-danger);
	}
	.qm-member-remove :global(svg) {
		width: var(--_qm-glyph-control);
		height: var(--_qm-glyph-control);
	}
	/* The default's set is what prints and nothing written: its titles and every value
	 its columns draw take the default rung (theme.css), and the first gesture, writing
	 it, takes it off. */
	.qm-matrix-roster[data-default] :global(:is(.qm-input, .ProseMirror, .qm-date)),
	.qm-matrix-roster[data-default] :global(.qm-select:not([data-ghosted])),
	.qm-matrix-roster[data-default] .qm-member.held .qm-member-title {
		color: var(--_qm-ink-default);
	}
</style>
