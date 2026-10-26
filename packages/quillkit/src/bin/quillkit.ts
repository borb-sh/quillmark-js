#!/usr/bin/env node
/**
 * The quill author's toolchain, one bin over the whole lifecycle: verbs are its steps and a
 * verb's argument is a target, `quiver`, `studio` or `app`, studio where none is named
 * (QUILLKIT §"Verbs and targets"). `usage()` below is the spelling of every verb and its
 * flags. The quiver is the working directory.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build as pack, fromDir } from '@quillmark/quiver/node';
import { APP_JSON, prepareApp, writeApp } from '../app-files.js';
import { CLIENTS, assertClient, layOut, targetOf, type Target } from '../deploy.js';
import { gate, message } from '../gate.js';
import { layStarter } from '../init.js';
import { createStaticServer, listen, type Mount } from '../serve.js';
import { serialize, watchCollection } from '../watch.js';

const HOST = 'localhost';
/** The live loop's port, and a built deploy's beside it, so both can run at once. */
const PORTS = { serve: 5174, preview: 4174 };

/** The short spelling of each flag that has one. */
const SHORT: Record<string, string> = { '-o': '--out', '-p': '--port', '-D': '--drafts' };

interface Spec {
	/** Flags taking a value, spelled `--name value` or `--name=value`. */
	values?: string[];
	/** Flags taking none. */
	switches?: string[];
	/** How many bare words the verb takes after it. */
	words: number;
}

interface Args {
	words: string[];
	values: Map<string, string>;
	switches: Set<string>;
}

/** The verb's own arguments, refused where they name a flag it does not take or more words
 *  than it reads: read as absent, either would run the verb without what was asked. */
function parse(verb: string, args: string[], { values = [], switches = [], words }: Spec): Args {
	const out: Args = { words: [], values: new Map(), switches: new Set() };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (!arg.startsWith('-')) {
			out.words.push(arg);
			continue;
		}
		const eq = arg.indexOf('=');
		const said = eq === -1 ? arg : arg.slice(0, eq);
		const name = SHORT[said] ?? said;
		if (switches.includes(name) && eq === -1) {
			out.switches.add(name);
			continue;
		}
		if (!values.includes(name)) throw new Usage(`quillkit ${verb} takes no ${said}`);
		const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
		if (value === undefined || value === '' || value.startsWith('-'))
			throw new Usage(`${name} takes a value`);
		out.values.set(name, value);
	}
	if (out.words.length > words)
		throw new Usage(`quillkit ${verb} takes ${words === 0 ? 'no argument' : `at most ${words}`}`);
	return out;
}

class Usage extends Error {}

function portOf(args: Args, fallback: number): number {
	const said = args.values.get('--port');
	const port = Number(said ?? fallback);
	if (!Number.isInteger(port) || port < 0 || port > 65535)
		throw new Error(`--port must be a port number, got "${said}"`);
	return port;
}

/** The address a target's front door is at: a client's page, or the quiver's index where
 *  there is no client. */
const frontDoor = (target: Target, port: number): string =>
	`http://${HOST}:${port}/${target === 'quiver' ? 'quiver/quiver.json' : ''}`;

/** `url` in the platform's browser. Best effort: a machine with no opener, a CI runner
 *  above all, serves on and says where. */
function openBrowser(url: string): void {
	const [command, args] =
		process.platform === 'darwin'
			? ['open', [url]]
			: process.platform === 'win32'
				? ['cmd', ['/c', 'start', '""', url]]
				: ['xdg-open', [url]];
	try {
		const child = spawn(command, args, { stdio: 'ignore', detached: true });
		child.on('error', () => console.error(`  no browser opener here: open ${url} yourself.`));
		child.unref();
	} catch {
		console.error(`  no browser opener here: open ${url} yourself.`);
	}
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

/** A new quiver in the named directory, else the working one: one quill that passes `check`
 *  and opens in `serve`. It refuses a directory that already holds a quiver rather than
 *  merging into it. */
async function init(args: string[]): Promise<void> {
	const dir = parse('init', args, { words: 1 }).words[0] ?? '.';
	const { at, wrotePackage, install } = await layStarter(dir);
	const steps = [
		...(resolve(dir) === resolve('.') ? [] : [`cd ${JSON.stringify(dir)}`]),
		wrotePackage ? 'npm install' : `npm install --save-dev ${install}`,
		'npx quillkit serve --open'
	];
	console.log(`quillkit init: ${at}`);
	console.log('  quills/letter/0.1.0/ is the quill: Quill.yaml, plate.typ, example.md.');
	console.log(`\nNext:\n${steps.map((s) => `  ${s}`).join('\n')}`);
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

async function check(args: string[]): Promise<void> {
	const { switches } = parse('check', args, { switches: ['--drafts'], words: 0 });
	const { pass, fail } = await gate(resolve('.'), { drafts: switches.has('--drafts') });
	console.log(`\n${pass}/${pass + fail} passed`);
	if (fail > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

async function build(args: string[]): Promise<void> {
	const parsed = parse('build', args, { values: ['--out'], switches: ['--drafts'], words: 1 });
	const target = targetOf(parsed.words[0], 'build');
	const { at, warnings } = await layOut({
		target,
		root: resolve('.'),
		out: parsed.values.get('--out') ?? 'dist',
		drafts: parsed.switches.has('--drafts')
	});
	for (const said of warnings) console.error(`warn  ${said}`);
	console.log(`quillkit build ${target}: ${at}`);
}

// ---------------------------------------------------------------------------
// serve
// ---------------------------------------------------------------------------

/**
 * The local loop: pack the quiver into a served tree, serve the target's client over it,
 * and repack when the source changes. It always packs the drafts, being the author looking
 * at their own quiver (QUILLKIT §"The local loop").
 */
async function serve(args: string[]): Promise<void> {
	const parsed = parse('serve', args, { values: ['--port'], switches: ['--open'], words: 1 });
	const target = targetOf(parsed.words[0], 'serve');
	const port = portOf(parsed, PORTS.serve);
	const root = resolve('.');
	// Under the quiver's `node_modules`, which is both out of the way and already excluded
	// from the watch.
	const work = join(root, 'node_modules', '.quillkit');
	const out = join(work, 'quiver');
	const stage = join(work, 'app');
	const client = CLIENTS[target];
	if (client !== undefined) assertClient(client);

	const generation = async (): Promise<void> => {
		await pack(root, out, { drafts: true });
		if (target !== 'app') return;
		const prepared = await prepareApp(root, await fromDir(root), true);
		for (const said of prepared.warnings) console.error(`warn  ${said}`);
		await writeApp(prepared, root, stage);
	};
	const repack = serialize(generation);
	// Before the server, so the first request finds a whole generation rather than an empty
	// directory.
	await repack();

	const mounts: Mount[] = [
		{ prefix: '/quiver', root: out },
		...(client === undefined ? [] : [{ prefix: '', root: client }]),
		...(target === 'app' ? [{ prefix: '', root: stage }] : [])
	];
	const bound = await listen(createStaticServer(mounts, { cors: target === 'quiver' }), port, HOST);

	const watcher = watchCollection(root, [work, join(root, 'dist')], () => {
		repack().then(
			() => console.log('repacked'),
			// A quiver mid-edit is invalid as often as not (a half-written `Quill.yaml`). A
			// failed pack never reaches the swap, so the last good generation stays served and
			// the failure is a line rather than an exit.
			(err: unknown) => console.error(`pack failed: ${message(err)}`)
		);
	});
	for (const signal of ['SIGINT', 'SIGTERM'] as const)
		process.on(signal, () => {
			watcher.close();
			process.exit(0);
		});

	const url = frontDoor(target, bound);
	console.log(`quillkit serve ${target}: ${url}`);
	console.log(`  quiver: ${root}`);
	console.log('  reload the page to pick up a repack.');
	if (parsed.switches.has('--open')) openBrowser(url);
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

/** The target a deploy was built for, read off what its build left at the root. */
function builtTarget(dir: string): Target {
	if (existsSync(join(dir, APP_JSON))) return 'app';
	if (existsSync(join(dir, 'index.html'))) return 'studio';
	if (existsSync(join(dir, 'quiver', 'quiver.json'))) return 'quiver';
	throw new Error(`${dir} holds no build: run \`quillkit build\` first`);
}

/** A built deploy, served as a static host serves it: at the root, a missing path a 404, and
 *  the host's cache rules on every response (QUILLKIT §"The deploy layout"). */
async function preview(args: string[]): Promise<void> {
	const parsed = parse('preview', args, {
		values: ['--out', '--port'],
		switches: ['--open'],
		words: 0
	});
	const port = portOf(parsed, PORTS.preview);
	const dir = resolve(parsed.values.get('--out') ?? 'dist');
	const target = builtTarget(dir);
	const bound = await listen(
		createStaticServer([{ prefix: '', root: dir }], { caching: 'host' }),
		port,
		HOST
	);
	const url = frontDoor(target, bound);
	console.log(`quillkit preview ${target}: ${url}`);
	console.log(`  serving: ${dir}`);
	if (parsed.switches.has('--open')) openBrowser(url);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function usage(): void {
	console.error(
		[
			'Usage:',
			'  quillkit init  [<dir>]',
			'  quillkit check [-D|--drafts]',
			'  quillkit build [quiver|studio|app] [-o|--out <dir>] [-D|--drafts]',
			'  quillkit serve [quiver|studio|app] [-p|--port <n>] [--open]',
			'  quillkit preview [-o|--out <dir>] [-p|--port <n>] [--open]',
			'',
			'The target is studio where none is named; preview serves whichever build is in --out.'
		].join('\n')
	);
}

const VERBS: Record<string, (args: string[]) => Promise<void>> = {
	init,
	check,
	build,
	serve,
	preview
};

const [verb, ...rest] = process.argv.slice(2);

// Own keys only: `in` reaches `Object.prototype`, and `quillkit toString` is a usage line
// rather than a call onto whatever it found.
if (verb !== undefined && Object.hasOwn(VERBS, verb)) {
	VERBS[verb]!(rest).catch((err: unknown) => {
		console.error(`error: ${message(err)}`);
		if (err instanceof Usage) usage();
		process.exit(1);
	});
} else {
	usage();
	process.exit(1);
}
