<!--
 A `date` or `datetime` field → a styled segmented date field on bits-ui. The
 stored value is a string, `YYYY-MM-DD` or `today`; a cleared control commits as its
 last segment empties, the blank `""` over a `default:`, which stays blank, and `undefined`
 (the unset rung) where nothing is declared, the parent removing the field. The value-object a date field lowers to is a render-time
 concern: the editor only sees the stored string.

 `today` is the render date rather than a written one (quillmark `docs/quills/quill-yaml-reference.md` §"Dated by the render"), so its
 digits take the default rung: they print, and nothing wrote them. The digits are
 the local date, which is what `resolve` and a session opened without a date both
 render. The Today toggle writes `today`, and pressed, writes those digits; `T` in a
 segment writes `today` too. An edit to a segment writes a whole date, the other
 segments the render date's. A `default: today` presses the toggle at the default
 rung while the field is unset.

 Styled rather than a native `<input type="date">`: that control's calendar popup
 is UA-owned and reaches no dial. `DateField` (segments, no
 calendar) rather than `DatePicker`: the segments are the entry affordance, and a
 calendar is a second surface this field does not need.

 A `datetime` is the same control with the time's segments after the date's, to the
 minute. It stores `YYYY-MM-DDThh:mm`, and `:ss` after it where the stored value
 carried seconds, which no segment shows and an edit keeps. `today` is no value of its
 type, so it draws no toggle and takes no `T`. The value is whole only with every
 segment filled, the time's too, so a date typed with no time is held and, on
 leaving, put back as any half-typed date is.

 The boundary is a string, and the local is too. The primitive speaks
 `CalendarDate`, or `CalendarDateTime` for a `datetime`; the document speaks
 `YYYY-MM-DD` and `YYYY-MM-DDThh:mm`. Neither carries a zone, so the round-trip is
 lossless and no local-midnight shift can occur: the hazard that makes
 `new Date('2026-07-25')` the wrong tool here. Authored values are data, not input:
 the parse throws on anything malformed, so a bad string degrades to an empty field
 rather than taking the editor down with it.

 The local is a `$derived`, which compares by identity, so it holds the string, not
 the parsed value: a fresh `CalendarDate` is never `===` the last one, so the
 re-derivation each commit causes would re-render all seven segments.

 The ghost is the default's digits, not a format hint. An unset field
 carrying a `default:` prints the default's digits in the segments at the default
 rung (theme.css), instead of the primitive's `mm`/`dd`/`yyyy` hints, which say
 "empty" where the rung says "will render 2026-01-01". At rest the ghost is painted
 in the segment snippet, over an unset primitive: a default held as its value reads
 as filled to every path that reads the primitive (`areAllSegmentsFilled`,
 Backspace, the hidden input), and whether it stands as the value is the field's to
 say only once the user enters it. `placeholder`
 (the `DateValue` the segments count from, never one they display) carries the
 default too, so arrowing an empty segment starts at the render's date rather than
 today's.

 Entering an unset field seats the default as the primitive's value, still at the
 default rung, so an edit to one segment commits a whole date with the others the
 default's. Leaving without an edit unseats it, and nothing is written.

 A segment edit that leaves a segment empty empties the primitive's value, which is
 held rather than committed while the focus stays inside: the first Backspace through
 a date writes nothing unset, and the empty segment shows its hint, not the default's
 digits beside the ones still standing. The keystroke that empties the last segment
 writes the blank at once, so the render follows the clear without waiting on the
 focus. Leaving with a segment filled puts the stored date back; a field storing no
 date puts its segments back by remounting the primitive, which re-reads an unchanged
 empty value as nothing to sync.
-->
<script lang="ts">
	import { flushSync } from 'svelte';
	import { DateField as BitsDateField } from 'bits-ui';
	import {
		getLocalTimeZone,
		parseDate,
		parseDateTime,
		toCalendarDateTime,
		today,
		type DateValue
	} from '@internationalized/date';
	import Icon from './icons/Icon.svelte';
	import { wording } from './strings.js';
	import './controls.css';

	const t = wording();
	const TODAY = 'today';
	/** Read at each use: a session left open past midnight renders the new day. */
	const renderDate = (): DateValue => today(getLocalTimeZone());

	interface Props {
		value: string | undefined;
		/** The declared `default:` (`YYYY-MM-DD` or `today`): parsed for display only,
		 * shown while unset, never written. */
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
		/** A `datetime`: the time's segments stand after the date's, and `today` is no
		 * value of its type, so it draws no toggle and takes no `T`. */
		datetime?: boolean;
		onCommit: (v: string | undefined) => void;
	}
	let { value, fallback, label, labelledBy, describedBy, datetime, onCommit }: Props = $props();

	let wrapEl: HTMLElement | undefined = $state();
	/** Take the caret: what the label click, and a parent placing focus here, calls.
	 * The first segment, not the field: focus lives on a segment (which is why the
	 * ring is `.qm-focus-ring-within`), and the container holds none. `literal` is the
	 * separator between segments: present, never focusable. */
	export function focus(): void {
		wrapEl?.querySelector<HTMLElement>('[data-segment]:not([data-segment="literal"])')?.focus();
	}

	/** The part of a stored string this control edits: all of a `datetime`, and the date
	 *  half of a `date`, anything past `YYYY-MM-DD` being no part of its type. */
	const span = (s: string | undefined): string | undefined => (datetime ? s : s?.slice(0, 10));
	// The parse throws on a malformed authored value: the segments stand empty and the
	// stored string draws beside them (`unread`), so the value an error names is on
	// screen.
	function toDateValue(s: string): DateValue | undefined {
		if (!s) return undefined;
		try {
			if (datetime) return parseDateTime(s);
			return s === TODAY ? renderDate() : parseDate(s);
		} catch {
			return undefined;
		}
	}
	/** A value as the document spells it. A `datetime` to the minute, its seconds
	 *  written only where it holds some. */
	const spell = (d: DateValue | undefined): string =>
		d ? (datetime ? d.toString().replace(/:00$/, '') : d.toString()) : '';

	const unread = $derived(
		value && value !== TODAY && !toDateValue(span(value)!) ? value : undefined
	);
	const fallbackDate = $derived(toDateValue(span(fallback) ?? ''));
	/** Where an empty segment counts from: the default, else, for a `datetime`, the
	 *  render date's midnight, a placeholder with a time being what stands the time's
	 *  segments. */
	const placeholder = $derived(
		fallbackDate ?? (datetime ? toCalendarDateTime(renderDate()) : undefined)
	);
	/** The default is the primitive's value: from entering an unset field until an
	 *  edit or leaving. Part of the projection, so a re-derivation keeps it. */
	let seat = $state(false);
	/** An emptied value held while the focus stays inside (see the header). Part of the
	 *  projection too, so a re-derivation restores neither the stored date nor the seat
	 *  over the segments it emptied. */
	let held = $state(false);
	/** Remounts the primitive when bumped (see the header). */
	let generation = $state(0);
	// Driven controlled (`value` + `onValueChange`, never `bind:`) so reconciliation
	// stays the package's.
	let local = $derived(
		held ? '' : (span(value) ?? (seat && fallbackDate ? spell(fallbackDate) : ''))
	);
	const parsed = $derived(toDateValue(local));
	// The date the empty segments ghost, or undefined when there is nothing to ghost:
	// the field is unset and the default has a date form. A non-blank local that
	// fails to parse is AUTHORED-but-malformed, which the empty field states
	// honestly: the ghost would claim it unset. Held as the parsed value rather than
	// a boolean so the substitution below narrows on the one fact it needs.
	const ghost = $derived(value == null && local === '' && !held ? fallbackDate : undefined);
	const seated = $derived(value == null && seat && local !== '');
	/** Who put `today` here, while the field follows the render date. */
	const follows = $derived(
		local === TODAY ? 'authored' : value == null && fallback === TODAY ? 'default' : undefined
	);

	function write(next: string): void {
		held = false;
		local = next;
		seat = false;
		onCommit(next);
	}
	function toggle(): void {
		write(follows ? renderDate().toString() : TODAY);
	}
	function shortcut(e: KeyboardEvent): void {
		if (datetime || e.key.toLowerCase() !== 't' || e.ctrlKey || e.metaKey || e.altKey) return;
		const seg = (e.target as HTMLElement).dataset.segment;
		if (!seg || seg === 'literal') return;
		e.preventDefault();
		e.stopPropagation();
		write(TODAY);
	}

	/** Focus moving between segments is neither an entry nor a leaving. */
	const within = (e: FocusEvent): boolean => !!wrapEl?.contains(e.relatedTarget as Node | null);
	function enter(e: FocusEvent): void {
		if (!within(e) && value == null && fallbackDate) seat = true;
	}
	const filled = (): boolean =>
		[...(wrapEl?.querySelectorAll('[data-segment]') ?? [])].some(
			(s) => s.getAttribute('data-segment') !== 'literal' && !s.hasAttribute('data-ghosted')
		);
	/** Every segment empty: the blank, written at once. */
	function clear(): void {
		const blank = fallbackDate ? '' : undefined;
		if (value !== blank) onCommit(blank);
	}
	function leave(e: FocusEvent): void {
		if (within(e)) return;
		const seated = seat;
		seat = false;
		const emptied = held;
		held = false;
		if (emptied && !filled()) clear();
		else if (!value && (emptied || (!seated && filled()))) generation++;
	}
	/** The keystroke that empties the last segment, after the primitive has drawn it. */
	function settle(): void {
		if (!held) return;
		flushSync();
		if (!filled()) clear();
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
	// The separators are `literal` parts, never unfilled. Digits are zero-padded to
	// the segment widths the field displays. A day period holds letters filled or not,
	// so it is filled where its hour is: `hour` is the hour segment's own text, and
	// `twelve` whether the field draws a day period, and so counts its hours to twelve.
	type Rung = 'default' | 'hint' | undefined;
	function segmentText(
		part: string,
		text: string,
		hour = '',
		twelve = false
	): { text: string; ghosted: Rung } {
		const filled = /\d/.test(part === 'dayPeriod' ? hour : text);
		if (part === 'literal' || filled) return { text, ghosted: undefined };
		if (!ghost) return { text, ghosted: 'hint' };
		const pad = (n: number, width = 2) => String(n).padStart(width, '0');
		const clock = 'hour' in ghost ? ghost : undefined;
		switch (part) {
			case 'year':
				return { text: pad(ghost.year, 4), ghosted: 'default' };
			case 'month':
				return { text: pad(ghost.month), ghosted: 'default' };
			case 'day':
				return { text: pad(ghost.day), ghosted: 'default' };
			case 'hour':
				return clock
					? { text: pad(twelve ? ((clock.hour + 11) % 12) + 1 : clock.hour), ghosted: 'default' }
					: { text, ghosted: 'hint' };
			case 'minute':
				return clock ? { text: pad(clock.minute), ghosted: 'default' } : { text, ghosted: 'hint' };
			case 'dayPeriod':
				return clock
					? { text: clock.hour < 12 ? 'AM' : 'PM', ghosted: 'default' }
					: { text, ghosted: 'hint' };
			default:
				return { text, ghosted: 'hint' };
		}
	}
</script>

<span
	class="qm-date-wrap"
	bind:this={wrapEl}
	onfocusin={enter}
	onfocusout={leave}
	onkeydowncapture={shortcut}
>
	{#key generation}
		<BitsDateField.Root
			value={parsed}
			{placeholder}
			granularity={datetime ? 'minute' : 'day'}
			onValueChange={(d) => {
				// A cleared or half-typed field yields undefined, held until the focus
				// leaves. The primitive reports its own value again as a segment loses
				// focus, which is no edit, and over a seated default or `today` would
				// write it.
				const next = spell(d);
				if (next === spell(parsed)) return;
				if (!d) {
					held = true;
					return;
				}
				held = false;
				local = next;
				onCommit(next);
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
				data-default={seated || follows ? '' : undefined}
				onkeydown={settle}
			>
				{#snippet children({ segments })}
					<!-- Keyed by index: `part` repeats (the `literal` separators between
					 segments all carry it) so a part-keyed block collides. -->
					{@const hour = segments.find((seg) => seg.part === 'hour')?.value}
					{@const twelve = segments.some((seg) => seg.part === 'dayPeriod')}
					{#each segments as seg, i (i)}
						{@const shown = segmentText(seg.part, seg.value, hour, twelve)}
						<BitsDateField.Segment
							class="qm-date-segment"
							part={seg.part}
							data-ghosted={shown.ghosted}
						>
							{shown.text}
						</BitsDateField.Segment>
					{/each}
					{#if unread}
						<span class="qm-date-unread">{unread}</span>
					{/if}
					{#if !datetime}
						<button
							type="button"
							class="qm-chip qm-tap-floor qm-focus-ring qm-date-today"
							aria-pressed={!!follows}
							data-default={follows === 'default' ? '' : undefined}
							onclick={toggle}
						>
							<Icon name={follows ? 'calendar-check' : 'calendar'} />{t.strings.dateToday}
						</button>
					{/if}
				{/snippet}
			</BitsDateField.Input>
		</BitsDateField.Root>
	{/key}
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
	   the caret happens to be in. Tabular figures, so a segment keeps its width as its
	   digits change. */
	.qm-date-wrap :global(.qm-date-segment) {
		padding: 0 var(--_qm-space-half);
		font-variant-numeric: tabular-nums;
		border-radius: var(--_qm-radius-inner);
		outline: none;
	}
	/* The first segment's pad sits inside the box's inset rather than after it, so its
	   digits start on the column every other box's text starts on. */
	.qm-date-wrap :global(.qm-date-segment:first-child) {
		margin-inline-start: calc(-1 * var(--_qm-space-half));
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
	/* A separator is punctuation between the parts rather than part of the value, so it
	 takes the label rung whatever the parts beside it hold: at `ink` it stood darker than
	 the hint or the default digits either side of it. */
	.qm-date-wrap :global(.qm-date .qm-date-segment[data-segment='literal']) {
		color: var(--_qm-ink-label);
	}
	/* The toggle's state is its fill and its glyph, never the pointer: a hover fill
	 would read as pressed. Off, it rests hidden where a pointer can reveal it, still
	 holding its width so the digits never shift. It sits inside the box's line, so
	 the box stands as tall as the inputs beside it. Its pad sits inside the box's
	 inset, so its label ends on the column the digits start on from the other side,
	 and its fill stands about as far off the box's end as off its top and bottom. */
	.qm-date-unread {
		margin-inline-start: var(--_qm-space-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--_qm-font-mono);
		color: var(--_qm-ink);
	}
	.qm-date-today {
		margin-inline-start: auto;
		margin-inline-end: calc(-1 * var(--_qm-space-2));
		padding-block: var(--_qm-space-half);
		line-height: 1;
		border-radius: var(--_qm-radius-inner);
	}
	.qm-date-today:hover {
		background: transparent;
		color: var(--_qm-ink-label);
	}
	.qm-date-today[aria-pressed='true'] {
		background: var(--_qm-accent-tint);
		color: var(--_qm-ink);
	}
	/* A default-supplied today keeps the pressed fill: the default ink alone says it is
	 shown and not written, as it does for the digits beside it. */
	.qm-date-today[data-default] {
		color: var(--_qm-ink-default);
	}
	@media (hover: hover) {
		.qm-date-wrap:not(:hover, :focus-within) .qm-date-today[aria-pressed='false'] {
			opacity: 0;
		}
	}
</style>
