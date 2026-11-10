<!--
 An `array` field → an add/remove repeater. Elements commit by value: every
 edit / add / remove / move rebuilds the whole array and hands it to the parent's typed
 `writer.set(field, wholeArray)` (arrays are not op-addressed). Element control
 by `items.type`: `richtext` / `text` → a prose element
 ({@link ProseValue}), `object` → a summary row that opens onto a subform, or a
 table's row where the array asks for one and the cells are short, a number, an enum, a
 boolean or a date → that type's own control, everything else → a text input. The add
 chip sits in the label header row (space-between with the field
 label); {@link Field} skips its own label for array controls and hands this component
 the label track with it. An array declaring `max:` disables the chip at the cap and
 draws the count beside it: a disabled button takes no focus, so a `title` reaches
 neither a screen reader nor a touch user, and the count is the carrier.

 An `object` element collapses: the row is its own summary — a box titled `Item` and
 its 1-based number, whatever the record holds — and opens onto {@link ObjectField}.
 Collapsed, the summary draws the words of the record's first one-line text cell after
 the title, at the label ink: what tells one closed row from the next, and no part of
 the row's name.
 Open, the summary keeps its words, its chevron and its remove where they stood, and
 lets its box go: a line at the tap rung over the subform, so the one thing a press
 on it moves is the chevron. Each row opens and closes on its own: a
 press on a summary toggles that row, and opening one leaves every other where it
 stands, so a landing never folds the row the author was in. A list of one record
 draws it open, on mount and whenever a remove leaves one: its summary would only be
 a press in front of the one record there is. Opening is part of a landing rather than something the user does first:
 `focusPath` opens the row it is aimed at before it focuses, and hands the rest of the
 walk to that row's subform, which is how a row two closed boxes down is reached.

 The table (`layout: 'table'`, INVARIANTS §"Structure mirrors the schema") is the
 same row machine in another presentation: the same ids, the same splices, the same
 landing and the same cell keys, over rows that are always open, each cell the
 property's ordinary control on the track the header names ({@link ObjectField}
 `bare`). Every row of it open, the whole of it stands where an open row's subform
 stands: a rung inside the field, behind the subform's vertical. A table composes by
 position, so it recurses into nothing: `arrayLayout` declines it for a row holding a
 container or a block prose cell.

 The row's controls are inside the element: a slab over the end of the element's own
 box, taking its two end-side corners: the remove. An `object` row's drag handle hangs
 off its start edge instead, as a table grip does. So a row's box is the element's box, and an array's rows end where
 every other field's control does. On an object element that box is the summary rather
 than the open row: a destructive control belongs to the line it sits on, not to
 everything that line has unfolded. A table's row carries the remove alone, in its last
 track and pinned to the end edge of the box the table scrolls in, so the one control
 the row draws never needs a scroll to reach. A table's row and a line carry no handle:
 their reorder is the key's alone.

 Keys carry the list without the mouse: Enter inserts a sibling below and takes the
 caret there, and short of a prose line's end splits the line there, as a bulleted list
 does; a paste of several lines into a prose row opens a row per line; Backspace at a
 prose line's start joins it onto the line above and Delete at its end joins the next
 onto it, each one commit; Backspace on an empty element removes it and hands focus back up the list, Alt+↑/↓
 anywhere in a row of the list moves it, the nearest row answering and never
 the record around a nested one, and on an `object` row is the twin of the handle's drag. A move is one splice of the ids
 and of the values together, the mechanism insert and remove use, so an element keeps
 its id for life and no prose leaf inside it remounts; the open row stays open across
 its own move, and `animate:reorder` holds the moving row as it holds a card.

 A change to the rows (an insert, a remove, a split, a join, a paste over rows, a move)
 is a step of the list's own, since no leaf's history holds it: ⌘/Ctrl+Z anywhere in the
 list takes the latest back and ⌘/Ctrl+Shift+Z puts it forward, the nearest list
 answering, while the rows stand as that step left them. An edit in a row since is the
 row's to undo first. A removal offered on the toast is the same step.

 An empty list of lines (any element but an `object`) draws a standing row to type
 into, so a list's first line takes no press of the add chip first. The row is not an
 element and draws as one that is not there yet: a row's own box with no remove, holding
 the words `arrayStanding` where its control ghosts words and muted where it cannot. Nothing commits until it holds something, so the field
 stays where it was, absent or `[]`, and Enter and Backspace have nothing to act on.
 Its first non-empty edit or paste commits it as the list's first element, keeping its
 id, so the caret stays in the leaf it is typing into.

 A scalar element's row is its type's control, and the row's keys are that control's:
 Enter and Backspace are a line's, so the remove is a tab stop here. A new row holds
 what the type holds empty: the blank for an enum or a date, `false` for a boolean. A
 number has no empty answer, so the add chip opens a standing row after the last
 element, which commits once it holds a number and which its remove dismisses, and a
 number row emptied is a row removed, offered back on the toast. Enter in a number row
 holding a number moves on, as on a line: to the next row with its number selected, or
 from the last to the standing row.

 An unset array whose `default:` holds elements draws them as its rows, at the default
 rung (`data-default` on the rows' box), since they are what prints. The rows are the
 declared literal rather than resolve's form, which completes a record against `items`:
 every gesture — an edit in a row, Enter, a remove, a move, the add chip — commits the
 whole array with the change in it, and a take writes only what the author declared.
 Removing the last row commits `[]`, the empty answer.
-->
<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { wording } from './strings.js';
	import { structuralUndo } from './undo.svelte.js';

	// The surface's words, ambient from the editor root; the package's English
	// off-tree, so this component renders standalone too.
	const t = wording();
	const undo = structuralUndo();
	import { onDestroy, tick, untrack } from 'svelte';
	import type { Content, PathStep, QuillFieldSchema } from '@quillmark/wasm';
	import { emptyContent } from '../core/codec/index.js';
	import { createLifespan } from '../core/teardown.js';
	import {
		IdSeq,
		baseType,
		controlKind,
		firstShortText,
		declaredContent,
		fieldTitle,
		literalText,
		renderedBoolean,
		schemaAt,
		textCap,
		type ArrayLayout
	} from './structure.js';
	import { splitDeep, unrouted, type DeepDiagnostic } from './diagnostics.js';
	import { propertyDomIds } from './domid.js';
	import type { LandingBox } from './leaves.js';
	import { reorder, reorderArm } from './motion.js';
	import { rowDrag } from './rowdrag.svelte.js';
	import Icon from './icons/Icon.svelte';
	import TextField from './TextField.svelte';
	import NumberField from './NumberField.svelte';
	import EnumField from './EnumField.svelte';
	import BooleanField from './BooleanField.svelte';
	import DateField from './DateField.svelte';
	import ObjectField from './ObjectField.svelte';
	import ProseValue from './ProseValue.svelte';
	import FieldLabel from './FieldLabel.svelte';
	import DiagnosticList from './DiagnosticList.svelte';
	import './controls.css';

	/** The disclosure glyph, at the size a panel header's own chevron takes: one
	 *  disclosure figure per surface, so it is one glyph at one size. */
	const CHEVRON = 16;

	interface Props {
		value: unknown;
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
	// A bare value is the one-element list the render floor wraps it into (quillmark/INVARIANTS
	// §"Coercion is the type predicate"), and the reader answers no element of it.
	const bare = $derived(value != null && !Array.isArray(value));
	const arr = $derived(rowsOf(value));
	function rowsOf(v: unknown): unknown[] {
		if (v == null) return fallback ?? [];
		return Array.isArray(v) ? v : [v];
	}
	/** The rows' content read: the boundary's, or, while the rows are the default or a
	 *  bare value, the literal's own leaf at the codec its declared type names. */
	function readAt(path: PathStep[]): Content | undefined {
		if (!defaulted && !bare) return contentAt(path);
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
	let ids = $state<string[]>(seq.take(rowsOf(value).length));
	// The standing row's id, taken at its first commit and replaced: the row it
	// becomes keeps the id, so its leaf never remounts under the keystroke.
	let standingId = $state(seq.next());
	// A boolean row is never empty, so a list of them has no row that is not one yet.
	const standing = $derived(
		!table &&
			control !== 'object' &&
			control !== 'boolean' &&
			arr.length === 0 &&
			(max == null || max > 0)
	);
	/** Whether the standing row is drawn: a gesture lands on it, which holds no element yet. */
	const onStanding = $derived(standing && ids.length === 0);
	/** The add chip's standing row after a list of numbers (see the header). */
	let adding = $state(false);
	const pending = $derived(adding && control === 'number' && ids.length > 0 && !atCap);
	const rowIds = $derived(onStanding ? [standingId] : pending ? [...ids, standingId] : ids);
	/** Whether the element's keys are its control's own, the row wiring none. */
	const scalar = $derived(
		control === 'number' || control === 'enum' || control === 'boolean' || control === 'date'
	);
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
	const els: Record<
		string,
		| {
				focus: () => void;
				setCaret?: (pos: number) => void;
				caret?: () => number | undefined;
				current?: () => Content | undefined;
				appended?: (tail: Content) => { content: Content; caret: number } | undefined;
		  }
		| undefined
	> = $state({});
	/** Focus row `id`'s control: through its handle where it exports one, else the first
	 *  control the row's markup holds, its remove aside. */
	function focusRow(id: string): void {
		const el = els[id];
		if (el) return el.focus();
		[...(rowEls[id]?.querySelectorAll<HTMLElement>('input, button') ?? [])]
			.find((n) => !n.classList.contains('qm-remove'))
			?.focus();
	}
	// The rows' own boxes, on the same key and dropped on the same paths: what an
	// element landing blooms in ({@link focusPath}), and what an object row's
	// summary is found through. A row is a box whatever its element type, so the two
	// element shapes register alike.
	const rowEls: Record<string, HTMLElement | undefined> = $state({});
	// A table row's cells, on the same key: the subform a landing and the column-keeping
	// Enter hop reach into. Every table row is open, so there is one per row where the
	// list holds one per open row.
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
		delete objEls[id];
		open.delete(id);
	}

	// ── Object elements: each row open on its own ────────────────────────────────
	const open = new SvelteSet<string>();
	// An open row's subform, on the row's id: the landing below walks into it.
	const objEls: Record<string, Subform | undefined> = $state({});

	/** A row's accessible name: `label` + the title it draws. */
	function elementName(k: number): string {
		return label != null ? t.strings.elementUntitled(label, k + 1) : t.strings.elementItem(k + 1);
	}
	// A list of one record opens it. Keyed on the count moving, so a press that closes
	// the one row holds until the count moves again; `pre`, so a mount draws it open.
	let seenCount = -1;
	$effect.pre(() => {
		const n = ids.length;
		if (n === seenCount) return;
		seenCount = n;
		if (n === 1 && control === 'object' && !table) {
			const only = ids[0];
			untrack(() => open.add(only));
		}
	});
	function toggleRow(id: string): void {
		if (open.has(id)) open.delete(id);
		else open.add(id);
	}
	/** What a collapsed row shows of its record: the cell a card's title reads. */
	const preview = (k: number): string | undefined =>
		firstShortText(items?.properties, (arr[k] ?? {}) as Record<string, unknown>);
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
		if (control === 'boolean') return false;
		return '';
	}

	/** The standing row becomes an element, the list's first or its last, keeping its id. */
	function claimStanding(): void {
		ids = [...ids, standingId];
		standingId = seq.next();
		adding = false;
	}
	/** An empty list's landing: the standing row where one is drawn, else the add chip. */
	function focusEmpty(): void {
		if (onStanding) focusRow(standingId);
		else addEl?.focus();
	}
	/** Splice `value` in at `at` under a fresh id and commit it. Every reshape withdraws
	 *  the editor's standing undo offer: a restore reinserts at the index its removal left,
	 *  which a reshape moves (`undo.svelte.ts`). */
	function insertAt(at: number, value: unknown): string {
		const before = snapshot();
		undo.withdraw();
		const id = seq.next();
		ids = [...ids.slice(0, at), id, ...ids.slice(at)];
		const next = arr.slice();
		next.splice(at, 0, value);
		onCommit(next);
		record(before, next, { id });
		return id;
	}

	function commitElement(k: number, next: unknown): void {
		if (onStanding || (pending && k === ids.length)) {
			if (next === undefined || cellBlank(next)) return;
			claimStanding();
		} else if (next === undefined && control === 'number') {
			// The focus follows only where the row still held it: a change on leaving is
			// a focus already on its way elsewhere.
			const held = !!rowEls[ids[k]]?.contains(document.activeElement);
			return remove(k, undefined, false, true, held);
		}
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
		const id = insertAt(k + 1, emptyElement());
		// A row added is a row to fill in, so an object element arrives open: landing on
		// a collapsed empty summary would make adding one a two-press gesture.
		if (control === 'object' && !table) open.add(id);
		void focusAfterFlush(id, column);
	}
	/** Element `k` as `row` and `below` as new elements after it, one commit: a paste or
	 *  a drop of several lines into a row, each line past the first a row as Enter would
	 *  open it. The caret ends where the lines do, at `caret` in the last. */
	function spill(k: number, row: Content, below: Content[], caret: number): void {
		const before = onStanding ? undefined : snapshot();
		if (onStanding) claimStanding();
		undo.withdraw();
		const at = k + 1;
		const fresh = seq.take(below.length);
		ids = [...ids.slice(0, at), ...fresh, ...ids.slice(at)];
		const next = arr.slice();
		next[k] = row;
		next.splice(at, 0, ...below);
		onCommit(next);
		if (before) record(before, next, { id: fresh.at(-1)!, caret });
		void (async () => {
			if (!(await span.resumes(tick()))) return;
			els[fresh.at(-1)!]?.setCaret?.(caret);
		})();
	}
	/** Element `upper + 1` joined onto the end of element `upper`, one commit, the caret
	 *  landing between the two: Backspace at a prose line's start, Delete at its end.
	 *  Whether it joined: not past either end of the list, nor where a leaf is held or
	 *  the joined line would pass the cap. */
	function join(upper: number): boolean {
		if (upper < 0 || upper + 1 >= ids.length) return false;
		const tail = els[ids[upper + 1]]?.current?.();
		const joined = tail && els[ids[upper]]?.appended?.(tail);
		if (!joined) return false;
		const before = snapshot();
		undo.withdraw();
		const [kept, gone] = [ids[upper], ids[upper + 1]];
		ids = ids.filter((_, i) => i !== upper + 1);
		drop(gone);
		const next = arr.slice();
		next.splice(upper, 2, joined.content);
		onCommit(next);
		record(before, next, { id: kept, caret: joined.caret });
		void (async () => {
			if (!(await span.resumes(tick()))) return;
			els[kept]?.setCaret?.(joined.caret);
		})();
		return true;
	}
	/** Enter in a number row once it holds a number moves on, as Enter on a line does:
	 *  to the row below with its number selected, or after the last to the standing row. */
	function numberEntered(k: number): void {
		if (k >= ids.length - 1) return add();
		focusRow(ids[k + 1]);
		rowEls[ids[k + 1]]?.querySelector('input')?.select();
	}
	function add(): void {
		if (control !== 'number') return insertAfter(ids.length - 1);
		if (atCap) return;
		adding = true;
		void focusAfterFlush(standingId);
	}
	/** Remove element `k`. Focus lands on the element before it, or on the one that
	 *  slid into its place; on the add affordance once the list is empty, which is then
	 *  the only thing left to hold it. Clicking the remove needs this as much as the key
	 *  does: the button under the pointer is part of what it destroys. A table lands on
	 *  the control the gesture came from: `column`, so Backspace keeps its column as
	 *  Enter does, or the remove where `fromRemove` says one was pressed, which is
	 *  pinned and so keeps the clip where the pointer left it, where the first cell
	 *  would scroll the box back to its start on every press. A removal the user asked for
	 *  by name, the remove's press or its key, is offered back on the editor's toast
	 *  (`undo.svelte.ts`); Backspace on an empty element takes nothing worth offering.
	 *  `land` off leaves the focus where it is. The standing row after a list of numbers
	 *  is no element: its remove dismisses it and writes nothing. */
	function remove(
		k: number,
		column?: string,
		fromRemove = false,
		offer = false,
		land = true
	): void {
		if (k >= ids.length) {
			adding = false;
			addEl?.focus();
			return;
		}
		const before = snapshot();
		const dropped = ids[k];
		const value = arr[k];
		const name = rowName(k) ?? t.strings.elementItem(k + 1);
		const next = ids.filter((_, i) => i !== k);
		ids = next;
		drop(dropped);
		const values = arr.filter((_, i) => i !== k);
		onCommit(values);
		const step = record(before, values, next.length ? { id: next[Math.max(k - 1, 0)] } : undefined);
		if (offer) undo.offer(t.strings.undoRemoved(name), () => restore(k, value, step));
		else undo.withdraw();
		if (!land) return;
		void focusAfterFlush(next[Math.max(k - 1, 0)], column, fromRemove).then(() => {
			if (offer) undo.hand(document.activeElement);
		});
	}
	/** A removal's undo: `value` back at `k`, under a fresh id, focused where a landing on
	 *  it would focus. A no-op once this field is gone, the row with it. */
	function restore(k: number, value: unknown, step: Reshape): void {
		if (!span.alive) return;
		if (done.at(-1) === step && takeStep(false)) return;
		void focusAfterFlush(insertAt(Math.min(k, ids.length), value));
	}
	/** A collapsed record's remove key, on its summary: the remove is out of the tab order,
	 *  and the summary is a button, where the key edits nothing. */
	function onSummaryKey(e: KeyboardEvent, k: number): void {
		if (e.key !== 'Backspace' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
		e.preventDefault();
		remove(k, undefined, false, true);
	}
	/**
	 * Move element `k` to slot `to`: one splice of the ids and of the values together, so
	 * the element keeps its id and everything mounted under it. A no-op outside the list.
	 * The control that held the focus rides with the row, so it is focused again once the
	 * flush has moved it: a node moved in the DOM is a node the browser blurred.
	 */
	function move(k: number, to: number): void {
		if (to === k || to < 0 || to >= ids.length) return;
		const before = snapshot();
		const pressed = document.activeElement;
		undo.withdraw();
		arm.arm();
		const nextIds = ids.slice();
		const [id] = nextIds.splice(k, 1);
		nextIds.splice(to, 0, id);
		ids = nextIds;
		const next = arr.slice();
		const [v] = next.splice(k, 1);
		next.splice(to, 0, v);
		onCommit(next);
		record(before, next, before.focus?.id === id ? before.focus : { id });
		void (async () => {
			if (!(await span.resumes(tick()))) return;
			if (pressed instanceof HTMLElement && pressed.isConnected && rowEls[id]?.contains(pressed))
				pressed.focus();
		})();
	}
	// ── The list's own undo ──────────────────────────────────────────────────────
	// A change to the rows (an insert, a remove, a split, a join, a spill, a move) lives
	// in no leaf's history, so the list keeps its steps itself. A step is taken back only
	// while the rows stand as the step left them: an edit in a row since is the row's to
	// undo first, and once its own undo brings the rows back, the step is next.
	type Focus = { id: string; caret?: number };
	type Rows = { ids: string[]; values: unknown[]; focus?: Focus };
	type Reshape = { before: Rows; after: Rows };
	/** How many steps the list keeps each way. */
	const DEPTH = 100;
	let done: Reshape[] = [];
	let undone: Reshape[] = [];
	/** Where the focus is in the list: the row holding it, and a prose row's caret. */
	function focusNow(): Focus | undefined {
		const at = document.activeElement;
		const id = ids.find((i) => rowEls[i]?.contains(at));
		return id === undefined ? undefined : { id, caret: els[id]?.caret?.() };
	}
	function snapshot(): Rows {
		return { ids: ids.slice(), values: arr, focus: focusNow() };
	}
	/** Record the step from `before` to the rows just committed. Its `after` takes the
	 *  rows as the store hands them back once the commit lands, which is what a later
	 *  read compares against. */
	function record(before: Rows, values: unknown[], focus?: Focus): Reshape {
		const step: Reshape = { before, after: { ids: ids.slice(), values, focus } };
		done = [...done.slice(1 - DEPTH), step];
		undone = [];
		void (async () => {
			if (!(await span.resumes(tick()))) return;
			step.after = { ...step.after, values: arr };
		})();
		return step;
	}
	const same = (a: unknown[], b: unknown[]): boolean =>
		a === b || JSON.stringify(a) === JSON.stringify(b);
	/** Take the latest step back (`redo` false) or forward again, where the rows still
	 *  stand where it would start from. Whether it did. */
	function takeStep(redo: boolean): boolean {
		const stack = redo ? undone : done;
		const step = stack.at(-1);
		if (!step) return false;
		const [from, to] = redo ? [step.before, step.after] : [step.after, step.before];
		if (!same(arr, from.values)) return false;
		if (redo) {
			undone = undone.slice(0, -1);
			done = [...done, step];
		} else {
			done = done.slice(0, -1);
			undone = [...undone, step];
		}
		undo.withdraw();
		for (const id of ids) if (!to.ids.includes(id)) drop(id);
		ids = to.ids.slice();
		onCommit(to.values);
		const focus = to.focus && ids.includes(to.focus.id) ? to.focus : undefined;
		void (async () => {
			if (!(await span.resumes(tick()))) return;
			const caret = focus?.caret;
			const row = focus && els[focus.id];
			if (caret !== undefined && row?.setCaret) row.setCaret(caret);
			else void focusAfterFlush(focus?.id);
		})();
		return true;
	}
	/** ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z (or Ctrl+Y) anywhere in the list, ahead of the
	 *  control's own: the nearest list answers, never the one around a nested list. */
	function onUndoChord(e: KeyboardEvent): void {
		if (e.defaultPrevented || e.isComposing || e.altKey || !(e.metaKey || e.ctrlKey)) return;
		const key = e.key.toLowerCase();
		const redo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey && e.ctrlKey);
		if (!redo && (key !== 'z' || e.shiftKey)) return;
		if (!(e.target instanceof Element) || e.target.closest('.qm-array') !== e.currentTarget) return;
		if (drag.held() || !takeStep(redo)) return;
		e.preventDefault();
		e.stopPropagation();
	}

	/** Take the caret: the first element, or the add affordance when the list is empty;
	 * which is then the only thing there is to land on, and the next thing the user
	 * wants anyway. Reached by a label click and by the editor's landing verbs, which
	 * ask one function so they cannot disagree (`Field`, `leaves.ts`). */
	export function focus(): void {
		if (ids.length === 0) return focusEmpty();
		if (table) return void cellEls[ids[0]]?.focus();
		if (control === 'object') return focusObjectRow(ids[0]);
		focusRow(ids[0]);
	}
	/** An object row's landing: inside the subform when that row is the open one, on
	 *  the row's own summary otherwise — a collapsed row's control is its summary. */
	function focusObjectRow(id: string): void {
		const sub = objEls[id];
		if (open.has(id) && sub) return sub.focus();
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
	 * at UTF-16 offset `pos` where the leaf the walk ends in can take one ({@link
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
			open.add(id);
			return (async () => {
				if (!(await span.resumes(tick()))) return undefined;
				const sub = objEls[id];
				if (rest.length && sub) return (await sub.focusPath(rest, pos)) ?? rowEls[id];
				focusObjectRow(id);
				return rowEls[id];
			})();
		}
		const el = els[id];
		if (pos != null && el?.setCaret) el.setCaret(pos);
		else focusRow(id);
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
		if (id === undefined) return focusEmpty();
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
		focusRow(id);
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
	 * and so is every cell beside it, read off the row: a cell showing only its schema
	 * default holds nothing written, as in a row just added. The caret's cell is read off
	 * its control, which a default the cell holds unwritten leaves full while the
	 * committed row has no key. */
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
		if (onStanding) {
			// No element to insert after or remove: a line is typed first.
			if (e.key === 'Enter' || e.key === 'Backspace') e.preventDefault();
			return;
		}
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
	/** The reorder's key, on the row so it answers from the summary, from any cell the
	 *  row holds and from its remove: Alt+↑/↓, the table island's own binding. The nearest
	 *  row answers, so a key in a nested list's row moves that row and never the record
	 *  around it. A control that takes the chord keeps it: a listbox opens on it and a
	 *  date segment steps, and their rows move from the remove. The standing row is no
	 *  element and moves nowhere. A held drag owns the row until its release. */
	function onRowKey(e: KeyboardEvent, k: number): void {
		if (k >= ids.length) return;
		if (!e.altKey || e.shiftKey || e.ctrlKey || e.metaKey || e.isComposing || drag.held()) return;
		// A cell that took the key — a select opening, a date segment stepping, a prose
		// leaf joining — owns it.
		if (e.defaultPrevented) return;
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		const nearest = e.target instanceof Element ? e.target.closest('.qm-array-row') : null;
		if (nearest !== e.currentTarget) return;
		const dir = e.key === 'ArrowUp' ? -1 : 1;
		if (k + dir < 0 || k + dir >= ids.length) return;
		e.preventDefault();
		move(k, k + dir);
	}

	const drag = rowDrag({
		count: () => ids.length,
		box: (i) => rowEls[ids[i]]?.getBoundingClientRect(),
		move: (k, to) => {
			const id = ids[k];
			move(k, to);
			// The row's summary takes the focus, so the keys that move it or take the move
			// back act on the row the pointer just moved.
			void (async () => {
				if (!(await span.resumes(tick()))) return;
				const summary = rowEls[id]?.querySelector<HTMLElement>('.qm-element-summary');
				if (summary && !rowEls[id]?.contains(document.activeElement))
					summary.focus({ preventScroll: true });
			})();
		}
	});
	onDestroy(drag.release);

	/** Whether cells stand past the table scroller's end edge, under the pinned remove,
	 *  which is what the fade before the remove draws on. */
	let tableOverflow = $state(false);
	/** The head row spans every track, so its box is the content width a new row or a
	 *  longer cell changes. */
	function trackOverflow(el: HTMLElement): () => void {
		const measure = () => {
			tableOverflow = el.scrollWidth - el.clientWidth - Math.abs(el.scrollLeft) > 1;
		};
		measure();
		el.addEventListener('scroll', measure, { passive: true });
		const observer =
			typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
		observer?.observe(el);
		if (el.firstElementChild) observer?.observe(el.firstElementChild);
		return () => {
			el.removeEventListener('scroll', measure);
			observer?.disconnect();
		};
	}
</script>

<div
	class={['qm-array', { empty: ids.length === 0 }]}
	role="group"
	onkeydowncapture={onUndoChord}
	aria-labelledby={label != null ? labelId : undefined}
	aria-describedby={description ? descriptionId : undefined}
>
	<div class="qm-array-header">
		{#if label != null}
			<FieldLabel {label} id={labelId} {descriptionId} onActivate={focus} {description} />
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
			class={['qm-array-rows qm-array-table qm-wash', { empty: ids.length === 0 }]}
			data-default={defaulted ? '' : undefined}
			bind:this={rowsEl}
		>
			<div
				class="qm-array-table-scroller"
				data-overflow={tableOverflow ? '' : undefined}
				style:--table-cols={columns.length}
				{@attach trackOverflow}
			>
				<!-- The header names the columns, so a cell carries no label of its own: its
				     accessible name is the row's and the column's composed (`ObjectField`). The
				     guidance affordance rides the header, being the column's rather than any
				     one cell's. -->
				<div class="qm-array-table-head">
					{#each columns as [key, sub] (key)}
						<div
							class={[
								'qm-array-table-col',
								{ mark: controlKind(sub) === 'boolean', prose: controlKind(sub) === 'prose' }
							]}
						>
							<FieldLabel
								label={fieldTitle(key, sub)}
								descriptionId={idBase != null ? propertyDomIds(idBase, key).description : undefined}
								description={sub.description}
								brief={false}
							/>
						</div>
					{/each}
					<span class="qm-array-table-head-end"></span>
				</div>
				{#each ids as id, k (id)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="qm-array-row qm-array-table-row qm-wash"
						data-qm-index={k}
						bind:this={rowEls[id]}
						onkeydown={(e) => onRowKey(e, k)}
					>
						<ObjectField
							bare
							bind:this={cellEls[id]}
							{idBase}
							value={(arr[k] ?? {}) as Record<string, unknown>}
							properties={items?.properties}
							label={rowName(k)}
							contentAt={(path) => readAt([k, ...path])}
							onCommit={(obj) => commitElement(k, obj)}
							onCellKey={(e, column) => onElementKey(e, k, column)}
							diagnostics={routed.below.get(k)}
						/>
						{@render removeButton(k, true)}
					</div>
				{/each}
			</div>
		</div>
	{:else if control === 'object'}
		<div
			class={['qm-array-rows qm-wash', { empty: ids.length === 0 }]}
			data-default={defaulted ? '' : undefined}
			bind:this={rowsEl}
		>
			{#each ids as id, k (id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- The handler catches a key from the controls inside the row and adds no
				     interaction of the row's own: the row is no tab stop. -->
				<div
					class={[
						'qm-array-row qm-element qm-wash',
						{ open: open.has(id), lifted: drag.lifted(k) }
					]}
					data-drop={drag.dropSide(k)}
					data-qm-index={k}
					bind:this={rowEls[id]}
					animate:reorder={arm.armed}
					onkeydown={(e) => onRowKey(e, k)}
				>
					<!-- The head is the row in collapsed form, and it is a box: the element IS
					     a value, the way the enum trigger is, and the slab's grammar (the box's
					     end-side corners) needs corners to take. So a list of records measures
					     like a list of inputs whatever the element type. -->
					<div class="qm-element-head">
						{@render handle(k)}
						<button
							type="button"
							class="qm-control-box qm-focus-ring qm-element-summary"
							aria-expanded={open.has(id)}
							aria-label={elementName(k)}
							aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Meta+Backspace Control+Backspace"
							onclick={() => toggleRow(id)}
							onkeydown={(e) => onSummaryKey(e, k)}
						>
							<!-- Leading, and it rotates: trailing is the figure for pushing a new
							     screen, where this unfolds in place. Same glyph, same rotation and
							     same rung as a panel header's, so the surface has one disclosure. -->
							<Icon name="chevron-right" class="qm-el-chevron" size={CHEVRON} />
							<span class="qm-element-title">{t.strings.elementItem(k + 1)}</span>
							{#if !open.has(id) && preview(k)}
								<span class="qm-element-preview">{preview(k)}</span>
							{/if}
						</button>
						<div class="qm-row-actions">
							{@render removeButton(k)}
						</div>
					</div>
					{#if open.has(id)}
						<ObjectField
							bind:this={objEls[id]}
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
			class={['qm-array-rows qm-wash', { empty: rowIds.length === 0 }]}
			data-default={defaulted ? '' : undefined}
			bind:this={rowsEl}
		>
			{#each rowIds as id, k (id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class={['qm-array-row qm-wash', { standing: id === standingId }]}
					data-qm-index={k}
					bind:this={rowEls[id]}
					onkeydown={(e) => onRowKey(e, k)}
				>
					{#if control === 'prose'}
						<ProseValue
							bind:this={els[id]}
							content={() => readAt([k])}
							value={arr[k]}
							plaintext={items != null && literalText(items)}
							cap={textCap(items)}
							label={rowName(k)}
							placeholder={id === standingId ? t.strings.arrayStanding : undefined}
							onChange={(rt) => commitElement(k, rt)}
							lines={{
								room: () => (max == null ? Infinity : max - Math.max(arr.length, 1)),
								onLines: (rt, below, caret) => spill(k, rt, below, caret),
								onJoin: (dir) => join(dir < 0 ? k - 1 : k)
							}}
							onKey={(e) => onElementKey(e, k)}
						/>
					{:else if control === 'number'}
						<NumberField
							value={arr[k] as number | undefined}
							integer={items != null && baseType(items) === 'integer'}
							placeholder={id === standingId ? t.strings.arrayStanding : undefined}
							label={rowName(k)}
							onCommit={(v) => commitElement(k, v)}
							onEnter={() => numberEntered(k)}
						/>
					{:else if control === 'enum'}
						<!-- The blank is an element's empty answer, drawn as an unanswered one. -->
						<EnumField
							value={(arr[k] as string | undefined) || undefined}
							values={items?.values ?? []}
							blankTitle={items?.ui?.blank_title}
							label={rowName(k)}
							onCommit={(v) => commitElement(k, v)}
						/>
					{:else if control === 'boolean'}
						<BooleanField
							value={renderedBoolean(arr[k])}
							label={rowName(k)}
							onCommit={(v) => commitElement(k, v)}
						/>
					{:else if control === 'date'}
						<DateField
							bind:this={els[id]}
							value={(arr[k] as string | undefined) || undefined}
							datetime={items != null && baseType(items) === 'datetime'}
							label={rowName(k)}
							onCommit={(v) => commitElement(k, v)}
						/>
					{:else}
						<TextField
							bind:this={els[id]}
							value={String(arr[k] ?? '')}
							placeholder={id === standingId ? t.strings.arrayStanding : undefined}
							label={rowName(k)}
							onCommit={(v) => commitElement(k, v)}
							onKey={(e) => onElementKey(e, k)}
						/>
					{/if}
					{#if id !== standingId || pending}
						<div class="qm-row-actions">
							{@render removeButton(k, scalar)}
						</div>
					{/if}
					<DiagnosticList diagnostics={routed.below.get(k)?.map((d) => d.diagnostic)} />
				</div>
			{/each}
		</div>
	{/if}
	<DiagnosticList diagnostics={foot} />
</div>

<!-- The remove, one button wherever a row ends: a scalar row's slab, a record row's
     slab after its reorder pair, a table row's last track. Out of the tab order where the
     row has a key that removes it: Backspace on an emptied line, ⌘/Ctrl+Backspace on a
     record's summary. A table's filled row has none, nor has a scalar element's, so its
     remove stays a stop. -->
{#snippet removeButton(k: number, stop = false)}
	<button
		type="button"
		class="qm-icon-btn qm-row-btn qm-remove qm-focus-ring"
		title={t.strings.arrayRemove}
		aria-label={rowAction(t.strings.arrayRemove, k)}
		aria-keyshortcuts={control === 'object' && !table ? undefined : 'Alt+ArrowUp Alt+ArrowDown'}
		tabindex={stop ? undefined : -1}
		onclick={() => remove(k, undefined, true, true)}><Icon name="x" /></button
	>
{/snippet}

<!-- An `object` row's drag handle, a table grip's twin hung off the row's start edge.
     Pointer-only and out of the accessibility tree: a press on it does nothing, so a
     button there would be one a screen reader activates to no effect. Its twin is
     Alt+↑/↓ from anywhere in the row, which the summary announces, as a table's or a
     line's remove does for its own row. -->
{#snippet handle(k: number)}
	<span
		class="qm-row-handle"
		aria-hidden="true"
		title={t.strings.arrayDrag}
		onpointerdown={(e) => drag.down(e, k)}
		onpointermove={drag.move}
		onpointerup={drag.up}
		onpointercancel={drag.up}
		onlostpointercapture={drag.up}
		><span class="qm-row-handle-bar"><Icon name="grip-vertical" /></span></span
	>
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
	/* Under a label that carries its description in flow, the chip keeps the label's
	 line rather than centring on the two. */
	.qm-array-header:has(> :global(.qm-field-label-row.briefed)) {
		align-items: baseline;
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
	 Rounded to the rung a row's own box draws, the way `.qm-field-control` is for every
	 other control.

	 `display: none` when there are no elements, so the header does not stand a gap above
	 an empty box; a wash over it then paints nothing, which is what an array with
	 nothing in it has to show. */
	.qm-array-rows {
		display: flex;
		flex-direction: column;
		gap: var(--_qm-space);
		border-radius: var(--_qm-radius-inner);
	}
	.qm-array-rows.empty {
		display: none;
	}
	/* The default's rows are what prints and nothing written: every value they draw takes
	   the default rung (theme.css), a checked switch's track included, and the first
	   gesture, writing them, takes it off. */
	.qm-array-rows[data-default] :global(:is(.qm-input, .ProseMirror, .qm-date)),
	.qm-array-rows[data-default] :global(.qm-select:not([data-ghosted])) {
		color: var(--_qm-ink-default);
	}
	/* A row that is not an element yet: the box a row draws, at the muted rung until it
	   holds the caret, and its first keystroke makes it one. A row whose control ghosts
	   words says so in them instead, at the label rung, which a muted box would take
	   under 3:1. */
	.qm-array-row.standing
		> :global(
			:is(.qm-input, .qm-control-box):not(:has(.qm-prose-placeholder), :placeholder-shown)
		) {
		opacity: var(--_qm-opacity-muted);
		transition: opacity var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-array-row.standing:focus-within > :global(:is(.qm-input, .qm-control-box)) {
		opacity: 1;
	}
	.qm-array-rows[data-default] :global(.qm-toggle[data-state='checked']) {
		background: var(--_qm-accent-default);
	}
	/* A grid rather than a block: an `<input>` is inline-level and would sit on a
	 baseline, standing the row a descender taller than the box the slab measures itself
	 against. `minmax(0, …)` because a long unbroken value grows an `auto` track, and the
	 edge with it. */
	.qm-array-row {
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
	 row's summary, which stands one slab off its end. `:global`, because the box
	 belongs to the child component's markup and the scope class stops at this
	 component's. The longhand beats the family's `padding` shorthand without a
	 specificity fight: `controls.css` ranks the family at zero inside `:where()`. */
	.qm-array-row > :global(.qm-input),
	.qm-array-row > :global(.qm-control-box),
	.qm-array-row > :global(.qm-select-wrap > .qm-control-box),
	.qm-array-row > :global(.qm-date-wrap .qm-control-box) {
		padding-inline-end: var(--_qm-tap-min);
	}
	.qm-element-summary {
		padding-inline-end: var(--_qm-tap-min);
	}
	/* The box's end wall, floor to ceiling: a height of its own would leave a sliver of
	 well above or below, and the corners it takes are the box's — the end-side pair keeps
	 `.qm-icon-btn`'s radius, which is the same rung the box draws; a slab standing before
	 another gives up its corners on both sides.

	 It comes up on its own row rather than on the field: a destructive control is offered
	 by the row the pointer is on, not by every row at once. Hover is where the remove says destructive, ink with fill, a
	 tint alone being a wash under a label-toned glyph. */
	.qm-row-actions {
		position: absolute;
		inset-block: 0;
		inset-inline-end: 0;
		display: flex;
		color: var(--_qm-ink-label);
		opacity: var(--_qm-opacity-rest);
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
	/* The handle is a table grip's twin (prose.css §"One grip per line"): a pill carrying
	 the grip's marks, hung off the row's start edge in the `--_qm-nest` every row stands
	 in from the stroke outside it, which a group's panel clips at. It rests
	 at nothing, where the remove rests faint, and comes up with the row the pointer is
	 on, staying up through the drag it carries; a band flush with the row keeps the
	 pointer on the row all the way to it. The pointer owns the gesture, not the page's
	 scroll. */
	.qm-row-handle {
		position: absolute;
		inset-block: 0;
		inset-inline-end: 100%;
		width: var(--_qm-nest);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--_qm-ink-label);
		cursor: grab;
		touch-action: none;
		opacity: 0;
		transition: opacity var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-row-handle-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: var(--_qm-tap-min);
		border-radius: var(--_qm-radius-pill);
		background: var(--_qm-surface-band);
	}
	.qm-row-handle-bar :global(svg) {
		width: var(--_qm-space-3);
		height: var(--_qm-space-3);
	}
	.qm-array-row:hover > .qm-element-head > .qm-row-handle,
	.qm-element.lifted > .qm-element-head > .qm-row-handle {
		opacity: 1;
	}
	.qm-element.lifted > .qm-element-head > .qm-row-handle {
		cursor: grabbing;
	}
	/* The lifted row is a tone, and the drop is one rule on the edge it would land
	 against, drawn out of flow so nothing reflows under the drag: the table island's
	 own pair. */
	.qm-element.lifted > .qm-element-head > .qm-element-summary {
		opacity: var(--_qm-opacity-muted);
	}
	.qm-element[data-drop]::before {
		content: '';
		position: absolute;
		inset-inline: 0;
		height: var(--_qm-ring-width);
		background: var(--_qm-accent);
		border-radius: var(--_qm-radius-pill);
		pointer-events: none;
	}
	.qm-element[data-drop='before']::before {
		top: calc(-0.5 * (var(--_qm-space) + var(--_qm-ring-width)));
	}
	.qm-element[data-drop='after']::before {
		bottom: calc(-0.5 * (var(--_qm-space) + var(--_qm-ring-width)));
	}
	/* ── An object element ──────────────────────────────────────────────────────
	 The row is a summary and the subform hangs under it. `row-gap` rather than a margin
	 on the subform, because the distance between a control and what it has unfolded
	 belongs to the thing stacking them; what `ObjectField` adds is the cap on its own
	 stroke, equal at both of its ends.

	 The distance inside an open row is the list's own, and the row then takes a rung of
	 air from the rows either side of it, so what it unfolded is nearer the summary it
	 hangs off than the sibling below. The wider distance on the inside is the inversion:
	 a subform reading as the next row's preamble. A variant takes the same distance and
	 needs no such guard, a field carrying one control and no siblings for its cells to
	 drift toward. */
	.qm-element {
		row-gap: var(--_qm-space);
	}
	.qm-element.open {
		margin-block: var(--_qm-space);
	}
	/* No inline distance: the subform's vertical hangs at the row's edge, under the
	 summary that unfolded it, as a variant's cells hang at the discriminant's and a
	 matrix's columns at the tick's. Every vertical hangs at the edge of the control it
	 unfolds from, so a step in is one nesting distance wherever it is read, the
	 `--_qm-nest` the subform keeps from its own stroke (INVARIANTS §"A plane is a
	 tone"); a second rung here read as a deeper level than the object the row holds. */
	/* The slabs measure the head, not the row: an open element is the head plus
	 everything it unfolded, and the controls belong to the line they sit on rather than
	 to all of that. Positioned, so `.qm-row-actions` anchors here. */
	.qm-element-head {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	/* A record's summary is a heading's line, open or closed, at the tap rung: a record is
	 a thing you open, where a box with a fill and an edge is a thing you type into, which
	 is what every well beside it is. Only the chevron turns between the two states, so
	 the words, the chevron and the slab stay where the pointer left them. It carries
	 `.qm-control-box` for the recipe's inline inset and type, so its words stand on the
	 column the wells' text does, and gives up the box's fill, edge and block padding. */
	.qm-element-summary {
		min-height: var(--_qm-tap-min);
		padding-block: 0;
		background: transparent;
		box-shadow: none;
		display: flex;
		align-items: center;
		gap: var(--_qm-space);
		width: 100%;
		box-sizing: border-box;
		text-align: start;
		cursor: pointer;
		transition: background-color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	/* No hover fill: a well does not fill under the pointer anywhere on this surface.
	 The chevron's ink is the cue, which is the panel header's own ladder. An open
	 row's rule reaches its own head and stops: a row's subform holds rows of this same
	 shape under this same scope, so a descendant's would turn every collapsed chevron
	 inside an open row to the open face. */
	.qm-element-summary :global(.qm-el-chevron) {
		flex-shrink: 0;
		display: block;
		stroke-width: var(--_qm-glyph-stroke);
		color: var(--_qm-ink);
		transform: rotate(0deg);
		transform-origin: center;
		transition:
			transform var(--_qm-duration-slow) var(--_qm-ease-reverse),
			color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-element-summary :global(.qm-el-chevron > *) {
		vector-effect: non-scaling-stroke;
	}
	.qm-element.open > .qm-element-head :global(.qm-el-chevron) {
		transform: rotate(90deg);
	}
	/* The title is the row's name, at the ink as a card's is, on one line however long
	 the label runs. */
	.qm-element-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--_qm-ink);
		font-variant-numeric: tabular-nums;
	}
	/* What the closed record holds, after its name and a rung under it: the label ink,
	 on the line's remainder, and the first to give way where the line runs short. */
	.qm-element-preview {
		flex: 1 1 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: start;
		color: var(--_qm-ink-label);
	}
	.qm-element-summary:has(.qm-element-preview) > .qm-element-title {
		flex-shrink: 0;
	}
	/* ── A table ────────────────────────────────────────────────────────────────
	 Every row of it is open, so it stands where an open row's subform stands: a rung
	 inside the field, behind the subform's vertical and between its caps (`ObjectField`,
	 INVARIANTS §"A plane is a tone"). The stroke is what says the header's labels are
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
	.qm-array-table-col.prose {
		min-width: var(--_qm-track-prose);
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
	/* While cells stand past the end edge, the slab fades them in over a step before it
	 rather than cutting them at its edge: the column the cut hides is still there. */
	.qm-array-table-row > .qm-remove::before,
	.qm-array-table-head-end::before {
		content: '';
		position: absolute;
		inset-block: calc(-1 * var(--_qm-ring-reach));
		inset-inline-end: calc(100% + var(--_qm-ring-reach));
		width: var(--_qm-space-3);
		background: linear-gradient(to right, transparent, var(--_qm-surface));
		pointer-events: none;
		opacity: 0;
		transition: opacity var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-array-table-row > .qm-remove:dir(rtl)::before,
	.qm-array-table-head-end:dir(rtl)::before {
		background: linear-gradient(to left, transparent, var(--_qm-surface));
	}
	.qm-array-table-scroller[data-overflow] > .qm-array-table-row > .qm-remove::before,
	.qm-array-table-scroller[data-overflow] .qm-array-table-head-end::before {
		opacity: 1;
	}
	/* The glyph stands on the row's first line with the cells, however far the slab
	 stretches under it. */
	.qm-array-table-row > .qm-remove {
		align-self: stretch;
		align-items: start;
		padding-block-start: calc((var(--_qm-box-line) - var(--_qm-glyph-control)) / 2);
		height: auto;
		border-radius: var(--_qm-radius-inner);
		color: var(--_qm-ink-label);
	}
	/* The pad past the slab, flat: the plane's spread above rounds with the slab's
	 corners, and a cell scrolled under them shows through at the clip. */
	.qm-array-table-row > .qm-remove::after,
	.qm-array-table-head-end::after {
		content: '';
		position: absolute;
		inset-block: calc(-1 * var(--_qm-ring-reach));
		inset-inline-start: 100%;
		width: var(--_qm-ring-reach);
		background: var(--_qm-surface);
	}
	/* The label line's own type: size, weight and leading are `.qm-field-label`'s, so
	 the two read as one register. Inner radius: the chip family is the card's, and this
	 box is a line of type. The chip's tap floor is given back (`.qm-tap-floor`),
	 and the padding with it, so the drawn box is the line and the target is the floor.
	 It is words, so it rests at the label ink in full, where the glyph controls beside a
	 row rest at the rest rung: a text control's floor is WCAG 1.4.3's 4.5:1, which the
	 rest rung over the label ink does not clear. At the cap it rests at the family's
	 disabled rung and the count beside it says why. */
	.qm-add-el {
		padding: 0 var(--_qm-space);
		font-weight: var(--_qm-weight-mid);
		line-height: var(--_qm-leading-tight);
		border-radius: var(--_qm-radius-inner);
		transition:
			opacity var(--_qm-duration-fast) var(--_qm-ease-reverse),
			background-color var(--_qm-duration-fast) var(--_qm-ease-reverse),
			color var(--_qm-duration-fast) var(--_qm-ease-reverse);
	}
	.qm-add-el:disabled {
		opacity: var(--_qm-opacity-idle);
	}
	/* No hover to come up on: the handle stands with the controls, already at rest. */
	@media (hover: none) {
		.qm-row-handle {
			opacity: 1;
		}
	}
</style>
