<!--
 An `array` field → an add/remove repeater. Elements commit by value: every
 edit / add / remove / move rebuilds the whole array and hands it to the parent's typed
 `writer.set(field, wholeArray)` (arrays are not op-addressed). Element control
 by `items.type`: `richtext` / `plaintext` → a prose element
 ({@link ProseValue}), `object` → a record row, everything else → a text input. The
 add chip sits in the label header row (space-between with the field label);
 {@link Field} skips its own label for array controls and hands this component the
 label track with it.

 **An `object` element draws in one of two figures over one row machine.** Collapsed, the
 row is its own summary — a box, titled by `items.ui.title` over the row's cells or by the
 first of them whose words are the row's own — and opens onto {@link ObjectField}, one at a
 time: stacking the subforms instead would nest a field one level past the depth the
 subform's own vertical draws, once per row. Where the field's `ui.layout` asks for a table
 and every cell is one line high ({@link tabular}), the same rows draw as a grid instead,
 each one's cells mounted in the caller's columns; nothing opens, because nothing is hidden.

 The machine under both is the same one — the session ids, the add and remove, the move,
 the landing, the wash box — so a landing walks one ladder and not two. What the figure
 changes is which of them a row answers with: a collapsed row opens before it takes a
 caret, a table row is already open.

 The row actions are inside the element: a slab over the end of the element's own box,
 taking its two end-side corners. So a row's box is the element's box, and an array's rows
 end where every other field's control does. On an object element that box is the summary
 rather than the open row: a destructive control belongs to the line it sits on, not to
 everything that line has unfolded.

 **Reorder is ↑/↓ on an object row**, the card header's own pair at the row's rung, with
 Alt+arrows as the keyboard twin: a mis-order in a list of strings is fixed by editing in
 place, and a record of four cells is not. A scalar or prose row keeps the edit-in-place
 rule and draws none. One splice of the ids and of the values together, so an element
 keeps its id for life, the surviving order never permutes, and no prose leaf inside a
 moved row remounts.

 Keys carry the list without the mouse: Enter inserts a
 sibling below and takes the caret there, Backspace on an empty element removes it
 and hands focus back up the list.
-->
<script lang="ts">
	import { wording } from './strings.js';

	// The surface's words, ambient from the editor root; the package's English
	// off-tree, so this component renders standalone too.
	const t = wording();
	import { onDestroy, flushSync, tick } from 'svelte';
	import type { Content, PathStep, QuillFieldSchema } from '@quillmark/wasm';
	import { emptyContent } from '../core/codec/index.js';
	import { createLifespan } from '../core/teardown.js';
	import {
		IdSeq,
		controlKind,
		elementSummary,
		obliged,
		propertyLabel,
		tabular
	} from './structure.js';
	import { holdInView } from './hold.js';
	import { reorder } from './motion.js';
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
		/**
		 * This array field's own schema: `items` is the element declaration, `max:` the
		 * element count past which it overflows the page it is laid out on, and `ui.layout`
		 * the figure it asks for. One prop rather than three, so what the repeater reads
		 * off the schema is the schema and not a hand-copied subset of it.
		 */
		schema: QuillFieldSchema | undefined;
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
		contentAt: (path: PathStep[]) => Content | undefined;
		onCommit: (arr: unknown[]) => void;
	}
	let {
		value,
		schema,
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
	const items = $derived(schema?.items);
	const max = $derived(schema?.max);
	const control = $derived(items ? controlKind(items) : 'text');
	const arr = $derived((value ?? []) as unknown[]);
	// The grid arm: a request off the schema, answered by the row's own shape and by
	// nothing measured (`tabular`).
	const table = $derived(tabular(schema));
	const columns = $derived(Object.entries(items?.properties ?? {}));

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
			for (const id of ids.slice(n)) drop(id);
			ids = ids.slice(0, n);
		}
	});

	/** The count against the cap, once the schema declares one. Nothing draws for a
	 *  document already over it: `validation::cardinality` is a warning, and warnings do
	 *  not draw (VISUAL_EDITOR §Diagnostics) — a host reads it off `quill.validate`. */
	const atMax = $derived(max != null && ids.length >= max);
	/** Where the count parks, in the field's own id space one segment down, so the group
	 *  can name it beside the description rather than beside nothing. */
	const countId = $derived(idBase != null ? `${idBase}-count` : undefined);
	/** What the group is described by: its `description`, then the cap. Absent where
	 *  neither is drawn — a reference pointing at nothing describes nothing, silently. */
	const describedBy = $derived(
		[description ? descriptionId : undefined, max != null ? countId : undefined]
			.filter(Boolean)
			.join(' ') || undefined
	);

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
	// element landing blooms in ({@link focusPath}), and what an object row's
	// summary is found through. A row is a box whatever its element type, so the two
	// element shapes register alike.
	const rowEls: Record<string, HTMLElement | undefined> = $state({});
	// The rows' subforms, on that same key. A map and not the single ref the collapsed
	// figure would need: the table arm mounts one per row, and a landing walking past
	// this rung asks the same entry under either figure.
	const rowSubEls: Record<
		string,
		| { focus: () => void; focusPath?: (path: PathStep[], pos?: number) => HTMLElement | undefined }
		| undefined
	> = $state({});
	let addEl: HTMLButtonElement | undefined = $state();
	let rowsEl: HTMLElement | undefined = $state();

	/** Forget an element: every keyed map, on every path that drops an id. */
	function drop(id: string): void {
		delete els[id];
		delete rowEls[id];
		delete rowSubEls[id];
	}

	// ── Object elements: one open at a time ──────────────────────────────────────
	// So an array of ten records is ten lines and one figure, whatever its length. The
	// table arm holds the state and draws nothing off it: its rows are open by
	// construction, so `openId` is what a landing sets on the way past rather than a
	// disclosure anyone operates.
	let openId = $state<string | undefined>(undefined);
	const openRow = (id: string): boolean => table || openId === id;

	/** A collapsed row's own words, or `undefined` while the row has none. */
	function elementTitle(k: number): string | undefined {
		return elementSummary(items, arr[k]);
	}
	/** What an untitled row reads as: the name its `aria-label` already spends,
	 *  `label` + the 1-based index. */
	function untitled(k: number): string {
		return label != null ? t.strings.elementUntitled(label, k + 1) : String(k + 1);
	}
	/** The name a row's cells compose their own from, and the row's own in the a11y tree. */
	function rowName(k: number): string | undefined {
		return label != null ? `${label} ${k + 1}` : undefined;
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
	/** Insert an empty element after `k` (`-1` prepends) and take focus to it. Declines at
	 *  the cap, which every insertion path reaches through here. */
	function insertAfter(k: number): void {
		if (atMax) return;
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
		drop(dropped);
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
	/**
	 * Swap element `k` with its neighbour one slot in `dir`, a no-op at either edge: the
	 * step the card stack's own reorder takes, at the row's rung.
	 *
	 * The ids move with the values in one operation, which is the mechanism insert and
	 * remove already use, so the moved row keeps its session id — the open row stays
	 * open across its own move, its subform keeps its caret, and no prose leaf inside it
	 * remounts. Focus rides the moved node; a browser that drops it on the reinsertion
	 * is answered after the flush, where the row is where it landed.
	 */
	// The row's arming window, the card stack's rule at the row's rung: `animate:` fires
	// wherever a keyed slot's rect moved, and a row growing under the caret moves every
	// row below it — a layout change with no trip in it. The move arms the gesture and
	// the frame it lands in disarms it.
	let reordering = false;
	let reorderFrame = 0;
	const isReordering = (): boolean => reordering;
	span.onEnd(() => cancelAnimationFrame(reorderFrame));

	function move(k: number, dir: -1 | 1): void {
		const to = k + dir;
		if (to < 0 || to >= ids.length) return;
		reordering = true;
		reorderFrame = requestAnimationFrame(() => (reordering = false));
		const id = ids[k];
		const held = document.activeElement;
		const inside = held instanceof HTMLElement && rowEls[id]?.contains(held) === true;
		const nextIds = ids.slice();
		[nextIds[k], nextIds[to]] = [nextIds[to], nextIds[k]];
		ids = nextIds;
		const next = arr.slice();
		[next[k], next[to]] = [next[to], next[k]];
		onCommit(next);
		if (inside) void restoreAfterFlush(id, held as HTMLElement);
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
	/** An object row's landing: inside the subform where that row has one mounted — every
	 *  row in the table arm, the open row in the collapsed one — and on the row's own
	 *  summary otherwise, a collapsed row's control being its summary. */
	function focusObjectRow(id: string): void {
		const sub = rowSubEls[id];
		if (sub) return sub.focus();
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
	/**
	 * Land at `path` inside this repeater, at USV `pos` where the leaf it reaches can take
	 * one (`leaves.ts`). The first step is an element index and the rest is that row's own
	 * to walk, so a click on a tour title two rungs down opens the vector, opens the tour
	 * and places the caret, one rung resolving at a time.
	 *
	 * The index resolves to the element's session id here, at the call, never carried as
	 * one — an index is stale the moment anything above it splices. Past the live list it
	 * falls back to {@link focus}: the field is right and the row is gone, which is a
	 * landing off a compile the document has moved past.
	 *
	 * An absent `pos` is the placement rung, exactly as on `Landing`. A row that takes no
	 * offset gets the bare focus: a `string` element, whose input has no coordinate to
	 * spend one in, and a subform, which has none either.
	 *
	 * The box that comes back is the innermost one the address named, which is the
	 * arrival wash's own granularity: a nested row where the walk reached one, this row
	 * otherwise. Opening is part of the landing rather than something the user does
	 * first — a collapsed row holds no control for a caret to sit in — so the row is
	 * opened and flushed before the walk goes on, and the box it hands back is the one
	 * that is now mounted.
	 */
	export function focusPath(path: PathStep[], pos?: number): HTMLElement | undefined {
		const [k, ...rest] = path;
		if (typeof k !== 'number') return undefined;
		const id = ids[k];
		if (id === undefined) {
			focus();
			return undefined;
		}
		if (control !== 'object') {
			// A scalar or prose element is a leaf: nothing inside it answers a further step,
			// so the row is the deepest rung the address reaches and takes the caret there
			// rather than abandoning the landing (`leaves.ts`).
			const el = els[id];
			if (!el) {
				focus();
				return undefined;
			}
			if (pos != null && el.setCaret) el.setCaret(pos);
			else el.focus();
			return rowEls[id];
		}
		if (!openRow(id)) {
			openId = id;
			flushSync();
		}
		if (rest.length) {
			const sub = rowSubEls[id];
			if (sub?.focusPath) return sub.focusPath(rest, pos) ?? rowEls[id];
		}
		focusObjectRow(id);
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
	/** Put the caret back where the move took it from: the same node where the reinsertion
	 *  kept it focusable, the row's own landing otherwise.
	 *
	 *  A row moved to an edge disables the control that moved it, and a disabled button
	 *  holds no focus — so the press that lands a row first would otherwise cost the
	 *  keyboard its place. The row is what the gesture was about, and its summary is where
	 *  the next one starts from. */
	async function restoreAfterFlush(id: string, held: HTMLElement): Promise<void> {
		if (!(await span.resumes(tick()))) return;
		if (document.activeElement === held) return;
		const dead = 'disabled' in held && (held as HTMLButtonElement).disabled;
		if (held.isConnected && !dead) return held.focus();
		focusObjectRow(id);
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
	 * wires neither: its row is a summary button, whose Enter is the disclosure's, and a
	 * Backspace inside a record of cells would destroy the other three.
	 */
	function onElementKey(e: KeyboardEvent, k: number): void {
		if (control === 'object' || e.isComposing) return;
		if (e.key === 'Enter') {
			// Claimed only where it acts: at the cap there is no sibling to open, and a key
			// swallowed for a gesture that does not happen is a dead press. The count
			// beside the add is what says why (§"A repeater's cap").
			if (atMax) return;
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
	/** The reorder's keyboard twin, on the control the row's own focus rests on: Alt and
	 *  an arrow, which is the binding the table island already spends on the same op. */
	function onRowKey(e: KeyboardEvent, k: number): void {
		if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
		e.preventDefault();
		move(k, e.key === 'ArrowUp' ? -1 : 1);
	}
</script>

<div
	class="qm-array"
	class:empty={ids.length === 0}
	role="group"
	aria-labelledby={label != null ? labelId : undefined}
	aria-describedby={describedBy}
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
		<div class="qm-array-cap">
			<!-- The cap is drawn, not parked in a `title`: a disabled button takes no focus,
			     so a tooltip on the chip reaches neither a screen reader nor a touch user,
			     and "disabled" is a promise that there is a state in which you could
			     (VISUAL_EDITOR §"Enum policy"). It rides the group's own description, so the
			     count is read on the way in whether or not the chip can be reached. -->
			{#if max != null}
				<span class="qm-array-count" id={countId}>{t.strings.arrayCount(ids.length, max)}</span>
			{/if}
			<button
				type="button"
				class="qm-add-el qm-chip qm-focus-ring qm-tap-floor"
				bind:this={addEl}
				disabled={atMax}
				onclick={add}>{t.strings.arrayAdd}</button
			>
		</div>
	</div>
	{#if table && ids.length > 0}
		<!-- The header names each column once for a reader who can see it; the name a
		     control is reached by is the `<label for>` inside its own cell, which the
		     table rung takes off the page (`ObjectField`, `layout="row"`). So these words
		     are chrome, and announcing them a second time is noise — and nothing focusable
		     stands in them, an `aria-hidden` focus stop being a stop nothing can name.

		     It is drawn over rows and never over nothing, the rule the rows box already
		     holds for itself: a strip of column names above an empty list names columns
		     the document has no line in. -->
		<div class="qm-table-head" style="--row-cols: {columns.length}" aria-hidden="true">
			{#each columns as [key, sub] (key)}
				<span class="qm-table-col"
					>{propertyLabel(key, sub)}{#if obliged(sub)}<span class="qm-table-req">*</span>{/if}</span
				>
			{/each}
		</div>
	{/if}
	<div class="qm-array-rows" class:empty={ids.length === 0} bind:this={rowsEl}>
		{#if control === 'object' && table}
			{#each ids as id, k (id)}
				<!-- One line of the grid: the row's cells are the subform's, mounted in this
					     row's own columns rather than under a summary. Nothing opens, so the
					     disclosure and the title go with it. -->
				<!-- The twin binds on the row rather than on a control: a table row draws no
					     summary, and its cells are what the keyboard is in when the gesture is
					     made. The row is a named group with it, which is what the collapsed
					     figure's summary says out loud and a grid of cells otherwise says only
					     to the eye.

					     The key is delegated and never the row's own: every control the press
					     can be made from is focusable and in the tab order, and the row is not
					     a target. That is the case the rule is not about. -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="qm-array-row qm-table-row"
					animate:reorder={isReordering}
					style="--row-cols: {columns.length}; --row-actions: 3"
					role="group"
					aria-label={rowName(k)}
					bind:this={rowEls[id]}
					onkeydown={(e) => onRowKey(e, k)}
				>
					<ObjectField
						bind:this={rowSubEls[id]}
						layout="row"
						value={(arr[k] ?? {}) as Record<string, unknown>}
						properties={items?.properties}
						label={rowName(k)}
						idBase={idBase != null ? `${idBase}-e-${id}` : undefined}
						contentAt={(path) => contentAt([k, ...path])}
						onCommit={(obj) => commitElement(k, obj)}
					/>
					{@render rowActions(k, rowName(k))}
				</div>
			{/each}
		{:else if control === 'object'}
			{#each ids as id, k (id)}
				{@const open = openId === id}
				{@const shown = elementTitle(k)}
				<div
					class="qm-array-row qm-element"
					animate:reorder={isReordering}
					class:open
					style="--row-actions: 3"
					bind:this={rowEls[id]}
				>
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
							onkeydown={(e) => onRowKey(e, k)}
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
						{@render rowActions(k, rowName(k))}
					</div>
					{#if open}
						<ObjectField
							bind:this={rowSubEls[id]}
							value={(arr[k] ?? {}) as Record<string, unknown>}
							properties={items?.properties}
							label={rowName(k)}
							idBase={idBase != null ? `${idBase}-e-${id}` : undefined}
							contentAt={(path) => contentAt([k, ...path])}
							onCommit={(obj) => commitElement(k, obj)}
						/>
					{/if}
				</div>
			{/each}
		{:else}
			{#each ids as id, k (id)}
				<div class="qm-array-row" style="--row-actions: 1" bind:this={rowEls[id]}>
					{#if control === 'prose'}
						<ProseValue
							bind:this={els[id]}
							content={() => contentAt([k]) ?? emptyContent()}
							plaintext={items?.type === 'plaintext'}
							label={rowName(k)}
							onChange={(rt) => commitElement(k, rt)}
							onKey={(e) => onElementKey(e, k)}
						/>
					{:else}
						<TextField
							bind:this={els[id]}
							value={String(arr[k] ?? '')}
							label={rowName(k)}
							onCommit={(v) => commitElement(k, v)}
							onKey={(e) => onElementKey(e, k)}
						/>
					{/if}
					<div class="qm-row-actions">
						<button
							type="button"
							class="qm-icon-btn qm-remove qm-focus-ring"
							title={t.strings.arrayRemove}
							onclick={() => remove(k)}><Icon name="minus" /></button
						>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<!-- The trailing cluster an object row carries: the reorder pair and the remove, in that
     order, so the destructive one is last and takes the box's end corners. Disabled at
     the edges rather than absent, which is the card header's own rule at the row's rung:
     a control that comes and goes teaches its position twice. -->
{#snippet rowActions(k: number, name: string | undefined)}
	<div class="qm-row-actions">
		<button
			type="button"
			class="qm-icon-btn qm-focus-ring"
			title={name != null ? `${t.strings.arrayMoveUp} — ${name}` : t.strings.arrayMoveUp}
			disabled={k === 0}
			onclick={() => move(k, -1)}><Icon name="chevron-up" /></button
		>
		<button
			type="button"
			class="qm-icon-btn qm-focus-ring"
			title={name != null ? `${t.strings.arrayMoveDown} — ${name}` : t.strings.arrayMoveDown}
			disabled={k === ids.length - 1}
			onclick={() => move(k, 1)}><Icon name="chevron-down" /></button
		>
		<button
			type="button"
			class="qm-icon-btn qm-remove qm-focus-ring"
			title={t.strings.arrayRemove}
			onclick={() => remove(k)}><Icon name="minus" /></button
		>
	</div>
{/snippet}

<style>
	/* A query container over the field's own width, which is what the grid arm steps its
	 columns at: the header and the rows are both inside it, so they read one answer and
	 line up without either measuring the other. */
	.qm-array {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
	}
	/* The array's first line is the row's label line: this component owns the label
	 track (Field.svelte). Arrays never pack (`grows`), so the chip's tap floor is
	 free to size the header; a caption on this line would have had to match
	 `.qm-field-label-row`. */
	.qm-array-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--_qm-space-2);
	}
	/* The cap and the chip are one piece of chrome with one answer, so they sit in one
	 box at the end of the header. */
	.qm-array-cap {
		display: flex;
		align-items: center;
		gap: var(--_qm-space);
	}
	/* The count reads as chrome rather than as a value: the label rung, at the label
	 size, beside a chip that reads at the same pair. */
	.qm-array-count {
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
		font-variant-numeric: tabular-nums;
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
		 over the whole list (`focusPath`): the row draws no box of its own, so the
		 radius it lends the wash is the one its element's box draws. */
		border-radius: var(--_qm-radius-inner);
	}
	/* The end inset the actions stand in, taken off whichever box the element drew:
	 `.qm-input` is the text element, `.qm-control-box` the prose one and an object row's
	 summary. One slab per action, the count riding the row as `--row-actions` because it
	 is the markup's fact and not the scale's. `:global`, because the box belongs to the
	 child component's markup and the scope class stops at this component's. The longhand
	 beats the family's `padding` shorthand without a specificity fight: this block is
	 unlayered and `controls.css` is not.

	 The child combinator is the whole of what keeps it to the row's own control: the
	 custom property inherits, and an open row has a subform of boxes under it that the
	 cluster does not stand in front of. A table row's cells are two boxes further down
	 for the same reason, and keep the recipe's own inset; the end the cluster needs is
	 the row's padding, one rule up. */
	.qm-array-row > :global(.qm-input),
	.qm-array-row > :global(.qm-control-box),
	.qm-element-head > .qm-element-summary {
		padding-inline-end: calc(var(--_qm-tap-min) * var(--row-actions));
	}
	/* The cluster's box: floor to ceiling at the end of the line it belongs to, so each
	 slab is the box's full height and a height of its own would leave a sliver of well
	 above or below.

	 It comes up on its own row rather than on the field: a destructive control is offered
	 by the row the pointer is on, not by every row at once. */
	.qm-row-actions {
		position: absolute;
		inset-block: 0;
		inset-inline-end: 0;
		display: flex;
		opacity: var(--_qm-opacity-idle);
		transition: opacity var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-array-row:hover > .qm-row-actions,
	.qm-array-row:focus-within > .qm-row-actions,
	.qm-element-head:hover > .qm-row-actions,
	.qm-element-head:focus-within > .qm-row-actions {
		opacity: 1;
	}
	.qm-row-actions button {
		width: var(--_qm-tap-min);
		padding: 0;
		color: var(--_qm-ink-label);
		border-radius: 0;
		transition:
			background-color var(--_qm-duration-fast) var(--_qm-ease-reverse),
			color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-row-actions :global(svg) {
		width: var(--_qm-glyph-control);
		height: var(--_qm-glyph-control);
	}
	/* The box's end wall keeps the box's corners, and only the last slab is against it.
	 Hover is where it says destructive, ink with fill, a tint alone being a wash under a
	 label-toned glyph. */
	.qm-row-actions .qm-remove {
		border-start-end-radius: var(--_qm-radius-inner);
		border-end-end-radius: var(--_qm-radius-inner);
	}
	.qm-remove:hover:not(:disabled) {
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
	 rather than to all of that. Positioned, so `.qm-row-actions` anchors here. */
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
	/* ── The grid arm ───────────────────────────────────────────────────────────
	 A row is a line of cells over the columns its schema declares, and every row lays
	 the same tracks, so the columns line up across the list without a table element or a
	 measurement. `--row-cols` is the property count, which is the markup's fact.

	 Stacked is the floor and the grid is the rung above it, at the width the section's
	 own capacity steps at (`.qm-capacity`, controls.css): one threshold on the surface
	 rather than a second one invented here. Below it the same cells stack, each under
	 the label it already carries, and the header goes — the same DOM under the other
	 figure, so nothing remounts and no prose leaf loses a caret to a resize. */
	.qm-table-head {
		display: none;
		column-gap: var(--_qm-space-2);
		padding-inline-end: calc(var(--_qm-tap-min) * 3);
	}
	.qm-table-col {
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The obligation the cell's own label carries and the table rung clips: the `*` is
	 the whole of what the surface says about it (VISUAL_EDITOR §"Structure mirrors the
	 schema"), so a column that asks says so where its name is drawn. Decoration here —
	 the header is out of the tree, and each control is still announced required by the
	 label it is named by. */
	.qm-table-req {
		color: var(--_qm-danger);
	}
	.qm-table-row {
		column-gap: var(--_qm-space-2);
		row-gap: var(--_qm-space);
		align-items: start;
		padding-inline-end: calc(var(--_qm-tap-min) * 3);
	}
	@container (min-width: 28rem) {
		.qm-table-head {
			display: grid;
			grid-template-columns: repeat(var(--row-cols), minmax(0, 1fr));
		}
		.qm-table-row {
			grid-template-columns: repeat(var(--row-cols), minmax(0, 1fr));
		}
		/* The column is named once, above, so each cell's own `<label for>` — what the
		 control is actually reached by — leaves the page rather than the DOM: clipped and
		 not `display: none`, which would take the name with it. */
		.qm-table-row :global(.qm-field-label-row) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		/* The guidance trigger goes out of the tree with it. A clipped box is still in the
		 tab order, so a table of four columns over ten rows would otherwise stand forty
		 focus stops in a 1×1 box nobody can see. What it opens is the `description`, which
		 each control still names through `aria-describedby`; the trigger returns at the
		 stacked rung, where the label it sits beside is drawn. */
		.qm-table-row :global(.qm-field-hint) {
			visibility: hidden;
		}
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
	.qm-add-el:hover:not(:disabled),
	.qm-add-el:focus-visible {
		opacity: 1;
	}
	.qm-array.empty .qm-add-el:not(:disabled) {
		opacity: 1;
	}
	@media (hover: none) {
		.qm-add-el,
		.qm-row-actions {
			opacity: var(--_qm-opacity-muted);
		}
	}
</style>
