// A document with one thread on it, over the reference quill, and a clock a test pins.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, type Document, type Quill } from '@quillmark/wasm';

export const core = await init();

const ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
	'..',
	'fixtures',
	'quills',
	'showcase',
	'1.0.0'
);

let held: Quill | undefined;
export function quill(): Quill {
	if (held) return held;
	const tree = new Map<string, Uint8Array>();
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			const abs = join(dir, entry);
			if (statSync(abs).isDirectory()) walk(abs);
			else tree.set(relative(ROOT, abs).split(sep).join('/'), new Uint8Array(readFileSync(abs)));
		}
	};
	walk(ROOT);
	return (held = core.Quill.fromTree(tree));
}

export const MD =
	'~~~\n$quill: showcase\n~~~\n\nThe committee met on Monday to plan the launch.\n\nA second paragraph stands here.\n';

/** The body of `MD` with the anchor `id` over `met on Monday`. */
export function anchoredDoc(id = 't1'): Document {
	const doc = core.Document.fromMarkdown(MD);
	doc.applyChange(
		{},
		{ markOps: [{ op: 'add', start: 14, end: 27, type: 'anchor', attrs: { id } }] }
	);
	return doc;
}

/** A clock that ticks one second per read, so stamps are distinct and comparable. */
export function clock(): () => string {
	let t = Date.UTC(2026, 0, 1);
	return () => new Date((t += 1000)).toISOString();
}
