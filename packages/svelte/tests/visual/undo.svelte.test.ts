// @vitest-environment jsdom
// A removal is offered back on a toast: the card or row returns where it left, with what it
// held, and the document reads as it did before the removal. A card's step outlives its toast.
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
const restoreButton = (target: HTMLElement) =>
	target.querySelector<HTMLButtonElement>('.qm-restore-btn');
/** A document's markdown less its cards' ids: a card restored after another was added is
 *  minted a new one when the added card took the id it left with. */
const sansIds = (markdown: string) => markdown.replace(/^\$id: .*\n/gm, '');
const lapse = () => {
	vi.advanceTimersByTime(OFFER_MS + 1);
	flushSync();
};

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
const CAPPED = LIST.replace('items: { type: text }', 'items: { type: text }\n      max: 2');

describe('structural undo', () => {
	it('puts a deleted card back where it was, holding what it held', async () => {
		const doc = example();
		const before = doc.toMarkdown();
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
		expect(doc.toMarkdown()).toBe(before);
		expect(toast(target)).toBeNull();
		expect(restoreButton(target)).toBeNull();
	});

	it('answers ⌘Z off a text control, and lapses on its own when not in use', () => {
		vi.useFakeTimers();
		const doc = example();
		const before = doc.toMarkdown();
		const { target } = mountEditor(quill(), doc);

		// A press on delete takes the button with it, so the key arrives at the body.
		deleteButton(slots(target)[0]).click();
		flushSync();
		press(document.body, 'z', { metaKey: true });
		flushSync();
		expect(doc.toMarkdown()).toBe(before);

		// A text control keeps its own ⌘Z unless the removal handed it the focus.
		deleteButton(slots(target)[0]).click();
		flushSync();
		const title = target.querySelector<HTMLInputElement>('.qm-card-title')!;
		press(title, 'z', { ctrlKey: true });
		flushSync();
		expect(toast(target)).not.toBeNull();
		undoButton(target).click();
		flushSync();
		expect(doc.toMarkdown()).toBe(before);

		deleteButton(slots(target)[0]).click();
		flushSync();
		// The lapse holds while the toast is in use.
		toast(target)!.dispatchEvent(new Event('pointerenter'));
		vi.advanceTimersByTime(OFFER_MS + 1);
		flushSync();
		expect(toast(target)).not.toBeNull();
		toast(target)!.dispatchEvent(new Event('pointerleave'));
		vi.advanceTimersByTime(OFFER_MS + 1);
		flushSync();
		expect(toast(target)).toBeNull();
	});

	it('gives a ⌘Z at the body to the editor that offered last', () => {
		const first = example();
		const second = example();
		const a = mountEditor(quill(), first);
		const b = mountEditor(quill(), second);
		const before = [first.toMarkdown(), second.toMarkdown()];
		deleteButton(slots(a.target)[0]).click();
		flushSync();
		deleteButton(slots(b.target)[0]).click();
		flushSync();
		press(document.body, 'z', { metaKey: true });
		flushSync();
		expect(second.toMarkdown()).toBe(before[1]);
		expect(first.toMarkdown()).not.toBe(before[0]);
		expect(toast(a.target)).not.toBeNull();
	});

	it('keeps a removed card past its toast, and puts it back beside the card it left', () => {
		vi.useFakeTimers();
		const doc = example();
		const before = sansIds(doc.toMarkdown());
		const { target, editor, errors } = mountEditor(quill(), doc);

		deleteButton(slots(target)[1]).click();
		flushSync();
		lapse();
		expect(toast(target)).toBeNull();

		// A card added above moves every index; the neighbour the removed card left has not moved.
		const added = editor.insertCard('section', 0)!;
		flushSync();
		restoreButton(target)!.click();
		flushSync();
		editor.removeCard(added);
		flushSync();
		expect(errors).toEqual([]);
		expect(sansIds(doc.toMarkdown())).toBe(before);
	});

	it('puts two removed cards back in turn, the second beside the restored first', () => {
		vi.useFakeTimers();
		const doc = example();
		const before = doc.toMarkdown();
		const { target } = mountEditor(quill(), doc);

		deleteButton(slots(target)[1]).click();
		flushSync();
		deleteButton(slots(target)[0]).click();
		flushSync();
		lapse();

		restoreButton(target)!.click();
		flushSync();
		restoreButton(target)!.click();
		flushSync();
		expect(doc.toMarkdown()).toBe(before);
		expect(restoreButton(target)).toBeNull();
	});

	it('answers ⌘Z for a kept card only until the next edit lands', () => {
		vi.useFakeTimers();
		const doc = example();
		const before = doc.toMarkdown();
		const { target, editor } = mountEditor(quill(), doc);

		deleteButton(slots(target)[0]).click();
		flushSync();
		lapse();
		press(document.body, 'z', { metaKey: true });
		flushSync();
		expect(doc.toMarkdown()).toBe(before);

		deleteButton(slots(target)[0]).click();
		flushSync();
		lapse();
		const added = editor.insertCard('section')!;
		flushSync();
		const changed = doc.toMarkdown();
		press(document.body, 'z', { metaKey: true });
		flushSync();
		expect(doc.toMarkdown()).toBe(changed);

		restoreButton(target)!.click();
		flushSync();
		editor.removeCard(added);
		flushSync();
		expect(sansIds(doc.toMarkdown())).toBe(sansIds(before));
	});

	it("leaves a kept card's key through a re-read, which is no edit", () => {
		vi.useFakeTimers();
		const doc = example();
		const before = doc.toMarkdown();
		const { target, editor } = mountEditor(quill(), doc);

		deleteButton(slots(target)[0]).click();
		flushSync();
		lapse();
		editor.refresh();
		flushSync();
		press(document.body, 'z', { metaKey: true });
		flushSync();
		expect(doc.toMarkdown()).toBe(before);
	});

	it("takes a host's step before a kept card's, and leaves the card to its control", () => {
		const doc = example();
		const before = doc.toMarkdown();
		const { target, editor } = mountEditor(quill(), doc);

		deleteButton(slots(target)[0]).click();
		flushSync();
		const without = doc.toMarkdown();
		let undone = 0;
		editor.offerUndo('Three places edited', () => undone++);
		flushSync();
		expect(toast(target)?.textContent).toContain('Three places edited');

		press(document.body, 'z', { metaKey: true });
		flushSync();
		expect(undone).toBe(1);
		press(document.body, 'z', { metaKey: true });
		flushSync();
		expect(doc.toMarkdown()).toBe(without);

		restoreButton(target)!.click();
		flushSync();
		expect(doc.toMarkdown()).toBe(before);
	});

	it("drops a host's step when a card is restored by its control", () => {
		vi.useFakeTimers();
		const doc = example();
		const before = doc.toMarkdown();
		const { target, editor } = mountEditor(quill(), doc);

		deleteButton(slots(target)[0]).click();
		flushSync();
		let undone = 0;
		editor.offerUndo('Three places edited', () => undone++);
		flushSync();
		lapse();
		restoreButton(target)!.click();
		flushSync();
		expect(doc.toMarkdown()).toBe(before);

		press(document.body, 'z', { metaKey: true });
		flushSync();
		expect(undone).toBe(0);
		expect(doc.toMarkdown()).toBe(before);
	});

	it("keeps a card's toast through another card operation, and withdraws a row's", () => {
		const { target, editor } = mountEditor(quill(), example());
		deleteButton(slots(target)[0]).click();
		flushSync();
		editor.insertCard('section', 0);
		flushSync();
		expect(toast(target)).not.toBeNull();

		const authors = field(target, 'Authors');
		authors.querySelector<HTMLButtonElement>('.qm-remove')!.click();
		flushSync();
		expect(toast(target)?.textContent).toContain('Authors 1 removed');
		editor.insertCard('section', 0);
		flushSync();
		expect(toast(target)).toBeNull();
	});

	it("puts a removed row back, and takes the row's remove out of the tab order", () => {
		const doc = core.Document.parse(
			['~~~', '$quill: undo_list@1.0.0', 'lines:', '  - one', '  - two', '~~~', ''].join('\n')
		);
		const before = doc.toMarkdown();
		const { target } = mountEditor(quillFromYaml(LIST), doc);
		const lines = field(target, 'Lines');
		const removes = () => [...lines.querySelectorAll<HTMLButtonElement>('.qm-remove')];
		expect(removes().map((b) => b.tabIndex)).toEqual([-1, -1]);

		removes()[0].click();
		flushSync();
		expect(doc.toMarkdown()).not.toContain('- one');
		expect(toast(target)?.textContent).toContain('Lines 1 removed');

		undoButton(target).click();
		flushSync();
		expect(doc.toMarkdown()).toBe(before);
	});

	it("withdraws a row's offer when the list changes shape under it", () => {
		const doc = core.Document.parse(
			['~~~', '$quill: undo_list@1.0.0', 'lines:', '  - one', '  - two', '~~~', ''].join('\n')
		);
		const { target } = mountEditor(quillFromYaml(CAPPED), doc);
		const lines = field(target, 'Lines');
		lines.querySelector<HTMLButtonElement>('.qm-remove')!.click();
		flushSync();
		expect(toast(target)).not.toBeNull();

		lines.querySelector<HTMLButtonElement>('.qm-add-el')!.click();
		flushSync();
		expect(toast(target)).toBeNull();
		expect(doc.toMarkdown()).not.toContain('- one');
	});
});
