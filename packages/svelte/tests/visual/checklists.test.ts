// The value a matrix prints (VISUAL_EDITOR §"The matrix").
import { describe, it, expect } from 'vitest';
import type { QuillFieldSchema } from '@quillmark/wasm';
import { matrixPrinted } from '$lib/visual/checklists';

describe('matrixPrinted', () => {
	it('reads the stored map, else a mapping default', () => {
		const withDefault: QuillFieldSchema = {
			type: 'matrix',
			members: { a: 'A' },
			default: { a: true }
		};
		expect(matrixPrinted(undefined, withDefault)).toEqual({ a: true });
		expect(matrixPrinted({}, withDefault)).toEqual({});
		expect(matrixPrinted(undefined, { type: 'matrix', members: { a: 'A' } })).toBeUndefined();
		expect(matrixPrinted(['a'], withDefault)).toBeUndefined();
	});
});
