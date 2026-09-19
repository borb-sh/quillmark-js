// The pure join/ordering/layout math (VisualEditor's projection). Unit-tested
// in isolation (no runes, no Document) including against the real showcase
// schema so the ordering contract and group layout are asserted on the fixture
// the suite runs against.
import { describe, it, expect } from 'vitest';
import type { QuillFieldSchema } from '@quillmark/wasm';
import {
	controlKind,
	humanize,
	fieldModels,
	groupOrder,
	groupLabel,
	groupSections,
	initialExpandedGroup,
	placeFields,
	interpolateTitle,
	titleText,
	titleFields,
	fieldValues,
	cardTitle,
	bodyEnabled,
	variantMember,
	variantCells,
	commitDiscriminant,
	elementSummary,
	summaryKey,
	tabular,
	grows,
	propertyGrows,
	obliged,
	matrixGroups,
	matrixHeld,
	matrixColumns,
	matrixMember,
	matrixCommit,
	matrixHeldCount,
	matrixMemberAt
} from '$lib/visual/structure';
import { quill } from '../helpers/fixtures.js';

const f = (over: Partial<QuillFieldSchema>): QuillFieldSchema =>
	({ type: 'string', ...over }) as QuillFieldSchema;

describe('controlKind', () => {
	it('maps each field type to its control', () => {
		expect(controlKind(f({ type: 'richtext' }))).toBe('prose');
		expect(controlKind(f({ type: 'plaintext' }))).toBe('prose');
		expect(controlKind(f({ type: 'string' }))).toBe('text');
		expect(controlKind(f({ type: 'enum', values: ['a'] }))).toBe('enum');
		expect(controlKind(f({ type: 'number' }))).toBe('number');
		expect(controlKind(f({ type: 'integer' }))).toBe('number');
		expect(controlKind(f({ type: 'boolean' }))).toBe('boolean');
		expect(controlKind(f({ type: 'date' }))).toBe('date');
		expect(controlKind(f({ type: 'datetime' }))).toBe('date');
		expect(controlKind(f({ type: 'array' }))).toBe('array');
		expect(controlKind(f({ type: 'object' }))).toBe('object');
	});

	it('splits the enum on `variants:`, the key that changes its resting shape', () => {
		const values = ['a', 'b'];
		expect(controlKind(f({ type: 'enum', values }))).toBe('enum');
		expect(
			controlKind(f({ type: 'enum', values, variants: { b: { note: f({ type: 'string' }) } } }))
		).toBe('variant');
	});
});

describe('variantMember + variantCells', () => {
	const schema = f({
		type: 'enum',
		values: ['plain', 'rich'],
		variants: { rich: { note: f({ type: 'string' }) } }
	});

	it('reads the authored discriminant, and falls back to the ghosted default', () => {
		expect(variantMember({ value: 'rich' }, 'plain')).toBe('rich');
		// Unset draws the world the document renders as, not nothing: an unset field
		// resolves its `default:`, so hiding that world's cells would print answers the
		// form never asked for.
		expect(variantMember(undefined, 'plain')).toBe('plain');
		// A container carrying answers but no discriminant is unset too, and the engine
		// resolves it the same way.
		expect(variantMember({ note: 'x' }, 'plain')).toBe('plain');
	});

	it('gives the blank no world, authored or ghosted', () => {
		expect(variantMember({ value: '' }, 'plain')).toBeUndefined();
		expect(variantMember(undefined, undefined)).toBeUndefined();
		expect(variantMember(undefined, '')).toBeUndefined();
	});

	it('answers cells only where that world declares them', () => {
		expect(variantCells(schema, 'rich')).toEqual({ note: f({ type: 'string' }) });
		expect(variantCells(schema, 'plain')).toBeUndefined();
		expect(variantCells(schema, undefined)).toBeUndefined();
	});
});

describe('commitDiscriminant', () => {
	it('keeps the answers a flip strands, which is what the boundary does with them', () => {
		expect(commitDiscriminant({ value: 'rich', note: 'x' }, 'plain')).toEqual({
			value: 'plain',
			note: 'x'
		});
		expect(commitDiscriminant(undefined, 'rich')).toEqual({ value: 'rich' });
	});

	it('clears the discriminant cell alone, and the field when it held nothing else', () => {
		expect(commitDiscriminant({ value: 'rich', note: 'x' }, undefined)).toEqual({ note: 'x' });
		expect(commitDiscriminant({ value: 'rich' }, undefined)).toBeUndefined();
		expect(commitDiscriminant(undefined, undefined)).toBeUndefined();
	});
});

describe('humanize', () => {
	it('spaces and capitalizes a snake_case name', () => {
		expect(humanize('memo_for')).toBe('Memo for');
		expect(humanize('font_size')).toBe('Font size');
		expect(humanize('date')).toBe('Date');
	});
});

describe('interpolateTitle + cardTitle', () => {
	it('interpolates {field} against live values', () => {
		expect(interpolateTitle('To {for} from {from}', { for: 'A', from: 'B' })).toBe('To A from B');
		expect(interpolateTitle('x {missing} y', {})).toBe('x  y');
	});
	it('reads a committed Content value by its text', () => {
		const content = { text: 'John A. Doe', lines: [], marks: [], islands: [] };
		expect(interpolateTitle('{rank} {name}', { rank: 'TSgt', name: content })).toBe(
			'TSgt John A. Doe'
		);
		expect(titleText(content)).toBe('John A. Doe');
		expect(titleText({ lines: [] })).toBe('');
		expect(titleText(['a', 'b'])).toBe('');
		expect(titleText(12)).toBe('12');
		expect(titleText(undefined)).toBe('');
	});
	it('names the fields a title reads', () => {
		expect(titleFields('{rank} {name}')).toEqual(['rank', 'name']);
		expect(titleFields('Routing indorsement')).toEqual([]);
		expect(titleFields(undefined)).toEqual([]);
	});
	it('joins a payload into values by key, comments aside', () => {
		const content = { text: 'John A. Doe', lines: [], marks: [], islands: [] };
		expect(
			fieldValues([
				{ type: 'field', key: 'rank', value: 'TSgt' },
				{ type: 'comment', text: 'not a field' },
				{ type: 'field', key: 'name', value: content }
			])
		).toEqual({ rank: 'TSgt', name: content });
	});
	it('override wins, then schema title, then humanized kind', () => {
		const schema = { fields: {}, ui: { title: 'Routing indorsement' } };
		expect(cardTitle(schema, 'indorsement', {}, 'Custom')).toBe('Custom');
		expect(cardTitle(schema, 'indorsement', {}, '')).toBe('Routing indorsement');
		expect(cardTitle({ fields: {} }, 'indorsement', {}, undefined)).toBe('Indorsement');
	});
});

describe('placeFields', () => {
	// A projected field, minus the projection: `control`/`inline` are what `packable`
	// reads. The schema rides along because a model carries one, and the array cases
	// vary its `items` to hold that the decline reads none of them.
	const mk = (name: string, compact: boolean, extra: Record<string, unknown> = {}) =>
		({
			name,
			compact,
			control: 'text',
			inline: false,
			schema: { type: 'string' },
			...extra
		}) as unknown as ReturnType<typeof fieldModels>[number];
	/** An array field of `items`, with the control the projection would give it. */
	const arr = (name: string, compact: boolean, items?: Record<string, unknown>) =>
		mk(name, compact, { control: 'array', schema: { type: 'array', items } });
	const spans = (fields: ReturnType<typeof mk>[]) =>
		placeFields(fields).map((p) => [p.field.name, p.span]);

	it('shares a row across a compact run, solos the rest', () => {
		expect(
			spans([mk('a', false), mk('b', true), mk('c', true), mk('d', true), mk('e', false)])
		).toEqual([
			['a', 'full'],
			['b', 'cell'],
			['c', 'cell'],
			['d', 'cell'],
			['e', 'full']
		]);
	});

	it('spans a stranded compact field across the whole row, wherever it sits', () => {
		// Trailing, leading, and alone: a run of one has nothing to share with, so the
		// hint buys it nothing and it takes the width every unpacked field takes.
		expect(spans([mk('a', false), mk('b', true)])).toEqual([
			['a', 'full'],
			['b', 'full']
		]);
		expect(spans([mk('a', true), mk('b', false)])).toEqual([
			['a', 'full'],
			['b', 'full']
		]);
		expect(spans([mk('a', true)])).toEqual([['a', 'full']]);
	});

	it('keeps a run of two as cells — one is the only run that strands', () => {
		expect(spans([mk('a', true), mk('b', true)])).toEqual([
			['a', 'cell'],
			['b', 'cell']
		]);
	});

	it('declines the compact hint for shapes that grow under their neighbours', () => {
		// Block richtext (`inline` absent) holds paragraphs and an object nests a field
		// set: either one stands its neighbours in a column of whitespace, so both take
		// a full row despite `ui.compact`.
		expect(
			spans([
				mk('block', true, { control: 'prose', inline: false }),
				mk('obj', true, { control: 'object', schema: { type: 'object' } })
			])
		).toEqual([
			['block', 'full'],
			['obj', 'full']
		]);
	});

	it('declines the compact hint for a variant, whose height a pick sets', () => {
		// A variant's height is the live world's cell count, so it moves on a pick rather
		// than only with the document: a packed neighbour would reflow every flip.
		expect(
			spans([
				mk('world', true, { control: 'variant', schema: { type: 'enum', values: ['a'] } }),
				mk('after', true)
			])
		).toEqual([
			['world', 'full'],
			['after', 'full']
		]);
	});

	it("reads a variant's compact hint as nothing at all, its neighbours included", () => {
		// Not merely "the variant spans the row": the hint moves no field on either side
		// of it, so a schema that declares it and one that does not place identically.
		const row = (compact: boolean) => [
			mk('a', true),
			mk('b', true),
			mk('world', compact, { control: 'variant', schema: { type: 'enum', values: ['a'] } }),
			mk('c', true)
		];
		expect(spans(row(true))).toEqual(spans(row(false)));
		expect(spans(row(true))).toEqual([
			['a', 'cell'],
			['b', 'cell'],
			['world', 'full'],
			['c', 'full']
		]);
	});

	it('declines the compact hint for an array whatever its items are', () => {
		// `memo_for` in the reference quill: an address block of one-line strings, the
		// shape that packs on any per-items reading. The element count is the document's,
		// so a packed array pays a cell of whitespace for every element its neighbour has
		// past it. An array with no `items` has text elements and declines the same.
		expect(
			spans([
				arr('strings', true, { type: 'string' }),
				arr('untyped', true),
				arr('inline_prose', true, { type: 'richtext', inline: true }),
				arr('blocks', true, { type: 'richtext' }),
				arr('objects', true, { type: 'object' })
			])
		).toEqual([
			['strings', 'full'],
			['untyped', 'full'],
			['inline_prose', 'full'],
			['blocks', 'full'],
			['objects', 'full']
		]);
	});

	it('packs an inline prose leaf like any scalar', () => {
		// `tag_line` in the reference quill: richtext + inline + compact, one line tall.
		expect(
			spans([mk('seal', true), mk('tag_line', true, { control: 'prose', inline: true })])
		).toEqual([
			['seal', 'cell'],
			['tag_line', 'cell']
		]);
	});

	it('does not let a declined field fuse the runs on either side of it', () => {
		// The block field breaks the run, so each neighbour is a run of one.
		expect(
			spans([mk('a', true), mk('block', true, { control: 'prose', inline: false }), mk('b', true)])
		).toEqual([
			['a', 'full'],
			['block', 'full'],
			['b', 'full']
		]);
	});
});

describe('initialExpandedGroup', () => {
	const sec = (group: string | undefined) =>
		({ group, label: group ?? '', fields: [] }) as ReturnType<typeof groupSections>[number];

	it('opens the first group in order', () => {
		expect(initialExpandedGroup([sec('a')])).toBe('a');
		expect(initialExpandedGroup([sec('a'), sec('b')])).toBe('a');
	});
	it('opens the first group whether or not the card carries a body', () => {
		// A body leaf is no substitute for a field: the card opens on one either way.
		expect(initialExpandedGroup([sec('a'), sec('b'), sec('c'), sec('d')])).toBe('a');
	});
	it('skips ungrouped sections, which render outside the accordion', () => {
		expect(initialExpandedGroup([sec(undefined), sec('a')])).toBe('a');
		// No groups at all → nothing to expand.
		expect(initialExpandedGroup([sec(undefined)])).toBeNull();
		expect(initialExpandedGroup([])).toBeNull();
	});
});

describe('groupOrder', () => {
	it('takes the typed ui.groups registry, in registry order', () => {
		const schema = {
			fields: { a: f({ ui: { group: 'two' } }) },
			ui: { groups: { one: {}, two: {} } }
		} as unknown as Parameters<typeof groupOrder>[0];
		expect(groupOrder(schema)).toEqual(['one', 'two']);
	});

	it('falls back to first-declaration order when no registry is declared', () => {
		const schema = {
			fields: {
				a: f({ ui: { group: 'second' } }),
				b: f({ ui: { group: 'first' } }),
				c: f({ ui: { group: 'second' } }),
				d: f({})
			}
		} as unknown as Parameters<typeof groupOrder>[0];
		// Order of first appearance, each group once, and an ungrouped field adds none.
		expect(groupOrder(schema)).toEqual(['second', 'first']);
	});
});

describe('groupLabel', () => {
	it('takes the registry title override, else humanizes the group id', () => {
		const schema = {
			fields: {},
			ui: { groups: { memo_for: { title: 'Memo For' }, addressing: {} } }
		} as unknown as Parameters<typeof groupLabel>[0];
		expect(groupLabel(schema, 'memo_for')).toBe('Memo For');
		expect(groupLabel(schema, 'addressing')).toBe('Addressing');
	});
});

describe('bodyEnabled', () => {
	it('is true unless the card schema turns it off explicitly', () => {
		const body = (enabled?: boolean) =>
			({ fields: {}, body: enabled === undefined ? {} : { enabled } }) as unknown as Parameters<
				typeof bodyEnabled
			>[0];
		expect(bodyEnabled(body(false))).toBe(false);
		expect(bodyEnabled(body(true))).toBe(true);
		expect(bodyEnabled(body())).toBe(true);
		expect(bodyEnabled({ fields: {} } as unknown as Parameters<typeof bodyEnabled>[0])).toBe(true);
		expect(bodyEnabled(undefined)).toBe(true);
	});
});

describe('required', () => {
	const models = (fields: Record<string, unknown>) =>
		Object.fromEntries(
			fieldModels({ fields } as unknown as Parameters<typeof fieldModels>[0]).map((m) => [
				m.name,
				m
			])
		);

	it('derives from the absence of a `default:`, which an empty string or array still counts as', () => {
		const byName = models({
			none: f({}),
			empty: f({ default: '' }),
			list: f({ type: 'array', default: [] })
		});
		expect(byName.none.required).toBe(true);
		expect(byName.empty.required).toBe(false);
		expect(byName.list.required).toBe(false);
	});

	it('exempts a typed dictionary, whose obligation is its leaves’', () => {
		// A namespace can declare no `default:` at all, so reading one off the container
		// would mark every subform required. `validate` anchors the obligation on the
		// properties, and so does the subform's own label.
		const byName = models({
			dict: f({ type: 'object', properties: { name: f({}) } })
		});
		expect(byName.dict.required).toBe(false);
	});
});

// The real schema is here to prove the fixture's YAML shapes reach the projection
// as the synthetic cases above assume. It asserts contracts, never the fixture's
// inventory: a count, a group list or a field's copy pinned here fails on every
// edit to the reference quill, and the failure is answered by pasting the new
// value (CLAUDE.md §Verification).
describe('against the real showcase schema', () => {
	const main = () => quill().schema.main;

	it('projects fields in declaration order, with the real shapes mapping to controls', () => {
		const schema = main();
		const models = fieldModels(schema);
		expect(models.map((m) => m.name)).toEqual(Object.keys(schema.fields));
		const byName = Object.fromEntries(models.map((m) => [m.name, m]));
		// One of each shape the synthetic table covers: an inline richtext leaf, an
		// enum, and an array whose items are themselves richtext.
		expect(byName.title.control).toBe('prose');
		expect(byName.title.inline).toBe(true);
		expect(byName.status.control).toBe('enum');
		expect(byName.keywords.control).toBe('array');
		expect(byName.keywords.schema.items?.type).toBe('richtext');
	});

	it('splits the two variants on what their `default:` names', () => {
		const byName = Object.fromEntries(fieldModels(main()).map((m) => [m.name, m]));
		expect(byName.distribution.control).toBe('variant');
		expect(byName.handling.control).toBe('variant');
		// The blank is a `default:` like any other, so the field is unobliged and draws
		// no `*`; what it does not do is name a world (`variantMember`), so an unset
		// `handling` draws its discriminant alone where `distribution` draws cells.
		expect(byName.handling.schema.default).toBe('');
		expect(byName.handling.required).toBe(false);
		expect(variantCells(byName.handling.schema, variantMember(undefined, ''))).toBeUndefined();
		expect(
			Object.keys(variantCells(byName.distribution.schema, variantMember(undefined, 'embargoed'))!)
		).toEqual(['lift_on', 'held_by']);
		// A member is a value, not an id: one carries a space, and the cells hang off the
		// spelling the schema declares rather than a humanized one.
		expect(byName.handling.schema.values).toContain('CLOSE HOLD');
		expect(Object.keys(byName.handling.schema.variants!)).toEqual(['CONTROLLED']);
	});

	it('reads `inline` off what the boundary serves, which spells it at every type', () => {
		const byName = Object.fromEntries(fieldModels(main()).map((m) => [m.name, m]));
		// `subtitle` and the `handling` cells declare `inline: true` on disk, and the
		// schema carries it whatever the field's type, so a plaintext leaf is an inline
		// one and `packable` takes the `ui.compact` it asks for.
		expect(byName.subtitle.schema.type).toBe('plaintext');
		expect(byName.subtitle.plaintext).toBe(true);
		expect(byName.subtitle.inline).toBe(true);
		expect(byName.epigraph.inline).toBe(true); // richtext, declared the same way
		expect(byName.subtitle.compact).toBe(true);
		// Packable and alone is still `full`: a run of one has nothing to pack against.
		expect(placeFields([byName.subtitle])).toEqual([{ field: byName.subtitle, span: 'full' }]);
	});

	it('threads a field schema description into the model verbatim', () => {
		const byName = Object.fromEntries(fieldModels(main()).map((m) => [m.name, m]));
		expect(byName.authors.description).toBe(byName.authors.schema.description);
		expect(byName.authors.description).toBeTruthy(); // the fixture declares one to thread
	});

	it('sections every field into the declared group order, losing none', () => {
		const schema = main();
		const models = fieldModels(schema);
		const sections = groupSections(models, groupOrder(schema), (g) => groupLabel(schema, g));
		// Grouped sections follow the registry; an ungrouped one may trail them.
		expect(sections.map((s) => s.group).filter((g) => g != null)).toEqual(groupOrder(schema));
		// And it is a partition; every projected field lands in exactly one section.
		expect(sections.flatMap((s) => s.fields.map((m) => m.name)).sort()).toEqual(
			models.map((m) => m.name).sort()
		);
	});
});

// ── The row summary (VISUAL_EDITOR §"Structure mirrors the schema") ──────────

describe('a row summary', () => {
	const rowItems = (over: Partial<QuillFieldSchema>): QuillFieldSchema =>
		f({ type: 'object', ...over });

	it('reads `items.ui.title` over the row\u2019s own cells', () => {
		const items = rowItems({
			ui: { title: '{from} \u2192 {for}' },
			properties: { from: f({}), for: f({}) }
		});
		expect(elementSummary(items, { from: 'Ops', for: 'Wing' })).toBe('Ops \u2192 Wing');
		// A row with neither cell written reads its indexed name, not the arrow between
		// them: the literal text of a template is punctuation between two answers.
		expect(elementSummary(items, {})).toBeUndefined();
		expect(elementSummary(items, undefined)).toBeUndefined();
		// One of them written is written in.
		expect(elementSummary(items, { from: 'Ops' })).toBe('Ops \u2192');
		// A template naming no cell is a constant the author chose, and stands.
		expect(elementSummary(rowItems({ ui: { title: 'Tour' } }), {})).toBe('Tour');
	});

	it('falls to the first cell whose words are the row\u2019s own', () => {
		// A `string` cell is one, and so is an inline content leaf — which is the shape
		// every airmark row carries and the one a `string`-only rule could not read.
		expect(summaryKey(rowItems({ properties: { n: f({ type: 'integer' }), t: f({}) } }))).toBe('t');
		expect(
			summaryKey(
				rowItems({
					properties: {
						flag: f({ type: 'boolean' }),
						title: f({ type: 'plaintext', inline: true })
					}
				})
			)
		).toBe('title');
		// A block leaf is not: a first sentence stands for a record it is only part of.
		expect(summaryKey(rowItems({ properties: { body: f({ type: 'richtext' }) } }))).toBeUndefined();
		// Read through `titleText`, so a committed cell and a parsed one read alike.
		const items = rowItems({ properties: { title: f({ type: 'plaintext', inline: true }) } });
		expect(elementSummary(items, { title: 'Spring run' })).toBe('Spring run');
		expect(elementSummary(items, { title: { text: 'Spring run' } })).toBe('Spring run');
	});

	it('reads a variant container as the member it selects', () => {
		// `{topic}` over a variant-bearing enum: the container carries no `.text`, so a
		// title that read only content read nothing.
		expect(titleText({ value: 'experience', employer: 'Wing' })).toBe('experience');
		expect(interpolateTitle('{topic}', { topic: { value: 'experience' } })).toBe('experience');
		// A container that selects nothing still reads as nothing.
		expect(titleText({ employer: 'Wing' })).toBe('');
	});
});

// ── The grid arm (#597) and the shape rule under it ─────────────────────────

describe('the figure an array draws in', () => {
	const table = (props: Record<string, QuillFieldSchema>): QuillFieldSchema =>
		f({ type: 'array', ui: { layout: 'table' }, items: f({ type: 'object', properties: props }) });

	it('grants a table to a row every cell of which is one line high', () => {
		expect(
			tabular(table({ title: f({ type: 'plaintext', inline: true }), n: f({ type: 'integer' }) }))
		).toBe(true);
		// A request, not a contract, and the schema alone answers it: a block leaf, a
		// nested container and a matrix each make the row a record.
		expect(tabular(table({ body: f({ type: 'richtext' }) }))).toBe(false);
		expect(tabular(table({ rows: f({ type: 'array', items: f({}) }) }))).toBe(false);
		expect(tabular(table({ m: f({ type: 'matrix', members: [] }) }))).toBe(false);
		// A row with no cells is no table either.
		expect(tabular(table({}))).toBe(false);
	});

	it('declines where the field asks for nothing, or asks it of the wrong shape', () => {
		expect(
			tabular(f({ type: 'array', items: f({ type: 'object', properties: { a: f({}) } }) }))
		).toBe(false);
		expect(tabular(f({ type: 'array', ui: { layout: 'table' }, items: f({}) }))).toBe(false);
		expect(tabular(undefined)).toBe(false);
	});

	it('is the one height rule, read at a field and at a property alike', () => {
		// `grows` decides what `ui.compact` may ask for and what a subform property takes
		// of its own grid, so the two grids measure alike however deep the nesting goes.
		expect(grows('prose', true)).toBe(false);
		expect(grows('prose', false)).toBe(true);
		for (const k of ['array', 'object', 'variant', 'matrix'] as const)
			expect(grows(k, true)).toBe(true);
		for (const k of ['text', 'enum', 'number', 'boolean', 'date'] as const)
			expect(grows(k, false)).toBe(false);
		expect(propertyGrows(f({ type: 'plaintext', inline: true }))).toBe(false);
		expect(propertyGrows(f({ type: 'array', items: f({}) }))).toBe(true);
	});
});

// ── The matrix (#599) ────────────────────────────────────────────────────────

describe('the matrix projection', () => {
	const roster = f({
		type: 'matrix',
		properties: { detail: f({ type: 'plaintext', inline: true, default: '' }) },
		members: [
			{ group: 'Ops', values: { flight_cc: 'Flight CC', dodin_ops: 'DODIN Ops' } },
			{ values: { cyber_200: 'Cyber 200' } }
		]
	});

	it('composes the roster the boundary serves, groups kept and order held', () => {
		expect(matrixGroups(roster)).toEqual([
			{
				label: 'Ops',
				members: [
					{ id: 'flight_cc', title: 'Flight CC' },
					{ id: 'dodin_ops', title: 'DODIN Ops' }
				]
			},
			{ label: undefined, members: [{ id: 'cyber_200', title: 'Cyber 200' }] }
		]);
		expect(matrixGroups(f({ type: 'matrix' }))).toEqual([]);
	});

	it('reads both rest forms: key presence is the tick unless the mapping spells otherwise', () => {
		expect(matrixHeld(undefined)).toBe(false);
		expect(matrixHeld(true)).toBe(true);
		expect(matrixHeld({})).toBe(true);
		expect(matrixHeld({ detail: 'x' })).toBe(true);
		expect(matrixHeld({ held: true, detail: 'x' })).toBe(true);
		expect(matrixHeld({ held: false, detail: 'x' })).toBe(false);
		expect(matrixHeld(false)).toBe(false);
		// The columns are what is left when the tick comes off, at either spelling.
		expect(matrixColumns(true)).toEqual({});
		expect(matrixColumns({ held: false, detail: 'x' })).toEqual({ detail: 'x' });
	});

	it('reads the tick at the render floor\u2019s coercion, at either spelling', () => {
		// The floor coerces: a number against zero, and the two strings a boolean spells.
		// A value it refuses (`validation::type_mismatch`) renders at the blank, which for
		// the synthesized cell is unheld. Identity against `false` drew every one of these
		// ticked, and a column edit then wrote `held: true` over the document's own answer.
		for (const unheld of [
			0,
			'false',
			'',
			'no',
			null,
			{ held: 0 },
			{ held: 'false' },
			{ held: '' },
			{ held: null }
		])
			expect(matrixHeld(unheld)).toBe(false);
		for (const held of [1, 'true', { held: 1 }, { held: 'true' }, { year: 9 }])
			expect(matrixHeld(held)).toBe(true);
		// And a prototype name is not a spelling of the tick.
		expect(matrixHeld({ detail: 'x' })).toBe(true);
		// An array is a shape the engine refuses for a member: unheld, and no columns to
		// launder its indices into.
		expect(matrixHeld([1, 2])).toBe(false);
		expect(matrixColumns([1, 2])).toEqual({});
	});

	it('reads a member by its own key, which `constructor` is a legal spelling of', () => {
		// A member id is a snake_case identifier and `constructor` is one, so a plain read
		// answers with `Object.prototype`'s for a document that never mentioned it.
		expect(matrixMemberAt({}, 'constructor')).toBeUndefined();
		expect(matrixMemberAt(undefined, 'flight_cc')).toBeUndefined();
		expect(matrixMemberAt({ flight_cc: true }, 'flight_cc')).toBe(true);
		const roster = f({
			type: 'matrix',
			members: [{ values: { constructor: 'Constructor', flight_cc: 'Flight CC' } }]
		});
		expect(matrixHeldCount(roster, {})).toBe(0);
		expect(matrixHeldCount(roster, { constructor: true })).toBe(1);
	});

	it('writes the object form, and drops an unheld member holding nothing', () => {
		expect(matrixMember(true, {})).toEqual({ held: true });
		expect(matrixMember(true, { detail: 'x' })).toEqual({ held: true, detail: 'x' });
		// An untick keeps the columns, so tick, type, untick, retick loses nothing.
		expect(matrixMember(false, { detail: 'x' })).toEqual({ held: false, detail: 'x' });
		expect(matrixMember(false, {})).toBeUndefined();
		// The tick never rides in as a column.
		expect(matrixMember(true, { held: false, detail: 'x' })).toEqual({ held: true, detail: 'x' });
	});

	it('commits a sparse map, and unsets the field once it holds nothing', () => {
		expect(matrixCommit(undefined, 'flight_cc', { held: true })).toEqual({
			flight_cc: { held: true }
		});
		expect(matrixCommit({ flight_cc: { held: true } }, 'flight_cc', undefined)).toBeUndefined();
		expect(
			matrixCommit({ flight_cc: { held: true }, cyber_200: true }, 'flight_cc', undefined)
		).toEqual({ cyber_200: true });
	});

	it('counts what the document holds, across both spellings and every group', () => {
		expect(matrixHeldCount(roster, undefined)).toBe(0);
		expect(
			matrixHeldCount(roster, { flight_cc: true, dodin_ops: { held: false }, cyber_200: { x: 1 } })
		).toBe(2);
	});

	it('obliges nothing of its own, the namespace rule a typed dictionary already holds', () => {
		expect(obliged(f({ type: 'matrix', members: [] }))).toBe(false);
		expect(obliged(f({ type: 'object' }))).toBe(false);
		expect(obliged(f({ type: 'string' }))).toBe(true);
		expect(controlKind(f({ type: 'matrix' }))).toBe('matrix');
	});
});
