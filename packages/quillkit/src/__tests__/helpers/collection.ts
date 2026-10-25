/**
 * A consumer's quiver, on disk: the reference quiver copied somewhere writable, outside this
 * workspace. quillkit carries the packer and the engine itself (QUILLKIT §"One pin"), so the
 * copy installs nothing beside it.
 */

import { cp, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('../../../../../fixtures', import.meta.url));

export interface Scratch {
	/** A fresh temp directory, tracked for cleanup. */
	dir(): Promise<string>;
	/** A copy of the reference quiver. */
	collection(): Promise<string>;
	/** Remove everything handed out. */
	cleanup(): Promise<void>;
}

export function scratch(prefix: string): Scratch {
	const made: string[] = [];

	const dir = async (): Promise<string> => {
		const at = await mkdtemp(join(tmpdir(), prefix));
		made.push(at);
		return at;
	};

	return {
		dir,
		async collection() {
			const at = join(await dir(), 'collection');
			await cp(FIXTURES, at, { recursive: true });
			return at;
		},
		async cleanup() {
			for (const at of made.splice(0)) await rm(at, { recursive: true, force: true });
		}
	};
}
