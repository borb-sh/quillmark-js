// diagnostics.ts routing/merge; pure logic, no Document. VisualEditor's
// `$derived.by` glue is the thin part; the math it feeds on is here. The path→key
// walk itself is `/core`'s `nearestAddrForFieldPath` and is tested there.
import { describe, it, expect } from 'vitest';
import type { Diagnostic } from '@quillmark/wasm';
import {
	resolveCardKey,
	deepen,
	splitDeep,
	unrouted,
	routeAndResolve,
	mergeDiagnostics,
	type FieldKey
} from '$lib/visual/diagnostics';

const err = (message: string, path?: string): Diagnostic => ({ severity: 'error', message, path });
const warn = (message: string, path?: string): Diagnostic => ({
	severity: 'warning',
	message,
	path
});

describe('resolveCardKey', () => {
	const cardIds = ['c0', 'c1', 'c2'];
	it('resolves an absolute document index to the live stable id', () => {
		expect(resolveCardKey({ card: 1, field: 'from' }, cardIds)).toEqual({
			card: 'c1',
			field: 'from'
		});
	});
	it('drops a positional key whose index is out of the current card array', () => {
		expect(resolveCardKey({ card: 5, field: 'from' }, cardIds)).toBeUndefined();
	});
	it('passes an already id-keyed or main key through unchanged', () => {
		expect(resolveCardKey({ card: 'c1', field: 'from' }, cardIds)).toEqual({
			card: 'c1',
			field: 'from'
		});
		expect(resolveCardKey({ field: 'subject' }, cardIds)).toEqual({ field: 'subject' });
	});
});

describe('routeAndResolve', () => {
	const cardIds = ['c0', 'c1'];

	it('routes a mix of main and card paths to the live stable-id keying', () => {
		const out = routeAndResolve(
			[err('e0', 'main.subject'), err('e1', 'cards.indorsement[1].from')],
			cardIds
		);
		expect(out).toEqual([
			{ key: { field: 'subject' }, diagnostic: err('e0', 'main.subject') },
			{ key: { card: 'c1', field: 'from' }, diagnostic: err('e1', 'cards.indorsement[1].from') }
		]);
	});

	it('drops warnings rather than routing them', () => {
		expect(routeAndResolve([warn('w1', 'main.subject')], cardIds)).toEqual([]);
	});

	it('lands an error deeper than a commit address on the field that holds it', () => {
		const out = routeAndResolve(
			[
				err('bad email', 'main.contact.email'),
				err('bad keyword', 'main.keywords[0]'),
				err('bad card prop', 'cards.indorsement[1].contact.email')
			],
			cardIds
		);
		expect(out.map((r) => r.key)).toEqual([
			{ field: 'contact' },
			{ field: 'keywords' },
			{ card: 'c1', field: 'contact' }
		]);
	});

	it('drops a nested WARNING, which the severity gate takes before any truncation', () => {
		expect(routeAndResolve([warn('unfilled', 'main.contact.email')], cardIds)).toEqual([]);
	});

	it('drops rather than mis-routes: no path, an unplaceable path, an out-of-range card', () => {
		expect(
			routeAndResolve(
				[
					{ severity: 'error', message: 'no path' },
					// Field-rooted: no prefix names an address, so there is nothing to
					// truncate to. A malformed path parses to nothing at all.
					err('unplaceable', 'recipients[0].name'),
					err('malformed', 'cards.indorsement[x].from'),
					err('gone', 'cards.indorsement[9].from'),
					// Truncation keeps the stale index for `resolveCardKey` to drop.
					err('gone nested', 'cards.indorsement[9].contact.email')
				],
				cardIds
			)
		).toEqual([]);
	});

	it('handles an undefined/empty list', () => {
		expect(routeAndResolve(undefined, cardIds)).toEqual([]);
		expect(routeAndResolve([], cardIds)).toEqual([]);
	});
});

describe('mergeDiagnostics', () => {
	it('merges multiple groups by field key', () => {
		const a = [{ key: { field: 'subject' } as FieldKey, diagnostic: err('e1') }];
		const b = [{ key: { field: 'subject' } as FieldKey, diagnostic: err('e2') }];
		const m = mergeDiagnostics(a, b);
		expect(m.get('main:subject')?.map((d) => d.message)).toEqual(['e1', 'e2']);
	});
	it('dedupes an identical (key, severity, message) triple across groups', () => {
		const a = [{ key: { field: 'x' } as FieldKey, diagnostic: err('same') }];
		const b = [{ key: { field: 'x' } as FieldKey, diagnostic: err('same') }];
		const m = mergeDiagnostics(a, b);
		expect(m.get('main:x')?.map((d) => d.message)).toEqual(['same']);
	});
	it('keeps the same message at DIFFERENT keys distinct (dedupe is per-key)', () => {
		const a = [{ key: { field: 'x' } as FieldKey, diagnostic: err('same') }];
		const b = [{ key: { field: 'y' } as FieldKey, diagnostic: err('same') }];
		const m = mergeDiagnostics(a, b);
		expect(m.get('main:x')?.length).toBe(1);
		expect(m.get('main:y')?.length).toBe(1);
	});
	it('keeps one message failing two cells of one container, the key being the field', () => {
		// Both rows key `main:appendices`; only the path tells them apart, and the walk
		// past the field is the path's. Deduping without it draws on the first row alone.
		const m = mergeDiagnostics([
			{
				key: { field: 'appendices' } as FieldKey,
				diagnostic: err('expected integer', 'main.appendices[0].entries[0].page')
			},
			{
				key: { field: 'appendices' } as FieldKey,
				diagnostic: err('expected integer', 'main.appendices[1].entries[0].page')
			}
		]);
		expect(m.get('main:appendices')?.map((d) => d.path)).toEqual([
			'main.appendices[0].entries[0].page',
			'main.appendices[1].entries[0].page'
		]);
	});
	it('still dedupes one path reported by two producers', () => {
		const one = { key: { field: 'appendices' } as FieldKey, diagnostic: err('e', 'main.a[0].b') };
		expect(mergeDiagnostics([one], [{ ...one }]).get('main:appendices')).toHaveLength(1);
	});
});

describe('the walk inside a field', () => {
	it('deepens a routed diagnostic into the steps past its field', () => {
		expect(deepen([err('e', 'main.appendices[0].entries[1].page')])).toEqual([
			{
				steps: [0, 'entries', 1, 'page'],
				diagnostic: err('e', 'main.appendices[0].entries[1].page')
			}
		]);
		// A field's own path, and a local commit error carrying one, have no steps.
		expect(deepen([err('e', 'main.subject')])[0].steps).toEqual([]);
		expect(deepen([err('e')])[0].steps).toEqual([]);
		expect(deepen(undefined)).toEqual([]);
	});

	it('splits one rung: what anchors here, and what steps on, bucketed by its next step', () => {
		const split = splitDeep([
			{ steps: [], diagnostic: err('here') },
			{ steps: [0, 'page'], diagnostic: err('row0') },
			{ steps: [0, 'note'], diagnostic: err('row0b') },
			{ steps: [2], diagnostic: err('row2') }
		]);
		expect(split.here).toEqual([err('here')]);
		expect([...split.below.keys()]).toEqual([0, 2]);
		expect(split.below.get(0)).toEqual([
			{ steps: ['page'], diagnostic: err('row0') },
			{ steps: ['note'], diagnostic: err('row0b') }
		]);
		expect(split.below.get(2)).toEqual([{ steps: [], diagnostic: err('row2') }]);
	});

	it('hands back what a rung cannot route on, so nothing is lost on the way down', () => {
		const split = splitDeep([
			{ steps: [], diagnostic: err('here') },
			{ steps: [0, 'x'], diagnostic: err('held') },
			{ steps: [9, 'x'], diagnostic: err('gone') }
		]);
		expect(unrouted(split, (step) => step === 0)).toEqual([err('here'), err('gone')]);
	});
});
