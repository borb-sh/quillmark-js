// A Y text event's own delta, as the `Delta` an editor maps its positions through.
//
// Yjs counts UTF-16 units and an embed as one, as the content model counts its text and an island
// slot. Formatting-only retains read as plain retains.
import type * as Y from 'yjs';
import type { Delta } from '@quillmark/wasm';
import { SLOT } from './shape.js';

export function deltaOf(event: Y.YTextEvent): Delta {
	const ops: Delta['ops'] = [];
	for (const op of event.delta) {
		if (op.retain !== undefined) ops.push({ retain: op.retain });
		else if (op.delete !== undefined) ops.push({ delete: op.delete });
		else if (op.insert !== undefined)
			ops.push({ insert: typeof op.insert === 'string' ? op.insert : SLOT });
	}
	return { ops };
}
