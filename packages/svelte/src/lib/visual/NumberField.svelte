<!--
 A `number` / `integer` field → numeric input (fixture `font_size` = 11.5).
 Commits at `change` (blur/Enter), not per keystroke: a partial numeric entry
 (`-`, `1.`) is never a document state worth a boundary round-trip, and
 committing it live flashes a coercion diagnostic + `console.error` on every
 intermediate prefix, announced by `DiagnosticList`'s `role="status"` live
 region.

 An unset field holds its resolved `default:` as its text, at the default rung
 (theme.css), and an edit that settles writes it as authored, as `TextField` takes
 its default. A number has no empty answer (canon `SCHEMAS.md` §"Native validation"),
 so a blank entry commits `undefined`, the unset rung: the parent removes the field,
 the engine renders the default, and the input holds it again.

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
 `QuillmarkError` the parent turns into a field diagnostic, VISUAL_EDITOR
 §Diagnostics). `Number()` alone is no gate: it reads `0x1F` and `Infinity` as
 numbers, and `1.000` as a whole one.
-->
<script lang="ts">
	import { syncedLocal } from './synced.svelte.js';
	import './controls.css';

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
	}
	let { value, integer, fallback, placeholder, label, id, describedBy, onCommit }: Props = $props();

	// Local input state synced to `value` (as a string projection), or to the default
	// an unset field holds; own-typing stays local, only an external change reconciles
	// back in (see `syncedLocal`).
	const local = syncedLocal(() => (value != null ? String(value) : (fallback ?? '')));
	const defaulted = $derived(value == null && !!fallback && local.value === fallback);

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
		local.value = el.value;
	}

	// Parse a settled entry and emit it; `local` is owned by `oninput`. Blank →
	// `undefined`, and the input takes the default back: nothing else reconciles it, the
	// projection having read the default throughout. Onto the element as well, since the
	// attribute Svelte last wrote may already be the default, and it writes no repeat.
	function commit(el: HTMLInputElement): void {
		const raw = el.value;
		const entry = raw.trim();
		if (entry === '') {
			onCommit(undefined);
			local.value = el.value = fallback ?? '';
			return;
		}
		// Finite as well: a digit run past `Number.MAX_VALUE` reads as `Infinity`.
		const n = whole.test(entry) ? Number(entry) : NaN;
		onCommit(Number.isFinite(n) ? n : raw);
	}
</script>

<input
	class="qm-input qm-focus-ring"
	type="text"
	inputmode={integer ? 'numeric' : 'decimal'}
	value={local.value}
	{id}
	{placeholder}
	data-default={defaulted ? '' : undefined}
	aria-label={id ? undefined : label}
	aria-describedby={describedBy}
	onbeforeinput={filter}
	oninput={(e) => {
		local.value = (e.currentTarget as HTMLInputElement).value;
	}}
	onchange={(e) => commit(e.currentTarget as HTMLInputElement)}
/>
