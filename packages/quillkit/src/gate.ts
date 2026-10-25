/**
 * `check`, the gate: every quill's seed renders, and so does its root `example.md` where it
 * ships one, through the wasm this package carries, which is the wasm every deployed client
 * renders through (QUILLKIT §"One pin"). With an `App.yaml` beside the quiver, the app it
 * describes resolves too.
 *
 * The only door onto the verdict, so an author on vitest, jest or another runner spawns
 * the bin (`execFileSync('quillkit', ['check'])`) rather than rebuilding the loop.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Document, Quill } from '@quillmark/wasm';
import { fromDir } from '@quillmark/quiver/node';
import { APP_YAML, prepareApp } from './app-files.js';

export interface Verdict {
	pass: number;
	fail: number;
}

/** An error's own words, with its cause's indented beneath. */
export function message(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	return err.cause == null ? err.message : `${err.message}\n  ${message(err.cause)}`;
}

export async function gate(root: string, { drafts }: { drafts: boolean }): Promise<Verdict> {
	// Loaded here rather than at the top of the bin: `check` is the verb that renders.
	const { init, Engine } = await import('@quillmark/wasm');
	const { formatDiagnostic } = await init();
	const engine = new Engine();
	const quiver = await fromDir(root);

	const names = quiver.quillNames();
	if (names.length === 0) throw new Error('quiver has no quills');

	const verdict: Verdict = { pass: 0, fail: 0 };

	async function tally(what: string, run: () => Promise<string>): Promise<void> {
		try {
			console.log(`pass  ${what} (${await run()})`);
			verdict.pass++;
		} catch (err) {
			console.error(`FAIL  ${what} — ${message(err)}`);
			verdict.fail++;
		}
	}

	function assertClean(quill: Quill, doc: Document, what: string): void {
		const said = [...doc.warnings, ...quill.validate(doc)];
		if (said.length > 0)
			throw new Error(`${what}: ${said.map((d) => formatDiagnostic(d)).join('\n')}`);
	}

	async function renders(quill: Quill, doc: Document, what: string): Promise<void> {
		const result: { artifacts?: unknown[] } = await engine.render(quill, doc);
		if (!Array.isArray(result.artifacts) || result.artifacts.length === 0)
			throw new Error(`${what} render produced no artifacts`);
	}

	for (const name of names) {
		for (const version of quiver.versionsOf(name)) {
			const ref = `${name}@${version}`;
			await tally(ref, async () => {
				const quill = await quiver.getQuill(ref);
				const docs: [string, Document][] = [['seed', quill.seedDocument()]];
				try {
					const example = quill.exampleDocument();
					if (example) {
						docs.push(['example', example]);
						assertClean(quill, example, 'example');
					}
					for (const [what, doc] of docs) await renders(quill, doc, what);
				} finally {
					for (const [, doc] of docs) doc.free();
				}
				return docs.map(([what]) => what).join(', ');
			});
		}
	}

	if (existsSync(join(root, APP_YAML)))
		await tally(APP_YAML, async () => {
			const { app } = await prepareApp(root, quiver, drafts);
			return app.quills.map((q) => q.ref).join(', ');
		});

	return verdict;
}
