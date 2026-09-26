// The schema × payload join, done by the editor (VISUAL_EDITOR §Structure). Pure
// functions only (no runes, no Document reads) so the ordering, control
// dispatch, group layout, titles, ghosts, and session-identity bookkeeping
// are unit-testable in isolation (tests/visual/structure.test.ts). The reactive
// orchestration (revision counter, live doc reads) lives in VisualEditor.svelte;
// this module is the projection math it feeds.
import {
	VARIANT_DISCRIMINANT_KEY,
	type Content,
	type PathStep,
	type PayloadItem,
	type QuillCardSchema,
	type QuillFieldSchema,
	type QuillFieldType,
	type ResolvedField,
	type Resolved
} from '@quillmark/wasm';
import { core } from '../core/lifecycle.js';

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
	| 'object' // nested subform
	| 'matrix'; // ticks over a roster, columns under a held member

/** The container controls: the ones a nested address walks into and a deep
 *  diagnostic routes through. */
export function isContainer(kind: ControlKind): boolean {
	return kind === 'array' || kind === 'object' || kind === 'variant' || kind === 'matrix';
}

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
	/** Display label: `title` when set, else the humanized field name. */
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
	/** The header an unrenamed card shows ({@link cardTitle} below its rename rung),
	 *  which the rename input ghosts (composable cards). */
	titlePlaceholder: string;
	/** Field name → current stored value (absent fields missing). */
	values: Record<string, unknown>;
	/**
	 * Field name → its resolved provenance row (`{ value, source }`), parallel to
	 * `values` (FIELD_PROVENANCE). The channel that feeds chrome (the ghosted
	 * `default:` and any authored/default/zero affordance), never the control
	 * value. Empty when `quill.resolve` is unavailable.
	 */
	provenance: Record<string, ResolvedField>;
	sections: GroupSection[];
	hasBody: boolean;
	/**
	 * The empty-body ghost, or undefined when the card renders no body. Never empty
	 * for a card that does ({@link resolveBodyGhost}), so a body leaf always has
	 * something in it to write into, which a field at rest deliberately does not: it
	 * draws what prints or what its quill declares, and an invented ghost would read as
	 * a value.
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

/** What an unset field shows of its `default:`: the resolved value the render would
 * use (`source === 'default'`), else undefined: an `authored` field shows its value,
 * a `blank` field has no default to show. */
export function ghostDefault(row: ResolvedField | undefined): unknown {
	return row?.source === 'default' ? row.value : undefined;
}

/** A ghost value's string form, or undefined for null/object (only text ghosts
 * render a placeholder). A scalar's resolved default reads through it; a content
 * field's resolves as `Content`, which a prose leaf reads by its text instead
 * ({@link titleText}). */
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
 * The empty body's ghost: the resolved body `default:`, else the kind's
 * `body.example`, else the consumer's wording, else the flat built-in. The
 * `default:` wins because it is the only one that describes the render: it promises
 * what prints if nothing is written, and wording placed over it would make that
 * promise unreadable. The rest are invitations, and an invitation belongs only where
 * there is no promise; the quill's own comes first, being the one an agent working
 * from the blueprint sees too.
 */
export function resolveBodyGhost(
	resolvedDefault: string | undefined,
	example: string | undefined,
	custom: string | undefined,
	builtIn: string
): string {
	return resolvedDefault || example || custom || builtIn;
}

/** Whether a cell is optional: a `t?` type, which renders `none` unanswered and so
 *  never declares a `default:` (canon `SCHEMAS.md` §"Optional cells"). */
export function optionalCell(f: QuillFieldSchema): boolean {
	return f.type.endsWith('?');
}

/** The type a cell's control reads: the declared one, an optional cell's `?` stripped.
 *  The `?` moves the render floor and nothing else, so every read of a type is this. */
export function baseType(f: QuillFieldSchema): QuillFieldType {
	return (optionalCell(f) ? f.type.slice(0, -1) : f.type) as QuillFieldType;
}

/**
 * A value the schema declares, as ghost text: a `default:`, an `example:` or a
 * `body.example`. Markdown — a `richtext` value — ghosts as the text it renders, one
 * block to a line, as a resolved default does ({@link titleText}); anything else as
 * itself. `undefined` for a blank or a non-scalar.
 */
export function declaredGhost(v: unknown, markdown: boolean): string | undefined {
	const text = stringifyGhost(v)?.trim();
	if (!text) return undefined;
	return (markdown ? core().importMarkdown(text).text.trim() : text) || undefined;
}

/**
 * A scalar `default:` as the text an unset control holds, where it prints: as
 * declared, `undefined` for none, a blank or a non-scalar. One test of printing for
 * every control, the one {@link exampleGhost} gives way to: a default of spaces
 * prints nothing a reader sees.
 */
export function printedText(v: unknown): string | undefined {
	const text = stringifyGhost(v);
	return text?.trim() ? text : undefined;
}

/**
 * A declared content literal as the `Content` it holds: a `richtext` one's markdown
 * imported, a `plaintext` one's text taken literally, one paragraph whose later lines
 * continue it, as the literal codec reads a stored one. What a cell's static
 * `default:` stands in its leaf as, where no resolved row reaches it. `undefined` for
 * a blank or a non-scalar.
 */
export function declaredContent(v: unknown, markdown: boolean): Content | undefined {
	const text = printedText(v);
	if (text === undefined) return undefined;
	if (markdown) return core().importMarkdown(text);
	return {
		text,
		lines: text
			.split('\n')
			.map((_, i) =>
				i === 0
					? { containers: [], kind: 'para' as const }
					: { containers: [], kind: 'para' as const, continues: true }
			),
		marks: [],
		islands: []
	};
}

/**
 * The `example:` an unset free-text cell ghosts: a `string`, `plaintext` or `richtext`
 * whose `default:` prints nothing. Every other type takes none. A default that prints
 * dominates, standing in the control as the value it is; a type-empty one, the
 * skippable marker, prints nothing and leaves the example the only thing to draw.
 */
export function exampleGhost(f: QuillFieldSchema): string | undefined {
	const kind = controlKind(f);
	if (kind !== 'text' && kind !== 'prose') return undefined;
	const markdown = baseType(f) === 'richtext';
	if (declaredGhost(f.default, markdown) !== undefined) return undefined;
	return declaredGhost(f.example, markdown);
}

/** Map a field schema to its control (precedence: prose › enum › text › …).
 * An array's element control is this over `items`: a missing `items` is a text
 * element. */
export function controlKind(f: QuillFieldSchema): ControlKind {
	switch (baseType(f)) {
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
		case 'matrix':
			return 'matrix';
		default:
			return 'text';
	}
}

/** The discriminant cell of a variant container, off the boundary's own constant: it
 *  crosses inside untyped container data with no type to read it off, so a literal here
 *  would be a second spelling of a reserved key. No variant may declare it. */
export const VARIANT_DISCRIMINANT = VARIANT_DISCRIMINANT_KEY;

/** The tick cell of a matrix member, the second reserved key beside the discriminant.
 *  The boundary synthesizes it on every member and exports no constant for it, so this
 *  is where the package spells it once (canon `SCHEMAS.md` §Matrix). */
export const MATRIX_HELD = 'held';

// ── The matrix ───────────────────────────────────────────────────────────────
// A namespace whose keys the roster fixes: `members` is the roster alone, and the
// `{held, …columns}` object each member desugars to is derived at parse and not
// serialized, so the control composes it from `members` × `properties` here.

/** One member of the roster: its id and its title. */
export interface MatrixMember {
	id: string;
	title: string;
}

/** The roster's members, in declaration order. Own keys only: a schema map is indexed
 *  by a document-supplied id, and `'toString' in members` is true of every roster. */
export function matrixMembers(roster: Record<string, string> | undefined): MatrixMember[] {
	return roster ? Object.keys(roster).map((id) => ({ id, title: roster[id] })) : [];
}

/** A member's stored payload, off the sparse map by own key: a document key can be
 *  spelled `constructor`. */
export function memberValue(map: Record<string, unknown> | undefined, id: string): unknown {
	return map && Object.hasOwn(map, id) ? map[id] : undefined;
}

/**
 * Whether a stored member is held. A bare scalar is the tick and a mapping is the member
 * object, whose `held` cell resolves as every absent cell does, to its `default:` of
 * `false` (canon `SCHEMAS.md` §Matrix): an absent key is unheld, a bare `true` is held,
 * and a member object is held only where its `held` cell says so. The spellings the
 * engine coerces to false — `false`, `0`, `"false"`, `null` — read false here; every other
 * present scalar reads held, so a document the engine would refuse still draws the tick
 * its spelling claims.
 */
export function matrixHeld(stored: unknown): boolean {
	if (typeof stored === 'object' && stored !== null)
		return (
			Object.hasOwn(stored, MATRIX_HELD) && tickOf((stored as Record<string, unknown>)[MATRIX_HELD])
		);
	return tickOf(stored);
}

/** A tick's scalar reading: absent and the engine's false spellings unheld, the rest held. */
function tickOf(v: unknown): boolean {
	if (v === undefined || v === null) return false;
	if (typeof v === 'boolean') return v;
	if (typeof v === 'number') return v !== 0;
	if (typeof v === 'string') return v !== 'false';
	return true;
}

/** A member's columns: the member object with its `held` cell taken out, `{}` for the
 *  bare and absent spellings. What the columns subform takes as its value. */
export function matrixColumns(stored: unknown): Record<string, unknown> {
	if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
	const rest = { ...(stored as Record<string, unknown>) };
	delete rest[MATRIX_HELD];
	return rest;
}

/**
 * The map after one member moves: `next` written under `id`, or the key dropped where
 * `next` is `undefined`; a map left holding nothing is an unset field. Every other
 * member rides through in the spelling the document had, so a stored `cyber_200: true`
 * stays `true` while its neighbour is edited.
 */
export function commitMember(
	map: Record<string, unknown> | undefined,
	id: string,
	next: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
	const out = { ...(map ?? {}) };
	if (next === undefined) delete out[id];
	else out[id] = next;
	return Object.keys(out).length ? out : undefined;
}

/**
 * The member a tick or an edit writes. Held with columns is the member object with an
 * explicit `held: true`; unheld keeps the columns under `held: false`, so tick, type,
 * untick, retick loses nothing; unheld with no columns is `undefined`, the key dropped.
 * Which columns are blank is the engine's rule and not restated here: a column control
 * that clears drops its key (`ObjectField`), so a member emptied by hand arrives with no
 * columns and only then leaves the map.
 */
export function memberWrite(
	held: boolean,
	columns: Record<string, unknown>
): Record<string, unknown> | undefined {
	if (!held && Object.keys(columns).length === 0) return undefined;
	return { [MATRIX_HELD]: held, ...columns };
}

/** The `object` a matrix member desugars to, for the schema walk: `held` beside the
 *  declared columns. Composed here because the boundary serializes the roster alone. */
export function matrixMemberSchema(matrix: QuillFieldSchema): QuillFieldSchema {
	return {
		type: 'object',
		properties: {
			[MATRIX_HELD]: { type: 'boolean', default: false },
			...(matrix.properties ?? {})
		}
	};
}

/** Whether `id` is on the roster. */
export function matrixDeclares(matrix: QuillFieldSchema, id: string): boolean {
	return matrix.members != null && Object.hasOwn(matrix.members, id);
}

// ── The schema walk ──────────────────────────────────────────────────────────

/**
 * The schema at `steps` under `field`, or `undefined` where the schema declares no such
 * place: an index under an `array`, a key under an `object`'s properties, a member id
 * under a `matrix` and a key under that member, a cell of any world (or the
 * discriminant) under a variant-bearing `enum`. The editor's copy of the boundary's
 * `schema_at`, held here because the landing lane checks an address against the schema
 * before it asks the mounted tree for it (VISUAL_EDITOR §Surface).
 */
export function schemaAt(
	field: QuillFieldSchema,
	steps: readonly PathStep[]
): QuillFieldSchema | undefined {
	let cursor: QuillFieldSchema | undefined = field;
	for (const step of steps) {
		if (!cursor) return undefined;
		cursor = stepInto(cursor, step);
	}
	return cursor;
}

/** What an array declaring no `items` holds, the walk's copy of the element control
 *  {@link controlKind} names for one: a text element, so an index into such an array is
 *  a place and not a refusal. */
const UNDECLARED_ELEMENT: QuillFieldSchema = { type: 'string' };

function stepInto(schema: QuillFieldSchema, step: PathStep): QuillFieldSchema | undefined {
	switch (controlKind(schema)) {
		case 'array':
			return typeof step === 'number' ? (schema.items ?? UNDECLARED_ELEMENT) : undefined;
		case 'object':
			return typeof step === 'string' && Object.hasOwn(schema.properties ?? {}, step)
				? schema.properties![step]
				: undefined;
		case 'matrix':
			return typeof step === 'string' && matrixDeclares(schema, step)
				? matrixMemberSchema(schema)
				: undefined;
		case 'variant': {
			if (typeof step !== 'string') return undefined;
			if (step === VARIANT_DISCRIMINANT) return { type: 'enum', values: schema.values };
			// Which world is live is a value-time fact, so the walk unions the worlds, as
			// the boundary's does.
			for (const cells of Object.values(schema.variants ?? {}))
				if (Object.hasOwn(cells, step)) return cells[step];
			return undefined;
		}
		default:
			return undefined;
	}
}

// ── Row summaries and layouts ────────────────────────────────────────────────

/** Whether a cell is one line tall by declaration: the shape a table column and a row
 *  summary can hold. A prose cell is one where it declares `inline`, `richtext` or
 *  `plaintext` alike. */
export function shortCell(sub: QuillFieldSchema): boolean {
	const kind = controlKind(sub);
	if (kind === 'prose') return !!sub.inline;
	return (
		kind === 'text' || kind === 'enum' || kind === 'number' || kind === 'boolean' || kind === 'date'
	);
}

/**
 * The first short text cell's words, in declaration order — a `string`, or an inline
 * `richtext` / `plaintext` — read through {@link titleText}; `undefined` while none of
 * them has any. What names an instance from its own values: a collapsed row, and a
 * card whose kind declares no `title`.
 */
function firstShortText(
	cells: Record<string, QuillFieldSchema> | undefined,
	values: Record<string, unknown>
): string | undefined {
	for (const [k, sub] of Object.entries(cells ?? {})) {
		const kind = controlKind(sub);
		if (kind !== 'text' && !(kind === 'prose' && shortCell(sub))) continue;
		const text = titleText(ownValue(values, k)).trim();
		if (text) return text;
	}
	return undefined;
}

/** A collapsed row's own words ({@link firstShortText}); `undefined` while the row has
 *  nothing to say for itself. */
export function rowSummary(items: QuillFieldSchema | undefined, row: unknown): string | undefined {
	return firstShortText(items?.properties, (row ?? {}) as Record<string, unknown>);
}

/** How an `array` draws its elements. */
export type ArrayLayout =
	| 'list' // one row per element, an `object` row collapsing to a summary
	| 'table'; // a grid over an `object` row's cells, a column per property

/**
 * The layout an array takes: `'table'` where the array's own `ui.layout` asks for it
 * and every cell of the row is short (a block prose cell declines it, at load width and
 * every width after), else `'list'`. That every column is a leaf is the loader's
 * contract (`quill::table_column_not_flat`); whether a leaf fits a cell is the surface's
 * answer (canon `SCHEMAS.md`): a table composes by position, so a row that would stack
 * inside a cell is not one.
 */
export function arrayLayout(field: QuillFieldSchema): ArrayLayout {
	if (field.ui?.layout !== 'table') return 'list';
	const items = field.items;
	if (!items || controlKind(items) !== 'object') return 'list';
	const cells = Object.values(items.properties ?? {});
	return cells.length > 0 && cells.every(shortCell) ? 'table' : 'list';
}

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
 * obligation (DOCUMENT_MODEL). Exempt are the cells whose absence of one says nothing:
 * a typed dictionary and a matrix, since a namespace declares no `default:` at all and
 * `validate` anchors obligation on the leaves under it; and an optional cell, which can
 * declare none, its unanswered render being `none`.
 */
export function obliged(schema: QuillFieldSchema): boolean {
	return (
		schema.type !== 'object' &&
		schema.type !== 'matrix' &&
		!optionalCell(schema) &&
		schema.default === undefined
	);
}

/** `foo_bar` → `Foo bar`: the label fallback when a field declares no `title`. */
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
		label: schema.title ?? humanize(name),
		description: schema.description,
		required: obliged(schema),
		inline: !!schema.inline,
		plaintext: baseType(schema) === 'plaintext'
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
 * pays more of it as the document is filled. A matrix declines as a roster does: its
 * height is the roster's, and grows again under every member ticked open. Its hint
 * reaches the roster instead, whose members stand abreast (`MatrixField`).
 */
function packable(f: FieldModel): boolean {
	if (!f.compact) return false;
	if (isContainer(f.control)) return false;
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

/** A value by own key: a declaration can name `constructor`. */
function ownValue(values: Record<string, unknown>, name: string): unknown {
	return Object.hasOwn(values, name) ? values[name] : undefined;
}

/** A field value as title text. A parsed field rests as the authored string and a
 *  committed one as `Content`, whose `text` is the same words; a scalar reads as
 *  itself; a variant container reads as its discriminant member, the one cell of it
 *  that names the world; any other container as nothing. */
export function titleText(v: unknown): string {
	if (v == null) return '';
	if (typeof v !== 'object') return String(v);
	const text = (v as Partial<Content>).text;
	if (typeof text === 'string') return text;
	const member = (v as Record<string, unknown>)[VARIANT_DISCRIMINANT];
	return typeof member === 'string' ? member : '';
}

/** A card kind's name: its schema `title`, else the humanized kind. What names a kind
 *  before there is an instance of it: the add menu, the retype select. */
export function kindTitle(cardSchema: QuillCardSchema | undefined, kind: string): string {
	const t = cardSchema?.title;
	return t && t.trim() ? t : humanize(kind);
}

/**
 * A card instance's header: the per-instance `$ext.editor.title` rename; else the
 * kind's schema `title`, which names every instance alike; else the instance's own
 * first short text cell ({@link firstShortText}); else the humanized kind. Empty
 * renames fall through, so a cleared rename reverts to what the schema says.
 */
export function cardTitle(
	cardSchema: QuillCardSchema | undefined,
	kind: string,
	values: Record<string, unknown>,
	extTitle: string | undefined
): string {
	if (extTitle && extTitle.trim()) return extTitle;
	const t = cardSchema?.title;
	if (t && t.trim()) return t;
	return firstShortText(cardSchema?.fields, values) ?? humanize(kind);
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
