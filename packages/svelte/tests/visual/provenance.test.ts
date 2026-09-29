// The provenance channel (FIELD_PROVENANCE): `quill.reader(doc).resolve()` mapped to the
// editor's name-keyed `provenance` map and the ghosted `default:` it feeds. The pure
// helpers are unit-tested; the resolve behavior is asserted against the real showcase
// schema, its values read off the schema rather than restated.
import { describe, it, expect } from 'vitest';
import type { Document, ResolvedField, Resolved } from '@quillmark/wasm';
import {
	provenanceMap,
	resolvedByCardIndex,
	ghostDefault,
	stringifyGhost
} from '$lib/visual/structure';
import { quill, example } from '../helpers/fixtures.js';

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
	const declared = (name: string) => quill().schema.main.fields[name].default;
	const resolved = (doc: Document) => provenanceMap(quill().reader(doc).resolve().main.fields);

	it('reports unset declared defaults as `default`-sourced with the schema value', () => {
		const main = resolved(quill().seedDocument());
		for (const name of ['tracking_id', 'font_size', 'accent'])
			expect(main[name]).toMatchObject({ source: 'default', value: declared(name) });
		// The ghost the control shows for each unset field is that resolved default.
		expect(ghostDefault(main.tracking_id)).toBe(declared('tracking_id'));
	});

	it('flips a field to `authored` (no ghost) once a value is stored, back on clear', () => {
		const doc = quill().seedDocument();
		doc.storeField('tracking_id', 'ACME-9');
		const authored = resolved(doc);
		expect(authored.tracking_id).toMatchObject({ source: 'authored', value: 'ACME-9' });
		// An authored field ghosts nothing; the control shows its own value.
		expect(ghostDefault(authored.tracking_id)).toBeUndefined();

		doc.removeField('tracking_id');
		const cleared = resolved(doc);
		expect(cleared.tracking_id.source).toBe('default');
		expect(ghostDefault(cleared.tracking_id)).toBe(declared('tracking_id'));
	});

	it('resolves a variant as a container, so the ghosted member is one cell of it', () => {
		const main = resolved(quill().seedDocument());
		// The rung is the field's, and its value is the whole container: the discriminant
		// the control ghosts is `value` inside it, never the row itself.
		expect(main.distribution).toMatchObject({
			source: 'default',
			value: { value: declared('distribution') }
		});
		expect(main.handling).toMatchObject({ source: 'default', value: { value: '' } });
		expect(stringifyGhost(ghostDefault(main.distribution))).toBeUndefined();
		expect(
			(ghostDefault(main.handling) as Record<string, unknown>).value,
			'the blank ghosts as itself, and names no world'
		).toBe('');
	});

	it('reports an array `default:` as one, and ghosts none of it', () => {
		const doc = example();
		// The example's answer is authored, not the default beneath it.
		expect(resolved(doc).authors).toMatchObject({
			source: 'authored',
			value: doc.getStored('authors')
		});
		doc.removeField('authors');
		const cleared = resolved(doc);
		expect(cleared.authors).toMatchObject({ source: 'default', value: declared('authors') });
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
		const unset = resolved(doc);
		expect(unset.contact).toMatchObject({
			source: 'default',
			value: { name: '', email: '', reply_by: '', listed: false }
		});
		// An object-shaped rung ghosts nothing however it resolves; only text does.
		expect(stringifyGhost(ghostDefault(unset.contact))).toBeUndefined();

		doc.storeField('contact', { email: 'ada@example.org' });
		const authored = resolved(doc);
		expect(authored.contact).toMatchObject({
			source: 'authored',
			value: { name: '', email: 'ada@example.org', reply_by: '', listed: false }
		});
	});
});
