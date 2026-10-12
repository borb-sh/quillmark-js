// @vitest-environment jsdom
// Where the arrival wash lands, which is the address's own granularity: a landing
// naming one element washes that row, and one naming the field washes the field's
// box. The wash answers "here" for a click made somewhere else, so a box wider than
// what the click resolved names the wrong thing — the field where the pick said the
// row.
//
// Asserted as the host the wash played on and never as its paint: every host draws
// the wash at mount, and which one a landing plays is the whole of what the
// granularity decides.
import { describe, it, expect, afterEach } from 'vitest';
import { tick } from 'svelte';
import { quill, example } from '../helpers/fixtures.js';
import { mountEditor, unmountAll, washHost } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

describe('the arrival wash', () => {
	it('washes the row an element landing named, not the list around it', async () => {
		const q = quill();
		const { target, editor } = mountEditor(q, example());

		await editor.setCaret({ field: 'main.keywords[1]', pos: 4, granularity: 'cluster' });
		await tick();

		const host = washHost(target);
		expect(host?.className).toContain('qm-array-row');
		// The row the caret is in, so the wash and the landing cannot name two rows.
		expect(document.activeElement?.closest('.qm-array-row')).toBe(host);
	});

	it('washes a table row with the plane it drew at mount, adding nothing to the tree', async () => {
		const q = quill();
		const { target, editor } = mountEditor(q, example());

		// The row is a subgrid, and a box added to a laid-out one resizes its tracks in
		// WebKit: the wash is the row's own `::after`, so a landing only plays it.
		const added: Node[] = [];
		const watch = new MutationObserver((records) => {
			for (const r of records) added.push(...r.addedNodes);
		});
		watch.observe(target, { childList: true, subtree: true });
		await editor.setCaret({ field: 'main.contributors[1].name' });
		await tick();
		watch.disconnect();

		const host = washHost(target);
		expect(host?.classList.contains('qm-array-table-row')).toBe(true);
		expect(document.activeElement?.closest('.qm-array-table-row')).toBe(host);
		expect(added).toEqual([]);
	});

	it('washes the whole list where the address named the field', async () => {
		const q = quill();
		const { target, editor } = mountEditor(q, example());

		await editor.focusField('main.keywords');
		await tick();

		expect(washHost(target)?.className).toContain('qm-array-rows');
	});

	it('washes the list again where the row is one this document no longer has', async () => {
		const q = quill();
		const { target, editor } = mountEditor(q, example());

		// A landing off a compile the document has moved past: the field is right and
		// the row is gone, so the landing falls back to the field and the wash with it.
		await editor.setCaret({ field: 'main.keywords[9]', pos: 0 });
		await tick();

		expect(washHost(target)?.className).toContain('qm-array-rows');
	});
});
