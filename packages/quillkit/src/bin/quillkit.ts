#!/usr/bin/env node
/**
 * The quill author's toolchain, one bin over the whole loop: start, gate, pack, look at, ship.
 * `usage()` below is the spelling of every verb and its flags.
 *
 * One wasm at most lives in this process, and only `test` puts it there: the packer
 * instantiates nothing, and the client is static bytes served to a browser tab.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Document, Quill } from '@quillmark/wasm';
import { loadCore, loadEngine, loadQuiverNode } from '../collection.js';
import { layStarter } from '../init.js';
import { CLIENT } from '../paths.js';
import { createStaticServer, listen, type Mount } from '../serve.js';
import { assertClient, assertPacked, laySite } from '../site.js';
import { assertTemplates } from '../templates.js';
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
// init
// ---------------------------------------------------------------------------

/** A new quiver in the named directory, else the working one: one quill that passes
 *  `test` and opens in `studio`. It refuses a directory that already holds a quiver
 *  rather than merging into it. */
async function init(): Promise<void> {
	const args = argv.slice(1);
	if (args.length > 1 || args.some((a) => a.startsWith('-'))) {
		usage();
		process.exit(1);
	}
	const dir = args[0] ?? '.';
	const { at, wrotePackage, install } = await layStarter(dir);
	const steps = [
		...(resolve(dir) === resolve('.') ? [] : [`cd ${JSON.stringify(dir)}`]),
		wrotePackage ? 'npm install' : `npm install --save-dev ${install.join(' ')}`,
		'npx quillkit studio'
	];
	console.log(`quillkit init: ${at}`);
	console.log('  quills/letter/0.1.0/ is the quill: Quill.yaml, plate.typ, example.md.');
	console.log(`\nNext:\n${steps.map((s) => `  ${s}`).join('\n')}`);
}

// ---------------------------------------------------------------------------
// test
// ---------------------------------------------------------------------------

/**
 * The gate: every quill's seed renders, and so does its root `example.md` where it ships
 * one. The seed is the one document every quill has; the example is the filled page
 * whose values reach the branches the blank leaves dark.
 *
 * With `--templates`, every template the manifest lists then opens in the quill its
 * `$quill` names, a selector resolving as in studio, and renders. A warning fails a
 * template: every value in one is the collection author's own to fix.
 *
 * The only door onto the verdict, so an author on vitest, jest or another runner spawns
 * it (`execFileSync('quillkit', ['test'])`) rather than rebuilding the loop
 * (QUILLKIT §"Blocked on, looked at").
 */
async function test(): Promise<void> {
	const source = collection();
	const templates = flag('--templates');
	const starters = templates === undefined ? undefined : assertTemplates(templates);
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

	/** One line of the verdict, counted: what `run` resolves to is printed beside the pass,
	 *  and what it throws is the failure. */
	async function tally(what: string, run: () => Promise<string>): Promise<void> {
		try {
			console.log(`pass  ${what} (${await run()})`);
			pass++;
		} catch (err) {
			console.error(`FAIL  ${what} — ${message(err)}`);
			fail++;
		}
	}

	async function renders(quill: Quill, doc: Document, what: string): Promise<void> {
		const result: { artifacts?: unknown[] } = await engine.render(quill, doc);
		if (!Array.isArray(result.artifacts) || result.artifacts.length === 0) {
			throw new Error(`${what} render produced no artifacts`);
		}
	}

	for (const name of names) {
		for (const version of quiver.versionsOf(name)) {
			const ref = `${name}@${version}`;
			await tally(ref, async () => {
				const quill = await quiver.getQuill(ref);
				const docs: [string, Document][] = [['seed', quill.seedDocument()]];
				try {
					const example = quill.exampleDocument();
					if (example) docs.push(['example', example]);
					for (const [what, doc] of docs) await renders(quill, doc, what);
				} finally {
					for (const [, doc] of docs) doc.free();
				}
				return docs.map(([what]) => what).join(', ');
			});
		}
	}

	if (starters !== undefined) {
		const core = await loadCore(source);
		for (const { file } of starters.templates) {
			await tally(file, async () => {
				const text = await readFile(join(starters.at, file), 'utf8');
				const probe = core.Document.fromMarkdown(text);
				let ref: string;
				try {
					ref = quiver.resolve(probe.quillRef);
				} finally {
					probe.free();
				}
				const quill = await quiver.getQuill(ref);
				const doc = quill.parse(text);
				try {
					const said = [...doc.warnings, ...quill.validate(doc)];
					if (said.length > 0)
						throw new Error(said.map((d) => core.formatDiagnostic(d)).join('\n'));
					await renders(quill, doc, 'template');
				} finally {
					doc.free();
				}
				return ref;
			});
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
	const templates = flag('--templates');
	const starters = templates === undefined ? undefined : assertTemplates(templates).at;
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

	// Templates are served from where they are written, so an edit to one reaches the
	// next pick without a repack.
	const mounts: Mount[] = [
		{ prefix: '/quiver', root: out },
		...(starters === undefined ? [] : [{ prefix: '/templates', root: starters }]),
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
	if (starters !== undefined) console.log(`  templates: ${starters}`);
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
		drafts: argv.includes('--drafts'),
		templates: flag('--templates')
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
			'  quillkit init   [<dir>]',
			'  quillkit test   [--quiver <dir>] [--templates <dir>]',
			'  quillkit build  [--quiver <dir>] [--out <dir>]',
			'  quillkit studio [--quiver <dir>] [--out <dir>] [--port <n>] [--host <addr>] [--templates <dir>]',
			'  quillkit site   [--quiver <dir>] [--out <dir>] [--drafts] [--templates <dir>]'
		].join('\n')
	);
}

function die(err: unknown): never {
	console.error(`error: ${message(err)}`);
	process.exit(1);
}

const VERBS: Record<string, () => Promise<void>> = { init, test, build, studio, site };

// Own keys only: `in` reaches `Object.prototype`, and `quillkit toString` is a usage
// line rather than a call onto whatever it found.
if (command !== undefined && Object.hasOwn(VERBS, command)) {
	VERBS[command]().catch(die);
} else {
	usage();
	process.exit(1);
}
