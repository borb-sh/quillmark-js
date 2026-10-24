// The font registry the editor offers and draws in: the faces a render of the quill
// sets type in (`engine.fontFaces(quill)`), handed over as the `fonts` prop. Two reads
// come off it. The family menu lists its families, and the paste pass keeps a family it
// holds (`core/codec/font-paste.ts`). Each face registers with the document's font set
// under the alias the leaf draws a family's run in (`core/codec/fonts.ts`), so a marked
// run shows its real face and a writer sees where it starts and ends.
//
// The families reach the tree through context, as the wording does: the popover and
// every leaf want them, and nothing between the root and those reads them.
import { getContext, setContext } from 'svelte';
import type { FontFace as QuillFontFace } from '@quillmark/wasm';
import { fontAlias } from '../core/codec/index.js';

/** Each family once, in its first face's spelling, in the registry's order. */
export function registryFamilies(faces: readonly QuillFontFace[]): string[] {
	const seen = new Map<string, string>();
	for (const face of faces) {
		const key = face.family.toLowerCase();
		if (!seen.has(key)) seen.set(key, face.family);
	}
	return [...seen.values()];
}

/** A registered face and the mounts holding it. */
interface Held {
	face: FontFace;
	holders: number;
}

/** One registration per face across every mounted editor: two editors over one quill
 *  share the faces rather than adding each twice to the one font set. */
const held = new Map<string, Held>();

/** Whether `data` is a collection, out of which a browser reads no face. */
function isCollection(data: Uint8Array): boolean {
	return data[0] === 0x74 && data[1] === 0x74 && data[2] === 0x63 && data[3] === 0x66;
}

/**
 * Add each face to the document's font set under its family's alias; the returned
 * function takes them out again once no mount holds them. A face out of a `.ttc` or
 * `.otc` is left out, since a browser loads none from a collection, and its runs draw
 * in the surface's face.
 */
export function registerFaces(faces: readonly QuillFontFace[]): () => void {
	if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts)
		return () => {};
	const keys: string[] = [];
	for (const face of faces) {
		if (face.index !== 0 || isCollection(face.data)) continue;
		const family = fontAlias(face.family);
		const key = `${family}\u0000${face.weight}\u0000${face.style}\u0000${face.data.byteLength}`;
		let entry = held.get(key);
		if (!entry) {
			const loaded = new FontFace(family, face.data as Uint8Array<ArrayBuffer>, {
				weight: String(face.weight),
				style: face.style
			});
			document.fonts.add(loaded);
			loaded.load().catch(() => {});
			entry = { face: loaded, holders: 0 };
			held.set(key, entry);
		}
		entry.holders++;
		keys.push(key);
	}
	return () => {
		for (const key of keys) {
			const entry = held.get(key);
			if (!entry || --entry.holders > 0) continue;
			document.fonts.delete(entry.face);
			held.delete(key);
		}
	};
}

const KEY = Symbol('qm.fonts');

/** The registry's families as the tree reads them: a getter, so a host handing over a
 *  new registry reaches the mounted menu and leaves. */
export interface FontRegistry {
	readonly families: readonly string[];
}

export function setFontRegistry(registry: FontRegistry): void {
	setContext(KEY, registry);
}

/** The registry under a mounted editor; an empty one off-tree. */
export function fontRegistry(): FontRegistry {
	return getContext<FontRegistry>(KEY) ?? { families: [] };
}
