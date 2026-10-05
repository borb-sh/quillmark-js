// The dependency law, enforced. In a workspace a quiver↔svelte edge is one relative path
// away, so the separation is held by a gate rather than by distance. Zero deps; run via
// `npm run check:deps`.
//
// Five rules:
//
//   1. The graph. `@quillmark/wasm` is external and above everything; `svelte` and `quiver`
//      are siblings at one tier with no edge between them, in either direction; and a node
//      reaching both is composing them, which is the only way the two meet. Declared
//      dependencies and source specifiers both, since either alone is half a check: an
//      undeclared import resolves fine in a workspace, and a declared dependency nothing
//      imports is still a promise.
//
//   2. One wasm per process. A handle minted by one copy of the linear memory and handed
//      to another is foreign, so what matters is how many copies meet inside one process. A
//      package a consumer can import puts its copy in the importer's process, so it peers
//      the artifact and never depends on it, at a single `>=` comparator (loose, until 1.0
//      makes a narrow one honest); root `overrides` pins the developed-against version to
//      exactly one, loose ranges permitting two installs rather than preventing them. A
//      package with no importable entry is a bundled terminal: nothing imports it, so the
//      copy it bundles meets no other, and what its manifest may hold is review's.
//
//   3. `/preview` stays free of editor weight, which is what makes the subpath claim ("a
//      bundler pulls only what the imported entry reaches") true for the one surface whose
//      audience is not editing. Held at the subpath's edge rather than by walking the graph:
//      preview reaches its own directory and the shared modules in `core/`, and one relative
//      hop further — `../core/codec` — pulls all of ProseMirror.
//
//   4. The lock's platforms. The lock resolves every platform an optional dependency
//      offers, not the one that wrote it: a lock missing `@rolldown/binding-darwin-arm64`
//      installs a rolldown with no native binary on a Mac, and npm repairs nothing. CI runs
//      one platform and the lock is platform-free data, so this is the only place the
//      breach is visible before a contributor's install fails.
//
//   5. The substrate entries carry no sheet. `/core` and the root are reached where there is
//      no document, a worker's `init` or a server's, and a dev server serves a side-effect
//      stylesheet (or a component's `<style>`) as a module that writes into one. A built
//      consumer extracts the sheet, so only the source graph shows the breach.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ROOT, filesUnder, packages, report } from './workspace.mjs';

/** The graph. An edge absent from this table is a violation; an edge in it is optional. */
const ALLOWED = {
	playground: ['@quillmark/svelte', '@quillmark/quiver'],
	quillkit: ['@quillmark/svelte', '@quillmark/quiver'],
	'@quillmark/svelte': [],
	'@quillmark/quiver': []
};

const WASM = '@quillmark/wasm';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const errors = [];
const fail = (msg) => errors.push(msg);

const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const PACKAGES = packages();
const names = PACKAGES.map((p) => p.json.name);

/** Every import/export-from/dynamic-import specifier in an ESM/Svelte source. */
function specifiersOf(file) {
	const src = readFileSync(file, 'utf8');
	return [
		/\bimport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
		/\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
		/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
		/\bimport\s*['"]([^'"]+)['"]/g
	].flatMap((re) => [...src.matchAll(re)].map((m) => m[1]));
}

/** Every source under `dir`, tests included, build output skipped. A stylesheet's `@import`
 *  is a specifier too, so a sheet reaching a forbidden module is seen. */
const sources = (dir) => filesUnder(dir, /\.(ts|js|svelte|css)$/, { names: ['dist', 'build'] });

// ── 1. The graph ────────────────────────────────────────────────────────────────

for (const { dir, json } of PACKAGES) {
	const allowed = ALLOWED[json.name];
	if (!allowed) {
		fail(
			`packages/${dir}: \`${json.name}\` is not in the dependency law — state its edges in check-deps.mjs`
		);
		continue;
	}
	for (const field of DEP_FIELDS)
		for (const dep of Object.keys(json[field] ?? {}))
			if (names.includes(dep) && !allowed.includes(dep))
				fail(
					`packages/${dir}/package.json: \`${field}.${dep}\` — \`${json.name}\` has no edge to \`${dep}\``
				);
}

const packageOf = (spec) => names.find((n) => spec === n || spec.startsWith(`${n}/`)) ?? null;

for (const { at, json } of PACKAGES) {
	const allowed = ALLOWED[json.name] ?? [];
	for (const file of sources(at))
		for (const spec of specifiersOf(file)) {
			const dep = packageOf(spec);
			if (dep && dep !== json.name && !allowed.includes(dep))
				fail(
					`${relative(ROOT, file)}: imports "${spec}" — \`${json.name}\` has no edge to \`${dep}\``
				);
		}
}

// ── 2. One wasm per process ─────────────────────────────────────────────────────

const pin = root.overrides?.[WASM];
if (!pin)
	fail(
		`package.json: root \`overrides.${WASM}\` is unset — the developed-against version is pinned there`
	);
else if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pin))
	fail(`package.json: \`overrides.${WASM}\` is \`${pin}\` — pin exactly one version, not a range`);

/** `>=1.2.3-0` → `[1, 2, 3]`, or null if the range is not a single `>=` comparator. */
const floorOf = (range) => {
	const m = /^>=\s*(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$/.exec(range.trim());
	return m ? [+m[1], +m[2], +m[3]] : null;
};
/** Lexicographic, not per-position: `0.99.0` is above the floor `0.98.5`. */
const below = (a, b) => {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
	return false;
};

/** What a consumer can import: a bare `main`, or an exports map with a module subpath in
 *  it. An empty map is the seal rather than an omission, and `./package.json` publishes a
 *  location rather than a module; neither is a `bin`, an executable being a process that
 *  hands out no handles. */
const importable = (json) =>
	json.main !== undefined ||
	Object.keys(json.exports ?? {}).some((path) => path !== './package.json');

for (const { dir, json } of PACKAGES) {
	if (json.private || !importable(json)) continue;
	for (const f of DEP_FIELDS)
		if (f !== 'peerDependencies' && json[f]?.[WASM])
			fail(
				`packages/${dir}/package.json: \`${f}.${WASM}\` — the artifact is peered, never depended on`
			);
	const range = json.peerDependencies?.[WASM];
	if (!range) {
		fail(
			`packages/${dir}/package.json: \`${WASM}\` is not peered — every published package claims a range`
		);
		continue;
	}
	const floor = floorOf(range);
	if (!floor)
		fail(
			`packages/${dir}/package.json: \`peerDependencies.${WASM}\` is \`${range}\` — the range is loose until wasm 1.0, one \`>=\` comparator`
		);
	else if (pin && below(pin.split('-')[0].split('.').map(Number), floor))
		fail(
			`packages/${dir}/package.json: the root pin \`${pin}\` is below this package's floor \`${range}\``
		);
}

// ── 3. The /preview subpath ─────────────────────────────────────────────────────

const LIB = join(ROOT, 'packages', 'svelte', 'src', 'lib');
const SELF = '@quillmark/svelte';
/** The subpaths a viewer may reach. Every other subpath svelte exports is editor-side and
 *  forbidden, derived rather than listed so a new editing surface is forbidden the moment
 *  it is exported. */
const NEUTRAL = new Set(['.', './core', './preview']);
const svelteExports = PACKAGES.find((p) => p.json.name === SELF)?.json.exports ?? {};
const editorSide = Object.keys(svelteExports)
	.filter((k) => !NEUTRAL.has(k))
	.map((k) => k.replace(/^\.\//, ''));
/** ProseMirror is the weight itself; the editing subpaths are editor-side whether or not
 *  they carry weight of their own. */
const FORBIDDEN = new RegExp(`^(prosemirror-|${SELF}/(${editorSide.join('|')}))`);
/** What preview may reach by relative path: its own directory, and a module directly in
 *  `core/`. `../core/codec/…` is one hop further and pulls all of ProseMirror. */
const REACHES = /^\.\/|^\.\.\/core\/[\w.-]+$/;

let held = 0;
for (const file of sources(join(LIB, 'preview'))) {
	held++;
	for (const spec of specifiersOf(file))
		if (FORBIDDEN.test(spec) || (spec.startsWith('.') && !REACHES.test(spec)))
			fail(`${relative(ROOT, file)}: imports "${spec}" — /preview stays free of editor weight`);
}

// ── 4. The lock's platforms ─────────────────────────────────────────────────────

const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
// A dependency resolves against the entry nearest its own path, so an optional dep is
// present if ANY entry ends in `node_modules/<name>`. Names only: which one an install
// picks is npm's business, and this rule is about the set being whole.
const resolved = new Set(
	Object.keys(lock.packages ?? {}).map((path) => path.split('node_modules/').pop())
);
let optionals = 0;
for (const [path, entry] of Object.entries(lock.packages ?? {}))
	for (const name of Object.keys(entry.optionalDependencies ?? {})) {
		optionals++;
		if (!resolved.has(name))
			fail(
				`package-lock.json: \`${path || '.'}\` names optional \`${name}\` with no entry — the lock was pruned to one platform; delete it and resolve it fresh`
			);
	}

// ── 5. The substrate entries ────────────────────────────────────────────────────

/** A relative specifier's source file: `./x.js` is authored as `x.ts`. */
const sourceOf = (from, spec) => {
	const target = resolve(dirname(from), spec);
	return [target, target.replace(/\.js$/, '.ts')].find((p) => existsSync(p)) ?? null;
};

const SUBSTRATE = [join(LIB, 'index.ts'), join(LIB, 'core', 'index.ts')];
const reached = new Set();
for (const entry of SUBSTRATE) {
	const queue = [entry];
	while (queue.length) {
		const file = queue.pop();
		if (reached.has(file)) continue;
		reached.add(file);
		if (/\.(css|svelte)$/.test(file)) {
			fail(
				`${relative(ROOT, file)}: reached from ${relative(ROOT, entry)} — a substrate entry carries no sheet`
			);
			continue;
		}
		for (const spec of specifiersOf(file)) {
			if (!spec.startsWith('.')) continue;
			const next = sourceOf(file, spec);
			if (next) queue.push(next);
			else fail(`${relative(ROOT, file)}: imports "${spec}", which resolves to no source`);
		}
	}
}

report(
	'Dependency law check',
	errors,
	`Dependency law OK — ${PACKAGES.length} packages, ${WASM} pinned at ${pin}, /preview holds ${held} modules, the substrate entries reach ${reached.size}, lock resolves ${optionals} optionals.`
);
