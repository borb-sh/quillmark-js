// Node-side fixture loading for Vitest: walk a quill directory into the `Map<string, Uint8Array>`
// `Quill.fromTree` accepts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { init, type Document, type Quill } from '@quillmark/wasm';

/** The core surface, for the classes and free functions `init` is the only door to. */
export const core = await init();

// `fixtures/` is the workspace's, shared with the playground.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/**
 * The reference quiver's quills (fixtures/Quiver.yaml). `showcase` is the default; `usaf_memo` is a
 * copy of a shipped quill.
 */
const ROOTS = {
	showcase: join(REPO_ROOT, 'fixtures', 'quills', 'showcase', '1.0.0'),
	usaf_memo: join(REPO_ROOT, 'fixtures', 'quills', 'usaf_memo', '0.0.0')
} as const;

export type FixtureName = keyof typeof ROOTS;

/** A fixture quill's tree, keyed by `"/"`-joined paths relative to its root, bytes undecoded. */
export function loadFixtureTree(name: FixtureName = 'showcase'): Map<string, Uint8Array> {
	const root = ROOTS[name];
	const tree = new Map<string, Uint8Array>();
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			const abs = join(dir, entry);
			if (statSync(abs).isDirectory()) {
				walk(abs);
			} else {
				tree.set(relative(root, abs).split(sep).join('/'), new Uint8Array(readFileSync(abs)));
			}
		}
	};
	walk(root);
	return tree;
}

/**
 * A fixture quill, parsed once per worker and never freed: suites only read its schema or open
 * documents off it.
 */
const cached = new Map<FixtureName, Quill>();
export function quill(name: FixtureName = 'showcase'): Quill {
	let held = cached.get(name);
	if (!held) cached.set(name, (held = core.Quill.fromTree(loadFixtureTree(name))));
	return held;
}

/**
 * A fixture quill's example document, every field and body filled. A fresh `Document` per call, the
 * caller's to free.
 */
export function example(name: FixtureName = 'showcase'): Document {
	const doc = quill(name).exampleDocument();
	if (!doc) throw new Error(`fixture quill ${name} ships no example.md`);
	return doc;
}

/**
 * A quill of its `Quill.yaml` alone over a one-line plate, for a field shape the reference quill
 * lacks. Fresh per call. Bytes are re-wrapped in this realm's `Uint8Array` because under jsdom the
 * encoder's output is from another realm and the boundary refuses it.
 */
export function quillFromYaml(yaml: string): Quill {
	const bytes = (s: string): Uint8Array => new Uint8Array(new TextEncoder().encode(s));
	return core.Quill.fromTree(
		new Map([
			['Quill.yaml', bytes(yaml)],
			['plate.typ', bytes('#set page(width: 200pt)\n')]
		])
	);
}
