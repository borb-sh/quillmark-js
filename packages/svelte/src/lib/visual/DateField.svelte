<!--
 A `date` (or `datetime`) field → a styled segmented date field on bits-ui. The
 stored value is a string (`YYYY-MM-DD`); a cleared control commits `undefined`
 (the unset rung): the parent removes the field, and what a blank date renders as
 is the plate's. The value-object a date field lowers to is a render-time concern:
 the editor only sees the stored string.

 "Today" writes the local calendar date as an authored value. A date the render
 took from its clock would change with the day it was rendered on; the stamp is
 fixed at the moment the user chose it.

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
 carrying a `default:` prints the default's digits in the segments, ghost-toned,
 instead of the primitive's `mm`/`dd`/`yyyy` hints, which say "empty" where the
 rung says "will render 2026-01-01". The ghost is painted in the segment snippet,
 over an unset primitive: substituting the default for `value` instead would make
 the field indistinguishable from an authored one to every path that reads it
 (`areAllSegmentsFilled`, Backspace, the hidden input), and the primitive shadows
 a written-back `value` prop it was not `bind:`-ed to, so re-seating the ghost
 after a clear never lands. `placeholder` (the `DateValue` the segments count
 from, never one they display) carries the default too, so arrowing an empty
 segment starts at the render's date rather than today's.
-->
<script lang="ts">
	import { DateField as BitsDateField } from 'bits-ui';
	import { getLocalTimeZone, parseDate, today, type DateValue } from '@internationalized/date';
	import { syncedLocal } from './synced.svelte.js';
	import { wording } from './strings.js';
	import './controls.css';

	const t = wording();

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

	// Local value synced to `value` as a string (see the identity note above);
	// own-edits stay local, only an external change reconciles back in. Driven
	// controlled (`value` + `onValueChange`, never `bind:`) so reconciliation stays
	// the package's.
	const local = syncedLocal(() => value?.slice(0, 10) ?? '');
	const parsed = $derived(toDateValue(local.value));
	// The date the empty segments ghost, or undefined when there is nothing to ghost:
	// the field is unset and the default has a date form. A non-blank local that
	// fails to parse is AUTHORED-but-malformed, which the empty field states
	// honestly: the ghost would claim it unset. Held as the parsed value rather than
	// a boolean so the substitution below narrows on the one fact it needs.
	const fallbackDate = $derived(toDateValue(fallback?.slice(0, 10) ?? ''));
	const ghost = $derived(local.value === '' ? fallbackDate : undefined);

	function commit(v: string | undefined): void {
		local.value = v ?? '';
		onCommit(v);
	}

	// What one segment prints, and whether that text is shown-never-written.
	//
	// An unfilled segment is always shown-never-written, whether it prints the
	// default's digits or the primitive's own `mm`/`dd`/`yyyy` hint: both state
	// "nothing authored here". Only an unfilled segment ghosts: a half-entered date
	// holds digits while the value is still undefined (one unfilled segment unsets
	// the whole field), so ghosting unconditionally would paint over, and dim, the
	// digits just typed. The segment's own text is the tell: its unfilled hint is
	// alphabetic in every locale bits ships (`mm`/`yyyy`, `аа`, `年`), a filled one
	// is digits.
	//
	// The separators are `literal` parts, never unfilled; substitution covers the
	// date parts only, so any time part keeps the primitive's text. Digits are
	// zero-padded to the segment widths the field displays.
	function segmentText(part: string, text: string): { text: string; ghosted: boolean } {
		if (part === 'literal' || /\d/.test(text)) return { text, ghosted: false };
		if (!ghost) return { text, ghosted: true };
		switch (part) {
			case 'year':
				return { text: String(ghost.year).padStart(4, '0'), ghosted: true };
			case 'month':
				return { text: String(ghost.month).padStart(2, '0'), ghosted: true };
			case 'day':
				return { text: String(ghost.day).padStart(2, '0'), ghosted: true };
			default:
				return { text, ghosted: true };
		}
	}
</script>

<span class="qm-date-wrap" bind:this={wrapEl}>
	<BitsDateField.Root
		value={parsed}
		placeholder={fallbackDate}
		onValueChange={(d) => {
			// `CalendarDate.toString()` is exactly `YYYY-MM-DD`. A cleared or
			// half-typed field yields undefined: the unset rung.
			commit(d?.toString());
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
		>
			{#snippet children({ segments })}
				<!-- Keyed by index: `part` repeats (the `literal` separators between
				 segments all carry it) so a part-keyed block collides. -->
				{#each segments as seg, i (i)}
					{@const shown = segmentText(seg.part, seg.value)}
					<BitsDateField.Segment
						class="qm-date-segment"
						part={seg.part}
						data-ghosted={shown.ghosted ? '' : undefined}
					>
						{shown.text}
					</BitsDateField.Segment>
				{/each}
			{/snippet}
		</BitsDateField.Input>
	</BitsDateField.Root>
	<button
		type="button"
		class="qm-date-today qm-chip qm-focus-ring qm-tap-floor"
		onclick={() => commit(today(getLocalTimeZone()).toString())}>{t.strings.dateToday}</button
	>
</span>

<style>
	/* A primitive renders its own element, which a scoped selector cannot reach:
	 styled through the wrapper with `:global`. */
	/* The box is `.qm-control-box` (controls.css), carried on the primitive's own
	   element beside `.qm-focus-ring-within`; the segments inherit its size and ink
	   rungs, so the field and its neighbours agree without a second rule. */
	.qm-date-wrap {
		display: flex;
		align-items: center;
		gap: var(--_qm-space-half);
	}
	.qm-date-wrap :global(.qm-date) {
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
		box-sizing: border-box;
	}
	/* A chip beside a box: the tap floor is given back (`.qm-tap-floor`) and the
	 padding with it, so the row keeps the box's height. */
	.qm-date-today {
		padding: 0 var(--_qm-space);
		line-height: var(--_qm-leading-tight);
		border-radius: var(--_qm-radius-inner);
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
	/* An unfilled segment is ghost-toned whatever it prints: the resolved `default:`
	 when there is one to ghost, the `dd`/`mm`/`yyyy` hint when there is not. Shown,
	 never written, either way. The marker is the component's own (see the snippet):
	 the date primitive emits no placeholder attribute of its own. */
	.qm-date-wrap :global(.qm-date-segment[data-ghosted]) {
		color: var(--_qm-ink-label);
	}
</style>
