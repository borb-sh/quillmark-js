/**
 * The repack trigger: what counts as a source change, and how many changes one repack
 * answers. The pack is quiver's `build`, which lands whole (QUIVER §"The generation lands whole").
 */

import { watch } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { within } from './paths.js';

/** One repack per settled burst: an editor's save arrives as several watcher events. */
export const SETTLE_MS = 80;

/** Call `fn` once a burst of calls stops arriving. `cancel` drops a call still waiting,
 *  which would otherwise run after teardown and hold the event loop open. */
export interface Settled {
	(): void;
	cancel(): void;
}

export function settle(ms: number, fn: () => void): Settled {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const fire: Settled = () => {
		clearTimeout(timer);
		timer = setTimeout(fn, ms);
	};
	fire.cancel = () => {
		clearTimeout(timer);
		timer = undefined;
	};
	return fire;
}

interface Watcher {
	close(): void;
}

/**
 * Watch a collection's source and call `onChange` once each burst settles.
 *
 * The pack's own output is filtered out, or a watcher seeing its own writes would repack
 * forever. `node_modules` and `.git` are excluded outright.
 */
export function watchCollection(
	collection: string,
	ignored: string[],
	onChange: () => void
): Watcher {
	const root = resolve(collection);
	const excluded = ignored.map((path) => resolve(path));

	const isOwnWrite = (path: string): boolean => {
		const abs = resolve(root, path);
		// Segments below the root, not of the absolute path: a collection installed at
		// `node_modules/@scope/quills` is its own root, and every file under it would
		// otherwise read as the output a pack writes.
		const rel = relative(root, abs);
		if (rel.split(sep).some((part) => part === 'node_modules' || part === '.git')) return true;
		return excluded.some((at) => within(at, abs));
	};

	const fire = settle(SETTLE_MS, onChange);
	const watcher = watch(root, { recursive: true }, (_event, filename) => {
		// A null filename carries no path to filter on, so it counts as a change.
		if (filename === null || !isOwnWrite(filename)) fire();
	});
	// Unregister before cancelling, or the watcher can re-arm the timer.
	return {
		close: () => {
			watcher.close();
			fire.cancel();
		}
	};
}

/**
 * Run `job` one at a time, chaining onto a settled queue whichever way the last one
 * went. `build` owns its output directory, so two overlapping packs would race over one
 * tree; and a rejected link left in the chain would answer every later pack with the
 * first failure instead of running it, which a quiver mid-edit reaches on the first
 * half-written `Quill.yaml`.
 */
export function serialize(job: () => Promise<void>): () => Promise<void> {
	let queue: Promise<void> = Promise.resolve();
	return () => (queue = queue.then(job, job));
}
