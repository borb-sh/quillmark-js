/**
 * A consumer's collection, on disk: the reference quiver copied somewhere writable,
 * with `@quillmark/*` resolvable from its own tree.
 *
 * That last part is the point rather than setup noise. quillkit ships no runtime
 * dependencies and resolves the packer and the engine out of the collection, so a
 * fixture that happened to sit inside this workspace would resolve through the
 * workspace's `node_modules` and prove nothing about a consumer's.
 */

import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('../../../../../fixtures', import.meta.url));
const WORKSPACE_MODULES = fileURLToPath(new URL('../../../../../node_modules', import.meta.url));

export interface Scratch {
	/** A fresh temp directory, tracked for cleanup. */
	dir(): Promise<string>;
	/** A copy of the reference quiver with the toolchain's peers installed beside it. */
	collection(): Promise<string>;
	/** The toolchain's peers installed into a collection laid elsewhere. */
	peers(at: string): Promise<void>;
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

	const peers = async (at: string): Promise<void> => {
		await mkdir(join(at, 'node_modules'), { recursive: true });
		await symlink(join(WORKSPACE_MODULES, '@quillmark'), join(at, 'node_modules', '@quillmark'));
	};

	return {
		dir,
		peers,
		async collection() {
			const at = join(await dir(), 'collection');
			await cp(FIXTURES, at, { recursive: true });
			await peers(at);
			return at;
		},
		async cleanup() {
			for (const at of made.splice(0)) await rm(at, { recursive: true, force: true });
		}
	};
}
