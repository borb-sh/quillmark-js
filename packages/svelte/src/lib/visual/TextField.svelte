<!--
 A `string` field → text input. Commits every edit live (on input) via the parent's
 typed `writer.set`, so the preview tracks typing.

 An unset field whose `default:` prints holds that default as its text, at the
 default rung (theme.css): the value it prints, drawn as one and a step off a written
 one. Nothing is written until an edit, which writes the whole text as authored: the
 default taken, whatever the edit left of it. Tabbing through writes nothing; a
 keystroke typed and removed pins the default.

 An emptied input writes what empty means for this field (VISUAL_EDITOR §"The
 commitment ladder"): `""` over a default that prints, the only answer that prints empty there;
 the unset rung elsewhere, where unset already prints nothing and the field stays
 unanswered, and an optional cell returns to `none`.
-->
<script lang="ts">
	import { syncedLocal } from './synced.svelte.js';
	import './controls.css';

	interface Props {
		value: string | undefined;
		/** The resolved `default:` where it prints: the text an unset field holds. */
		fallback?: string;
		/** Words at rest about an unset field that holds no text: the `None` an optional
		 * cell prints. */
		placeholder?: string;
		/** An unset field's `example:` (`exampleGhost`): drawn wherever the field holds no
		 * text, and in `placeholder`'s stead while the input holds the focus. */
		example?: string;
		/** Accessible name for an input nothing else names: an array element, whose
		 * name is the field label plus its 1-based index. A field's own input takes
		 * `id` instead and is named by the `<label for>` beside it. */
		label?: string;
		/** `<label for>` target. Set → the label names this input, so `aria-label`
		 * comes off: two names is where implementations disagree about which wins. */
		id?: string;
		/** The parked `description` (FieldLabel): announced after the name. */
		describedBy?: string;
		onCommit: (v: string | undefined) => void;
		/** Raw keydown, for a container whose own keys run through this control: the
		 * array repeater's Enter/Backspace (`ArrayField`). */
		onKey?: (e: KeyboardEvent) => void;
	}
	let { value, fallback, placeholder, example, label, id, describedBy, onCommit, onKey }: Props =
		$props();

	// Local input state synced to `value`, or to the default an unset field holds:
	// own-typing stays local, only an external change reconciles back in (see
	// `syncedLocal`).
	const local = syncedLocal(() => value ?? fallback ?? '');
	const defaulted = $derived(value == null && !!fallback && local.value === fallback);

	let focused = $state(false);
	const ghost = $derived(focused ? (example ?? placeholder) : (placeholder ?? example));

	let inputEl: HTMLInputElement | undefined = $state();
	/** Take the caret: what a parent placing focus on this control calls. */
	export function focus(): void {
		inputEl?.focus();
	}
</script>

<input
	bind:this={inputEl}
	class="qm-input qm-focus-ring"
	type="text"
	value={local.value}
	{id}
	placeholder={ghost}
	data-default={defaulted ? '' : undefined}
	aria-label={id ? undefined : label}
	aria-describedby={describedBy}
	onkeydown={onKey}
	onfocus={() => (focused = true)}
	onblur={() => (focused = false)}
	oninput={(e) => {
		local.value = (e.currentTarget as HTMLInputElement).value;
		onCommit(local.value !== '' ? local.value : fallback ? '' : undefined);
	}}
/>
