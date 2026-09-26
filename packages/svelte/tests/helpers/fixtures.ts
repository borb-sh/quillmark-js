// Node-side fixture loading for Vitest: walk a quill directory into the
// `Map<string, Uint8Array>` `Quill.fromTree` accepts. The playground reads the same
// tree through a built quiver over HTTP; this is the filesystem twin, so a test
// builds the reference quill with no server and no pack step.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { init, type Document, type Quill } from '@quillmark/wasm';

const core = await init();

// `fixtures/` is the workspace's, not this package's: the playground reads the same
// tree, so it sits above both.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/**
 * The reference quiver's quills (dev fixtures, never published). `showcase` is the
 * workspace's own and is what a suite drives unless it says otherwise; `usaf_memo` is
 * a copy of a shipped quill, held at `0.0.0` (fixtures/Quiver.yaml).
 */
const ROOTS = {
	showcase: join(REPO_ROOT, 'fixtures', 'quills', 'showcase', '1.0.0'),
	usaf_memo: join(REPO_ROOT, 'fixtures', 'quills', 'usaf_memo', '0.0.0')
} as const;

/** Which fixture quill: the default is `showcase` everywhere it is not named. */
export type FixtureName = keyof typeof ROOTS;

/**
 * A fixture quill's tree, keyed by `"/"`-joined paths relative to its root; binary
 * bytes intact (the fonts, the letterhead mark and the seals are read as raw
 * `Uint8Array`, never decoded). The version directory is quill content throughout,
 * so there is nothing here to skip.
 */
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
 * A fixture quill, parsed once per worker. `Quill.fromTree` re-parses the whole
 * fixture tree, and a suite only ever reads its schema or opens fresh documents off
 * it; so the handle is shared and never freed, rather than each suite keeping its own
 * copy of this cache.
 */
const cached = new Map<FixtureName, Quill>();
export function quill(name: FixtureName = 'showcase'): Quill {
	let held = cached.get(name);
	if (!held) cached.set(name, (held = core.Quill.fromTree(loadFixtureTree(name))));
	return held;
}

/**
 * A fixture quill's template document, `fixtures/templates/<name>.md`, parsed and
 * conformed against it: every field and body filled, which a seed leaves empty. A
 * fresh `Document` per call, the caller's to free.
 */
export function template(name: FixtureName = 'showcase'): Document {
	const md = readFileSync(join(REPO_ROOT, 'fixtures', 'templates', `${name}.md`), 'utf8');
	return quill(name).parse(md);
}
