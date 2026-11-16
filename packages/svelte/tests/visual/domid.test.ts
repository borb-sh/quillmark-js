// domid.ts: the leaf key's crossing into `id` syntax. Pure string math, so it
// pins here what the browser tier cannot cheaply enumerate: that no two distinct
// fields can ever land on one DOM id, which is the failure mode `for` resolves
// silently and wrongly rather than reporting.
import { describe, it, expect } from 'vitest';
import { fieldDomIds, groupPanelId } from '$lib/visual/domid';
import { fieldKeyToString } from '$lib/visual/diagnostics';
import { groupOrder } from '$lib/visual/structure';
import { quill } from '../helpers/fixtures.js';

describe('fieldDomIds', () => {
	it('spends only `id`-safe characters, whatever the key held', () => {
		const { control, label, description } = fieldDomIds(
			'u1',
			fieldKeyToString({ field: 'subject' })
		);
		for (const id of [control, label, description]) {
			// No whitespace (which `id` forbids outright), and nothing a bare CSS
			// selector or `querySelector` would need escaped.
			expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
		}
	});

	it('gives the label and the description their own names, distinct from the control', () => {
		const ids = fieldDomIds('u1', 'main:subject');
		expect(new Set([ids.control, ids.label, ids.description]).size).toBe(3);
	});

	it('is INJECTIVE — a key that differs by one character keeps its own id', () => {
		// The hand-written pairs a plain replace-with-dash would collapse (the key's own
		// separator against a literal dash, the body sentinel against a field of that
		// name), plus the shapes the real key space actually mints.
		const keys = [
			'main:subject',
			'main-subject',
			'main:$body',
			'main:_body',
			'a:b-c',
			'a-b:c',
			'card1:x',
			'card1:x-',
			'card:1:x',
			fieldKeyToString({ field: 'memo_for' }),
			fieldKeyToString({ card: 'c1', field: 'subject' }),
			fieldKeyToString({ card: 'c1' }),
			fieldKeyToString({ card: 2, field: 'subject' })
		];
		const ids = keys.map((k) => fieldDomIds('u1', k).control);
		expect(new Set(ids).size).toBe(keys.length);
	});

	it('separates two editors holding the same field', () => {
		// The leaf-key space is unique per editor, not per document: two mounted side by
		// side both hold `main:subject`, and a duplicate id makes `for` resolve to the
		// first.
		expect(fieldDomIds('u1', 'main:subject').control).not.toBe(
			fieldDomIds('u2', 'main:subject').control
		);
	});
});

describe('groupPanelId', () => {
	// A group panel's id is what its header's `aria-controls` names, so the same
	// collision that breaks `for` breaks the accordion's announced state; pointing
	// a header at a field is worse than pointing it nowhere.
	it('gives each card its own panel per group, and each editor its own card', () => {
		const ids = [
			groupPanelId('u1', undefined, 'letterhead'),
			groupPanelId('u1', undefined, 'addressing'),
			groupPanelId('u1', 'c1', 'letterhead'),
			groupPanelId('u2', undefined, 'letterhead')
		];
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('cannot land on a field id — the reference quill, every group against every field', () => {
		const schema = quill().schema.main;
		const fields = Object.keys(schema.fields);
		const cards: (string | undefined)[] = [undefined, 'c1', 'c2'];
		const panels = cards.flatMap((c) => groupOrder(schema).map((g) => groupPanelId('u1', c, g)));
		const controls = cards.flatMap((card) =>
			[...fields, undefined].map((field) => fieldDomIds('u1', fieldKeyToString({ card, field })))
		);
		const taken = new Set(controls.flatMap((ids) => [ids.control, ids.label, ids.description]));
		expect(panels.length).toBeGreaterThan(0); // the fixture declares groups to test against
		for (const id of panels) expect(taken.has(id)).toBe(false);
	});
});
