// @vitest-environment jsdom
// The format bar's keyboard route. Its key over a selection raises the surface at once
// and enters it; worked from there the surface keeps the focus through an action, Tab
// walks its controls and wraps, and Escape hands the focus back to the selection with the
// surface still up. Entered by a press it is a pointer's, and an action returns the focus
// to the text. The probe is its own quill.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { FontFace as LibraryFace } from '@quillmark/wasm';
import { FIELD_KEYS } from '$lib/core/codec/index.js';
import { core, quillFromYaml } from '../helpers/fixtures.js';
import { mountInner, press, settle, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const YAML = `quill:
  name: bar_probe
  version: 1.0.0
  backend: typst
  description: One richtext field the format bar rises over.
typst:
  plate_file: plate.typ
main:
  fields:
    intro:
      type: richtext
      multiline: true
`;
const LIBRARY: LibraryFace[] = [
	{ family: 'Tinos', weight: 400, style: 'normal', index: 0, data: new Uint8Array([1]) }
];

async function open() {
	const q = quillFromYaml(YAML);
	const doc = core.Document.parse(['~~~', '$quill: bar_probe@1.0.0', '~~~', ''].join('\n'));
	doc.unchecked.storeField('intro', 'Set in face');
	const { editor, errors } = mountInner(q, doc, { fonts: LIBRARY });
	await editor.setCaret({ field: 'main.intro', pos: 0 });
	await settle();
	return {
		errors,
		leaf: document.activeElement as HTMLElement,
		marks: () => q.reader(doc).getContentAt({ field: 'intro' }, [])?.marks ?? []
	};
}
/** Select the leaf's first word as the keyboard does: no press behind the range. */
function selectWord(leaf: HTMLElement): void {
	const text = leaf.querySelector('p')!.firstChild!;
	const range = document.createRange();
	range.setStart(text, 0);
	range.setEnd(text, 3);
	window.getSelection()!.removeAllRanges();
	window.getSelection()!.addRange(range);
	document.dispatchEvent(new Event('selectionchange'));
	flushSync();
}
/** The bar's key, in the notation the keymap binds it by, as the event it matches. */
function barKey(leaf: HTMLElement): KeyboardEvent {
	const names = FIELD_KEYS.formatBar.split('-');
	const e = new KeyboardEvent('keydown', {
		key: names.at(-1),
		altKey: names.includes('Alt'),
		bubbles: true,
		cancelable: true
	});
	leaf.dispatchEvent(e);
	flushSync();
	return e;
}
const surface = () => document.querySelector<HTMLElement>('.qm-format-popover');
const controls = () => [...surface()!.querySelectorAll<HTMLElement>('button, select, input')];
/** Enter the bar over a selected word, its surface mounted. */
async function entered(): Promise<Awaited<ReturnType<typeof open>>> {
	const probe = await open();
	selectWord(probe.leaf);
	barKey(probe.leaf);
	await settle();
	return probe;
}
/** Select the word behind a press on the leaf, as a pointer does. */
async function pointed(leaf: HTMLElement): Promise<void> {
	leaf.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	selectWord(leaf);
	leaf.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
	await new Promise<void>((r) => requestAnimationFrame(() => r()));
	flushSync();
	await settle();
}

describe('the format bar’s key', () => {
	it('raises the surface over a selection at once, and enters it', async () => {
		const { leaf } = await open();
		selectWord(leaf);
		expect(surface()).toBeNull();

		const e = barKey(leaf);
		await settle();
		expect(e.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(controls()[0]);
	});

	it('is not taken where no selection stands', async () => {
		const { leaf } = await open();
		expect(barKey(leaf).defaultPrevented).toBe(false);
		expect(surface()).toBeNull();
	});

	it('keeps the focus through an action, so a second can follow', async () => {
		const { marks, errors } = await entered();
		const [first, second, third] = controls();
		first.click();
		flushSync();
		expect(marks()).toHaveLength(1);
		expect(document.activeElement).toBe(first);

		press(first, 'ArrowRight');
		expect(document.activeElement).toBe(second);
		press(second, 'ArrowRight');
		third.click();
		flushSync();
		expect(marks()).toHaveLength(2);
		expect(document.activeElement).toBe(third);
		expect(errors).toEqual([]);
	});

	it('walks the controls by Tab and wraps at either end, the picker among them', async () => {
		await entered();
		const all = controls();
		expect(all.some((el) => el instanceof HTMLSelectElement)).toBe(true);
		for (const next of [...all.slice(1), all[0]]) {
			press(document.activeElement as HTMLElement, 'Tab');
			expect(document.activeElement).toBe(next);
		}
		press(all[0], 'Tab', { shiftKey: true });
		expect(document.activeElement).toBe(all.at(-1));
	});

	it('hands the focus back to the selection on Escape, the surface still up', async () => {
		const { leaf } = await entered();
		press(document.activeElement as HTMLElement, 'Escape');
		await settle();
		expect(document.activeElement).toBe(leaf);
		expect(surface()).not.toBeNull();
	});

	it('leaves a pointer’s surface a pointer’s: an action returns the focus to the text', async () => {
		const { leaf, marks } = await open();
		await pointed(leaf);
		const [first] = controls();
		first.focus();
		first.click();
		flushSync();
		expect(marks()).toHaveLength(1);
		expect(document.activeElement).toBe(leaf);
	});
});
