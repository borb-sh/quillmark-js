// The playground, served from source in one verb, and asked a question in a browser.
//
// The playground resolves `@quillmark/svelte` and `@quillmark/quiver` through the
// workspace symlink to each one's `dist`, so a source edit is invisible until that
// package is rebuilt — and then invisible again until Vite's caches are dropped and the
// dev server restarted. HMR alone, `--force` alone, and a rebuild without a restart each
// serve the previous CSS with nothing failing: the scope hash on the served rule still
// matches while its body is the old one. So the sequence is not optional and is not a
// checklist; it is this script, and `npm run dev` is it.
//
// `--probe` is the other half. jsdom computes no layout, so every CSS-level fact in
// `@quillmark/svelte` — `position`, whether a `@container` rule applied at all, a
// clip, the specificity between two rules, whether a longhand against a two-value rung
// parsed — is invisible to that package's suite by construction. This is where one is
// asked: a real browser over a page built the way a consumer's is, answering an
// expression the author writes, printed as JSON. What the answer may then be committed
// as is CLAUDE.md §Verification's two shapes; what it is for here is finding out.
//
//   node scripts/playground.mjs                       # serve, and hold the port
//   node scripts/playground.mjs --probe '<expr>'      # serve, ask, print, stop
//   node scripts/playground.mjs --probe @probe.js     # the expression from a file

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './workspace.mjs';
import { load } from './browser.mjs';

/** Every cache that can serve a stale copy of a rebuilt dependency. */
const CACHES = [
	join(ROOT, 'packages', 'playground', 'node_modules', '.vite'),
	join(ROOT, 'packages', 'playground', '.svelte-kit'),
	join(ROOT, 'node_modules', '.vite')
];

/** Where this script records the server it started, so the next run kills that pid and
 *  not whatever else a name pattern matches — `pkill -f vite` matches the shell that ran
 *  it. One file per port: two ports are two servers. */
const pidfile = (port) => join(ROOT, 'node_modules', '.cache', `playground-${port}.pid`);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const at = args.indexOf(name);
	return at === -1 ? fallback : args[at + 1];
};

const port = Number(flag('--port', 5173));
const route = flag('--route', '/playground');
const viewport = { width: Number(flag('--width', 1440)), height: Number(flag('--height', 900)) };
const probe = flag('--probe', undefined);
if (args.includes('--probe') && (probe === undefined || probe.startsWith('--')))
	throw new Error('--probe takes the expression to evaluate, or `@<file>` to read it off disk');
const expression = probe?.startsWith('@') ? readFileSync(probe.slice(1), 'utf8') : probe;
const url = `http://localhost:${port}${route}`;

const say = (what) => console.error(`playground: ${what}`);

/** Run a command to completion, its output on this process's streams. */
function run(command, argv) {
	return new Promise((ok, no) => {
		const child = spawn(command, argv, { cwd: ROOT, stdio: 'inherit', shell: false });
		child.on('error', no);
		child.on('exit', (code) => (code === 0 ? ok() : no(new Error(`${command} exited ${code}`))));
	});
}

/** Stop the server a previous run left on this port, and wait for the port with it: Vite
 *  is started `--strictPort`, so a lingering listener is a refusal rather than a second
 *  server nobody is reading. */
async function stopPrevious() {
	let pid;
	try {
		pid = Number(readFileSync(pidfile(port), 'utf8'));
	} catch {
		return;
	}
	try {
		process.kill(-pid, 'SIGTERM');
		say(`stopped the server left at pid ${pid}`);
	} catch {
		// Gone already, or never ours: the pidfile outlives the process it names.
	}
	rmSync(pidfile(port), { force: true });
	for (let tries = 0; tries < 100 && (await answers()); tries++)
		await new Promise((wake) => setTimeout(wake, 100));
}

/** Whether something is listening on the port and answering HTTP. */
async function answers() {
	try {
		await fetch(url, { signal: AbortSignal.timeout(1000) });
		return true;
	} catch {
		return false;
	}
}

await stopPrevious();
if (await answers())
	throw new Error(`something else answers at ${url}; stop it, or pass --port <n>`);

say('building @quillmark/quiver and @quillmark/svelte');
await run('npm', ['run', 'build', '-w', 'packages/quiver', '-w', 'packages/svelte']);

for (const cache of CACHES) rmSync(cache, { recursive: true, force: true });
say('dropped the Vite and SvelteKit caches');

const server = spawn(
	'npm',
	['run', 'dev', '-w', 'packages/playground', '--', '--port', String(port), '--strictPort'],
	// Its own process group, so the whole Vite tree goes with one signal rather than
	// leaving the child that holds the port behind.
	{ cwd: ROOT, stdio: 'inherit', detached: true }
);
if (server.pid === undefined) throw new Error('the dev server did not start');
mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true });
writeFileSync(pidfile(port), String(server.pid));

const stop = () => {
	rmSync(pidfile(port), { force: true });
	try {
		process.kill(-server.pid, 'SIGTERM');
	} catch {
		// Already down.
	}
};
// The server is its own group, so no signal this process takes reaches it: every way
// out takes it down, a throw included.
process.on('exit', stop);
for (const [signal, code] of [
	['SIGINT', 130],
	['SIGTERM', 143],
	['SIGHUP', 129]
])
	process.on(signal, () => process.exit(code));

let exited = false;
server.once('exit', () => (exited = true));
for (let tries = 0; tries < 300 && !exited && !(await answers()); tries++)
	await new Promise((wake) => setTimeout(wake, 100));
if (exited || !(await answers())) throw new Error(`the dev server never answered at ${url}`);

if (probe === undefined) {
	say(`serving ${url} — Ctrl-C to stop`);
	await new Promise(() => {});
}

try {
	say(`asking ${url} at ${viewport.width}×${viewport.height}`);
	console.log(JSON.stringify(await load(url, expression, viewport), null, 2));
} finally {
	stop();
}
