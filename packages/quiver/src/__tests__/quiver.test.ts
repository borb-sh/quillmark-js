import { describe, it, expect, afterEach } from 'vitest';
import { fromDir } from '../node.js';
import { mockQuillFromTree } from './helpers/mock-engine.js';

const SAMPLE_FIXTURE = new URL('./fixtures/sample-quiver', import.meta.url).pathname;

describe('fromDir', () => {
	it('loads sample fixture: quillNames() returns sorted names', async () => {
		const q = await fromDir(SAMPLE_FIXTURE);
		const names = q.quillNames();
		expect(names).toEqual([...names].sort());
		expect(names).toContain('memo');
		expect(names).toContain('resume');
	});

	it('versionsOf returns empty array for unknown quill name', async () => {
		const q = await fromDir(SAMPLE_FIXTURE);
		expect(q.versionsOf('nonexistent')).toEqual([]);
	});

	// --- tree loading (observed via the tree fed to Quill.fromTree) ---
	//
	// The tree path is private: `getQuill` hands the loaded tree straight to
	// `Quill.fromTree`. Stub that to read the tree the loader produced.

	let stub: ReturnType<typeof mockQuillFromTree> | undefined;
	afterEach(() => {
		stub?.restore();
		stub = undefined;
	});

	it('loads the correct version: 1.1.0 content differs from 1.0.0', async () => {
		const q = await fromDir(SAMPLE_FIXTURE);
		stub = mockQuillFromTree();
		await q.getQuill('memo@1.0.0');
		await q.getQuill('memo@1.1.0');
		expect(stub.calls[0]!.has('Quill.yaml')).toBe(true);
		const text100 = new TextDecoder().decode(stub.calls[0]!.get('template.typ')!);
		const text110 = new TextDecoder().decode(stub.calls[1]!.get('template.typ')!);
		expect(text100).toContain('1.0.0');
		expect(text110).toContain('1.1.0');
	});

	it('getQuill throws quill_not_found for unknown quill name', async () => {
		const q = await fromDir(SAMPLE_FIXTURE);
		await expect(q.getQuill('unknown@1.0.0')).rejects.toThrow(
			expect.objectContaining({ code: 'quill_not_found' })
		);
	});

	// --- Immutability ---

	it('quillNames() returns a new array each call (defensive copy)', async () => {
		const q = await fromDir(SAMPLE_FIXTURE);
		const a = q.quillNames();
		const b = q.quillNames();
		expect(a).not.toBe(b);
		expect(a).toEqual(b);
	});

	it('versionsOf() returns a new array each call (defensive copy)', async () => {
		const q = await fromDir(SAMPLE_FIXTURE);
		const a = q.versionsOf('memo');
		const b = q.versionsOf('memo');
		expect(a).not.toBe(b);
		expect(a).toEqual(b);
	});
});
