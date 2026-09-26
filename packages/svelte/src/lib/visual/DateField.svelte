<!--
 A `date` (or `datetime`) field → a styled segmented date field on bits-ui. The
 stored value is a string (fixture uses `YYYY-MM-DD`, blank to mean "today at
 render"); a cleared control commits `undefined` (the unset rung): the parent
 removes the field, so the memo quill's blank-date → `datetime.today`
 substitution applies. The value-object a date field lowers to is a
 render-time concern: the editor only sees the stored string.

 Styled rather than a native `<input type="date">`: that control's calendar popup
 is UA-owned and reaches no dial. `DateField` (segments, no
 calendar) rather than `DatePicker`: the segments are the entry affordance, and a
 calendar is a second surface this field does not need.

 The boundary is a string, and the local is too. The primitive speaks
 `CalendarDate`; the document speaks `YYYY-MM-DD`. `CalendarDate` carries no time
 and no zone, so the round-trip is lossless and no local-midnight shift can occur:
 the hazard that makes `new Date('2026-07-25')` the wrong tool here. Authored
 values are data, not input: `parseDate` throws on anything malformed, so a bad
 string degrades to an empty field rather than taking the editor down with it.

 `syncedLocal` reconciles by identity, so the local must hold the string, not the
 parsed value: a fresh `CalendarDate` is never `===` the last one, which would
 make every reconcile fire and re-render all seven segments on each commit.

 The ghost is the default's digits, not a format hint. An unset field
 carrying a `default:` prints the default's digits in the segments at the default
 rung (theme.css), instead of the primitive's `mm`/`dd`/`yyyy` hints, which say
 "empty" where the rung says "will render 2026-01-01". At rest the ghost is painted
 in the segment snippet, over an unset primitive: a default held as its value reads
 as filled to every path that reads the primitive, which re-reports a filled value as
 each segment loses focus, so a Tab through the field would write it. `placeholder`
 (the `DateValue` the segments count from, never one they display) carries the
 default too, so arrowing an empty segment starts at the render's date rather than
 today's.

 Entering an unset field seats the default as the primitive's value, still at the
 default rung, so an edit to one segment commits a whole date with the others the
 default's. Leaving without an edit unseats it, and nothing is written; so does
 clearing a segment.
-->
<script lang="ts">
	import { DateField as BitsDateField } from 'bits-ui';
	import { parseDate, type DateValue } from '@internationalized/date';
	import { syncedLocal } from './synced.svelte.js';
	import './controls.css';

	interface Props {
		value: string | undefined;
		/** The resolved `default:` in the boundary's currency (`YYYY-MM-DD`): parsed
		 * for display only, shown while unset, never written. */
		fallback?: string;
		/** Accessible name for a field nothing else names: an object property, whose
		 * name is the field label plus the property's. A field's own date takes
		 * `labelledBy` instead. */
		label?: string;
		/** The field label's own id. `for` cannot reach this control: the segment
		 * container is not a labelable element; so the association runs the other way,
		 * and the label's click comes back through {@link focus}. It lands on the
		 * container, which the primitive gives `role="group"`: the name belongs to the
		 * set of segments, and entering any of them announces it. (bits builds each
		 * segment's own `aria-labelledby` from a `DateField.Label` inside its root:
		 * unreachable from here, since the field's label is a grid child of the field,
		 * not of the control.) */
		labelledBy?: string;
		/** The parked `description` (FieldLabel): announced after the name. */
		describedBy?: string;
		onCommit: (v: string | undefined) => void;
	}
	let { value, fallback, label, labelledBy, describedBy, onCommit }: Props = $props();

	let wrapEl: HTMLElement | undefined = $state();
	/** Take the caret: what the label click, and a parent placing focus here, calls.
	 * The first segment, not the field: focus lives on a segment (which is why the
	 * ring is `.qm-focus-ring-within`), and the container holds none. `literal` is the
	 * separator between segments: present, never focusable. */
	export function focus(): void {
		wrapEl?.querySelector<HTMLElement>('[data-segment]:not([data-segment="literal"])')?.focus();
	}

	// The stored form may carry a time (`datetime`); the date half is what a date
	// field edits, so anything past `YYYY-MM-DD` is not this control's. `parseDate`
	// throws on a malformed authored value: an empty field is the honest render.
	function toDateValue(s: string): DateValue | undefined {
		if (!s) return undefined;
		try {
			return parseDate(s);
		} catch {
			return undefined;
		}
	}

	const fallbackDate = $derived(toDateValue(fallback?.slice(0, 10) ?? ''));
	/** The default is the primitive's value: from entering an unset field until an
	 *  edit, a cleared segment or leaving. Part of the projection, so a reconcile
	 *  neither drops a seat nor restores one over the segments a clear left. */
	let seat = $state(false);
	// Local value synced to `value` as a string (see the identity note above);
	// own-edits stay local, only an external change reconciles back in. Driven
	// controlled (`value` + `onValueChange`, never `bind:`) so reconciliation stays
	// the package's.
	const local = syncedLocal(
		() => value?.slice(0, 10) ?? (seat && fallbackDate ? fallbackDate.toString() : '')
	);
	const parsed = $derived(toDateValue(local.value));
	// The date the empty segments ghost, or undefined when there is nothing to ghost:
	// the field is unset and the default has a date form. A non-blank local that
	// fails to parse is AUTHORED-but-malformed, which the empty field states
	// honestly: the ghost would claim it unset. Held as the parsed value rather than
	// a boolean so the substitution below narrows on the one fact it needs.
	const ghost = $derived(local.value === '' ? fallbackDate : undefined);
	const seated = $derived(value == null && seat && local.value !== '');

	/** Focus moving between segments is neither an entry nor a leaving. */
	const within = (e: FocusEvent): boolean => !!wrapEl?.contains(e.relatedTarget as Node | null);
	function enter(e: FocusEvent): void {
		if (!within(e) && value == null && fallbackDate) seat = true;
	}
	function leave(e: FocusEvent): void {
		if (!within(e)) seat = false;
	}

	// What one segment prints, and which rung it takes.
	//
	// An unfilled segment is always shown-never-written, whether it prints the
	// default's digits (`default`, the rung of what prints) or the primitive's own
	// `mm`/`dd`/`yyyy` hint (`hint`, a word about the value): both state "nothing
	// authored here". Only an unfilled segment ghosts: a half-entered date
	// holds digits while the value is still undefined (one unfilled segment unsets
	// the whole field), so ghosting unconditionally would paint over, and dim, the
	// digits just typed. The segment's own text is the tell: its unfilled hint is
	// alphabetic in every locale bits ships (`mm`/`yyyy`, `аа`, `年`), a filled one
	// is digits.
	//
	// The separators are `literal` parts, never unfilled; substitution covers the
	// date parts only, so any time part keeps the primitive's text. Digits are
	// zero-padded to the segment widths the field displays.
	type Rung = 'default' | 'hint' | undefined;
	function segmentText(part: string, text: string): { text: string; ghosted: Rung } {
		if (part === 'literal' || /\d/.test(text)) return { text, ghosted: undefined };
		if (!ghost) return { text, ghosted: 'hint' };
		switch (part) {
			case 'year':
				return { text: String(ghost.year).padStart(4, '0'), ghosted: 'default' };
			case 'month':
				return { text: String(ghost.month).padStart(2, '0'), ghosted: 'default' };
			case 'day':
				return { text: String(ghost.day).padStart(2, '0'), ghosted: 'default' };
			default:
				return { text, ghosted: 'hint' };
		}
	}
</script>

<span class="qm-date-wrap" bind:this={wrapEl} onfocusin={enter} onfocusout={leave}>
	<BitsDateField.Root
		value={parsed}
		placeholder={fallbackDate}
		onValueChange={(d) => {
			// `CalendarDate.toString()` is exactly `YYYY-MM-DD`. A cleared or
			// half-typed field yields undefined: the unset rung. The primitive reports
			// its own value again as a segment loses focus, which is no edit, and over a
			// seated default would write it.
			const next = d?.toString() ?? '';
			if (next === local.value) return;
			local.value = next;
			if (!d) seat = false;
			onCommit(d?.toString());
		}}
	>
		<!-- `data-ghosted` states the rung the way the enum trigger does. The date
		 primitive emits no per-segment placeholder marker (only bits' `select`
		 does), so the tone rides the same attribute, set per segment from the
		 substitution itself; which is also what keeps a half-typed date's own
		 digits at full ink while the segments around them ghost. -->
		<BitsDateField.Input
			class="qm-date qm-control-box qm-focus-ring-within"
			aria-label={labelledBy ? undefined : label}
			aria-labelledby={labelledBy}
			aria-describedby={describedBy}
			data-ghosted={ghost ? '' : undefined}
			data-default={seated ? '' : undefined}
		>
			{#snippet children({ segments })}
				<!-- Keyed by index: `part` repeats (the `literal` separators between
				 segments all carry it) so a part-keyed block collides. -->
				{#each segments as seg, i (i)}
					{@const shown = segmentText(seg.part, seg.value)}
					<BitsDateField.Segment
						class="qm-date-segment"
						part={seg.part}
						data-ghosted={shown.ghosted}
					>
						{shown.text}
					</BitsDateField.Segment>
				{/each}
			{/snippet}
		</BitsDateField.Input>
	</BitsDateField.Root>
</span>

<style>
	/* A primitive renders its own element, which a scoped selector cannot reach:
	 styled through the wrapper with `:global`. */
	/* The box is `.qm-control-box` (controls.css), carried on the primitive's own
	   element beside `.qm-focus-ring-within`; the segments inherit its size and ink
	   rungs, so the field and its neighbours agree without a second rule. */
	.qm-date-wrap :global(.qm-date) {
		display: flex;
		align-items: center;
		width: 100%;
		box-sizing: border-box;
	}
	/* The ring rides `.qm-focus-ring-within` (controls.css) rather than the plain
	   marker: focus lives on the segment, so it rings the field, not the segment
	   the caret happens to be in. */
	.qm-date-wrap :global(.qm-date-segment) {
		padding: 0 var(--_qm-space-half);
		border-radius: var(--_qm-radius-inner);
		outline: none;
	}
	.qm-date-wrap :global(.qm-date-segment:focus) {
		background: var(--_qm-surface-hover);
	}
	/* An unfilled segment is ghost-toned whatever it prints, at the rung of what it
	 prints: the resolved `default:`'s digits at the default rung, the `dd`/`mm`/`yyyy`
	 hint at the label rung. Shown, never written, either way. The marker is the
	 component's own (see the snippet): the date primitive emits no placeholder
	 attribute of its own. A seated default is the value and still unwritten, so its
	 filled segments take the default rung too. */
	.qm-date-wrap :global(.qm-date-segment[data-ghosted='hint']) {
		color: var(--_qm-ink-label);
	}
	.qm-date-wrap :global(.qm-date-segment[data-ghosted='default']),
	.qm-date-wrap :global(.qm-date[data-default] .qm-date-segment) {
		color: var(--_qm-ink-default);
	}
</style>
