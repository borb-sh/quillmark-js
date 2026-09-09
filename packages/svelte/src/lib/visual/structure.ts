// The schema × payload join, done by the editor (VISUAL_EDITOR §Structure). Pure
// functions only (no runes, no Document reads) so the ordering, control
// dispatch, group layout, title interpolation, and session-identity bookkeeping
// are unit-testable in isolation (tests/visual/structure.test.ts). The reactive
// orchestration (revision counter, live doc reads) lives in VisualEditor.svelte;
// this module is the projection math it feeds.
import type {
	Content,
	PayloadItem,
	QuillCardSchema,
	QuillFieldSchema,
	ResolvedField,
	Resolved
} from '@quillmark/wasm';

/** The control a field type maps to (VISUAL_EDITOR §"Structure mirrors the schema"). */
export type ControlKind =
	| 'prose' // richtext / plaintext → a codec prose leaf
	| 'text' // string
	| 'enum' // string+enum | type:'enum' → select
	| 'variant' // type:'enum' + variants: → select, plus the live world's cells
	| 'number' // number / integer
	| 'boolean' // boolean → toggle
	| 'date' // date / datetime → native date control
	| 'array' // add/remove repeater
	| 'object'; // nested subform

/** One field, projected: its schema, the control it renders as, and its layout hints. */
export interface FieldModel {
	name: string;
	schema: QuillFieldSchema;
	control: ControlKind;
	/** `ui.group` (undefined = ungrouped). */
	group: string | undefined;
	/** `ui.compact`: asks to share a row with adjacent compacts. A request, not a
	 * guarantee: `placeFields` declines it for the shapes that grow (see `packable`). */
	compact: boolean;
	/** Display label: `ui.title` when set, else the humanized field name. */
	label: string;
	/** Schema `description`: authoring help rendered beside the label,
	 * undefined when the field declares none. Chrome-only; never gates. */
	description: string | undefined;
	/**
	 * Required-ness: {@link obliged}. Drives a persistent label `*`; a field never
	 * carries both it and a ghosted `default:`, that default being the whole of what
	 * retires the obligation. Persistent (schema-derived, survives filling). Label
	 * chrome only; never gates.
	 */
	required: boolean;
	/** Prose-leaf flags (only meaningful when `control === 'prose'` / array items). */
	inline: boolean;
	plaintext: boolean;
}

/** A `ui.group` section: its label and the fields (declaration order) inside it. */
export interface GroupSection {
	group: string | undefined;
	label: string;
	fields: FieldModel[];
}

/**
 * One card instance projected for rendering: the schema × payload join result
 * the VisualEditor's `$derived` produces and hands to `<Card>`. Positional
 * identity is carried by `id` (a session key), not by array index.
 */
export interface CardModel {
	/** Stable session id (`'main'` for the main card). */
	id: string;
	isMain: boolean;
	kind: string;
	/**
	 * The card's `kind` has no projectable schema: a foreign kind under
	 * a schema that declares others, or a card under a schema with no `card_kinds` at
	 * all. Such a card renders a recovery shell (humanized title + retype + delete)
	 * instead of a field list, so its content is never dropped or trapped: retyping
	 * to a declared kind re-projects it, delete removes it. Always `false` for `main`.
	 */
	unschemable: boolean;
	/** Raw `$ext.editor.title` override (composable cards). */
	titleOverride: string;
	/** Schema-resolved title used as the rename placeholder (composable cards). */
	titlePlaceholder: string;
	/** Field name → current stored value (absent fields missing). */
	values: Record<string, unknown>;
	/**
	 * Field name → its resolved provenance row (`{ value, source }`), parallel to
	 * `values` (FIELD_PROVENANCE). The channel that feeds chrome (the ghosted
	 * `default:` and any authored/default/zero affordance), never the control
	 * value. Empty when `reader.resolve` is unavailable.
	 */
	provenance: Record<string, ResolvedField>;
	sections: GroupSection[];
	hasBody: boolean;
	/**
	 * The empty-body ghost, or undefined when the card renders no body. Never
	 * empty for a card that does: the resolved body `default:` when there is one,
	 * else the consumer's wording, else the built-in invitation
	 * ({@link resolveBodyGhost}). A body leaf therefore always has something in it
	 * to write into, which the inline fields deliberately do not: their ghost is
	 * the resolved default, and an invented one would read as a value.
	 */
	bodyGhost?: string;
}

/**
 * A card's resolved rows keyed by field name: the provenance channel parallel to
 * {@link CardModel.values}. `resolve` returns rows in declaration order; the
 * editor keys them the same way `values` keys its payload walk, so a field's value
 * and its provenance resolve under one name.
 */
export function provenanceMap(fields: ResolvedField[]): Record<string, ResolvedField> {
	return Object.fromEntries(fields.map((f) => [f.name, f]));
}

/** A card's resolved rows: its declared fields, and the `body` sibling `resolve`
 * hangs off each card. */
export interface ResolvedCardRows {
	fields: ResolvedField[];
	body: ResolvedField | null;
}

/** The empty rows a card with no resolve entry reads: a shared constant so the
 * per-card miss allocates nothing. */
export const NO_RESOLVED_ROWS: ResolvedCardRows = { fields: [], body: null };

/**
 * Composable cards' resolved rows keyed by document index (`ResolvedCard.index`,
 * not array position, so it holds whatever order the resolve view returns): built
 * once per derive, so the per-card provenance join is O(1). Both channels ride one
 * entry: a card reads its fields and its body from a single lookup. Empty map when
 * `resolved` is absent (a `resolve` failure degrades to no ghosts, never a blank
 * form).
 */
export function resolvedByCardIndex(resolved: Resolved | undefined): Map<number, ResolvedCardRows> {
	return new Map((resolved?.cards ?? []).map((c) => [c.index, { fields: c.fields, body: c.body }]));
}

/** The ghost a field shows when unset: the resolved `default:` value the render
 * would use (`source === 'default'`), else undefined: an `authored` field shows
 * its value, a `zero` field has no default to ghost. */
export function ghostDefault(row: ResolvedField | undefined): unknown {
	return row?.source === 'default' ? row.value : undefined;
}

/** A ghost value's string form, or undefined for null/object (only text ghosts
 * render a placeholder). The one text-ghost projection: a scalar field's
 * placeholder and a body leaf's both read `stringifyGhost ∘
 * ghostDefault`, since a richtext body resolves to a text render: the correct
 * thing to display as a placeholder (FIELD_PROVENANCE). */
export function stringifyGhost(ghost: unknown): string | undefined {
	return ghost != null && typeof ghost !== 'object' ? String(ghost) : undefined;
}

/** What a {@link BodyPlaceholder} is told about the body it words. The card's
 *  identity, not its chrome: `cardId` is what per-card wording keys off, `kind` keys
 *  the consumer's own `quill.schema` for anything richer, and a renamed card must not
 *  shift its ghost. */
export interface BodyPlaceholderContext {
	/**
	 * The card's session key (`CardId`), `'main'` for the main card. Follows its card
	 * across a reorder and a retype, and is re-minted when the surface re-keys on a new
	 * document handle. Opaque: wording keyed off it hashes it rather than reads it.
	 */
	cardId: string;
	/** The card's kind; `'main'` for the main card. */
	kind: string;
	/** The main card: whose `kind` is not a `card_kinds` key. */
	isMain: boolean;
}

/**
 * Consumer wording for an empty body, in place of the flat `bodyGhost` string;
 * returning `undefined` takes it. Consulted per card on every derive and never
 * cached, so it must be pure: a hook sampling a set at random re-rolls on every
 * keystroke. Per-card wording is a function of `cardId`, per-kind wording a function
 * of `kind`, and either is stable because the function is.
 */
export type BodyPlaceholder = (ctx: BodyPlaceholderContext) => string | undefined;

/**
 * The empty body's ghost: the resolved body `default:`, else the consumer's
 * wording, else the flat built-in. The `default:` wins because it is the only one
 * of the three that describes the render: it promises what prints if nothing is
 * written, and wording placed over it would make that promise unreadable. The
 * other two are invitations, and an invitation belongs only where there is no
 * promise.
 */
export function resolveBodyGhost(
	resolvedDefault: string | undefined,
	custom: string | undefined,
	builtIn: string
): string {
	return resolvedDefault || custom || builtIn;
}

/** Map a field schema to its control (precedence: prose › enum › text › …).
 * An array's element control is this over `items`: a missing `items` is a text
 * element. */
export function controlKind(f: QuillFieldSchema): ControlKind {
	switch (f.type) {
		case 'richtext':
		case 'plaintext':
			return 'prose';
		case 'enum':
			// `variants:` is the one key that changes a field's resting shape (canon
			// `SCHEMAS.md`): with it the field rests as a container, without it a bare string.
			return f.variants ? 'variant' : 'enum';
		case 'string':
			return 'text';
		case 'number':
		case 'integer':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'date':
		case 'datetime':
			return 'date';
		case 'array':
			return 'array';
		case 'object':
			return 'object';
		default:
			return 'text';
	}
}

/** The discriminant cell of a variant container (`VARIANT_DISCRIMINANT_KEY` upstream,
 *  which the boundary does not export). Reserved: no variant may declare it. */
export const VARIANT_DISCRIMINANT = 'value';

/**
 * Which world's cells to draw: the authored discriminant when the container carries
 * one, else the ghosted default's member — an unset field renders its `default:`, so a
 * defaulted world whose cells were hidden would print answers the form never asked
 * for. The blank owns no world, and neither does a member declaring no cells.
 */
export function variantMember(
	value: Record<string, unknown> | undefined,
	ghostMember: string | undefined
): string | undefined {
	const authored = value?.[VARIANT_DISCRIMINANT];
	return (typeof authored === 'string' ? authored : ghostMember) || undefined;
}

/** The cells a member declares, or `undefined` where that world has none. */
export function variantCells(
	schema: QuillFieldSchema,
	member: string | undefined
): Record<string, QuillFieldSchema> | undefined {
	return member ? schema.variants?.[member] : undefined;
}

/**
 * The container a discriminant pick commits, and the discriminant cell alone the unset
 * sentinel clears: sibling cells are **kept** either way, since the boundary carries an
 * answer its world does not select rather than dropping it (VISUAL_EDITOR §"Enum
 * variants"). A container left holding nothing is an unset field, which commits
 * `undefined`.
 */
export function commitDiscriminant(
	value: Record<string, unknown> | undefined,
	member: string | undefined
): Record<string, unknown> | undefined {
	const next = { ...(value ?? {}) };
	if (member !== undefined) return { ...next, [VARIANT_DISCRIMINANT]: member };
	delete next[VARIANT_DISCRIMINANT];
	return Object.keys(next).length ? next : undefined;
}

/**
 * Whether the schema obliges a cell: `default:`'s absence, which is the whole of the
 * obligation (DOCUMENT_MODEL). A typed dictionary is exempt — a namespace declares no
 * `default:` at all, and `validate` anchors obligation on the leaves under it, so
 * reading one off the container would mark every subform required.
 */
export function obliged(schema: QuillFieldSchema): boolean {
	return schema.type !== 'object' && schema.default === undefined;
}

/** `foo_bar` → `Foo bar`: the label fallback when a field declares no `ui.title`. */
export function humanize(name: string): string {
	const spaced = name.replace(/_/g, ' ').trim();
	return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : spaced;
}

/** Project a card schema's `fields` map (declaration = key order) into models. */
export function fieldModels(cardSchema: QuillCardSchema): FieldModel[] {
	return Object.entries(cardSchema.fields).map(([name, schema]) => ({
		name,
		schema,
		control: controlKind(schema),
		group: schema.ui?.group,
		compact: !!schema.ui?.compact,
		label: schema.ui?.title ?? humanize(name),
		description: schema.description,
		required: obliged(schema),
		inline: !!schema.inline,
		plaintext: schema.type === 'plaintext'
	}));
}

/**
 * Group-section order (VISUAL_EDITOR §"Structure mirrors the schema"): the schema's `ui.groups` registry
 * key order when present: `QuillCardUi.groups` is a typed `Record` at the
 * boundary, so this reads it uncast: else the first-appearance order of each
 * field's `ui.group`.
 */
export function groupOrder(cardSchema: QuillCardSchema): string[] {
	const groups = cardSchema.ui?.groups;
	if (groups) return Object.keys(groups);
	const order: string[] = [];
	for (const f of Object.values(cardSchema.fields)) {
		const g = f.ui?.group;
		if (g && !order.includes(g)) order.push(g);
	}
	return order;
}

/**
 * A group's display label: the `ui.groups[g].title` override when the registry
 * declares one, else the humanized id (`memo_for` → "Memo for"): the same
 * id-derives-the-label rule a field's key follows.
 */
export function groupLabel(cardSchema: QuillCardSchema, group: string): string {
	return cardSchema.ui?.groups?.[group]?.title ?? humanize(group);
}

/**
 * Sort field models into ordered group sections. Declared groups first (in
 * `order`), each carrying its fields in declaration order; then any remaining
 * groups (including the ungrouped bucket) in first-appearance order. `labelFor`
 * resolves a group id to its display label: always {@link groupLabel} bound to
 * the card schema, which falls back to {@link humanize} itself.
 */
export function groupSections(
	fields: FieldModel[],
	order: string[],
	labelFor: (group: string) => string
): GroupSection[] {
	const sections: GroupSection[] = [];
	const emitted = new Set<string | undefined>();
	for (const g of order) {
		const fs = fields.filter((f) => f.group === g);
		if (fs.length) {
			sections.push({ group: g, label: labelFor(g), fields: fs });
			emitted.add(g);
		}
	}
	for (const f of fields) {
		if (emitted.has(f.group)) continue;
		sections.push({
			group: f.group,
			label: f.group ? labelFor(f.group) : '',
			fields: fields.filter((x) => x.group === f.group)
		});
		emitted.add(f.group);
	}
	return sections;
}

/**
 * The group section a card's accordion opens on first mount: the first in
 * order, or `null` when the card declares none. Ungrouped fields render outside
 * the accordion, so only `group != null` sections count.
 *
 * A card opens on fields. All-collapsed paints as a stack of chevrons that name
 * their sections and disclose nothing of what is behind them, and a body leaf is
 * no substitute: on a card carrying both, the fields are what the card is for.
 * The first section is the one `ui.groups` already ranks highest, and it is the
 * same section on every mount: a rule keyed on document state would move the
 * opening under a user as they fill.
 *
 * State is ephemeral session state the Card owns; this only seeds it.
 */
export function initialExpandedGroup(sections: GroupSection[]): string | null {
	return sections.find((s) => s.group != null)?.group ?? null;
}

/** How wide a field sits in its section grid. */
export type FieldSpan =
	| 'cell' // one column, auto-placed among its neighbours
	| 'full'; // the whole grid, its own row

export interface PlacedField {
	field: FieldModel;
	span: FieldSpan;
}

/**
 * Whether a field can share a row. `ui.compact` asks; a shape declines when the
 * document sets its height, because a row is as tall as its tallest cell and the cell
 * beside it does not grow in step: an object nests a whole field set, block richtext
 * (`inline` absent) holds paragraphs, and an array holds however many elements the
 * document carries. Any of them stands its neighbour in a column of whitespace. An
 * inline prose leaf is one line tall and packs like any scalar.
 *
 * A variant declines for the same reason one step further in: its height is the live
 * world's cell count, so it is set by a pick rather than only by the document, and a
 * packed neighbour would reflow every time the discriminant moves. The hint reaches
 * nothing inside one either: a world's cells are the object subform's own grid, which
 * reads no `ui` of its own, so `ui.compact` is inert everywhere a variant carries it.
 *
 * An array declines whatever its items are: one-line elements make a one-line step,
 * but nothing holds two arrays to the same number of them, so the shorter of a packed
 * pair pays a cell of whitespace for every element the taller one has past it, and
 * pays more of it as the document is filled.
 */
function packable(f: FieldModel): boolean {
	if (!f.compact) return false;
	if (f.control === 'object' || f.control === 'array' || f.control === 'variant') return false;
	return f.control !== 'prose' || f.inline;
}

/**
 * Assign each field its span in the section grid. Consecutive packable fields are
 * `cell`s the grid auto-places: capacity and wrapping are the container query's
 * business, so a trailing orphan keeps its column width rather than growing to fill.
 * A run of one is stranded — nothing packed beside it, and no row above to align to —
 * so it is `full` like the shapes that declined: a lone narrow track reads as truncated
 * against the width it leaves empty, and sharing was the whole of what asked for it.
 * Everything else is `full`.
 *
 * Pure, and stays pure: no width, no measurement, nothing to re-derive on resize.
 */
export function placeFields(fields: FieldModel[]): PlacedField[] {
	const out: PlacedField[] = [];
	let run = 0;
	// A run of one is only knowable at its end, so the span is patched back onto the
	// field already placed.
	const flush = () => {
		if (run === 1) out[out.length - 1].span = 'full';
		run = 0;
	};
	for (const f of fields) {
		if (packable(f)) {
			out.push({ field: f, span: 'cell' });
			run++;
		} else {
			flush();
			out.push({ field: f, span: 'full' });
		}
	}
	flush();
	return out;
}

/** A card's field values by key, off its payload items. */
export function fieldValues(items: readonly PayloadItem[]): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const p of items) if (p.type === 'field') values[p.key] = p.value;
	return values;
}

/** Interpolate a `{field}` card-title template against live field values. */
export function interpolateTitle(template: string, values: Record<string, unknown>): string {
	return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) =>
		titleText(values[name])
	);
}

/** A field value as title text. A parsed field rests as the authored string and a
 *  committed one as `Content`, whose `text` is the same words; a scalar reads as
 *  itself and any other container as nothing. */
export function titleText(v: unknown): string {
	if (v == null) return '';
	if (typeof v !== 'object') return String(v);
	const text = (v as Partial<Content>).text;
	return typeof text === 'string' ? text : '';
}

/** The field names a `{field}` title reads. */
export function titleFields(template: string | undefined): string[] {
	if (!template) return [];
	return [...template.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
}

/**
 * Resolve a card instance's header title: the per-instance `$ext.editor.title`
 * override wins; else the schema `ui.title` (literal or `{field}` template
 * interpolated); else the humanized kind. Empty overrides fall through so a
 * cleared rename reverts to the schema title.
 */
export function cardTitle(
	cardSchema: QuillCardSchema | undefined,
	kind: string,
	values: Record<string, unknown>,
	extTitle: string | undefined
): string {
	if (extTitle && extTitle.trim()) return extTitle;
	const t = cardSchema?.ui?.title;
	if (t && t.trim()) return interpolateTitle(t, values);
	return humanize(kind);
}

/** Whether a card kind renders a body leaf: gated by `body.enabled !== false`. */
export function bodyEnabled(cardSchema: QuillCardSchema | undefined): boolean {
	return cardSchema?.body?.enabled !== false;
}

// ── Session identity (VISUAL_EDITOR §"The address is the spine") ─────────────
// Cards are positional in the content and `doc.cards` re-allocates on each read,
// so a stable card-instance key cannot be the card object (a fresh object every
// derive): it is a session id held in a parallel array, reordered in lockstep
// with the structure ops and resolved to an index only at the mutation boundary.

/** A monotonic per-session id source. Ids are opaque strings, stable for the
 * session; a fresh array for N existing instances is `seq.take(N)`, and an id
 * resolves to its current index by `ids.indexOf(id)` (-1 once the instance is
 * gone): read at the mutation boundary, never cached. */
export class IdSeq {
	#n = 0;
	next(): string {
		return `c${this.#n++}`;
	}
	/** `count` fresh ids, in order. */
	take(count: number): string[] {
		return Array.from({ length: count }, () => this.next());
	}
}
