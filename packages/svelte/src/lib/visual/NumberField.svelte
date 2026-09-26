<!--
 A `number` / `integer` field → numeric input (fixture `font_size` = 11.5).
 Commits at `change` (blur/Enter), not per keystroke: a partial numeric entry
 (`-`, `1.`, `1e`) is never a document state worth a boundary round-trip, and
 committing it live flashes a coercion diagnostic + `console.error` on every
 intermediate prefix, announced by `DiagnosticList`'s `role="status"` live
 region.

 An unset field holds its resolved `default:` as its text, at the default rung
 (theme.css), and an edit that settles writes it as authored, as `TextField` takes
 its default. A number has no empty answer (canon `SCHEMAS.md` §"Native validation"),
 so a blank entry commits `undefined`, the unset rung: the parent removes the field,
 the engine renders the default, and the input holds it again.

 `type="text"`, not `type="number"`: a native number input sanitizes an
 invalid string to `""` before the DOM `value` setter even runs (verified:
 `.value = "abc"` on `type="number"` never lands), which would make a
 genuinely bad entry untypeable. The commit-time coercion diagnostic
 (VISUAL_EDITOR §Diagnostics) needs exactly that path reachable through the
 UI, so a non-blank entry that fails to parse forwards the raw string to
 `onCommit` unchanged: the boundary's own `writer.set` coercion is the judge
 (throws a `QuillmarkError` the parent turns into a field diagnostic), not a
 client-side guess. `inputmode` keeps the numeric mobile keyboard.
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

	// Parse a settled entry and emit it; `local` is owned by `oninput`. Blank →
	// `undefined`, and the input takes the default back: nothing else reconciles it, the
	// projection having read the default throughout. Onto the element as well, since the
	// attribute Svelte last wrote may already be the default, and it writes no repeat.
	function commit(el: HTMLInputElement): void {
		const raw = el.value;
		if (raw.trim() === '') {
			onCommit(undefined);
			local.value = el.value = fallback ?? '';
			return;
		}
		// Number(), not parseFloat/parseInt: a prefix parse would silently commit
		// `14.5` for `14.5x` (and truncate `11.9` → 11 on integer fields) instead
		// of letting the boundary judge the full entry.
		const n = Number(raw);
		onCommit(Number.isNaN(n) ? raw : n);
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
	oninput={(e) => {
		local.value = (e.currentTarget as HTMLInputElement).value;
	}}
	onchange={(e) => commit(e.currentTarget as HTMLInputElement)}
/>
