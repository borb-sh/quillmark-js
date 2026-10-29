// A Y text event's own delta, as the USV `Delta` an editor maps its positions through.
//
// Yjs counts UTF-16 units and an embed as one; the codec counts USV characters and an island slot
// as one. Formatting-only retains read as plain retains.
import type * as Y from 'yjs';
import type { Delta } from '@quillmark/wasm';
import { SLOT, units } from './shape.js';

/** `event.delta`, over `before` (the field's characters ahead of the change), in USV. */
export function usvDelta(event: Y.YTextEvent, before: readonly string[]): Delta {
	const ops: Delta['ops'] = [];
	let at = 0;
	const span = (u16: number): number => {
		let n = 0;
		for (let u = 0; u < u16 && at + n < before.length; n++) u += units(before[at + n]);
		at += n;
		return n;
	};
	for (const op of event.delta) {
		if (op.retain !== undefined) ops.push({ retain: span(op.retain) });
		else if (op.delete !== undefined) ops.push({ delete: span(op.delete) });
		else if (op.insert !== undefined)
			ops.push({ insert: typeof op.insert === 'string' ? op.insert : SLOT });
	}
	return { ops };
}
