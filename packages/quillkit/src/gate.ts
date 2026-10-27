/**
 * `check`, the gate: every quill's seed renders, and so does its root `example.md` where it
 * ships one, through the wasm this package carries, which is the wasm every deployed client
 * renders through (QUILLKIT §"One pin"). With an `App.yaml` or an `app.css` beside the
 * quiver, the app they describe resolves too.
 *
 * The only door onto the verdict, so an author on vitest, jest or another runner spawns
 * the bin (`execFileSync('quillkit', ['check'])`) rather than rebuilding the loop.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic, Document, Quill } from '@quillmark/wasm';
import { fromDir } from '@quillmark/quiver/node';
import { APP_CSS, APP_YAML, prepareApp } from './app-files.js';

export interface Verdict {
	pass: number;
	fail: number;
}

/** An error's own words, with its cause's indented beneath. */
export function message(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	return err.cause == null ? err.message : `${err.message}\n  ${message(err.cause)}`;
}

const indent = (text: string): string => text.replace(/^/gm, '  ');

/** Diagnostics the gate holds against a document, shaped as a `QuillmarkError` so they
 *  print as one. */
class Diagnosed extends Error {
	constructor(readonly diagnostics: Diagnostic[]) {
		super(diagnostics[0]?.message);
	}
}

/** What a passing run covered, and the warnings it carried, each printed whole. */
interface Covered {
	what: string;
	warnings: string[];
}

export async function gate(
	root: string,
	{ drafts, strict }: { drafts: boolean; strict: boolean }
): Promise<Verdict> {
	// Loaded here rather than at the top of the bin: `check` is the verb that renders.
	const { init, Engine, isQuillmarkError } = await import('@quillmark/wasm');
	const { formatDiagnostic } = await init();
	const engine = new Engine();
	const quiver = await fromDir(root);

	const names = quiver.quillNames();
	if (names.length === 0) throw new Error('quiver has no quills');

	const verdict: Verdict = { pass: 0, fail: 0 };

	/** An error as the CLI prints it: each diagnostic whole, a cause indented beneath. */
	function explain(err: unknown): string {
		if (isQuillmarkError(err)) return err.diagnostics.map((d) => formatDiagnostic(d)).join('\n');
		if (!(err instanceof Error)) return String(err);
		return err.cause == null ? err.message : `${err.message}\n${indent(explain(err.cause))}`;
	}

	async function tally(what: string, run: () => Promise<Covered>): Promise<void> {
		let covered: Covered;
		try {
			covered = await run();
		} catch (err) {
			console.error(
				isQuillmarkError(err)
					? `FAIL  ${what}\n${indent(explain(err))}`
					: `FAIL  ${what} — ${explain(err)}`
			);
			verdict.fail++;
			return;
		}
		const warnings = [...new Set(covered.warnings)];
		if (strict && warnings.length > 0) {
			console.error(`FAIL  ${what} — warnings under --strict`);
			console.error(indent(warnings.join('\n')));
			verdict.fail++;
			return;
		}
		console.log(`pass  ${what} (${covered.what})`);
		if (warnings.length > 0) console.log(indent(warnings.join('\n')));
		verdict.pass++;
	}

	function assertClean(quill: Quill, doc: Document, what: string): void {
		const said = [...doc.warnings, ...quill.validate(doc)];
		if (said.length > 0) throw new Error(`${what} is not clean`, { cause: new Diagnosed(said) });
	}

	async function renders(quill: Quill, doc: Document, what: string): Promise<Diagnostic[]> {
		let result: { artifacts?: unknown[]; warnings: Diagnostic[] };
		try {
			result = await engine.render(quill, doc);
		} catch (err) {
			throw new Error(`${what} does not render`, { cause: err });
		}
		if (!Array.isArray(result.artifacts) || result.artifacts.length === 0)
			throw new Error(`${what} render produced no artifacts`);
		return result.warnings;
	}

	for (const name of names) {
		for (const version of quiver.versionsOf(name)) {
			const ref = `${name}@${version}`;
			await tally(ref, async () => {
				const quill = await quiver.getQuill(ref);
				const seed = quill.seedDocument();
				const docs: [string, Document][] = [['seed', seed]];
				const said: Diagnostic[] = [...quill.warnings, ...seed.warnings];
				try {
					let example: Document | undefined;
					try {
						example = quill.exampleDocument();
					} catch (err) {
						throw new Error('example does not open', { cause: err });
					}
					if (example) {
						docs.push(['example', example]);
						assertClean(quill, example, 'example');
					}
					for (const [what, doc] of docs) said.push(...(await renders(quill, doc, what)));
				} finally {
					for (const [, doc] of docs) doc.free();
				}
				return {
					what: docs.map(([what]) => what).join(', '),
					warnings: said.map((d) => formatDiagnostic(d))
				};
			});
		}
	}

	if ([APP_YAML, APP_CSS].some((name) => existsSync(join(root, name))))
		await tally('app', async () => {
			const { app, warnings } = await prepareApp(root, quiver, drafts);
			return {
				what: app.quills.map((q) => q.ref).join(', '),
				warnings: warnings.map((said) => `[WARN] ${said}`)
			};
		});

	return verdict;
}
