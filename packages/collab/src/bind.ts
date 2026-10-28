// The binding: one content field of a WASM `Document`, kept equal to its Y state.
//
// Local edits go out by diff: after the Document commits, `push` reads the field and writes the
// difference to Y. Remote edits come in whole: a Y transaction from any other origin projects the
// field and overwrites the Document with it, so the Document is a projection of the Y state and
// never a second source of truth. Nothing here knows the editor; the host tells its mounted leaf
// through `onRemote`.
import * as Y from 'yjs';
import type { Addr, Content, Document } from '@quillmark/wasm';
import { fieldTypes, readField, type FieldTypes } from './shape.js';
import { project } from './project.js';
import { writeField, type Mint } from './write.js';

export interface BindFieldOpts {
	doc: Document;
	ydoc: Y.Doc;
	/** The field's address in `doc`. Absent is the main body. */
	addr?: Addr;
	/** The field's name in `ydoc`; every client binding one field uses one name. */
	name?: string;
	/** Fired after a remote change landed in the Document: the host re-hydrates its leaf. */
	onRemote?(): void;
}

export interface FieldBinding {
	/** Write the field's committed content to Y. Returns whether the Document changed in turn,
	 *  which it does when a new island took a minted id. */
	push(): boolean;
	/** How many projections split a line around a table slot. */
	readonly repairs: number;
	destroy(): void;
}

export function bindField(opts: BindFieldOpts): FieldBinding {
	const { doc, ydoc } = opts;
	const addr = opts.addr ?? {};
	const types = fieldTypes(ydoc, opts.name ?? 'main.body');
	const origin = Symbol('quillmark-collab');
	const mint = minter(ydoc);
	let repairs = 0;

	const read = (): Content => doc.getStored(addr) as Content;

	function pull(): void {
		const projected = project(readField(types));
		doc.overwrite(addr, projected.content);
		if (projected.repaired) {
			repairs++;
			writeField(types, read(), mint, origin);
		}
	}

	function push(): boolean {
		const renamed = writeField(types, read(), mint, origin);
		if (renamed.size === 0) return false;
		doc.overwrite(addr, project(readField(types)).content);
		return true;
	}

	const onAfter = (tr: Y.Transaction) => {
		if (tr.origin === origin) return;
		if (!touches(tr, types)) return;
		pull();
		opts.onRemote?.();
	};
	ydoc.on('afterTransaction', onAfter);

	if (types.text.length > 0 || types.meta.size > 0) pull();
	else push();

	return {
		push,
		get repairs() {
			return repairs;
		},
		destroy() {
			ydoc.off('afterTransaction', onAfter);
		}
	};
}

function touches(tr: Y.Transaction, { text, meta }: FieldTypes): boolean {
	const types = [text, meta] as unknown as Y.AbstractType<Y.YEvent<any>>[];
	return types.some((t) => tr.changedParentTypes.has(t) || tr.changed.has(t));
}

function minter(ydoc: Y.Doc): Mint {
	const prefix = ydoc.clientID.toString(36);
	let n = 0;
	return () => `${prefix}-${(n++).toString(36)}`;
}

/**
 * The Y update that seeds a field with `content`, the same bytes on every client that seeds the
 * same content: it is written by a fixed client id with deterministic ids, so two clients opening
 * one document each apply it and merge to one copy rather than two.
 */
export function seedUpdate(content: Content, name = 'main.body'): Uint8Array {
	const seed = new Y.Doc();
	seed.clientID = 0;
	let n = 0;
	writeField(fieldTypes(seed, name), content, () => `s-${(n++).toString(36)}`, null);
	return Y.encodeStateAsUpdate(seed);
}
