<!--
 A `number` / `integer` field → numeric input (fixture `font_size` = 11.5).
 Commits at `change` (blur/Enter), not per keystroke: a partial numeric entry
 (`-`, `1.`) is never a document state worth a boundary round-trip, and
 committing it live flashes a coercion diagnostic + `console.error` on every
 intermediate prefix. Where the parent moves on at Enter (`onEnter`), Enter commits at once and
 the move follows a number, never a blank or a refused entry. Escape takes a pending
 entry back to what the field holds, as it takes a card rename back, and the focus
 stays; with nothing pending the key is not claimed.

 An unset field holds its resolved `default:` as its text, at the default rung
 (theme.css), and an edit that settles writes it as authored, as `TextField` takes
 its default. A number has no empty answer (quillmark/INVARIANTS §"A blank is a property of the field"),
 so a blank entry commits `undefined`, the unset rung: the parent removes the field,
 the engine renders the default, and the input holds it again. The input's own undo
 back to the default it held unwritten settles as `undefined` too, so taking every edit
 back leaves the field unset, as a text leaf's undo does.

 The entry grammar is plain decimal: an optional sign and digits, and for a `number`
 a `.` and an exponent, the form `String()` gives a value too small or large for
 digits. A keystroke that leaves the text outside a prefix of it does not land, and in
 a `number` a `,` lands as `.`, the decimal key of a comma locale's keypad. A deletion
 always lands, so a stored value outside the grammar (`abc`) can be cleared, and a
 paste, a drop or an IME composition lands as it comes, judged when it settles.
 `type="text"`, not `type="number"`: a native number input sanitizes an invalid
 string to `""` rather than showing it, and steps on a scroll-wheel. `inputmode`
 keeps the numeric mobile keyboard.

 A settled entry in the grammar commits as a number. Anything else forwards the raw
 string to `onCommit`: the boundary's `writer.set` coercion is the judge (throws a
 `QuillmarkError` the parent turns into a field diagnostic, INVARIANTS §Diagnostics). `Number()` alone is no gate: it reads `0x1F` and `Infinity` as
 numbers, and `1.000` as a whole one.

 A proposed value is drawn over the input, the text it holds struck where it stands and the
 proposed one tinted beside it, as a one-line text leaf draws its own. The input holds its own
 text throughout, so the caret moves through the struck text and an edit writes what the field
 holds; once an entry is pending the input shows it, and the drawing keeps its place unseen, so
 the answer card standing on it stays.
-->
<script lang="ts">
	import './controls.css';
	import { review } from './review.svelte.js';

	interface Props {
		value: number | undefined;
		integer?: boolean;
		/** The resolved `default:` as text: what an unset field holds. */
		fallback?: string;
		/** Words at rest about an unset field that holds no text: the `None` an optional
		 * cell prints. */
		placeholder?: string;
		/** Accessible name for an input nothing else names: an object property, whose
		 * name is the field label plus the property's. A field's own input takes `id`
		 * instead and is named by the `<label for>` beside it. */
		label?: string;
		/** `<label for>` target. Set → the label names this input, so `aria-label`
		 * comes off: two names is where implementations disagree about which wins. */
		id?: string;
		/** The parked `description` (FieldLabel): announced after the name. */
		describedBy?: string;
		onCommit: (v: number | string | undefined) => void;
		/** Enter settled the entry as a number: a list's row moves on from it. Enter
		 *  claimed here commits at once rather than at the browser's own `change`. */
		onEnter?: () => void;
		/** A proposed value, drawn over the input at rest. */
		proposed?: { id: string; after: string };
	}
	let {
		value,
		integer,
		fallback,
		placeholder,
		label,
		id,
		describedBy,
		onCommit,
		onEnter,
		proposed
	}: Props = $props();

	const reviewing = review();

	/** The face stands over the input's own box, wherever the input stands in its parent. */
	function over(face: HTMLElement) {
		const input = face.previousElementSibling as HTMLElement | null;
		if (!input) return;
		const place = () => {
			face.style.insetBlockStart = `${input.offsetTop}px`;
			face.style.insetInlineStart = `${input.offsetLeft}px`;
			face.style.width = `${input.offsetWidth}px`;
			face.style.height = `${input.offsetHeight}px`;
		};
		place();
		if (typeof ResizeObserver === 'undefined') return;
		const watch = new ResizeObserver(place);
		watch.observe(input);
		return () => watch.disconnect();
	}

	const resting = $derived(value != null ? String(value) : (fallback ?? ''));
	let local = $derived(resting);
	const defaulted = $derived(value == null && !!fallback && local === fallback);
	const drawn = $derived(proposed && proposed.after !== resting ? proposed : undefined);

	// The default the input held while the field was unwritten, kept across the field's own
	// commits and dropped by anyone else's write: what an undo can return the field to.
	let unwrittenText: string | undefined;
	let committed: number | undefined;
	let undone = false;
	$effect(() => {
		if (value == null) [unwrittenText, committed] = [fallback, undefined];
		else if (value !== committed) unwrittenText = undefined;
	});

	const partial = $derived(
		integer ? /^\s*[+-]?\d*\s*$/ : /^\s*[+-]?\d*\.?\d*(?:[eE][+-]?\d*)?\s*$/
	);
	const whole = $derived(integer ? /^[+-]?\d+$/ : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/);

	function filter(e: InputEvent): void {
		if (e.inputType !== 'insertText' || e.data == null) return;
		const el = e.currentTarget as HTMLInputElement;
		const from = el.selectionStart ?? el.value.length;
		const to = el.selectionEnd ?? el.value.length;
		const data = !integer && e.data === ',' ? '.' : e.data;
		const next = el.value.slice(0, from) + data + el.value.slice(to);
		if (!partial.test(next)) return e.preventDefault();
		if (data === e.data) return;
		e.preventDefault();
		// `insertText` lands on the undo stack and fires `input`; `setRangeText` does neither.
		if (document.execCommand?.('insertText', false, data)) return;
		el.setRangeText(data, from, to, 'end');
		local = el.value;
	}

	// Where the reverted text differs from the last settled one, a browser fires `change`
	// on leaving; that one commits nothing. An entry that settled outside the grammar was
	// handed up as a string and refused, so taking it back settles the held value again,
	// which clears the refusal drawn on the field.
	let reverted = false;
	let offered = false;
	// The text Enter last settled, which the browser's `change` on leaving would settle again.
	let settled: string | undefined;
	function onKey(e: KeyboardEvent): void {
		if (e.key === 'Escape') return revert(e);
		if (e.key !== 'Enter' || !onEnter || e.isComposing) return;
		const el = e.currentTarget as HTMLInputElement;
		e.preventDefault();
		if (el.value !== settled && el.value !== resting) commit(el);
		settled = el.value;
		if (!offered && el.value.trim() !== '') onEnter();
	}
	function revert(e: KeyboardEvent): void {
		if (e.isComposing) return;
		const el = e.currentTarget as HTMLInputElement;
		if (el.value === resting) return;
		e.preventDefault();
		local = el.value = resting;
		reverted = true;
		if (offered) {
			offered = false;
			onCommit(value);
		}
	}

	// Parse a settled entry and emit it; `local` is owned by `oninput`. Blank →
	// `undefined`, and the input takes the default back: nothing else reconciles it, the
	// projection having read the default throughout. Onto the element as well, since the
	// attribute Svelte last wrote may already be the default, and it writes no repeat.
	function commit(el: HTMLInputElement): void {
		if (reverted) {
			reverted = false;
			return;
		}
		const raw = el.value;
		const entry = raw.trim();
		offered = false;
		if (undone && unwrittenText != null && raw === unwrittenText) {
			undone = false;
			if (value != null) onCommit(undefined);
			return;
		}
		if (entry === '') {
			onCommit(undefined);
			local = el.value = fallback ?? '';
			return;
		}
		// Finite as well: a digit run past `Number.MAX_VALUE` reads as `Infinity`.
		const n = whole.test(entry) ? Number(entry) : NaN;
		offered = !Number.isFinite(n);
		if (!offered) committed = n;
		onCommit(offered ? raw : n);
	}
</script>

<input
	class="qm-input qm-focus-ring"
	type="text"
	inputmode={integer ? 'numeric' : 'decimal'}
	value={local}
	{id}
	{placeholder}
	data-default={defaulted ? '' : undefined}
	data-proposed-over={drawn && local === resting ? '' : undefined}
	aria-label={id ? undefined : label}
	aria-describedby={describedBy}
	onbeforeinput={filter}
	oninput={(e) => {
		local = (e.currentTarget as HTMLInputElement).value;
		reverted = false;
		settled = undefined;
		undone = e instanceof InputEvent && e.inputType === 'historyUndo';
	}}
	onkeydown={onKey}
	onchange={(e) => {
		const el = e.currentTarget as HTMLInputElement;
		if (el.value !== settled) commit(el);
	}}
/>
{#if drawn}
	{@const lit = reviewing.lit === drawn.id}
	<span
		class={['qm-number-review', { pending: local !== resting }]}
		aria-hidden="true"
		{@attach over}
	>
		{#if resting}<del class={['qm-review-del', { 'qm-review-lit': lit }]}>{resting}</del>{/if}<ins
			class={['qm-review-ins', { 'qm-review-lit': lit }]}
			data-qm-review={drawn.id}>{drawn.after}</ins
		>
	</span>
{/if}

<style>
	/* Tabular figures, so numbers stacked in a column line up digit for digit. */
	.qm-input,
	.qm-number-review {
		font-variant-numeric: tabular-nums;
	}
	:global(:has(> .qm-number-review)) {
		position: relative;
	}
	.qm-input[data-proposed-over] {
		color: transparent;
		caret-color: var(--_qm-ink);
	}
	.qm-number-review.pending {
		visibility: hidden;
	}
	.qm-number-review {
		position: absolute;
		display: flex;
		align-items: center;
		box-sizing: border-box;
		padding: var(--_qm-inset-control);
		overflow: hidden;
		font-size: var(--_qm-text-body);
		line-height: var(--_qm-leading-body);
		white-space: nowrap;
		pointer-events: none;
	}
	.qm-review-del {
		color: var(--_qm-ink-label);
		text-decoration: line-through;
		text-decoration-color: var(--_qm-review-line);
	}
	.qm-review-ins {
		color: var(--_qm-ink);
		text-decoration: underline;
		text-decoration-color: var(--_qm-review-line);
		text-decoration-thickness: var(--_qm-border-width);
		text-underline-offset: 0.2em;
		background: var(--_qm-review-tint);
		box-shadow:
			calc(-1 * var(--_qm-space-half)) 0 0 var(--_qm-review-tint),
			var(--_qm-space-half) 0 0 var(--_qm-review-tint);
		border-radius: var(--_qm-radius-inner);
	}
	.qm-review-ins.qm-review-lit {
		background: var(--_qm-review-lit);
		box-shadow:
			calc(-1 * var(--_qm-space-half)) 0 0 var(--_qm-review-lit),
			var(--_qm-space-half) 0 0 var(--_qm-review-lit);
	}
	.qm-review-del + .qm-review-ins {
		margin-inline-start: calc(var(--_qm-space) + var(--_qm-space-half));
	}
	@media (forced-colors: active) {
		.qm-review-ins {
			text-decoration-color: currentColor;
		}
	}
</style>
