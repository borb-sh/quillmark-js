#!/usr/bin/env node
/**
 * The quill author's toolchain, one bin over the whole loop: gate, pack, look at, ship.
 * `usage()` below is the spelling of every verb and its flags.
 *
 * One wasm at most lives in this process, and only `test` puts it there: the packer
 * instantiates nothing, and the client is static bytes served to a browser tab.
 */

import { join, resolve } from 'node:path';
import { loadEngine, loadQuiverNode } from '../collection.js';
import { CLIENT } from '../paths.js';
import { createStaticServer, listen, type Mount } from '../serve.js';
import { assertClient, assertPacked, laySite } from '../site.js';
import { serialize, watchCollection } from '../watch.js';

const argv = process.argv.slice(2);
const command = argv[0];

/** One flag with a value, spelled either `--name value` or `--name=value`. */
function flag(name: string): string | undefined {
	const eq = `${name}=`;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === name) return i + 1 < argv.length ? argv[i + 1] : undefined;
		if (argv[i].startsWith(eq)) return argv[i].slice(eq.length);
	}
	return undefined;
}

/** The collection every verb runs against, defaulting to the working directory. */
const collection = (): string => resolve(flag('--quiver') ?? '.');

/** An error's own words, with its cause's indented beneath: `collection.ts` names what was
 *  loading and chains what threw. */
function message(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	return err.cause == null ? err.message : `${err.message}\n  ${message(err.cause)}`;
}

// ---------------------------------------------------------------------------
// test
// ---------------------------------------------------------------------------

/**
 * The gate. Seeded rather than read from a file: `seedDocument()` is the one document
 * this and the client can both name.
 *
 * The only door onto the verdict, so an author on vitest, jest or another runner spawns
 * it (`execFileSync('quillkit', ['test'])`) rather than rebuilding the loop
 * (QUILLKIT §"Blocked on, looked at").
 */
async function test(): Promise<void> {
	const source = collection();
	const engine = await loadEngine(source);
	const { fromDir } = await loadQuiverNode(source);
	const quiver = await fromDir(source);

	const names = quiver.quillNames();
	if (names.length === 0) {
		console.error('error: quiver has no quills');
		process.exit(1);
	}

	let pass = 0;
	let fail = 0;

	for (const name of names) {
		for (const version of quiver.versionsOf(name)) {
			const ref = `${name}@${version}`;
			try {
				const quill = await quiver.getQuill(ref);
				const doc = quill.seedDocument();
				let result: { artifacts?: unknown[] };
				try {
					result = await engine.render(quill, doc);
				} finally {
					doc.free();
				}
				if (!Array.isArray(result.artifacts) || result.artifacts.length === 0) {
					throw new Error('example render produced no artifacts');
				}
				console.log(`pass  ${ref}`);
				pass++;
			} catch (err) {
				console.error(`FAIL  ${ref} — ${message(err)}`);
				fail++;
			}
		}
	}

	console.log(`\n${pass}/${pass + fail} passed`);
	if (fail > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

async function build(): Promise<void> {
	const source = collection();
	const out = flag('--out') ?? 'dist';
	const { build: packQuiver } = await loadQuiverNode(source);
	console.log(`quillkit build: ${source} → ${out}`);
	await packQuiver(source, out);
	console.log('done.');
}

// ---------------------------------------------------------------------------
// studio
// ---------------------------------------------------------------------------

async function studio(): Promise<void> {
	const source = collection();
	// Under the collection's `node_modules` by default, which is both out of the way
	// and already excluded from the watch.
	const out = resolve(flag('--out') ?? join(source, 'node_modules', '.quillkit', 'quiver'));
	// Checked as `site` checks it, and for the same reason: a missing client is a mount
	// that answers 404 to every request, which reads as a broken tool rather than as a
	// tree with the bin compiled and the client not.
	assertClient(CLIENT);
	const port = Number(flag('--port') ?? 5174);
	const host = flag('--host') ?? 'localhost';

	if (!Number.isInteger(port) || port < 0 || port > 65535)
		throw new Error(`--port must be a port number, got "${flag('--port')}"`);

	const { build: packQuiver } = await loadQuiverNode(source);
	// Drafts included: this is the author's own viewer, and a quill under 0.1.0 is
	// what an author is most likely to be looking at.
	const pack = serialize(() => packQuiver(source, out, { drafts: true }));
	// Before the server, so the first request finds a whole generation rather than an
	// empty directory.
	await pack();
	assertPacked(out, source);

	const mounts: Mount[] = [
		{ prefix: '/quiver', root: out },
		{ prefix: '', root: CLIENT }
	];
	const bound = await listen(createStaticServer(mounts), port, host);

	const watcher = watchCollection(source, [out], () => {
		pack().then(
			() => console.log('repacked'),
			// A quiver mid-edit is invalid as often as not (a half-written `Quill.yaml`).
			// A failed pack never reaches the swap, so the last good generation stays
			// served and the failure is a line rather than an exit.
			(err: unknown) => console.error(`pack failed: ${message(err)}`)
		);
	});
	for (const signal of ['SIGINT', 'SIGTERM'] as const)
		process.on(signal, () => {
			watcher.close();
			process.exit(0);
		});

	console.log(`quillkit studio: http://${host}:${bound}/`);
	console.log(`  quiver:   ${source}`);
	console.log('  reload the page to pick up a repack.');
}

// ---------------------------------------------------------------------------
// site
// ---------------------------------------------------------------------------

async function site(): Promise<void> {
	const source = collection();
	// Under the collection, as `studio`'s default is: `site/` beside the quiver is the
	// ordinary layout, and it is the same directory either way for the ordinary run from
	// the collection's own root. A cwd-relative default parts from it exactly when
	// `--quiver` points elsewhere, and then writes the layout wherever the shell stood.
	const at = await laySite({
		collection: source,
		out: flag('--out') ?? join(source, 'site'),
		drafts: argv.includes('--drafts')
	});
	console.log(`quillkit site: ${at}`);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function usage(): void {
	console.error(
		[
			'Usage:',
			'  quillkit test   [--quiver <dir>]',
			'  quillkit build  [--quiver <dir>] [--out <dir>]',
			'  quillkit studio [--quiver <dir>] [--out <dir>] [--port <n>] [--host <addr>]',
			'  quillkit site   [--quiver <dir>] [--out <dir>] [--drafts]'
		].join('\n')
	);
}

function die(err: unknown): never {
	console.error(`error: ${message(err)}`);
	process.exit(1);
}

const VERBS: Record<string, () => Promise<void>> = { test, build, studio, site };

// Own keys only: `in` reaches `Object.prototype`, and `quillkit toString` is a usage
// line rather than a call onto whatever it found.
if (command !== undefined && Object.hasOwn(VERBS, command)) {
	VERBS[command]().catch(die);
} else {
	usage();
	process.exit(1);
}
