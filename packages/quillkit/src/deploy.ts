/**
 * `build`: a target laid out for a static host. Every target lays the whole packed quiver
 * at `quiver/`; `studio` and `app` lay their client at the root beside it, which is where
 * each client looks (`document.baseURI`), and `app` lays `app.json` and the author's files
 * too (QUILLKIT §"The deploy layout").
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build as pack, fromDir } from '@quillmark/quiver/node';
import { prepareApp, writeApp } from './app-files.js';
import { APP, STUDIO, within } from './paths.js';

export const TARGETS = ['quiver', 'studio', 'app'] as const;
export type Target = (typeof TARGETS)[number];

/** The client each target lays at the root; the quiver target lays none. */
export const CLIENTS: Record<Target, string | undefined> = {
	quiver: undefined,
	studio: STUDIO,
	app: APP
};

/** What every verb takes where no target is named. */
export const DEFAULT_TARGET: Target = 'studio';

/** `word` as a target, the default where there is none, or a refusal naming them all. */
export function targetOf(word: string | undefined, verb: string): Target {
	if (word === undefined) return DEFAULT_TARGET;
	if ((TARGETS as readonly string[]).includes(word)) return word as Target;
	throw new Error(`quillkit ${verb} has no target "${word}": ${TARGETS.join(', ')}`);
}

export interface LayOptions {
	target: Target;
	/** The quiver: `Quiver.yaml` at its root. */
	root: string;
	/** The deploy's root, owned outright: cleared before it is written. */
	out: string;
	/** Pack the draft space too (QUIVER §"The draft floor"). */
	drafts?: boolean;
	/** Defaults to the client the target ships, which is the only one a verb lays. What this
	 *  is for is the suite, which asserts the layout over a stub rather than waiting on a
	 *  Vite build to prove a copy. */
	client?: string;
}

/**
 * The out is cleared before it is written, so an out that is or contains the quiver or the
 * working directory deletes what is being laid out. An out nested inside the quiver stays
 * allowed: `dist/` under the quiver root is the ordinary layout, and nothing of the source
 * is read after the clear.
 */
export function assertSafeOut(root: string, out: string): void {
	const at = resolve(out);
	const what = within(at, resolve(root))
		? 'the quiver'
		: within(at, process.cwd())
			? 'the working directory'
			: undefined;
	if (what !== undefined)
		throw new Error(
			`Refusing to build into "${out}": a build clears its output, and this one holds ${what} ("${at}"). Point --out at a directory the deploy owns.`
		);
}

/** A client carrying a `quiver/` of its own would shadow the laid one at the same URL. */
export function assertClient(dist: string): void {
	if (!existsSync(join(dist, 'index.html')))
		throw new Error(`No client at ${dist}: quillkit carries one beside its bin`);
	if (existsSync(join(dist, 'quiver')))
		throw new Error(
			`${dist}/quiver exists: a client carries no quiver, and it would shadow the deploy's`
		);
}

/** Returns the deploy's root, resolved, and what the build has to say about it. */
export async function layOut({
	target,
	root,
	out,
	drafts = false,
	client = CLIENTS[target]
}: LayOptions): Promise<{ at: string; warnings: string[] }> {
	assertSafeOut(root, out);
	if (client !== undefined) assertClient(client);
	const at = resolve(out);
	const prepared =
		target === 'app' ? await prepareApp(root, await fromDir(root), drafts) : undefined;
	// Packed beside the out and moved in after the clear, so a quiver the packer refuses
	// leaves the last deploy standing.
	const packed = `${at}.quiver`;
	await pack(root, packed, { drafts });

	try {
		await rm(at, { recursive: true, force: true });
		await mkdir(at, { recursive: true });
		if (client !== undefined) await cp(client, at, { recursive: true });
		await rename(packed, join(at, 'quiver'));
		if (prepared) await writeApp(prepared, root, at);
	} finally {
		await rm(packed, { recursive: true, force: true });
	}
	return { at, warnings: prepared?.warnings ?? [] };
}
