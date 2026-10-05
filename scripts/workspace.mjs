// The workspace's shape, for the gates that read it: where the root is, what the
// packages are, where canon lives, and how a gate reports. Stated once, so three
// scripts cannot disagree about the answer.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every workspace package, sorted by directory: `{ dir, at, json }`. `packages/*` is the
 *  root manifest's own workspace glob, so a directory there with no manifest is named
 *  rather than opened: the throw is otherwise a bare ENOENT from whichever gate read it
 *  first, which reads as a broken gate rather than as output written where packages go. */
export function packages() {
	return readdirSync(join(ROOT, 'packages'))
		.sort()
		.map((dir) => {
			const at = join(ROOT, 'packages', dir);
			if (!existsSync(join(at, 'package.json')))
				throw new Error(`packages/${dir}: no package.json — packages/ holds workspace packages`);
			return { dir, at, json: JSON.parse(readFileSync(join(at, 'package.json'), 'utf8')) };
		});
}

/** The installed `@quillmark/wasm`'s version, off its own manifest. The artifact
 *  publishes one entry and no `./package.json`, so the manifest is reached by walking
 *  up from the resolved entry to the first one that names the package — walked rather
 *  than a fixed `../`, so an entry a level deeper is found rather than answered for by
 *  whatever manifest sits above it. */
export function wasmVersion(root = ROOT) {
	const entry = createRequire(join(root, 'package.json')).resolve('@quillmark/wasm');
	for (let at = dirname(entry), up = dirname(at); ; at = up, up = dirname(at)) {
		const manifest = join(at, 'package.json');
		if (existsSync(manifest)) {
			const json = JSON.parse(readFileSync(manifest, 'utf8'));
			if (json.name === '@quillmark/wasm') return json.version;
		}
		if (up === at) break;
	}
	throw new Error(`@quillmark/wasm resolved to "${entry}" with no manifest of its own above it`);
}

/** Every file under `at` matching `ext`, sorted: `skip` names directories by path, `names`
 *  by name at any depth. A missing directory reads as empty — the caller says whether that
 *  is a finding. */
export function filesUnder(at, ext, { skip = [], names = [] } = {}) {
	const out = [];
	(function walk(dir) {
		if (!existsSync(dir) || skip.includes(dir)) return;
		for (const name of readdirSync(dir).sort()) {
			if (name === 'node_modules' || name.startsWith('.') || names.includes(name)) continue;
			const abs = join(dir, name);
			if (statSync(abs).isDirectory()) walk(abs);
			else if (ext.test(name)) out.push(abs);
		}
	})(at);
	return out;
}

/** A gate's verdict, in two severities. An error fails the run: a fault the diff cannot
 *  show — a pruned stylesheet, a dangling pointer, a rung that resolves to nothing — or a
 *  form a rule admitting no exception refuses, which review would only ever reject. A
 *  warning is a fault review can see and weigh for itself, printed so it stays visible and
 *  never blocking: the shape a rule takes while the thing it is about is still moving.
 *  Warnings print above the `ok` line, so a passing gate still says what it noticed. */
export function report(label, errors, ok, warnings = []) {
	for (const w of warnings) console.warn(`  ~ ${w}`);
	if (errors.length) {
		console.error(`${label} failed (${errors.length}):`);
		for (const e of errors) console.error(`  ✗ ${e}`);
		process.exit(1);
	}
	console.log(warnings.length ? `${ok} (${warnings.length} warned)` : ok);
}
