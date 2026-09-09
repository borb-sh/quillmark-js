// The `$ext.editor` namespace: editor-only chrome state that never reaches the
// render backend (canon: `CARDS.md`; VISUAL_EDITOR §"Card operations"). Card rename
// keeps `title` here and the tips channel keeps `tips`; both, and every key added
// later, write through the one verb below.
//
// Kept out of VisualEditor.svelte so the write the editor performs is the write a
// test can call: the invariant this module exists to hold fails silently, and a
// test asserting a hand-copy of it would not notice.
import type { Document, CardAddr } from '@quillmark/wasm';

/**
 * Merge `patch` into `$ext.editor` on the card `addr` targets (absent `card` =
 * main). A key whose patch value is `undefined` is dropped; every other key in the
 * namespace is carried through untouched.
 *
 * **The whole map is the write unit.** `storeExt` replaces `$ext` entire, so a
 * writer that stores its own namespace alone destroys the siblings, and one that
 * stores its own key alone destroys the sibling keys. `tips` and `title` are
 * siblings here, so a dismissal that skipped either merge would wipe every renamed
 * card's title. Both merges live in this one function, which is what makes that
 * unexpressible rather than merely documented: key N+1 inherits them instead of
 * re-deriving them.
 *
 * The drop is an explicit `delete`, not a stored `undefined`: whether a JS
 * `undefined` survives the wasm-bindgen crossing is not a property worth depending
 * on.
 *
 * **A namespace emptied of keys is removed, not stored empty**, and `$ext` goes
 * with it when `editor` was the last namespace — `removeExt`, not `storeExt({})`,
 * which records an explicit empty map. So a document nothing has renamed or hinted
 * carries no editor slot rather than an empty one. A patch dropping keys the
 * namespace does not have writes nothing, so dismissing tips on a document that
 * carries none is not a mutation.
 */
export function patchEditorExt(
	doc: Document,
	addr: CardAddr,
	patch: Record<string, unknown>
): void {
	const ext = doc.getExt(addr) ?? {};
	const current = ext.editor as Record<string, unknown> | undefined;
	const next = { ...(current ?? {}) };
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) delete next[key];
		else next[key] = value;
	}
	if (Object.keys(next).length > 0) {
		doc.storeExt(addr, { ...ext, editor: next });
		return;
	}
	if (!current) return;
	const { editor: _dropped, ...rest } = ext;
	if (Object.keys(rest).length > 0) doc.storeExt(addr, rest);
	else doc.removeExt(addr);
}
