import { describe, it, expect, afterEach } from 'vitest';
import { fromDir } from '../node.js';
import { createQuiver, type Quiver } from '../quiver.js';
import { mockQuillFromTree } from './helpers/mock-engine.js';

const SAMPLE_FIXTURE = new URL('./fixtures/sample-quiver', import.meta.url).pathname;

// ─── resolve ──────────────────────────────────────────────────────────────────

describe('Quiver.resolve', () => {
	it('unqualified "memo" → "memo@1.1.0" (highest)', async () => {
		const quiver = await fromDir(SAMPLE_FIXTURE);
		expect(quiver.resolve('memo')).toBe('memo@1.1.0');
	});

	it('"memo@1" → invalid_ref, though the quiver holds 1.0.0 and 1.1.0', async () => {
		const quiver = await fromDir(SAMPLE_FIXTURE);
		expect(quiver.versionsOf('memo')).toEqual(['1.1.0', '1.0.0']);
		expect(() => quiver.resolve('memo@1')).toThrow(
			expect.objectContaining({ code: 'invalid_ref' })
		);
		await expect(quiver.getQuill('memo@1')).rejects.toThrow(
			expect.objectContaining({ code: 'invalid_ref' })
		);
	});

	it('"memo@1.0" → "memo@1.0.0" (highest 1.0.*)', async () => {
		const quiver = await fromDir(SAMPLE_FIXTURE);
		expect(quiver.resolve('memo@1.0')).toBe('memo@1.0.0');
	});

	it('"memo@1.0.0" → "memo@1.0.0" (exact)', async () => {
		const quiver = await fromDir(SAMPLE_FIXTURE);
		expect(quiver.resolve('memo@1.0.0')).toBe('memo@1.0.0');
	});

	it('"sample.memo@1.0" names this quiver → "memo@1.0.0"', async () => {
		const quiver = await fromDir(SAMPLE_FIXTURE);
		expect(quiver.resolve('sample.memo@1.0')).toBe('memo@1.0.0');
	});

	it('"other.memo" names another collection → quill_not_found', async () => {
		const quiver = await fromDir(SAMPLE_FIXTURE);
		expect(() => quiver.resolve('other.memo')).toThrow(
			expect.objectContaining({ code: 'quill_not_found' })
		);
	});

	it('"memo@2.0.0" (not present) → quill_not_found', async () => {
		const quiver = await fromDir(SAMPLE_FIXTURE);
		expect(() => quiver.resolve('memo@2.0.0')).toThrow(
			expect.objectContaining({ code: 'quill_not_found' })
		);
	});

	it('"memo@^1" → invalid_ref (from parseQuillRef)', async () => {
		const quiver = await fromDir(SAMPLE_FIXTURE);
		expect(() => quiver.resolve('memo@^1')).toThrow(
			expect.objectContaining({ code: 'invalid_ref' })
		);
	});

	it('unknown name → quill_not_found', async () => {
		const quiver = await fromDir(SAMPLE_FIXTURE);
		expect(() => quiver.resolve('nonexistent')).toThrow(
			expect.objectContaining({ code: 'quill_not_found' })
		);
	});
});

// ─── getQuill ─────────────────────────────────────────────────────────────────

describe('Quiver.getQuill', () => {
	// `getQuill` builds quills via the engine-free `Quill.fromTree`; stub it so
	// these tests don't depend on the real WASM validator.
	let stub: ReturnType<typeof mockQuillFromTree> | undefined;
	afterEach(() => {
		stub?.restore();
		stub = undefined;
	});

	it('selector ref resolves and returns a quill', async () => {
		const quiver = await fromDir(SAMPLE_FIXTURE);
		stub = mockQuillFromTree();

		const a = await quiver.getQuill('memo');
		const b = await quiver.getQuill('memo@1.1.0');

		// Both resolve to memo@1.1.0 → identical cached instance.
		expect(a).toBe(b);
	});

	it('concurrent calls for same ref coalesce into one Quill.fromTree call', async () => {
		const quiver = await fromDir(SAMPLE_FIXTURE);
		stub = mockQuillFromTree();

		const [a, b] = await Promise.all([
			quiver.getQuill('memo@1.0.0'),
			quiver.getQuill('memo@1.0.0')
		]);

		expect(a).toBe(b);
		expect(stub.calls).toHaveLength(1);
	});
});

// ─── the counting loader ──────────────────────────────────────────────────────

/** Builds a Quiver wired to a counting loader. Lets us assert tree-fetch counts. */
function makeCountingQuiver(opts: { name: string; catalog: Map<string, string[]> }): {
	quiver: Quiver;
	loaderCalls: () => number;
} {
	let calls = 0;
	const loader = {
		async loadTree(_name: string, _version: string) {
			calls++;
			return new Map<string, Uint8Array>([
				['Quill.yaml', new TextEncoder().encode('name: stub\n')]
			]);
		}
	};
	const quiver = createQuiver(opts.name, undefined, opts.catalog, loader);
	return { quiver, loaderCalls: () => calls };
}

// ─── quill cache lifecycle ───────────────────────────────────────────────────

describe('Quiver quill cache lifecycle', () => {
	// The quill cache is keyed by ref (not engine): `Quill.fromTree` is engine-free,
	// so one quill per ref is shared. It is the one cache — a tree is held only for
	// the length of the materialization that consumes it.
	let stub: ReturnType<typeof mockQuillFromTree> | undefined;
	afterEach(() => {
		stub?.restore();
		stub = undefined;
	});

	it('repeated getQuill returns the same instance, fetched and built once', async () => {
		const { quiver, loaderCalls } = makeCountingQuiver({
			name: 'test',
			catalog: new Map([['memo', ['1.0.0']]])
		});
		stub = mockQuillFromTree();

		const a = await quiver.getQuill('memo@1.0.0');
		const b = await quiver.getQuill('memo@1.0.0');

		expect(b).toBe(a);
		expect(loaderCalls()).toBe(1);
		expect(stub.calls).toHaveLength(1);
	});

	it('a retry after Quill.fromTree throws refetches the tree', async () => {
		const { quiver, loaderCalls } = makeCountingQuiver({
			name: 'test',
			catalog: new Map([['memo', ['1.0.0']]])
		});
		stub = mockQuillFromTree();
		let fromTreeCalls = 0;
		stub.spy.mockImplementation(() => {
			fromTreeCalls++;
			if (fromTreeCalls === 1) throw new Error('boom');
			return { seedDocument: () => ({}) } as unknown as never;
		});

		await expect(quiver.getQuill('memo@1.0.0')).rejects.toThrow('boom');

		const quill = await quiver.getQuill('memo@1.0.0');
		expect(quill).toBeDefined();
		// The tree goes with the failed materialization: a broken quill is not a
		// path worth a second cache to spare a round-trip on.
		expect(loaderCalls()).toBe(2);
		expect(fromTreeCalls).toBe(2);
	});
});
