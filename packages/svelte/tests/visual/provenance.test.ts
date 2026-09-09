// The provenance channel (FIELD_PROVENANCE): `quill.reader(doc).resolve()` mapped to the
// editor's name-keyed `provenance` map and the ghosted `default:` it feeds. The
// pure helpers are unit-tested; the resolve behavior is asserted against the real
// showcase schema, so the authored↔default flip the ghost turns on is pinned to
// the fixture the suite runs against, not a mock.
import { describe, it, expect } from 'vitest';
import type { ResolvedField, Resolved } from '@quillmark/wasm';
import {
	provenanceMap,
	resolvedByCardIndex,
	ghostDefault,
	stringifyGhost
} from '$lib/visual/structure';
import { quill } from '../helpers/fixtures.js';

const row = (name: string, value: unknown, source: ResolvedField['source']): ResolvedField => ({
	name,
	value,
	source
});

describe('resolvedByCardIndex', () => {
	// Array position 1 carries document index 2; the map keys on `index`, and one
	// entry carries both channels (fields and the `body` sibling).
	const resolved = {
		main: { fields: [], body: null },
		cards: [
			{
				kind: 'k',
				index: 0,
				fields: [row('x', 1, 'authored')],
				body: row('body', 'B0', 'default')
			},
			{ kind: 'k', index: 2, fields: [row('y', 2, 'default')], body: null }
		]
	} as unknown as Resolved;

	it('keys cards by document index, not array position', () => {
		const byCard = resolvedByCardIndex(resolved);
		expect(byCard.get(0)?.fields[0]?.name).toBe('x');
		expect(byCard.get(2)?.fields[0]?.name).toBe('y');
	});
	it('carries each card’s body row alongside its fields', () => {
		const byCard = resolvedByCardIndex(resolved);
		expect(byCard.get(0)?.body?.value).toBe('B0');
		expect(byCard.get(2)?.body).toBeNull();
	});
	it('is empty for a missing index or an absent resolve', () => {
		expect(resolvedByCardIndex(resolved).get(5)).toBeUndefined();
		expect(resolvedByCardIndex(undefined).size).toBe(0);
	});
});

// The two halves of the ghost projection every control and the body leaf share:
// `ghostDefault` decides whether a row ghosts, `stringifyGhost` whether it has a
// text form to show.
describe('the ghost projection', () => {
	it('ghosts only a default-sourced value', () => {
		expect(ghostDefault(row('a', 'D', 'default'))).toBe('D');
		expect(ghostDefault(row('a', 'A', 'authored'))).toBeUndefined();
		expect(ghostDefault(row('a', '', 'blank'))).toBeUndefined();
		expect(ghostDefault(undefined)).toBeUndefined();
	});
	it('renders a scalar ghost as text and declines an object one', () => {
		expect(stringifyGhost('Write it here')).toBe('Write it here');
		expect(stringifyGhost(12)).toBe('12');
		expect(stringifyGhost(undefined)).toBeUndefined();
		// Only text ghosts render a placeholder: a richtext body resolves to a text
		// render, so an object-shaped default is not one.
		expect(stringifyGhost({ lines: [] })).toBeUndefined();
	});
});

describe('resolve over the real showcase schema', () => {
	it('reports unset declared defaults as `default`-sourced with the schema value', () => {
		const doc = quill().seedDocument();
		const main = provenanceMap(quill().reader(doc).resolve().main.fields);
		expect(main.tracking_id).toMatchObject({ source: 'default', value: 'SPEC-0001' });
		expect(main.font_size).toMatchObject({ source: 'default', value: 10.5 });
		expect(main.accent).toMatchObject({ source: 'default', value: 'slate' });
		// The ghost the control shows for each unset field is that resolved default.
		expect(ghostDefault(main.tracking_id)).toBe('SPEC-0001');
	});

	it('flips a field to `authored` (no ghost) once a value is stored, back on clear', () => {
		const doc = quill().seedDocument();
		doc.storeField('tracking_id', 'ACME-9');
		const authored = provenanceMap(quill().reader(doc).resolve().main.fields);
		expect(authored.tracking_id).toMatchObject({ source: 'authored', value: 'ACME-9' });
		// An authored field ghosts nothing; the control shows its own value.
		expect(ghostDefault(authored.tracking_id)).toBeUndefined();

		doc.removeField('tracking_id');
		const cleared = provenanceMap(quill().reader(doc).resolve().main.fields);
		expect(cleared.tracking_id.source).toBe('default');
		expect(ghostDefault(cleared.tracking_id)).toBe('SPEC-0001');
	});

	it('resolves a variant as a container, so the ghosted member is one cell of it', () => {
		const doc = quill().seedDocument();
		const main = provenanceMap(quill().reader(doc).resolve().main.fields);
		// The rung is the field's, and its value is the whole container: the discriminant
		// the control ghosts is `value` inside it, never the row itself.
		expect(main.distribution).toMatchObject({ source: 'default', value: { value: 'internal' } });
		expect(main.handling).toMatchObject({ source: 'default', value: { value: '' } });
		expect(stringifyGhost(ghostDefault(main.distribution))).toBeUndefined();
		expect(
			(ghostDefault(main.handling) as Record<string, unknown>).value,
			'the blank ghosts as itself, and names no world'
		).toBe('');
	});

	it('leaves a variant cell to its own world: no seed reaches its `example:`', () => {
		// `handling.CONTROLLED.controlled_by` declares an `example:` and the seed writes
		// none — the cascade reaches a card's fields, and a cell is not one. So a fresh
		// document has no handling container at all, which is what the blank `default:`
		// then resolves for.
		const doc = quill().seedDocument();
		expect(doc.toMarkdown()).not.toContain('handling');
		expect(doc.getStored('handling')).toBeUndefined();
	});

	it('reports an array `default:` as one, and ghosts none of it', () => {
		const doc = quill().seedDocument();
		// Seeded from `example:`, which is the authored answer, not the default beneath it.
		expect(provenanceMap(quill().reader(doc).resolve().main.fields).authors).toMatchObject({
			source: 'authored',
			value: ['Ada Lovelace', 'Grace Hopper']
		});
		doc.removeField('authors');
		const cleared = provenanceMap(quill().reader(doc).resolve().main.fields);
		expect(cleared.authors).toMatchObject({ source: 'default', value: ['Anonymous'] });
		// A list is not text: the repeater draws its rows and has no placeholder to ghost
		// into, the same way an object-shaped rung has none.
		expect(stringifyGhost(ghostDefault(cleared.authors))).toBeUndefined();
	});

	it('reports a container’s strongest contributing rung, its cells having their own', () => {
		const doc = quill().seedDocument();
		// `contact` declares no literal — a namespace holds none — and one property
		// declares a `default:`, which is the whole of what lifts the container off
		// `blank`. The value is composed per cell, so the defaultless three blank-fill
		// beside it.
		const unset = provenanceMap(quill().reader(doc).resolve().main.fields);
		expect(unset.contact).toMatchObject({
			source: 'default',
			value: { name: '', email: '', reply_by: '', listed: false }
		});
		// An object-shaped rung ghosts nothing however it resolves; only text does.
		expect(stringifyGhost(ghostDefault(unset.contact))).toBeUndefined();

		doc.storeField('contact', { email: 'ada@example.org' });
		const authored = provenanceMap(quill().reader(doc).resolve().main.fields);
		expect(authored.contact).toMatchObject({
			source: 'authored',
			value: { name: '', email: 'ada@example.org', reply_by: '', listed: false }
		});
	});
});
