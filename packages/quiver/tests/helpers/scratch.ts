import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Scratch {
	/** A fresh temp directory, tracked for cleanup. */
	dir(): Promise<string>;
	/** Remove everything handed out. */
	cleanup(): Promise<void>;
}

export function scratch(prefix: string): Scratch {
	const made: string[] = [];
	return {
		async dir() {
			const at = await mkdtemp(join(tmpdir(), prefix));
			made.push(at);
			return at;
		},
		async cleanup() {
			for (const at of made.splice(0)) await rm(at, { recursive: true, force: true });
		}
	};
}
