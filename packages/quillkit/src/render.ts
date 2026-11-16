/**
 * `render`, the look step: one quill's seed, example or a markdown document, rendered through
 * the engine and fonts `check` renders through, to a PDF or one PNG per page.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { Diagnostic, Document, Quill } from '@quillmark/wasm';
import { loadSuite } from '@quillmark/fonts/node';
import { fromDir } from '@quillmark/quiver/node';

/** Which document is rendered: the quill's own, or a markdown file's. */
export type Source = { kind: 'seed' } | { kind: 'example' } | { kind: 'file'; path: string };

export interface Rendered {
	/** The files written, in page order. */
	files: string[];
	/** The document's own warnings, then the render's, each printed whole. */
	warnings: string[];
	/** What was rendered: `seed`, `example` or the file's path. */
	what: string;
}

export async function render(
	root: string,
	ref: string,
	{ source, png, out }: { source: Source | undefined; png: boolean; out: string }
): Promise<Rendered> {
	const { init, Engine, isQuillmarkError } = await import('@quillmark/wasm');
	const { formatDiagnostic } = await init();
	const quiver = await fromDir(root);
	const quill = await quiver.getQuill(ref);

	const { doc, what, stem } = await documentOf(quill, ref, source);
	const said: Diagnostic[] = [...quill.warnings, ...doc.warnings];
	let artifacts: { bytes: Uint8Array }[];
	try {
		const engine = new Engine({ fonts: await loadSuite() });
		const result = await engine.render(quill, doc, { format: png ? 'png' : 'pdf' });
		artifacts = result.artifacts;
		said.push(...result.warnings);
	} catch (err) {
		if (!isQuillmarkError(err)) throw err;
		throw new Error(
			`${what} does not render\n${err.diagnostics.map((d) => formatDiagnostic(d)).join('\n')}`
		);
	} finally {
		doc.free();
	}
	if (artifacts.length === 0) throw new Error(`${what} render produced no artifacts`);

	const dir = resolve(out);
	await mkdir(dir, { recursive: true });
	const name = `${ref.split('@')[0]}-${stem}`;
	const files = png
		? artifacts.map((_, i) => join(dir, `${name}-${i + 1}.png`))
		: [join(dir, `${name}.pdf`)];
	await Promise.all(files.map((file, i) => writeFile(file, artifacts[i]!.bytes)));
	return { files, what, warnings: [...new Set(said.map((d) => formatDiagnostic(d)))] };
}

/** The document `source` names; with none, the example where the quill declares one, else
 *  the seed, as studio opens a quill (INVARIANTS §"The document is the blueprint's"). */
async function documentOf(
	quill: Quill,
	ref: string,
	source: Source | undefined
): Promise<{ doc: Document; what: string; stem: string }> {
	if (source?.kind === 'file') {
		const doc = quill.parse(await readFile(source.path, 'utf8'));
		return { doc, what: source.path, stem: basename(source.path, extname(source.path)) };
	}
	if (source?.kind !== 'seed') {
		const example = quill.exampleDocument();
		if (example) return { doc: example, what: 'example', stem: 'example' };
		if (source?.kind === 'example') throw new Error(`${ref} declares no example`);
	}
	return { doc: quill.seedDocument(), what: 'seed', stem: 'seed' };
}
