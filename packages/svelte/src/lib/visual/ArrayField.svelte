<!--
 An `array` field → an add/remove repeater. Elements commit by value: every
 edit / add / remove rebuilds the whole array and hands it to the parent's typed
 `writer.set(field, wholeArray)` (arrays are not op-addressed). Element control
 by `items.type`: `richtext` / `plaintext` → a prose element
 ({@link ProseValue}), `object` → a summary row that opens onto a subform,
 everything else → a text input. The
 add chip sits in the label header row (space-between with the field label);
 {@link Field} skips its own label for array controls and hands this component the
 label track with it.

 An `object` element collapses: the row is its own summary — a box, titled by the
 element's first `string` cell — and opens onto {@link ObjectField}, one at a time.
 Stacking the subforms instead would nest a field one level past the depth the
 subform's own vertical draws, once per row. Opening is therefore part of a landing rather than something the
 user does first: `focusElement` opens the row it is aimed at before it focuses.

 The remove is inside the element: a slab over the end of the element's own box, taking
 its two end-side corners. So a row's box is the element's box, and an array's rows end
 where every other field's control does. On an object element that box is the summary
 rather than the open row: a destructive control belongs to the line it sits on, not to
 everything that line has unfolded.

 Keys carry the list without the mouse: Enter inserts a
 sibling below and takes the caret there, Backspace on an empty element removes it
 and hands focus back up the list.

 No reorder: an array's order is fixed at declaration/entry order. Elements
 carry a parallel session-id list, spliced with the values as one operation at
 whatever index a mutation names; so an element holds its id for life and the
 surviving order never permutes, which is what lets a keyed prose element survive an
 insert or a remove above it rather than remounting.
-->
<script lang="ts">
	import { wording } from './strings.js';

	// The surface's words, ambient from the editor root; the package's English
	// off-tree, so this component renders standalone too.
	const t = wording();
	import { onDestroy, tick } from 'svelte';
	import type { Content, PathStep, QuillFieldSchema } from '@quillmark/wasm';
	import { emptyContent } from '../core/codec/index.js';
	import { createLifespan } from '../core/teardown.js';
	import { IdSeq, controlKind } from './structure.js';
	import { holdInView } from './hold.js';
	import Icon from './icons/Icon.svelte';
	import TextField from './TextField.svelte';
	import ObjectField from './ObjectField.svelte';
	import ProseValue from './ProseValue.svelte';
	import FieldLabel from './FieldLabel.svelte';
	import './controls.css';

	/** The disclosure glyph, at the size the accordion's own chevron takes: one
	 *  disclosure figure per surface, so it is one glyph at one size. */
	const CHEVRON = 16;

	interface Props {
		value: unknown[] | undefined;
		items: QuillFieldSchema | undefined;
		/** Accessible-name prefix for the element controls (`label` + 1-based index). */
		label?: string;
		/** No-default field → a persistent required `*` on the label. */
		required?: boolean;
		/** Schema `description`: the label's help affordance. */
		description?: string;
		/** The label's own DOM id. An array is a group (N inputs, no single `for`
		 * target) so the label names the set and each element keeps its indexed
		 * `aria-label`. */
		labelId?: string;
		/** Where the description parks, for the group's `aria-describedby`. */
		descriptionId?: string;
		/** The field's control id: the base an `object` element's subform derives its
		 * properties' own names from, one `-e-<element id>` segment down, so each open
		 * record's cells carry real `<label for>` pairs like every other control. */
		idBase?: string;
		/** The boundary's nested content read, rooted at this field: `path` is a
		 * `PathStep[]` from the field to the leaf, so `[i]` is element `i` and
		 * `[i, key]` a content cell of an `object` element's subform (`Field`,
		 * `reader.getContentAt`). The codec is the leaf's own declared type's. Asked
		 * only for a content-typed leaf: on any other the read is not content and
		 * throws. `undefined` for a leaf the stored value does not reach — a slot this
		 * control has spliced in and whose commit has yet to land, or was refused. */
		contentAt: (path: PathStep[], plaintext?: boolean) => Content | undefined;
		onCommit: (arr: unknown[]) => void;
	}
	let {
		value,
		items,
		label,
		required,
		description,
		labelId,
		descriptionId,
		idBase,
		contentAt,
		onCommit
	}: Props = $props();

	// The element control is the item schema's own, with no departure: a content-typed
	// element mounts the prose leaf its scalar field mounts, reading through
	// `contentAt` whatever the element rests as. An array declaring no `items`
	// has text elements.
	const control = $derived(items ? controlKind(items) : 'text');
	const arr = $derived((value ?? []) as unknown[]);

	// Parallel stable ids, one per element, kept in lockstep with the data below.
	// Seeded eagerly so a non-empty array renders its rows on the first pass:
	// an effect-only seed mounts every element editor in a second render.
	const seq = new IdSeq();
	// svelte-ignore state_referenced_locally
	let ids = $state<string[]>(seq.take((value ?? []).length));
	// Length reconcile (defend against an out-of-band length change);
	// order is maintained by the mutators, not here.
	$effect(() => {
		const n = arr.length;
		if (ids.length === n) return;
		if (ids.length < n) ids = [...ids, ...seq.take(n - ids.length)];
		else {
			for (const id of ids.slice(n)) {
				delete els[id];
				delete rowEls[id];
			}
			ids = ids.slice(0, n);
		}
	});

	// The focus targets, keyed by element ID rather than index: an index goes stale on
	// the splice that focus is chasing. An element control exposes `focus()` because a
	// text element and a prose element disagree on what focusing is: the difference
	// is stated on `ProseValue.focus`, which owns it.
	//
	// Every path that drops an id deletes its entry: `bind:this` teardown nulls the
	// value on unmount and leaves the key, so a card that outlives its elements
	// accumulates one dead key per element ever created.
	//
	// `$state` for the binding's sake, not this component's: nothing here reads `els`
	// reactively (every read is inside an event handler or a post-flush focus hop), but
	// `bind:this` into a property of a plain object is a write Svelte cannot track, and
	// it says so once per element per render. Thirteen lines on one memo's first paint,
	// in the console a consumer is reading to find its own defects. Same shape
	// {@link Card} keeps its header/panel refs in.
	const els: Record<string, { focus: () => void; setCaret?: (pos: number) => void } | undefined> =
		$state({});
	// The rows' own boxes, on the same key and dropped on the same paths: what an
	// element landing blooms in ({@link focusElement}), and what an object row's
	// summary is found through. A row is a box whatever its element type, so the two
	// element shapes register alike.
	const rowEls: Record<string, HTMLElement | undefined> = $state({});
	let addEl: HTMLButtonElement | undefined = $state();
	let rowsEl: HTMLElement | undefined = $state();

	// ── Object elements: one open at a time ──────────────────────────────────────
	// So an array of ten records is ten lines and one figure, whatever its length.
	let openId = $state<string | undefined>(undefined);
	// The open row's subform, for the landing below. One entry, never a map: only one
	// row is open, so the ref is singular by the same rule the state is.
	let openObjEl = $state<{ focus: () => void } | undefined>();

	/** The property whose value titles a collapsed row: the first `string` cell in
	 *  declaration order, which is the order a schema states its own priority in. */
	const titleKey = $derived.by(() => {
		for (const [k, sub] of Object.entries(items?.properties ?? {})) {
			if (controlKind(sub) === 'text') return k;
		}
		return undefined;
	});
	/** A collapsed row's own words: the title cell's committed value, or `undefined`
	 *  while it has none. */
	function elementTitle(k: number): string | undefined {
		const el = arr[k] as Record<string, unknown> | undefined;
		const v = titleKey ? el?.[titleKey] : undefined;
		return typeof v === 'string' && v.trim() ? v : undefined;
	}
	/** What an untitled row reads as: the name its `aria-label` already spends,
	 *  `label` + the 1-based index. */
	function untitled(k: number): string {
		return label != null ? t.strings.elementUntitled(label, k + 1) : String(k + 1);
	}
	/** The summary is the anchor: a row closing above it is what would carry it off the fold,
	 *  and a row's subform hangs under its own summary (`hold.ts`). */
	function toggleRow(id: string, summary: HTMLElement): void {
		holdInView(summary, () => {
			openId = openId === id ? undefined : id;
		});
	}

	// The awaited flush below is the only work that outlives a gesture here, so the
	// span carries no cancellers: it is the liveness `focusAfterFlush` asks for.
	const span = createLifespan();
	onDestroy(() => span.end());

	function emptyElement(): unknown {
		if (control === 'prose') return emptyContent();
		if (control === 'object') return {};
		return '';
	}

	function commitElement(k: number, next: unknown): void {
		const copy = arr.slice();
		// A cleared element control commits `undefined` (the unset rung), but an
		// array slot is positional: an array defaults as a whole (`[]`), no
		// per-element `default:` to fall back to. Keep the slot as the type's empty
		// element, not an array hole.
		copy[k] = next === undefined ? emptyElement() : next;
		onCommit(copy);
	}
	/** Insert an empty element after `k` (`-1` prepends) and take focus to it. */
	function insertAfter(k: number): void {
		const id = seq.next();
		const at = k + 1;
		ids = [...ids.slice(0, at), id, ...ids.slice(at)];
		const next = arr.slice();
		next.splice(at, 0, emptyElement());
		onCommit(next);
		// A row added is a row to fill in, so an object element arrives open: landing on
		// a collapsed empty summary would make adding one a two-press gesture.
		if (control === 'object') openId = id;
		focusAfterFlush(id);
	}
	function add(): void {
		insertAfter(ids.length - 1);
	}
	function remove(k: number): void {
		const dropped = ids[k];
		const next = ids.filter((_, i) => i !== k);
		ids = next;
		delete els[dropped];
		delete rowEls[dropped];
		// The open row can be the one removed; `openId` is cleared with it rather than
		// left naming an element that has gone.
		if (openId === dropped) openId = undefined;
		onCommit(arr.filter((_, i) => i !== k));
		// Focus lands on the element before the removed one, or on the one that slid
		// into its place; on the add affordance once the list is empty, which is then
		// the only thing left to hold it. Clicking the remove needs this as much as the
		// key does: the button under the pointer is part of what it destroys.
		focusAfterFlush(next[Math.max(k - 1, 0)]);
	}
	/** Take the caret: the first element, or the add affordance when the list is empty;
	 * which is then the only thing there is to land on, and the next thing the user
	 * wants anyway. Reached by a label click and by the editor's landing verbs, which
	 * ask one function so they cannot disagree (`Field`, `leaves.ts`). */
	export function focus(): void {
		if (ids.length === 0) return void addEl?.focus();
		if (control === 'object') return focusObjectRow(ids[0]);
		els[ids[0]]?.focus();
	}
	/** An object row's landing: inside the subform when that row is the open one, on
	 *  the row's own summary otherwise — a collapsed row's control is its summary. */
	function focusObjectRow(id: string): void {
		if (id === openId && openObjEl) return openObjEl.focus();
		rowEls[id]?.querySelector<HTMLElement>('.qm-element-summary')?.focus();
	}
	/** The box an arrival wash blooms in (`leaves.ts`, `core/bloom.ts`): the elements,
	 * not the header above them. This component owns the field's label, so the wrapper
	 * `Field` blooms every other control inside would wash the label here too. Empty,
	 * the box is `display: none` and the landing is answered by the focus the add
	 * affordance takes. */
	export function washBox(): HTMLElement | undefined {
		return rowsEl;
	}
	/** Take the caret to element `k`, at USV `pos` where the row's control can take one:
	 * what a landing on an element address resolves to (`leaves.ts`). The index resolves
	 * to the element's session id here, at the call, never carried as one — an index is
	 * stale the moment anything above it splices. Past the live list it falls back to
	 * {@link focus}: the field is right and the row is gone, which is a landing off a
	 * compile the document has moved past.
	 *
	 * An absent `pos` is the placement rung, exactly as on `Landing`. A row that takes
	 * no offset gets the bare focus: a `string` element, whose input has no coordinate
	 * to spend one in and which the compile never addresses.
	 *
	 * The row's box comes back with the landing: the arrival wash is the address's own
	 * granularity, and one row is what an element address named. A fallback to the
	 * field answers `undefined`, which is the field's box again (`leaves.ts`). */
	export function focusElement(k: number, pos?: number): HTMLElement | undefined {
		const id = ids[k];
		// A collapsed row holds no control for a caret to land in, so opening it is part
		// of the landing rather than something the user does first: a preview click that
		// resolves into an element has to arrive somewhere the caret can sit.
		if (control === 'object') {
			if (id === undefined) {
				focus();
				return undefined;
			}
			openId = id;
			void focusAfterFlush(id);
			return rowEls[id];
		}
		const el = id === undefined ? undefined : els[id];
		if (!el) {
			focus();
			return undefined;
		}
		if (pos != null && el.setCaret) el.setCaret(pos);
		else el.focus();
		return rowEls[id];
	}
	/** Focus element `id` after the flush, never in the same tick: a mutation commits
	 * the array by value, so the parent re-derives and the row does not exist until
	 * then. `undefined` is the empty list: the add affordance.
	 *
	 * The commit that schedules this can also remove the card holding the field, which
	 * unmounts this component inside the window (core/teardown.ts). */
	async function focusAfterFlush(id: string | undefined): Promise<void> {
		if (!(await span.resumes(tick()))) return;
		if (id === undefined) return void addEl?.focus();
		if (control === 'object') return focusObjectRow(id);
		els[id]?.focus();
	}
	/** Whether element `k` reads empty to the user. A text element's committed value
	 * lags the input: a cleared field commits at `change`, not per keystroke
	 * ({@link TextField}); so the input's own value is the truth. A prose element
	 * commits every edit, so the committed `Content` is; an authored string, the
	 * transport-door rest, is empty when it has no characters. */
	function elementEmpty(k: number, target: EventTarget | null): boolean {
		if (control === 'prose') {
			const el = arr[k];
			if (typeof el === 'string') return el.length === 0;
			return !(el as Content | undefined)?.text;
		}
		return target instanceof HTMLInputElement && !target.value;
	}
	/**
	 * The element keyboard contract. Both keys ride the element control's own keydown
	 * (the input's, or the PM view's through `handleDOMEvents`) since neither
	 * surface is a place a keymap of this component's could sit. An `object` element
	 * wires neither: its row is a summary button, whose Enter is the disclosure's.
	 */
	function onElementKey(e: KeyboardEvent, k: number): void {
		if (control === 'object' || e.isComposing) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			insertAfter(k);
		} else if (e.key === 'Backspace' && !e.repeat && elementEmpty(k, e.target)) {
			// Destructive with nothing to undo it, so it takes a deliberate press:
			// `repeat` is a held key running on past the character it just cleared, and
			// the emptiness test reads the state before this keystroke applies; so the
			// press that empties an element never also removes it.
			e.preventDefault();
			remove(k);
		}
	}
</script>

<div
	class="qm-array"
	class:empty={ids.length === 0}
	role="group"
	aria-labelledby={label != null ? labelId : undefined}
	aria-describedby={description ? descriptionId : undefined}
>
	<div class="qm-array-header">
		{#if label != null}
			<FieldLabel
				{label}
				id={labelId}
				{descriptionId}
				onActivate={focus}
				{required}
				{description}
			/>
		{:else}
			<span></span>
		{/if}
		<button
			type="button"
			class="qm-add-el qm-chip qm-focus-ring qm-tap-floor"
			bind:this={addEl}
			onclick={add}>{t.strings.arrayAdd}</button
		>
	</div>
	<div class="qm-array-rows" class:empty={ids.length === 0} bind:this={rowsEl}>
		{#each ids as id, k (id)}
			{#if control === 'object'}
				{@const open = openId === id}
				{@const shown = elementTitle(k)}
				<div class="qm-array-row qm-element" class:open bind:this={rowEls[id]}>
					<!-- The head is the row in collapsed form, and it is a box: the element IS
					     a value, the way the enum trigger is, and the remove slab's grammar
					     (the box's two end-side corners) needs corners to take. So a list of
					     records measures like a list of inputs whatever the element type. -->
					<div class="qm-element-head">
						<button
							type="button"
							class="qm-control-box qm-focus-ring qm-element-summary"
							aria-expanded={open}
							onclick={(e) => toggleRow(id, e.currentTarget)}
						>
							<!-- Leading, and it rotates: trailing is the figure for pushing a new
							     screen, where this unfolds in place. Same glyph, same rotation and
							     same rung as the accordion's, so the surface has one disclosure. -->
							<Icon name="chevron-right" class="qm-el-chevron" size={CHEVRON} />
							{#if shown}
								<span class="qm-element-title">{shown}</span>
							{:else}
								<span class="qm-element-title untitled">{untitled(k)}</span>
							{/if}
						</button>
						<button
							type="button"
							class="qm-icon-btn qm-remove qm-focus-ring"
							title={t.strings.arrayRemove}
							onclick={() => remove(k)}><Icon name="minus" /></button
						>
					</div>
					{#if open}
						<ObjectField
							bind:this={openObjEl}
							value={(arr[k] ?? {}) as Record<string, unknown>}
							properties={items?.properties}
							label={label != null ? `${label} ${k + 1}` : undefined}
							idBase={idBase != null ? `${idBase}-e-${id}` : undefined}
							contentAt={(path, plaintext) => contentAt([k, ...path], plaintext)}
							onCommit={(obj) => commitElement(k, obj)}
						/>
					{/if}
				</div>
			{:else}
				<div class="qm-array-row" bind:this={rowEls[id]}>
					{#if control === 'prose'}
						<ProseValue
							bind:this={els[id]}
							content={() => contentAt([k], items?.type === 'plaintext') ?? emptyContent()}
							plaintext={items?.type === 'plaintext'}
							label={label != null ? `${label} ${k + 1}` : undefined}
							onChange={(rt) => commitElement(k, rt)}
							onKey={(e) => onElementKey(e, k)}
						/>
					{:else}
						<TextField
							bind:this={els[id]}
							value={String(arr[k] ?? '')}
							label={label != null ? `${label} ${k + 1}` : undefined}
							onCommit={(v) => commitElement(k, v)}
							onKey={(e) => onElementKey(e, k)}
						/>
					{/if}
					<button
						type="button"
						class="qm-icon-btn qm-remove qm-focus-ring"
						title={t.strings.arrayRemove}
						onclick={() => remove(k)}><Icon name="minus" /></button
					>
				</div>
			{/if}
		{/each}
	</div>
</div>

<style>
	.qm-array {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
	}
	/* The array's first line is the row's label line: this component owns the label
	 track (Field.svelte). Arrays never pack (`packable`), so the chip's tap floor is
	 free to size the header; a caption on this line would have had to match
	 `.qm-field-label-row`. */
	.qm-array-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--_qm-space-2);
	}
	/* The elements, in a box of their own: the arrival wash blooms here rather than over
	 the wrapper `Field` hands this component (`washBox`), which is the label's box too.
	 Positioned for the wash's inset child, and rounded to the rung a row's own box
	 draws, the way `.qm-field-control` is for every other control.

	 `display: none` when there are no elements, so the header does not stand a gap above
	 an empty box; a wash over it then paints nothing, which is what an array with
	 nothing in it has to show. */
	.qm-array-rows {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
		border-radius: var(--_qm-radius-inner);
	}
	.qm-array-rows.empty {
		display: none;
	}
	/* A grid rather than a block: an `<input>` is inline-level and would sit on a
	 baseline, standing the row a descender taller than the box the slab measures itself
	 against. `minmax(0, …)` because a long unbroken value grows an `auto` track, and the
	 edge with it. */
	.qm-array-row {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		/* The corners the row's wash takes, an element landing blooming here rather than
		 over the whole list (`focusElement`): the row draws no box of its own, so the
		 radius it lends the wash is the one its element's box draws. */
		border-radius: var(--_qm-radius-inner);
	}
	/* The end inset the slab stands in, taken off whichever box the element drew:
	 `.qm-input` is the text element, `.qm-control-box` the prose one and an object row's
	 summary. `:global`, because the box belongs to the child component's markup and the
	 scope class stops at this component's. The longhand beats the family's `padding` shorthand
	 without a specificity fight: this block is unlayered and `controls.css` is not. */
	.qm-array-row :global(.qm-input),
	.qm-array-row :global(.qm-control-box) {
		padding-inline-end: var(--_qm-tap-min);
	}
	/* The box's end wall, floor to ceiling: a height of its own would leave a sliver of
	 well above or below, and the corners it takes are the box's — the end-side pair keeps
	 `.qm-icon-btn`'s radius, which is the same rung the box draws.

	 It comes up on its own row rather than on the field: a destructive control is offered
	 by the row the pointer is on, not by every row at once. Hover is where it says
	 destructive, ink with fill, a tint alone being a wash under a label-toned glyph. */
	.qm-remove {
		position: absolute;
		inset-block: 0;
		inset-inline-end: 0;
		width: var(--_qm-tap-min);
		color: var(--_qm-ink-label);
		opacity: var(--_qm-opacity-idle);
		border-start-start-radius: 0;
		border-end-start-radius: 0;
		transition:
			opacity var(--_qm-duration-fast) var(--_qm-ease-reverse),
			background-color var(--_qm-duration-fast) var(--_qm-ease-reverse),
			color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-remove :global(svg) {
		width: var(--_qm-glyph-control);
		height: var(--_qm-glyph-control);
	}
	.qm-array-row:hover .qm-remove,
	.qm-array-row:focus-within .qm-remove {
		opacity: 1;
	}
	.qm-remove:hover {
		background: var(--_qm-danger-tint);
		color: var(--_qm-danger);
	}
	/* ── An object element ──────────────────────────────────────────────────────
	 The row is a summary and the subform hangs under it. `row-gap` rather than a
	 margin on the subform, because the distance between a control and what it has
	 unfolded belongs to the thing stacking them: the variant field spends its own `gap` on
	 exactly this, and what `ObjectField` adds is the cap on its own stroke, equal at both
	 of its ends. */
	.qm-element {
		row-gap: var(--_qm-space-2);
	}
	/* The slab measures the head, not the row: an open element is the head plus
	 everything it unfolded, and a destructive control belongs to the line it sits on
	 rather than to all of that. Positioned, so `.qm-remove` anchors here. */
	.qm-element-head {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	/* A box, which the button family otherwise is not: the row IS the element, a value
	 in collapsed form the way the enum trigger is one, and the slab's grammar — the
	 box's two end-side corners — needs a box with corners to take. It carries
	 `.qm-control-box`, so the fill, the radius, the inset and the type are the recipe's
	 (controls.css) and a list of records measures like the list of inputs beside it.
	 The end inset the slab stands in arrives from the row's own rule above. */
	.qm-element-summary {
		display: flex;
		align-items: center;
		gap: var(--_qm-space);
		width: 100%;
		box-sizing: border-box;
		text-align: start;
		cursor: pointer;
	}
	/* No hover fill: a well does not fill under the pointer anywhere on this surface.
	 The chevron's ink is the cue, which is the accordion header's own ladder. */
	.qm-element-summary :global(.qm-el-chevron) {
		flex-shrink: 0;
		display: block;
		color: var(--_qm-ink-label);
		transform: rotate(0deg);
		transform-origin: center;
		transition:
			transform var(--_qm-duration-slow) var(--_qm-ease-reverse),
			color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-element-summary:hover :global(.qm-el-chevron),
	.qm-element.open :global(.qm-el-chevron) {
		color: var(--_qm-ink);
	}
	.qm-element.open :global(.qm-el-chevron) {
		transform: rotate(90deg);
	}
	/* The title is the element's own value, so it reads at the ink a written value
	 takes, on one line however long the cell runs. An untitled row has nothing written
	 in it yet and says so the way every other empty rung does. */
	.qm-element-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.qm-element-title.untitled {
		color: var(--_qm-ink-label);
		font-style: italic;
	}
	/* The label line's own type: size, weight and leading are `.qm-field-label`'s, so
	 the two read as one register. Inner radius: the chip family is the card's, and this
	 box is a line of type. The chip's tap floor is given back (`.qm-tap-floor`),
	 and the padding with it, so the drawn box is the line and the target is the floor.
	 It rests dim and comes up under the pointer; empty, it is the way in. */
	.qm-add-el {
		padding: 0 var(--_qm-space);
		font-weight: var(--_qm-weight-mid);
		line-height: var(--_qm-leading-tight);
		border-radius: var(--_qm-radius-inner);
		opacity: var(--_qm-opacity-idle);
	}
	.qm-add-el:hover,
	.qm-add-el:focus-visible {
		opacity: 1;
	}
	.qm-array.empty .qm-add-el {
		opacity: 1;
	}
	@media (hover: none) {
		.qm-add-el,
		.qm-remove {
			opacity: var(--_qm-opacity-muted);
		}
	}
</style>
