// The binding: one content field of a WASM `Document`, kept equal to its Y state.
//
// Local edits go out by diff: after the Document commits, `push` reads the field and writes the
// difference to Y. Remote edits come in whole: a Y transaction from any other origin projects the
// field and revises the Document to it (`reviseContent`), so the Document is a projection of the Y
// state and never a second source of truth. Anchors have no Y form, so the revise carries the
// Document's own through the change rather than dropping them. Nothing here knows the editor; the host tells its mounted leaf
// through `onRemote`.
import * as Y from 'yjs';
import type { Addr, Content, Delta, Document } from '@quillmark/wasm';
import { SLOT, fieldTypes, readField, type FieldTypes } from './shape.js';
import { project } from './project.js';
import { writeField, type Mint } from './write.js';

export interface BindFieldOpts {
	doc: Document;
	ydoc: Y.Doc;
	/** The field's address in `doc`. Absent is the main body. */
	addr?: Addr;
	/** The field's name in `ydoc`; every client binding one field uses one name. */
	name?: string;
	/** Fired after a remote change landed in the Document, with the text delta it moved by: the
	 *  host re-hydrates its leaf and maps the caret through `delta`. */
	onRemote?(delta: Delta | undefined): void;
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

	/** The text event of the transaction in flight, read by `pull`. */
	let event: Y.YTextEvent | undefined;
	const onText = (e: Y.YTextEvent) => {
		event = e;
	};
	types.text.observe(onText);

	/** Land the Y state in the Document. The delta handed on is the Y change's own, which knows
	 *  where a character typed into a run of the same character went; the revise's diff does not.
	 *  A repaired line moves text the Y change never did, and takes the revise's. */
	function pull(): Delta | undefined {
		const before = Array.from(read().text);
		const projected = project(readField(types));
		const revised = revise(doc, addr, projected.content);
		const own = event ? usvDelta(event, before) : { ops: [] };
		event = undefined;
		if (projected.repaired) {
			repairs++;
			writeField(types, read(), mint, origin);
			return revised;
		}
		return own;
	}

	function push(): boolean {
		const renamed = writeField(types, read(), mint, origin);
		if (renamed.size === 0) return false;
		revise(doc, addr, project(readField(types)).content);
		return true;
	}

	const onAfter = (tr: Y.Transaction) => {
		if (tr.origin === origin) return;
		if (!touches(tr, types)) return;
		opts.onRemote?.(pull());
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
			types.text.unobserve(onText);
		}
	};
}

/** `doc.reviseContent` where the engine has it, else `overwrite`, which drops the Document's
 *  anchors and reports no delta. */
function revise(doc: Document, addr: Addr, content: Content): Delta | undefined {
	const revising = doc as Document & {
		reviseContent?(addr: Addr, rt: Content): { delta: Delta };
	};
	if (revising.reviseContent) return revising.reviseContent(addr, content).delta;
	doc.overwrite(addr, content);
	return undefined;
}

/** A Y text event's delta, in UTF-16 units over the text it changed, as a USV `Delta` over
 *  `before`. Formatting retains read as retains; an embed is one slot. */
function usvDelta(event: Y.YTextEvent, before: string[]): Delta {
	const ops: Delta['ops'] = [];
	let at = 0;
	const chars = (units: number): number => {
		let n = 0;
		for (let u = 0; u < units; n++) u += before[at + n].codePointAt(0)! > 0xffff ? 2 : 1;
		at += n;
		return n;
	};
	for (const op of event.delta) {
		if (op.retain !== undefined) ops.push({ retain: chars(op.retain) });
		else if (op.delete !== undefined) ops.push({ delete: chars(op.delete) });
		else if (op.insert !== undefined)
			ops.push({ insert: typeof op.insert === 'string' ? op.insert : SLOT });
	}
	return { ops };
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
