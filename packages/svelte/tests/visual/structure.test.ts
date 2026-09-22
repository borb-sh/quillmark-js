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
	rowSummary,
	shortCell,
	arrayLayout,
	schemaAt,
	matrixMembers,
	matrixHeld,
	matrixColumns,
	memberValue,
	memberWrite,
	commitMember,
	MATRIX_HELD
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
		// Its own control, never the trailing arm's text input over a namespace.
		expect(controlKind(f({ type: 'matrix', members: {} }))).toBe('matrix');
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
	it('reads a variant container by its discriminant member', () => {
		// A `{field}` title over a variant-bearing enum names the world, which is the one
		// cell of the container that does.
		expect(titleText({ value: 'float', side: 'end' })).toBe('float');
		expect(interpolateTitle('{placement}', { placement: { value: 'float' } })).toBe('float');
		expect(titleText({ side: 'end' })).toBe('');
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
		).toEqual(['lift_on', 'held_by', 'notices']);
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

describe('rowSummary', () => {
	const row = (properties: Record<string, QuillFieldSchema>, ui?: { title?: string }) =>
		({ type: 'object', properties, ui }) as QuillFieldSchema;
	const content = (text: string) => ({ text, lines: [], marks: [], islands: [] });

	it('interpolates items.ui.title with the row, and falls through where it comes out blank', () => {
		const items = row(
			{ title: f({ type: 'string' }), note: f({ type: 'string' }) },
			{ title: '{title}' }
		);
		expect(rowSummary(items, { title: 'Sources', note: 'n' })).toBe('Sources');
		// The template names an empty cell: the cell rule takes over rather than the row
		// reading as untitled beside a note it has.
		expect(rowSummary(items, { note: 'n' })).toBe('n');
		expect(rowSummary(items, {})).toBeUndefined();
	});

	it('falls back to the first short text cell: a string, or inline prose', () => {
		const items = row({
			page: f({ type: 'integer' }),
			label: f({ type: 'plaintext', inline: true }),
			note: f({ type: 'richtext', inline: true })
		});
		// No `string` cell: the inline `plaintext` is the first title-bearing one, read
		// through `titleText` whichever rest form it has.
		expect(rowSummary(items, { page: 3, label: 'Primary' })).toBe('Primary');
		expect(rowSummary(items, { page: 3, label: content('Primary') })).toBe('Primary');
		expect(rowSummary(items, { page: 3, note: content('only a note') })).toBe('only a note');
		expect(rowSummary(items, { page: 3 })).toBeUndefined();
	});

	it('skips a block prose cell and every non-text cell', () => {
		const items = row({
			body: f({ type: 'richtext' }),
			n: f({ type: 'number' }),
			on: f({ type: 'boolean' })
		});
		expect(rowSummary(items, { body: content('para'), n: 1, on: true })).toBeUndefined();
		expect(rowSummary(undefined, { x: 'y' })).toBeUndefined();
	});
});

describe('arrayLayout', () => {
	const short = {
		name: f({ type: 'string' }),
		role: f({ type: 'enum', values: ['a'] }),
		since: f({ type: 'date' }),
		lead: f({ type: 'boolean' }),
		n: f({ type: 'integer' }),
		tag: f({ type: 'plaintext' }),
		line: f({ type: 'richtext', inline: true })
	};
	const arr = (properties: Record<string, QuillFieldSchema>, layout?: 'table') =>
		({
			type: 'array',
			items: { type: 'object', properties },
			ui: layout ? { layout } : undefined
		}) as QuillFieldSchema;

	it('answers table only where the array asks and every cell is short', () => {
		expect(arrayLayout(arr(short, 'table'))).toBe('table');
		expect(arrayLayout(arr(short))).toBe('list');
		for (const [k, sub] of Object.entries(short)) expect(shortCell(sub), k).toBe(true);
	});

	it('declines for a block prose cell or a container, at every width', () => {
		expect(arrayLayout(arr({ ...short, body: f({ type: 'richtext' }) }, 'table'))).toBe('list');
		expect(
			arrayLayout(
				arr({ ...short, rows: f({ type: 'array', items: f({ type: 'string' }) }) }, 'table')
			)
		).toBe('list');
		expect(
			arrayLayout(arr({ ...short, sub: f({ type: 'object', properties: {} }) }, 'table'))
		).toBe('list');
		expect(arrayLayout(arr({}, 'table'))).toBe('list');
		expect(
			arrayLayout({
				type: 'array',
				items: f({ type: 'string' }),
				ui: { layout: 'table' }
			} as QuillFieldSchema)
		).toBe('list');
	});

	it('reads the key off the array, never off items.ui', () => {
		const wrong = {
			type: 'array',
			items: { type: 'object', properties: short, ui: { layout: 'table' } }
		} as QuillFieldSchema;
		expect(arrayLayout(wrong)).toBe('list');
	});
});

describe('schemaAt', () => {
	const matrix = f({
		type: 'matrix',
		members: { a: 'A', b: 'B' },
		properties: { note: f({ type: 'plaintext', inline: true }) }
	});
	const vectors = f({
		type: 'array',
		items: {
			type: 'object',
			properties: {
				tours: f({
					type: 'array',
					items: { type: 'object', properties: { title: f({ type: 'plaintext' }) } }
				})
			}
		}
	});
	const variant = f({
		type: 'enum',
		values: ['x', 'y'],
		variants: { y: { note: f({ type: 'string' }) } }
	});

	it('walks an index under an array, a key under an object, rung by rung', () => {
		expect(schemaAt(vectors, [0, 'tours', 2, 'title'])?.type).toBe('plaintext');
		expect(schemaAt(vectors, [0, 'tours'])?.type).toBe('array');
		expect(schemaAt(vectors, [])).toBe(vectors);
		expect(schemaAt(vectors, ['tours'])).toBeUndefined();
		expect(schemaAt(vectors, [0, 'nothing'])).toBeUndefined();
		expect(schemaAt(vectors, [0, 'tours', 'x'])).toBeUndefined();
		expect(schemaAt(f({ type: 'string' }), [0])).toBeUndefined();
	});

	it('takes an index into an array declaring no items, the text element it draws', () => {
		// `controlKind` calls a missing `items` a text element, so an index into one is a
		// place the tree mounts and the landing guard must not refuse.
		const bare = f({ type: 'array' });
		expect(schemaAt(bare, [0])?.type).toBe('string');
		expect(schemaAt(bare, ['x'])).toBeUndefined();
		expect(schemaAt(bare, [0, 'deeper'])).toBeUndefined();
	});

	it('walks a matrix member into its held cell and its columns', () => {
		expect(schemaAt(matrix, ['a'])?.type).toBe('object');
		expect(schemaAt(matrix, ['a', MATRIX_HELD])?.type).toBe('boolean');
		expect(schemaAt(matrix, ['b', 'note'])?.type).toBe('plaintext');
		expect(schemaAt(matrix, ['c'])).toBeUndefined();
		expect(schemaAt(matrix, ['a', 'nope'])).toBeUndefined();
		// A prototype key is not on the roster.
		expect(schemaAt(matrix, ['toString'])).toBeUndefined();
	});

	it('walks a variant into the discriminant and the union of its worlds', () => {
		expect(schemaAt(variant, ['value'])?.type).toBe('enum');
		expect(schemaAt(variant, ['note'])?.type).toBe('string');
		expect(schemaAt(variant, ['other'])).toBeUndefined();
	});
});

describe('the matrix helpers', () => {
	it('reads the roster by own keys, in declaration order', () => {
		expect(matrixMembers({ b: 'B', a: 'A' })).toEqual([
			{ id: 'b', title: 'B' },
			{ id: 'a', title: 'A' }
		]);
		expect(matrixMembers(undefined)).toEqual([]);
	});

	it('reads held off both rest forms, a mapping unheld unless it names `held`', () => {
		expect(matrixHeld(undefined)).toBe(false);
		expect(matrixHeld(true)).toBe(true);
		expect(matrixHeld({ note: 'x' })).toBe(false);
		expect(matrixHeld({ held: false, note: 'x' })).toBe(false);
		expect(matrixHeld({ held: true })).toBe(true);
		// The spellings the engine coerces to false, and a mapping naming no tick.
		for (const v of [false, 0, 'false', null, {}, { held: 0 }, { held: 'false' }, { held: null }])
			expect(matrixHeld(v), JSON.stringify(v)).toBe(false);
		// Every other present tick reads held, `1` and `"true"` among them.
		for (const v of [1, 'true', { held: 1 }, { held: {} }])
			expect(matrixHeld(v), JSON.stringify(v)).toBe(true);
	});

	it('reads a member off the map by own key', () => {
		expect(memberValue({ a: true }, 'a')).toBe(true);
		expect(memberValue({ a: true }, 'b')).toBeUndefined();
		expect(memberValue({}, 'constructor')).toBeUndefined();
		expect(memberValue(undefined, 'a')).toBeUndefined();
	});

	it('takes the columns off a member, held aside', () => {
		expect(matrixColumns({ held: true, note: 'x' })).toEqual({ note: 'x' });
		expect(matrixColumns(true)).toEqual({});
		expect(matrixColumns(undefined)).toEqual({});
		expect(matrixColumns(['x'])).toEqual({});
	});

	it('writes a member with an explicit held, and drops an unheld one with no columns', () => {
		expect(memberWrite(true, {})).toEqual({ held: true });
		expect(memberWrite(true, { note: 'x' })).toEqual({ held: true, note: 'x' });
		expect(memberWrite(false, { note: 'x' })).toEqual({ held: false, note: 'x' });
		expect(memberWrite(false, {})).toBeUndefined();
	});

	it('commits one member into the map and leaves the rest as spelled', () => {
		expect(commitMember({ a: true }, 'b', { held: true })).toEqual({ a: true, b: { held: true } });
		expect(commitMember({ a: true, b: { held: true } }, 'b', undefined)).toEqual({ a: true });
		expect(commitMember({ a: true }, 'a', undefined)).toBeUndefined();
		expect(commitMember(undefined, 'a', { held: true })).toEqual({ a: { held: true } });
	});
});
