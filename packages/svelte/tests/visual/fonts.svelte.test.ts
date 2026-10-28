// @vitest-environment jsdom
// The host's font library on the editing side: the popover's picker offers each family
// the library holds and sets or clears the selection's, a family the document already
// sets is offered and clearable with no library at all, and the editor registers the
// library's faces with the page for as long as it is mounted. The probe is its own quill.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { FontFace as LibraryFace } from '@quillmark/wasm';
import { DEFAULT_VISUAL_STRINGS } from '$lib/visual';
import { familiesOf, registerFaces } from '$lib/visual/fonts.js';
import { core, quillFromYaml } from '../helpers/fixtures.js';
import { mountInner, settle, unmountAll, type InnerRef } from '../helpers/surface.svelte.js';

afterEach(unmountAll);
afterEach(() => {
	vi.unstubAllGlobals();
});

const YAML = `quill:
  name: font_probe
  version: 1.0.0
  backend: typst
  description: One richtext field a font family is set in.
typst:
  plate_file: plate.typ
main:
  fields:
    intro:
      type: richtext
      multiline: true
`;

const face = (family: string, weight = 400, index = 0): LibraryFace => ({
	family,
	weight,
	style: 'normal',
	index,
	data: new Uint8Array([family.length])
});
const LIBRARY = [face('Tinos'), face('Tinos', 700), face('Carlito')];

function load(intro: string) {
	const q = quillFromYaml(YAML);
	const doc = core.Document.fromMarkdown(['~~~', '$quill: font_probe@1.0.0', '~~~', ''].join('\n'));
	doc.storeField('intro', intro);
	return { q, doc, intro: () => q.reader(doc).getContentAt({ field: 'intro' }, []) };
}

/** The text node and offset `offset` characters into `block`. */
function at(block: Element, offset: number): [Node, number] {
	const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
	for (let node = walk.nextNode(); node; node = walk.nextNode()) {
		const length = node.textContent!.length;
		if (offset <= length) return [node, offset];
		offset -= length;
	}
	throw new Error('offset past the block');
}

/** Land in `intro` and select `[from, to)` of its first line, as a pointer does. */
async function select(editor: InnerRef, from: number, to: number): Promise<void> {
	await editor.setCaret({ field: 'main.intro', pos: 0 });
	await settle();
	const leaf = document.activeElement as HTMLElement;
	leaf.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	const range = document.createRange();
	range.setStart(...at(leaf.querySelector('p')!, from));
	range.setEnd(...at(leaf.querySelector('p')!, to));
	window.getSelection()!.removeAllRanges();
	window.getSelection()!.addRange(range);
	document.dispatchEvent(new Event('selectionchange'));
	leaf.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
	flushSync();
}

/** The picker once the popover's coalesced check has run, or `null` where none draws. */
async function picker(): Promise<HTMLSelectElement | null> {
	await new Promise<void>((r) => requestAnimationFrame(() => r()));
	flushSync();
	await settle();
	expect(document.querySelector('.qm-format-popover')).not.toBeNull();
	return document.querySelector<HTMLSelectElement>(
		`select[aria-label="${DEFAULT_VISUAL_STRINGS.formatFont}"]`
	);
}

function pick(select: HTMLSelectElement, value: string): void {
	select.value = value;
	select.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}

const options = (select: HTMLSelectElement) =>
	[...select.options].filter((o) => !o.hidden).map((o) => o.textContent);

describe('the font picker', () => {
	it('offers each library family once, and sets the selection in one', async () => {
		const { q, doc, intro } = load('Set in face');
		const { editor } = mountInner(q, doc, { fonts: LIBRARY });
		await select(editor, 0, 3);
		const box = (await picker())!;
		expect(options(box)).toEqual([DEFAULT_VISUAL_STRINGS.fontDefault, 'Tinos', 'Carlito']);
		expect(box.value).toBe('');

		pick(box, 'Carlito');
		expect(intro()?.marks).toEqual([
			{ start: 0, end: 3, type: 'font_family', attrs: { name: 'Carlito' } }
		]);
	});

	it('reads the selection’s family, and its default clears it', async () => {
		const { q, doc, intro } = load('<qm-span family="Tinos">Set</qm-span> in face');
		const { editor } = mountInner(q, doc, { fonts: LIBRARY });
		await select(editor, 0, 3);
		const box = (await picker())!;
		expect(box.value).toBe('Tinos');

		pick(box, '');
		expect(intro()?.marks).toEqual([]);
	});

	it('reads no family over a selection setting two', async () => {
		const { q, doc } = load(
			'<qm-span family="Tinos">Se</qm-span><qm-span family="Carlito">t</qm-span> in'
		);
		const { editor } = mountInner(q, doc, { fonts: LIBRARY });
		await select(editor, 0, 3);
		const box = (await picker())!;
		expect(box.selectedOptions[0]?.textContent).toBe(DEFAULT_VISUAL_STRINGS.fontMixed);
	});

	it('draws nothing with no library over text setting no family', async () => {
		const { q, doc } = load('Set in face');
		const { editor } = mountInner(q, doc);
		await select(editor, 0, 3);
		expect(await picker()).toBeNull();
	});

	it('offers a family the document sets though the library lacks it, so it can clear', async () => {
		const { q, doc, intro } = load('<qm-span family="Figtree">Set</qm-span> in face');
		const { editor } = mountInner(q, doc);
		await select(editor, 0, 3);
		const box = (await picker())!;
		expect(options(box)).toEqual([DEFAULT_VISUAL_STRINGS.fontDefault, 'Figtree']);
		pick(box, '');
		expect(intro()?.marks).toEqual([]);
	});
});

describe('the library’s faces', () => {
	it('lists each family once, in the library’s order', () => {
		expect(familiesOf([face('B'), face('A'), face('B', 700)])).toEqual(['B', 'A']);
	});

	it('registers each first face with the page, and takes them back out', () => {
		const made: { family: string; descriptors: FontFaceDescriptors }[] = [];
		vi.stubGlobal(
			'FontFace',
			class {
				loaded = Promise.resolve(this);
				constructor(family: string, _data: BufferSource, descriptors: FontFaceDescriptors) {
					made.push({ family, descriptors });
				}
			}
		);
		const held = new Set<unknown>();
		const set = held as unknown as FontFaceSet;
		const release = registerFaces([face('Tinos'), face('Tinos', 700), face('Packed', 400, 1)], set);
		expect(made).toEqual([
			{ family: 'Tinos', descriptors: { weight: '400', style: 'normal' } },
			{ family: 'Tinos', descriptors: { weight: '700', style: 'normal' } }
		]);
		expect(held.size).toBe(2);
		release();
		expect(held.size).toBe(0);
	});
});
