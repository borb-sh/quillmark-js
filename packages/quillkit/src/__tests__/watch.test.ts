/**
 * The repack trigger. The pack itself lands whole in quiver, so what is left here is
 * what provokes one: a burst of watcher events collapsed to a single repack, a
 * filter that keeps a pack from feeding itself, and a queue that survives a failure.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { within } from '../paths.js';
import { serialize, settle, watchCollection } from '../watch.js';
import { scratch } from './helpers/collection.js';

describe('the watch filter', () => {
	it('the output a pack writes is not a source change', () => {
		// The default output lives under the collection's `node_modules`, so a watcher
		// that saw its own writes would repack forever.
		expect(within('/c/node_modules/.quillkit/quiver', '/c/node_modules/.quillkit/quiver/x')).toBe(
			true
		);
		expect(within('/c/out', '/c/out')).toBe(true);
		expect(within('/c/out', '/c/quills/memo/1.0.0/Quill.yaml')).toBe(false);
		// A sibling whose name merely starts the same is outside it.
		expect(within('/c/out', '/c/outside/x')).toBe(false);
	});
});

describe('settle', () => {
	it('fires once for a burst', async () => {
		let calls = 0;
		const fire = settle(10, () => calls++);
		for (let i = 0; i < 5; i++) fire();
		await new Promise((ok) => setTimeout(ok, 40));
		expect(calls).toBe(1);
	});

	it('cancels the call still waiting', async () => {
		// A teardown that only unregisters leaves the scheduled half to run — in
		// `studio` a repack into a tree the caller is done with — and the timer holds
		// the process open until it does.
		let calls = 0;
		const fire = settle(10, () => calls++);
		fire();
		fire.cancel();
		await new Promise((ok) => setTimeout(ok, 40));
		expect(calls).toBe(0);
	});

	it('takes a burst again after a cancel', async () => {
		let calls = 0;
		const fire = settle(10, () => calls++);
		fire();
		fire.cancel();
		fire();
		await new Promise((ok) => setTimeout(ok, 40));
		expect(calls).toBe(1);
	});
});

describe('watchCollection', () => {
	const temp = scratch('quillkit-watch-');
	afterEach(() => temp.cleanup());

	it('close() ends the scheduled repack, not just the registration', async () => {
		const at = await temp.dir();
		let packs = 0;
		const watcher = watchCollection(at, [], () => packs++);
		await writeFile(join(at, 'Quiver.yaml'), 'name: w\n');
		// Inside the settle window, which is the whole of what `close` has to answer
		// for: the event has landed and the repack has not.
		await new Promise((ok) => setTimeout(ok, 10));
		watcher.close();
		await new Promise((ok) => setTimeout(ok, 200));
		expect(packs).toBe(0);
	});

	it('repacks a collection that itself lives under node_modules', async () => {
		// A quiver is consumed as a dependency, so `studio` is run against a root whose
		// own path holds the segment the filter refuses. Reading it there answers every
		// edit in the collection with silence.
		const at = join(await temp.dir(), 'node_modules', '@acme', 'quills');
		await mkdir(at, { recursive: true });
		let packs = 0;
		const watcher = watchCollection(at, [], () => packs++);
		await writeFile(join(at, 'Quiver.yaml'), 'name: w\n');
		await new Promise((ok) => setTimeout(ok, 300));
		watcher.close();
		expect(packs).toBe(1);
	});
});

describe('serialize', () => {
	it('runs one at a time, in order', async () => {
		const order: number[] = [];
		let n = 0;
		const run = serialize(async () => {
			const mine = ++n;
			await new Promise((ok) => setTimeout(ok, 10 - mine));
			order.push(mine);
		});

		await Promise.all([run(), run(), run()]);
		expect(order).toEqual([1, 2, 3]);
	});

	it('a failure does not end the queue', async () => {
		// A queue chaining onto its own result would answer every later call with the
		// first failure instead of running it, so one half-written `Quill.yaml` would
		// end the loop until the process restarts.
		let calls = 0;
		const run = serialize(async () => {
			if (++calls === 1) throw new Error('mid-edit');
		});

		await expect(run()).rejects.toThrow('mid-edit');
		await expect(run()).resolves.toBeUndefined();
		expect(calls).toBe(2);
	});
});
