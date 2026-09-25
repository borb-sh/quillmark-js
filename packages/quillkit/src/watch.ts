/**
 * The repack trigger: what counts as a source change, and how many changes one repack
 * answers. The pack itself is quiver's `build`, which replaces its file whole
 * (QUIVER §"The file is replaced whole"), so nothing here needs to know a client is
 * reading the file it writes.
 */

import { watch } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { within } from './paths.js';

/** One repack per settled burst: an editor's save arrives as several watcher events. */
const SETTLE_MS = 80;

/** Call `fn` once a burst of calls stops arriving. `cancel` drops a call still
 *  waiting: a teardown that only unregisters leaves the scheduled half to run
 *  (`core/teardown.ts`), and it holds the event loop open until it does. */
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

export interface Watcher {
	close(): void;
}

/**
 * Watch a collection's source and call `onChange` once each burst settles.
 *
 * The pack's own output is filtered out: the default output lives under the collection's
 * `node_modules`, so a watcher seeing its own writes would repack forever. That
 * directory and `.git` are excluded outright, a quiver's authored source being in
 * neither.
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
		// A null filename carries no path to filter on, so it counts as a change: missing
		// a real edit costs an author the repack they asked for.
		if (filename === null || !isOwnWrite(filename)) fire();
	});
	// Unregister, then cancel, in that order (`core/teardown.ts`): cancelling first
	// leaves a watcher that can re-arm the timer.
	return {
		close: () => {
			watcher.close();
			fire.cancel();
		}
	};
}

/**
 * Run `job` one at a time, chaining onto a settled queue whichever way the last one
 * went. Two overlapping packs of one source land in whichever order they finish rather
 * than the order they started; and a rejected link left in the chain would answer every later pack with the
 * first failure instead of running it, which a quiver mid-edit reaches on the first
 * half-written `Quill.yaml`.
 */
export function serialize(job: () => Promise<void>): () => Promise<void> {
	let queue: Promise<void> = Promise.resolve();
	return () => (queue = queue.then(job, job));
}
