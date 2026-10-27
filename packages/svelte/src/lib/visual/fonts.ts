// The host's font library on the editing side: the faces `engine.fontFaces(quill)` lists,
// registered with the page so a leaf draws a `font_family` run in the face the preview
// sets it in, and the family logic behind the popover's picker, off the component.
//
// `font_family` carries a value, as `link` does, so the picker spells its mark ops out
// rather than toggling (`links.ts` states why); one family a character is the mark's own
// exclusion (`codec/schema.ts`).
import type { FontFace as LibraryFace } from '@quillmark/wasm';
import type { Command, EditorState } from 'prosemirror-state';

/** The families `faces` offer, each once, in the library's order. */
export function familiesOf(faces: readonly LibraryFace[]): string[] {
	return [...new Set(faces.map((face) => face.family))];
}

/**
 * Register `faces` with `set` and return what takes them back out. A face past the
 * first in a collection is left out, a CSS face drawing a collection's first alone, so
 * its family draws in the root face here while the preview sets it. A face the browser
 * refuses draws the same way, and a page with no Font Loading API registers nothing.
 */
export function registerFaces(
	faces: readonly LibraryFace[],
	set: FontFaceSet | undefined = globalThis.document?.fonts
): () => void {
	if (!set || typeof FontFace === 'undefined') return () => {};
	const added: FontFace[] = [];
	for (const face of faces) {
		if (face.index !== 0) continue;
		const css = new FontFace(face.family, face.data as Uint8Array<ArrayBuffer>, {
			weight: String(face.weight),
			style: face.style
		});
		css.loaded.catch(() => set.delete(css));
		set.add(css);
		added.push(css);
	}
	return () => {
		for (const css of added) set.delete(css);
	};
}

/**
 * The family the selection's text is set in: its name, `''` where it sets none, `null`
 * where it sets more than one or holds no text.
 */
export function familyInSelection(state: EditorState): string | null {
	const type = state.schema.marks.font_family;
	const { from, to } = state.selection;
	const seen = new Set<string>();
	state.doc.nodesBetween(from, to, (node) => {
		if (!node.isText) return;
		seen.add(type ? String(type.isInSet(node.marks)?.attrs.name ?? '') : '');
	});
	return seen.size === 1 ? [...seen][0]! : null;
}

/** Set the selection in `name`, or in the surrounding face where `name` is `''`. */
export function setFamily(name: string): Command {
	return (state, dispatch) => {
		const type = state.schema.marks.font_family;
		const { from, to, empty } = state.selection;
		if (!type || empty) return false;
		if (dispatch) {
			const tr = state.tr.removeMark(from, to, type);
			dispatch(name ? tr.addMark(from, to, type.create({ name })) : tr);
		}
		return true;
	};
}
