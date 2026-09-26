<!--
 An `array` field → an add/remove repeater. Elements commit by value: every
 edit / add / remove / move rebuilds the whole array and hands it to the parent's typed
 `writer.set(field, wholeArray)` (arrays are not op-addressed). Element control
 by `items.type`: `richtext` / `plaintext` → a prose element
 ({@link ProseValue}), `object` → a summary row that opens onto a subform, or a
 table's row where the array asks for one and the cells are short, everything else →
 a text input. The add chip sits in the label header row (space-between with the field
 label); {@link Field} skips its own label for array controls and hands this component
 the label track with it. An array declaring `max:` disables the chip at the cap and
 draws the count beside it: a disabled button takes no focus, so a `title` reaches
 neither a screen reader nor a touch user, and the count is the carrier.

 An `object` element collapses: the row is its own summary — a box, titled by the
 row's first short text cell ({@link rowSummary}) — and opens onto {@link ObjectField},
 one at a time. Stacking the subforms instead would nest a field one level past the
 depth the subform's own vertical draws, once per row.
 Opening is therefore part of a landing rather than something the user does first:
 `focusPath` opens the row it is aimed at before it focuses, and hands the rest of the
 walk to the subform it opened, which is how a row two closed boxes down is reached.

 The table (`layout: 'table'`, VISUAL_EDITOR §"Structure mirrors the schema") is the
 same row machine in another presentation: the same ids, the same splices, the same
 landing and the same cell keys, over rows that are always open, each cell the
 property's ordinary control on the track the header names ({@link ObjectField}
 `bare`). Every row of it open, the whole of it stands where an open row's subform
 stands: a rung inside the field, behind the subform's vertical. A table composes by
 position, so it recurses into nothing: `arrayLayout` declines it for a row holding a
 container or a block prose cell.

 The row's controls are inside the element: a slab over the end of the element's own
 box, taking its two end-side corners — the remove, and on an `object` row the reorder
 pair before it. So a row's box is the element's box, and an array's rows end where
 every other field's control does. On an object element that box is the summary rather
 than the open row: a destructive control belongs to the line it sits on, not to
 everything that line has unfolded. A table's row carries the remove alone, in its last
 track and pinned to the end edge of the box the table scrolls in: every cell of the
 row is on the line, so a mis-order is a retype as it is in a list of strings, and the
 one gesture the row keeps never needs a scroll to reach.

 Keys carry the list without the mouse: Enter inserts a sibling below and takes the
 caret there, Backspace on an empty element removes it and hands focus back up the
 list, Alt+↑/↓ anywhere in an `object` row of the list moves it, the nearest row
 answering and never the record around a nested one. A move is one splice of the ids
 and of the values together, the mechanism insert and remove use, so an element keeps
 its id for life and no prose leaf inside it remounts; the open row stays open across
 its own move, and `animate:reorder` holds the moving row as it holds a card.

 An unset array whose `default:` holds elements draws them as its rows, at the default
 rung (`data-default` on the rows' box), since they are what prints. The rows are the
 declared literal rather than resolve's form, which completes a record against `items`:
 every gesture — an edit in a row, Enter, a remove, a move, the add chip — commits the
 whole array with the change in it, and a take writes only what the author declared.
 Removing the last row commits `[]`, the empty answer.
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
	import {
		IdSeq,
		baseType,
		controlKind,
		declaredContent,
		humanize,
		obliged,
		rowSummary,
		schemaAt,
		type ArrayLayout
	} from './structure.js';
	import { splitDeep, unrouted, type DeepDiagnostic } from './diagnostics.js';
	import type { LandingBox } from './leaves.js';
	import { holdInView } from './hold.js';
	import { reorder, reorderArm } from './motion.js';
	import Icon from './icons/Icon.svelte';
	import TextField from './TextField.svelte';
	import ObjectField from './ObjectField.svelte';
	import ProseValue from './ProseValue.svelte';
	import FieldLabel from './FieldLabel.svelte';
	import DiagnosticList from './DiagnosticList.svelte';
	import './controls.css';

	/** The disclosure glyph, at the size the accordion's own chevron takes: one
	 *  disclosure figure per surface, so it is one glyph at one size. */
	const CHEVRON = 16;

	interface Props {
		value: unknown[] | undefined;
		/** The declared `default:`: the rows an unset array draws, which a gesture takes. */
		fallback?: unknown[];
		items: QuillFieldSchema | undefined;
		/** How the elements draw: the record list, or the table an `array<object>` of
		 * short cells asks for (`arrayLayout`). */
		layout?: ArrayLayout;
		/** The schema's `max:`, past which the add chip disables and Enter stops
		 * inserting; `undefined` is no cap. */
		max?: number;
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
		/** The diagnostics routed into this array, each with its steps still to walk: one
		 * naming a row draws under that row — under its head while it is collapsed, under
		 * the cell once it is open — and one naming no row draws at the list's foot. */
		diagnostics?: readonly DeepDiagnostic[];
	}
	let {
		value,
		fallback,
		items,
		layout = 'list',
		max,
		label,
		required,
		description,
		labelId,
		descriptionId,
		idBase,
		contentAt,
		onCommit,
		diagnostics
	}: Props = $props();

	// The element control is the item schema's own, with no departure: a content-typed
	// element mounts the prose leaf its scalar field mounts, reading through
	// `contentAt` whatever the element rests as. An array declaring no `items`
	// has text elements.
	const control = $derived(items ? controlKind(items) : 'text');
	const table = $derived(layout === 'table' && control === 'object');
	const columns = $derived(Object.entries(items?.properties ?? {}));
	const defaulted = $derived(value == null && (fallback?.length ?? 0) > 0);
	const arr = $derived((value ?? fallback ?? []) as unknown[]);
	/** The rows' content read: the boundary's, or, while the rows are the default, the
	 *  literal's own leaf at the codec its declared type names. */
	function readAt(path: PathStep[]): Content | undefined {
		if (!defaulted) return contentAt(path);
		const leaf = schemaAt({ type: 'array', items }, path);
		let v: unknown = arr;
		for (const step of path) v = (v as Record<string | number, unknown> | undefined)?.[step];
		return leaf ? declaredContent(v, baseType(leaf) === 'richtext') : undefined;
	}
	const atCap = $derived(max != null && arr.length >= max);
	const routed = $derived(splitDeep(diagnostics));
	const foot = $derived(
		unrouted(routed, (step) => typeof step === 'number' && step >= 0 && step < arr.length)
	);

	// Parallel stable ids, one per element, kept in lockstep with the data below.
	// Seeded eagerly so a non-empty array renders its rows on the first pass:
	// an effect-only seed mounts every element editor in a second render.
	const seq = new IdSeq();
	// svelte-ignore state_referenced_locally
	let ids = $state<string[]>(seq.take((value ?? fallback ?? []).length));
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
	// A table row's cells, on the same key: the subform a landing and the column-keeping
	// Enter hop reach into. Every table row is open, so there is one per row where the
	// list holds one for the open row alone.
	type Subform = {
		focus: () => void;
		focusPath: (steps: readonly PathStep[], pos?: number) => LandingBox;
	};
	const cellEls: Record<string, Subform | undefined> = $state({});
	let addEl: HTMLButtonElement | undefined = $state();
	let rowsEl: HTMLElement | undefined = $state();
	function drop(id: string): void {
		delete els[id];
		delete rowEls[id];
		delete cellEls[id];
	}

	// ── Object elements: one open at a time ──────────────────────────────────────
	// So an array of ten records is ten lines and one figure, whatever its length.
	let openId = $state<string | undefined>(undefined);
	// The open row's subform, for the landing below. One entry, never a map: only one
	// row is open, so the ref is singular by the same rule the state is.
	let openObjEl = $state<Subform | undefined>();

	/** A collapsed row's own words, or `undefined` while it has none. */
	function elementTitle(k: number): string | undefined {
		return rowSummary(items, arr[k]);
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
	const rowName = (k: number): string | undefined =>
		label != null ? `${label} ${k + 1}` : undefined;
	/** A row control's name: its action, and the row, where the row has a name. */
	const rowAction = (action: string, k: number): string => {
		const row = rowName(k);
		return row != null ? t.strings.arrayRowAction(action, row) : action;
	};
	// The count's id, for the chip it describes: off the field's id space where there is
	// one, else this instance's own.
	const uid = $props.id();
	const countId = $derived(`${idBase ?? `qm-${uid}`}-count`);
	const columnTitle = (key: string, sub: QuillFieldSchema): string => sub.title ?? humanize(key);

	// The awaited flush below is the only work that outlives a gesture here, so the
	// span carries the reorder's frame and nothing else: it is the liveness
	// `focusAfterFlush` asks for.
	const span = createLifespan();
	const arm = reorderArm();
	span.onEnd(arm.cancel);
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
	/** Insert an empty element after `k` (`-1` prepends) and take focus to it: into
	 *  `column` where the gesture came from a table cell, so Enter keeps its column. A
	 *  no-op at the cap: no editor gesture commits an element past `max:`. */
	function insertAfter(k: number, column?: string): void {
		if (atCap) return;
		const id = seq.next();
		const at = k + 1;
		ids = [...ids.slice(0, at), id, ...ids.slice(at)];
		const next = arr.slice();
		next.splice(at, 0, emptyElement());
		onCommit(next);
		// A row added is a row to fill in, so an object element arrives open: landing on
		// a collapsed empty summary would make adding one a two-press gesture.
		if (control === 'object' && !table) openId = id;
		void focusAfterFlush(id, column);
	}
	function add(): void {
		insertAfter(ids.length - 1);
	}
	/** Remove element `k`. Focus lands on the element before it, or on the one that
	 *  slid into its place; on the add affordance once the list is empty, which is then
	 *  the only thing left to hold it. Clicking the remove needs this as much as the key
	 *  does: the button under the pointer is part of what it destroys. A table lands on
	 *  the control the gesture came from: `column`, so Backspace keeps its column as
	 *  Enter does, or the remove where `fromRemove` says one was pressed, which is
	 *  pinned and so keeps the clip where the pointer left it, where the first cell
	 *  would scroll the box back to its start on every press. */
	function remove(k: number, column?: string, fromRemove = false): void {
		const dropped = ids[k];
		const next = ids.filter((_, i) => i !== k);
		ids = next;
		drop(dropped);
		// The open row can be the one removed; `openId` is cleared with it rather than
		// left naming an element that has gone.
		if (openId === dropped) openId = undefined;
		onCommit(arr.filter((_, i) => i !== k));
		void focusAfterFlush(next[Math.max(k - 1, 0)], column, fromRemove);
	}
	/**
	 * Move element `k` one slot: one splice of the ids and of the values together, so
	 * the element keeps its id and everything mounted under it. A no-op at either edge.
	 * The control that was pressed rides with the row, so it is focused again once the
	 * flush has moved it: a node moved in the DOM is a node the browser blurred. An arrow
	 * the move carried to its edge is disabled and takes no focus, so its twin does.
	 */
	function move(k: number, dir: -1 | 1): void {
		const to = k + dir;
		if (to < 0 || to >= ids.length) return;
		const pressed = document.activeElement;
		arm.arm();
		const nextIds = ids.slice();
		const [id] = nextIds.splice(k, 1);
		nextIds.splice(to, 0, id);
		ids = nextIds;
		const next = arr.slice();
		const [v] = next.splice(k, 1);
		next.splice(to, 0, v);
		onCommit(next);
		void (async () => {
			if (!(await span.resumes(tick()))) return;
			if (!(pressed instanceof HTMLElement) || !pressed.isConnected) return;
			const target =
				pressed instanceof HTMLButtonElement && pressed.disabled
					? [pressed.previousElementSibling, pressed.nextElementSibling].find(
							(b) => b instanceof HTMLButtonElement && !b.disabled
						)
					: pressed;
			if (target instanceof HTMLElement) target.focus();
		})();
	}
	/** Take the caret: the first element, or the add affordance when the list is empty;
	 * which is then the only thing there is to land on, and the next thing the user
	 * wants anyway. Reached by a label click and by the editor's landing verbs, which
	 * ask one function so they cannot disagree (`Field`, `leaves.ts`). */
	export function focus(): void {
		if (ids.length === 0) return void addEl?.focus();
		if (table) return void cellEls[ids[0]]?.focus();
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
	/**
	 * Land at `steps`: element `steps[0]`, and the rest of the walk inside its subform,
	 * at USV `pos` where the leaf the walk ends in can take one ({@link
	 * FieldControl.focusPath}). The index resolves to the element's session id here, at
	 * the call, never carried as one — an index is stale the moment anything above it
	 * splices. Past the live list it falls back to {@link focus}: the field is right and
	 * the row is gone, which is a landing off a compile the document has moved past.
	 *
	 * A collapsed row holds no control for a caret to land in, so opening it is part of
	 * the landing rather than something the user does first, and the subform it opens
	 * exists one flush later: that arm answers after the flush, with the rest of the
	 * walk handed to the subform then. An absent `pos` is the placement rung, exactly as
	 * on `Landing`; a row that takes no offset gets the bare focus.
	 *
	 * The row's box comes back with the landing, or the innermost row a deeper walk
	 * opened: the arrival wash is the address's own granularity. A fallback to the field
	 * answers `undefined`, which is the field's box again (`leaves.ts`).
	 */
	export function focusPath(steps: readonly PathStep[], pos?: number): LandingBox {
		const [k, ...rest] = steps;
		const id = typeof k === 'number' ? ids[k] : undefined;
		if (id === undefined) {
			focus();
			return undefined;
		}
		if (table) {
			const cells = cellEls[id];
			if (rest.length && cells) void cells.focusPath(rest, pos);
			else cells?.focus();
			return rowEls[id];
		}
		if (control === 'object') {
			openId = id;
			return (async () => {
				if (!(await span.resumes(tick()))) return undefined;
				if (rest.length && openObjEl) return (await openObjEl.focusPath(rest, pos)) ?? rowEls[id];
				focusObjectRow(id);
				return rowEls[id];
			})();
		}
		const el = els[id];
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
	 * then. `undefined` is the empty list: the add affordance. `column` is a table
	 * cell to land in rather than the row's first, and `fromRemove` the row's remove.
	 *
	 * The commit that schedules this can also remove the card holding the field, which
	 * unmounts this component inside the window (core/teardown.ts). */
	async function focusAfterFlush(
		id: string | undefined,
		column?: string,
		fromRemove = false
	): Promise<void> {
		if (!(await span.resumes(tick()))) return;
		if (id === undefined) return void addEl?.focus();
		if (table) {
			// Without the focus scroll: the remove is pinned, so it is in view where it
			// stands, and the scroll the browser would make is to its unpinned place at
			// the row's end.
			if (fromRemove)
				return void rowEls[id]
					?.querySelector<HTMLElement>('.qm-remove')
					?.focus({ preventScroll: true });
			const cells = cellEls[id];
			if (column && cells) void cells.focusPath([column]);
			else cells?.focus();
			return;
		}
		if (control === 'object') return focusObjectRow(id);
		els[id]?.focus();
	}
	/** Whether a cell's committed value is at its blank: unset, the empty string, or a
	 *  `Content` with no characters. A boolean or a number is never blank. */
	function cellBlank(v: unknown): boolean {
		if (v === undefined || v === '') return true;
		return typeof v === 'object' && v !== null && 'text' in v && (v as Content).text === '';
	}
	/** Whether element `k` reads empty to the user. A text element's input is the truth,
	 * being the control the keystroke lands in. A prose element commits every edit, so
	 * the committed `Content` is; an authored string, the transport-door rest, is empty
	 * when it has no characters. A table's row is empty when the cell under the caret is
	 * and so is every cell beside it: the caret's cell is read off its control, which a
	 * default the cell holds unwritten leaves full while the committed row has no key. */
	function elementEmpty(k: number, target: EventTarget | null, column?: string): boolean {
		if (control === 'prose') {
			const el = arr[k];
			if (typeof el === 'string') return el.length === 0;
			return !(el as Content | undefined)?.text;
		}
		if (table) {
			const row = (arr[k] ?? {}) as Record<string, unknown>;
			const under =
				target instanceof HTMLInputElement
					? !target.value
					: !target || !(target as HTMLElement).textContent;
			const beside = Object.entries(row).every(([c, v]) => c === column || cellBlank(v));
			return under && beside;
		}
		return target instanceof HTMLInputElement && !target.value;
	}
	/**
	 * The element keyboard contract. Both keys ride the element control's own keydown
	 * (the input's, or the PM view's through `handleDOMEvents`) since neither
	 * surface is a place a keymap of this component's could sit. A collapsed `object`
	 * element wires neither: its row is a summary button, whose Enter is the
	 * disclosure's. A table's cell wires both through the subform ({@link ObjectField}
	 * `onCellKey`), Enter keeping the column it was pressed in.
	 *
	 * Riding the control is what decides which cells answer: a text cell and a prose
	 * cell leave both keys free, where a select opens its list on Enter, a switch
	 * toggles on it and a date segment edits on Backspace. So a table's row keys answer
	 * from its text and prose columns.
	 */
	function onElementKey(e: KeyboardEvent, k: number, column?: string): void {
		if (e.isComposing) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			insertAfter(k, column);
		} else if (e.key === 'Backspace' && !e.repeat && elementEmpty(k, e.target, column)) {
			// Destructive with nothing to undo it, so it takes a deliberate press:
			// `repeat` is a held key running on past the character it just cleared, and
			// the emptiness test reads the state before this keystroke applies; so the
			// press that empties an element never also removes it.
			e.preventDefault();
			remove(k, column);
		}
	}
	/** The reorder's keyboard twin, on the row so it answers from the summary and from
	 *  any cell an open row holds: Alt+↑/↓, the table island's own binding. The nearest
	 *  row answers, or none does: a press inside a nested row is that row's whether it
	 *  holds a reorder or not, so a key in a table's cell or a list of strings' input
	 *  moves nothing, and never the record around it. */
	function onRowKey(e: KeyboardEvent, k: number): void {
		if (!e.altKey || e.shiftKey || e.ctrlKey || e.metaKey || e.isComposing) return;
		// A cell that took the key — a select opening, a date segment stepping, a prose
		// leaf joining — owns it.
		if (e.defaultPrevented) return;
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		const nearest = e.target instanceof Element ? e.target.closest('.qm-array-row') : null;
		if (nearest !== e.currentTarget) return;
		const dir = e.key === 'ArrowUp' ? -1 : 1;
		if (k + dir < 0 || k + dir >= ids.length) return;
		e.preventDefault();
		move(k, dir);
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
		<!-- The cap is drawn, not parked in a `title`: a disabled chip takes no focus and
		     announces nothing, and disabled is a promise that there is a state in which
		     you could, so the count says which state. -->
		<span class="qm-array-add-slot">
			{#if max != null}
				<span class="qm-array-count" id={countId}>{t.strings.arrayCount(arr.length, max)}</span>
			{/if}
			<button
				type="button"
				class="qm-add-el qm-chip qm-focus-ring qm-tap-floor"
				bind:this={addEl}
				aria-describedby={max != null ? countId : undefined}
				disabled={atCap}
				onclick={add}>{t.strings.arrayAdd}</button
			>
		</span>
	</div>
	<!-- Three lists, one per row shape, because `animate:` is granted only to a keyed
	     each block's one child: a branch inside the block would stand between them. -->
	{#if table}
		<div
			class="qm-array-rows qm-array-table"
			class:empty={ids.length === 0}
			data-default={defaulted ? '' : undefined}
			bind:this={rowsEl}
		>
			<div class="qm-array-table-scroller" style:--table-cols={columns.length}>
				<!-- The header names the columns, so a cell carries no label of its own: its
				     accessible name is the row's and the column's composed (`ObjectField`). The
				     obligation mark and the guidance affordance ride the header, being the
				     column's rather than any one cell's. -->
				<div class="qm-array-table-head">
					{#each columns as [key, sub] (key)}
						<div class="qm-array-table-col" class:mark={controlKind(sub) === 'boolean'}>
							<FieldLabel
								label={columnTitle(key, sub)}
								required={obliged(sub)}
								description={sub.description}
							/>
						</div>
					{/each}
					<span class="qm-array-table-head-end"></span>
				</div>
				{#each ids as id, k (id)}
					<div class="qm-array-row qm-array-table-row" bind:this={rowEls[id]}>
						<ObjectField
							bare
							bind:this={cellEls[id]}
							value={(arr[k] ?? {}) as Record<string, unknown>}
							properties={items?.properties}
							label={rowName(k)}
							contentAt={(path) => readAt([k, ...path])}
							onCommit={(obj) => commitElement(k, obj)}
							onCellKey={(e, column) => onElementKey(e, k, column)}
							diagnostics={routed.below.get(k)}
						/>
						{@render removeButton(k)}
					</div>
				{/each}
			</div>
		</div>
	{:else if control === 'object'}
		<div
			class="qm-array-rows"
			class:empty={ids.length === 0}
			data-default={defaulted ? '' : undefined}
			bind:this={rowsEl}
		>
			{#each ids as id, k (id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- The handler catches a key from the controls inside the row and adds no
				     interaction of the row's own: the row is no tab stop. -->
				<div
					class="qm-array-row qm-element"
					class:open={openId === id}
					bind:this={rowEls[id]}
					animate:reorder={arm.armed}
					onkeydown={(e) => onRowKey(e, k)}
				>
					<!-- The head is the row in collapsed form, and it is a box: the element IS
					     a value, the way the enum trigger is, and the slab's grammar (the box's
					     end-side corners) needs corners to take. So a list of records measures
					     like a list of inputs whatever the element type. -->
					<div class="qm-element-head">
						<button
							type="button"
							class="qm-control-box qm-focus-ring qm-element-summary"
							aria-expanded={openId === id}
							onclick={(e) => toggleRow(id, e.currentTarget)}
						>
							<!-- Leading, and it rotates: trailing is the figure for pushing a new
							     screen, where this unfolds in place. Same glyph, same rotation and
							     same rung as the accordion's, so the surface has one disclosure. -->
							<Icon name="chevron-right" class="qm-el-chevron" size={CHEVRON} />
							{#if elementTitle(k)}
								<span class="qm-element-title">{elementTitle(k)}</span>
							{:else}
								<span class="qm-element-title untitled">{untitled(k)}</span>
							{/if}
						</button>
						<div class="qm-row-actions">
							{@render rowActions(k)}
						</div>
					</div>
					{#if openId === id}
						<ObjectField
							bind:this={openObjEl}
							value={(arr[k] ?? {}) as Record<string, unknown>}
							properties={items?.properties}
							label={rowName(k)}
							idBase={idBase != null ? `${idBase}-e-${id}` : undefined}
							contentAt={(path) => readAt([k, ...path])}
							onCommit={(obj) => commitElement(k, obj)}
							diagnostics={routed.below.get(k)}
						/>
					{:else}
						<!-- A collapsed row draws no cell, so what its cells would have said is said
						     under the head, where the row can be seen: the message names the leaf. -->
						<DiagnosticList diagnostics={routed.below.get(k)?.map((d) => d.diagnostic)} />
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<div
			class="qm-array-rows"
			class:empty={ids.length === 0}
			data-default={defaulted ? '' : undefined}
			bind:this={rowsEl}
		>
			{#each ids as id, k (id)}
				<div class="qm-array-row" bind:this={rowEls[id]}>
					{#if control === 'prose'}
						<ProseValue
							bind:this={els[id]}
							content={() => readAt([k])}
							plaintext={items != null && baseType(items) === 'plaintext'}
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
						{@render removeButton(k)}
					</div>
					<DiagnosticList diagnostics={routed.below.get(k)?.map((d) => d.diagnostic)} />
				</div>
			{/each}
		</div>
	{/if}
	<DiagnosticList diagnostics={foot} />
</div>

<!-- The remove, one button wherever a row ends: a scalar row's slab, a record row's
     slab after its reorder pair, a table row's last track. -->
{#snippet removeButton(k: number)}
	<button
		type="button"
		class="qm-icon-btn qm-row-btn qm-remove qm-focus-ring"
		title={t.strings.arrayRemove}
		aria-label={rowAction(t.strings.arrayRemove, k)}
		onclick={() => remove(k, undefined, true)}><Icon name="minus" /></button
	>
{/snippet}

<!-- An `object` row's controls: the reorder pair, disabled at its edge as the card
     header's is, then the remove. -->
{#snippet rowActions(k: number)}
	<button
		type="button"
		class="qm-icon-btn qm-row-btn qm-focus-ring"
		title={t.strings.arrayMoveUp}
		aria-label={rowAction(t.strings.arrayMoveUp, k)}
		disabled={k === 0}
		onclick={() => move(k, -1)}><Icon name="chevron-up" /></button
	>
	<button
		type="button"
		class="qm-icon-btn qm-row-btn qm-focus-ring"
		title={t.strings.arrayMoveDown}
		aria-label={rowAction(t.strings.arrayMoveDown, k)}
		disabled={k === ids.length - 1}
		onclick={() => move(k, 1)}><Icon name="chevron-down" /></button
	>
	{@render removeButton(k)}
{/snippet}

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
	.qm-array-add-slot {
		display: inline-flex;
		align-items: center;
		gap: var(--_qm-space-2);
	}
	/* The count reads at the label rung: it is a fact about the field, stated beside the
	 chip in the register the chip rests at, and never a value. */
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
	/* The default's rows are what prints and nothing written: every value they draw takes
	   the default rung (theme.css), and the first gesture, writing them, takes it off. */
	.qm-array-rows[data-default] :global(:is(.qm-input, .ProseMirror, .qm-select, .qm-date)),
	.qm-array-rows[data-default] .qm-element-title:not(.untitled) {
		color: var(--_qm-ink-default);
	}
	/* A grid rather than a block: an `<input>` is inline-level and would sit on a
	 baseline, standing the row a descender taller than the box the slab measures itself
	 against. `minmax(0, …)` because a long unbroken value grows an `auto` track, and the
	 edge with it. */
	.qm-array-row {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		row-gap: var(--_qm-space);
		/* The corners the row's wash takes, an element landing blooming here rather than
		 over the whole list (`focusPath`): the row draws no box of its own, so the
		 radius it lends the wash is the one its element's box draws. */
		border-radius: var(--_qm-radius-inner);
	}
	/* The end inset the slabs stand in, taken off whichever box the element drew:
	 `.qm-input` is the text element, `.qm-control-box` the prose one — the row's own
	 child, so a table's cells, which are boxes too, keep their inset — and an object
	 row's summary, which stands three slabs off its end. `:global`, because the box
	 belongs to the child component's markup and the scope class stops at this
	 component's. The longhand beats the family's `padding` shorthand without a
	 specificity fight: `controls.css` ranks the family at zero inside `:where()`. */
	.qm-array-row > :global(.qm-input),
	.qm-array-row > :global(.qm-control-box) {
		padding-inline-end: var(--_qm-tap-min);
	}
	.qm-element-summary {
		padding-inline-end: calc(3 * var(--_qm-tap-min));
	}
	/* The box's end wall, floor to ceiling: a height of its own would leave a sliver of
	 well above or below, and the corners it takes are the box's — the end-side pair keeps
	 `.qm-icon-btn`'s radius, which is the same rung the box draws; a slab standing before
	 another gives up its corners on both sides.

	 It comes up on its own row rather than on the field: a destructive control is offered
	 by the row the pointer is on, not by every row at once, and the reorder pair beside
	 it comes up with it. Hover is where the remove says destructive, ink with fill, a
	 tint alone being a wash under a label-toned glyph. */
	.qm-row-actions {
		position: absolute;
		inset-block: 0;
		inset-inline-end: 0;
		display: flex;
		color: var(--_qm-ink-label);
		opacity: var(--_qm-opacity-idle);
		transition: opacity var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-row-btn {
		height: 100%;
		width: var(--_qm-tap-min);
		padding: 0;
		border-radius: 0;
		transition:
			background-color var(--_qm-duration-fast) var(--_qm-ease-reverse),
			color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-row-btn:last-child {
		border-start-end-radius: var(--_qm-radius-inner);
		border-end-end-radius: var(--_qm-radius-inner);
	}
	.qm-row-btn :global(svg) {
		width: var(--_qm-glyph-control);
		height: var(--_qm-glyph-control);
	}
	/* Child combinators: a nested array shares this scope, and a row's hover is not its
	 open subform's rows'. */
	.qm-array-row:hover > .qm-row-actions,
	.qm-array-row:focus-within > .qm-row-actions,
	.qm-array-row:hover > .qm-element-head > .qm-row-actions,
	.qm-array-row:focus-within > .qm-element-head > .qm-row-actions {
		opacity: 1;
	}
	.qm-remove:hover:not(:disabled) {
		background: var(--_qm-danger-tint);
		color: var(--_qm-danger);
	}
	/* ── An object element ──────────────────────────────────────────────────────
	 The row is a summary and the subform hangs under it. `row-gap` rather than a margin
	 on the subform, because the distance between a control and what it has unfolded
	 belongs to the thing stacking them; what `ObjectField` adds is the cap on its own
	 stroke, equal at both of its ends.

	 The distance inside an open row is the list's own, and the row then takes a rung of
	 air from the rows either side of it, so what it unfolded is nearer the summary it
	 hangs off than the sibling below. The wider distance on the inside is the inversion:
	 a subform reading as the next row's preamble. A variant spends the wider rung on the
	 same join and needs no such guard, a field carrying one control and no siblings for
	 its cells to drift toward. */
	.qm-element {
		row-gap: var(--_qm-space);
	}
	.qm-element.open {
		margin-block: var(--_qm-space);
	}
	/* The inline distance is the stacker's too, and here it is a rung: the summary stands
	 for the row rather than being a cell of it, so its subform's vertical takes the
	 disclosure's own column — `--_qm-nest` in, the distance every stroke on the ladder
	 keeps from the one outside it (ARCHITECTURE §"A plane is a tone"). Flush with the
	 row's edge that stroke is collinear with the box above it and with the sibling row
	 below, so a row's cells read as the list's own rung and the content of an open row
	 stands outboard of the chevron that opened it. A variant's cells and a matrix's
	 columns keep the flush edge: those sit beside the discriminant and the tick they are
	 stored with, not under them. */
	.qm-element > :global(.qm-object) {
		margin-inline-start: var(--_qm-nest);
	}
	/* The slabs measure the head, not the row: an open element is the head plus
	 everything it unfolded, and the controls belong to the line they sit on rather than
	 to all of that. Positioned, so `.qm-row-actions` anchors here. */
	.qm-element-head {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	/* A box, which the button family otherwise is not: the row IS the element, a value
	 in collapsed form the way the enum trigger is one, and the slab's grammar — the
	 box's two end-side corners — needs a box with corners to take. It carries
	 `.qm-control-box`, so the fill, the radius, the inset and the type are the recipe's
	 (controls.css) and a list of records measures like the list of inputs beside it. */
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
	 The chevron's ink is the cue, which is the accordion header's own ladder. An open
	 row's rule reaches its own head and stops: a row's subform holds rows of this same
	 shape under this same scope, so a descendant's would turn every collapsed chevron
	 inside an open row to the open face. */
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
	.qm-element.open > .qm-element-head :global(.qm-el-chevron) {
		color: var(--_qm-ink);
	}
	.qm-element.open > .qm-element-head :global(.qm-el-chevron) {
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
	/* ── A table ────────────────────────────────────────────────────────────────
	 Every row of it is open, so it stands where an open row's subform stands: a rung
	 inside the field, behind the subform's vertical and between its caps (`ObjectField`,
	 ARCHITECTURE §"A plane is a tone"). The stroke is what says the header's labels are
	 the field's insides: on the field's own edge at the label's register, labels abreast
	 over boxes are the figure a row of compact fields draws. A corner reads square at a
	 stroke, so the wash takes none here.

	 The grid is a box inside the stroke, and the one that scrolls: the stroke and the
	 inset hold still while the columns move, and the clip is the inset's edge rather than
	 the stroke's. One grid over the header and every row: a column per property, then a
	 track for the row's remove. The header and each row subgrid onto it, so a
	 cell's edge is its column's whatever the row above it holds. The row packs at the
	 start rather than sharing the field's leftover width between the columns: a table
	 carries its own rhythm, and stretching four short cells across a field sets them
	 apart by the width the card happens to have.

	 A track rests at what its cells cannot shrink below and grows no further than its
	 widest, so a field too narrow for them all overflows the grid's box and scrolls
	 sideways. A fixed floor as the track's base would instead hand each column a share of
	 the width and leave a control that does not shrink — a date's segments — painting
	 over the column beside it; the floor rides the header cell, which every column has.

	 The pad is the clip box's, the ring on a cell at that box's own edge reaching past
	 its content; the margin takes the same distance back, so the tracks stand a nest in
	 from the label row above them and the caps keep their rung. The box keeps the
	 remove's track clear of the scrolls it makes itself, so a cell scrolled into view
	 lands beside the pinned button rather than under it.

	 The names are the array's own: `.qm-table` is the codec's island (`prose.css`), an
	 unscoped stylesheet in this package, and a box wearing that name takes the island's
	 hairline whatever this block says. */
	.qm-array-rows.qm-array-table {
		border-inline-start: var(--_qm-vertical-width) solid var(--_qm-border);
		padding-inline-start: var(--_qm-nest);
		padding-block: var(--_qm-space);
		border-radius: 0;
	}
	.qm-array-table-scroller {
		display: grid;
		grid-template-columns:
			repeat(var(--table-cols), minmax(min-content, max-content))
			auto;
		justify-content: start;
		gap: var(--_qm-space);
		overflow-x: auto;
		scroll-padding-inline-end: calc(var(--_qm-tap-min) + var(--_qm-space));
		padding: var(--_qm-ring-reach);
		margin: calc(-1 * var(--_qm-ring-reach));
	}
	.qm-array-table-head,
	.qm-array-row.qm-array-table-row {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: subgrid;
		column-gap: var(--_qm-space);
	}
	.qm-array-row.qm-array-table-row {
		align-items: start;
	}
	/* The header's cells are labels standing over columns, at the rung a field label
	 stands at over its control, and where the column's floor is stated: a column is a
	 property and every one of them has a header, so the label carries the track's.

	 A switch column carries none. The floor is the width a control that fills its track
	 stays usable at, and a switch is a mark: one width at every width, so the rest of
	 the floor is whitespace the column spends on nothing and the table scrolls that much
	 sooner. Without it the column rests at its header's own width, its cells still
	 clearing the mark, which no track can shrink below. It is the table's to state
	 because the table is where a column is a width of its own; in a section's grid and
	 in a subform's, a boolean stands in a track its neighbours share. */
	.qm-array-table-col {
		min-width: var(--_qm-track-min);
	}
	.qm-array-table-col.mark {
		min-width: 0;
	}
	/* The remove is the row's last track, pinned to the end edge of the box the table
	 scrolls in: sticky, so it rests in its track while the table fits and rides over
	 the cells once the box scrolls, on the card's plane so what passes under it is
	 hidden rather than overprinted, and stretched to the row so no cell shows above or
	 below it. Always drawn: a table's rows are many and the eye finds the control by
	 its column. The header's end cell pins with it, or the labels would scroll under
	 nothing while the cells scroll under a plane.

	 The inset is the content box's, so the ring's reach fits inside the clip; the plane
	 spread over that same reach hides the sliver of cell the pad would show past the
	 button, and the ring paints over it.

	 The slab's grammar goes with the slab: a button on the row's own plane takes the
	 icon family's radius at all four corners, where one cut into a box takes that box's
	 end-side pair and squares the rest. */
	.qm-array-table-row > .qm-remove,
	.qm-array-table-head-end {
		position: sticky;
		inset-inline-end: 0;
		background: var(--_qm-surface);
		box-shadow: 0 0 0 var(--_qm-ring-reach) var(--_qm-surface);
	}
	.qm-array-table-row > .qm-remove {
		align-self: stretch;
		height: auto;
		border-radius: var(--_qm-radius-inner);
		color: var(--_qm-ink-label);
	}
	/* The label line's own type: size, weight and leading are `.qm-field-label`'s, so
	 the two read as one register. Inner radius: the chip family is the card's, and this
	 box is a line of type. The chip's tap floor is given back (`.qm-tap-floor`),
	 and the padding with it, so the drawn box is the line and the target is the floor.
	 It rests dim and comes up under the pointer; empty, it is the way in; at the cap it
	 rests at the family's disabled rung and the count beside it says why. */
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
	.qm-array.empty .qm-add-el {
		opacity: 1;
	}
	@media (hover: none) {
		.qm-add-el,
		.qm-row-actions {
			opacity: var(--_qm-opacity-muted);
		}
	}
</style>
