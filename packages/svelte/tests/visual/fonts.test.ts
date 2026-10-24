// @vitest-environment jsdom
// The font registry the editor is handed (`visual/fonts.ts`): its families each once in
// their first spelling, and its faces held in the document's font set for as long as a
// mount holds them, one registration across every mount. jsdom has no font set, so the
// set and the face constructor are stand-ins that record what reaches them.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FontFace as QuillFontFace } from '@quillmark/wasm';
import { fontAlias } from '$lib/core/codec';
import { registerFaces, registryFamilies } from '$lib/visual/fonts.js';

const face = (
	family: string,
	weight = 400,
	data = new Uint8Array([0, 1, 0, 0])
): QuillFontFace => ({
	family,
	weight,
	style: 'normal',
	index: 0,
	data
});

class StandInFace {
	constructor(
		readonly family: string,
		readonly data: unknown,
		readonly descriptors: FontFaceDescriptors
	) {}
	load() {
		return Promise.resolve(this);
	}
}

let added: Set<StandInFace>;

beforeEach(() => {
	added = new Set();
	vi.stubGlobal('FontFace', StandInFace);
	Object.defineProperty(document, 'fonts', {
		configurable: true,
		value: { add: (f: StandInFace) => added.add(f), delete: (f: StandInFace) => added.delete(f) }
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete (document as { fonts?: unknown }).fonts;
});

describe('the font registry', () => {
	it('lists each family once, in its first face’s spelling and the registry’s order', () => {
		expect(registryFamilies([face('Carlito'), face('Roboto'), face('carlito', 700)])).toEqual([
			'Carlito',
			'Roboto'
		]);
	});

	it('registers each face under its family’s alias, and takes it out with the last holder', () => {
		const faces = [face('Carlito'), face('Carlito', 700)];
		const first = registerFaces(faces);
		const second = registerFaces(faces);
		expect([...added].map((f) => [f.family, f.descriptors.weight])).toEqual([
			[fontAlias('Carlito'), '400'],
			[fontAlias('Carlito'), '700']
		]);
		first();
		expect(added.size).toBe(2);
		second();
		expect(added.size).toBe(0);
	});

	it('leaves out a face read out of a collection', () => {
		const ttc = new Uint8Array([0x74, 0x74, 0x63, 0x66]);
		registerFaces([face('Carlito', 400, ttc), { ...face('Roboto'), index: 1 }]);
		expect(added.size).toBe(0);
	});
});
