// @vitest-environment jsdom
// Where the arrival wash lands, which is the address's own granularity: a landing
// naming one element washes that row, and one naming the field washes the field's
// box. The wash answers "here" for a click made somewhere else, so a box wider than
// what the click resolved names the wrong thing — the field where the pick said the
// row.
//
// Asserted as the wash node's host and never as its paint: `bloomInside` appends one
// inset child per host, and which host holds it is the whole of what the granularity
// decides.
import { describe, it, expect, afterEach } from 'vitest';
import { tick } from 'svelte';
import { quill, template } from '../helpers/fixtures.js';
import { mountEditor, unmountAll, washHost } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

describe('the arrival wash', () => {
	it('washes the row an element landing named, not the list around it', async () => {
		const q = quill();
		const { target, editor } = mountEditor(q, template());

		await editor.setCaret({ field: 'main.keywords[1]', pos: 4, granularity: 'cluster' });
		await tick();

		const host = washHost(target);
		expect(host?.className).toContain('qm-array-row');
		// The row the caret is in, so the wash and the landing cannot name two rows.
		expect(document.activeElement?.closest('.qm-array-row')).toBe(host);
	});

	it('washes the whole list where the address named the field', async () => {
		const q = quill();
		const { target, editor } = mountEditor(q, template());

		await editor.focusField('main.keywords');
		await tick();

		expect(washHost(target)?.className).toContain('qm-array-rows');
	});

	it('washes the list again where the row is one this document no longer has', async () => {
		const q = quill();
		const { target, editor } = mountEditor(q, template());

		// A landing off a compile the document has moved past: the field is right and
		// the row is gone, so the landing falls back to the field and the wash with it.
		await editor.setCaret({ field: 'main.keywords[9]', pos: 0 });
		await tick();

		expect(washHost(target)?.className).toContain('qm-array-rows');
	});
});
