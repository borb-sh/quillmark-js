// @vitest-environment jsdom
// A removal is offered back once, on a toast: the card or row returns where it left, with
// what it held, and the document reads as it did before the removal.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { core, quill, quillFromYaml, example } from '../helpers/fixtures.js';
import { field, mountEditor, press, settle, unmountAll } from '../helpers/surface.svelte.js';
import { OFFER_MS } from '$lib/visual/undo.svelte';

afterEach(() => {
	unmountAll();
	vi.useRealTimers();
});

const slots = (target: HTMLElement) => [...target.querySelectorAll<HTMLElement>('.qm-card-slot')];
const toast = (target: HTMLElement) => target.querySelector<HTMLElement>('.qm-toast');
const undoButton = (target: HTMLElement) =>
	target.querySelector<HTMLButtonElement>('.qm-toast-action')!;
const deleteButton = (slot: HTMLElement) =>
	slot.querySelector<HTMLButtonElement>('.qm-card-delete')!;

const LIST = `quill:
  name: undo_list
  version: 1.0.0
  backend: typst
  description: A list of lines.
typst:
  plate_file: plate.typ
main:
  fields:
    lines:
      type: array
      items: { type: text }
`;

describe('structural undo', () => {
	it('puts a deleted card back where it was, holding what it held', async () => {
		const doc = example();
		const before = doc.toString();
		const { target } = mountEditor(quill(), doc);
		const seeded = slots(target).length;
		expect(target.querySelector('.qm-toast-slot')?.getAttribute('role')).toBe('status');

		deleteButton(slots(target)[0]).click();
		flushSync();
		expect(slots(target)).toHaveLength(seeded - 1);
		expect(toast(target)?.textContent).toMatch(/removed\s*Undo$/);

		undoButton(target).click();
		flushSync();
		await settle();
		expect(slots(target)).toHaveLength(seeded);
		expect(doc.toString()).toBe(before);
		expect(toast(target)).toBeNull();
	});

	it('answers ⌘Z off a text leaf, and lapses on its own', () => {
		vi.useFakeTimers();
		const doc = example();
		const before = doc.toString();
		const { target } = mountEditor(quill(), doc);

		deleteButton(slots(target)[0]).click();
		flushSync();
		press(target.querySelector('.qm-editor')!, 'z', { metaKey: true });
		flushSync();
		expect(doc.toString()).toBe(before);

		deleteButton(slots(target)[0]).click();
		flushSync();
		vi.advanceTimersByTime(OFFER_MS + 1);
		flushSync();
		expect(toast(target)).toBeNull();
	});

	it('withdraws the offer when another structural edit moves what its index names', () => {
		const { target, editor } = mountEditor(quill(), example());
		deleteButton(slots(target)[0]).click();
		flushSync();
		expect(toast(target)).not.toBeNull();
		editor.insertCard('section', 0);
		flushSync();
		expect(toast(target)).toBeNull();
	});

	it("puts a removed row back, and takes the row's remove out of the tab order", () => {
		const doc = core.Document.parse(
			['~~~', '$quill: undo_list@1.0.0', 'lines:', '  - one', '  - two', '~~~', ''].join('\n')
		);
		const before = doc.toString();
		const { target } = mountEditor(quillFromYaml(LIST), doc);
		const lines = field(target, 'Lines');
		const removes = () => [...lines.querySelectorAll<HTMLButtonElement>('.qm-remove')];
		expect(removes().map((b) => b.tabIndex)).toEqual([-1, -1]);

		removes()[0].click();
		flushSync();
		expect(doc.toString()).not.toContain('- one');
		expect(toast(target)?.textContent).toContain('Lines 1 removed');

		undoButton(target).click();
		flushSync();
		expect(doc.toString()).toBe(before);
	});
});
