// @vitest-environment jsdom
// Changes the host makes to the document itself, as a live session lands another client's
// edits: the surface re-reads on `applyExternal`, `refresh` and `applyCardOps`, keeps the
// mounted cards that stay, and reports nothing through `onChange`.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { quill, example } from '../helpers/fixtures.js';
import { mountEditor, unmountAll } from '../helpers/surface.svelte.js';

afterEach(() => unmountAll());

const slots = (target: HTMLElement) => [...target.querySelectorAll<HTMLElement>('.qm-card-slot')];
const leafKeys = (slot: HTMLElement) =>
	[...slot.querySelectorAll('[data-leaf-key]')].map((e) => e.getAttribute('data-leaf-key'));
const leaf = (target: HTMLElement, key: string) =>
	target.querySelector<HTMLElement>(`[data-leaf-key="${key}"]`)!;

describe('changes the host made', () => {
	it('moves the card keys with the card ops the document already holds', () => {
		const q = quill();
		const doc = example();
		const { target, editor, changes } = mountEditor(q, doc);
		const seeded = slots(target).length;
		const firstBody = leaf(target, 'c0:$body').querySelector('[contenteditable]');

		doc.insertCard(q.seedCard('section', doc.seedOverlay('section'))!, 0);
		doc.moveCard(1, 2);
		doc.removeCard(seeded);
		editor.applyCardOps([
			{ op: 'insert', at: 0 },
			{ op: 'move', from: 1, to: 2 },
			{ op: 'remove', at: seeded }
		]);
		flushSync();

		expect(slots(target)).toHaveLength(seeded);
		expect(leafKeys(slots(target)[0])).toContain(`c${seeded}:$body`);
		expect(leafKeys(slots(target)[2])).toContain('c0:$body');
		expect(leaf(target, 'c0:$body').querySelector('[contenteditable]')).toBe(firstBody);
		expect(changes).toEqual([]);
	});

	it('re-reads a prose leaf the host changed, reporting nothing', () => {
		const q = quill();
		const doc = example();
		const { target, editor, changes } = mountEditor(q, doc);
		const delta = { ops: [{ insert: 'Remote ' }] };
		doc.applyChange({}, { delta });
		editor.applyExternal(doc.pathFor({}), delta);
		flushSync();
		expect(leaf(target, 'main:$body').textContent?.startsWith('Remote ')).toBe(true);
		expect(changes).toEqual([]);
	});

	it('re-reads a card the host retyped', () => {
		const q = quill();
		const doc = example();
		const { target, editor } = mountEditor(q, doc);
		const at = doc.cards.findIndex((c) => c.kind === 'section');
		doc.insertCard({ ...doc.card(at), kind: 'note' }, at);
		doc.removeCard(at + 1);
		editor.refresh();
		flushSync();
		expect(leafKeys(slots(target)[at])).toContain(`c${at}:label`);
	});
});
