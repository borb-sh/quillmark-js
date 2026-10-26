/**
 * The bin, as an author reaches it: `dist/bin/quillkit.js` spawned in a quiver.
 *
 * Every other test in this package imports `src/`, which is what makes this one worth
 * its seconds: what an author reaches is a linked bin, and nothing that imports a module
 * proves one works. It pins what the tool carries (the packer, the engine and both clients,
 * resolved out of its own dependencies and nothing beside the quiver) and a real render of
 * every quill's seed and example, that last being what a gate for quills is.
 *
 * It runs against `dist/`, so it needs the package built: every half, since the verbs that
 * serve reach for a client. The root `npm run build` does that in an order `tsc` here
 * depends on, which is what CI runs before it tests.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { APP_JSON, APP_YAML } from '../app-files.js';
import { DEFAULT_TARGET, TARGETS } from '../deploy.js';
import { scratch } from './helpers/collection.js';

const run = promisify(execFile);

/** The bin as npm links it, not the TypeScript behind it. */
const BIN = fileURLToPath(new URL('../../dist/bin/quillkit.js', import.meta.url));
const MANIFEST = fileURLToPath(new URL('../../package.json', import.meta.url));

/** A real Typst backend load and one page compiled. */
const RENDER_MS = 120_000;

const temp = scratch('quillkit-cli-');
const children: ChildProcess[] = [];
afterEach(async () => {
	for (const child of children.splice(0)) child.kill('SIGTERM');
	await temp.cleanup();
});

beforeAll(() => {
	expect(
		existsSync(BIN),
		`${BIN} is missing: run \`npm run build -w packages/quillkit\` first`
	).toBe(true);
});

/** A verb that fails, as its rejection: the message carries stderr, `stdout` the rest. */
async function refused(args: string[], cwd: string): Promise<Error & { stdout?: string }> {
	return run(process.execPath, [BIN, ...args], { cwd }).then(
		() => new Error(`quillkit ${args.join(' ')} succeeded`),
		(err: Error) => err
	);
}

/** A verb that serves, started, and the front door it prints. */
async function serving(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<URL> {
	const child = spawn(process.execPath, [BIN, ...args, '-p', '0'], {
		cwd,
		env: { ...process.env, ...env },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	children.push(child);
	return new Promise<URL>((ok, no) => {
		let out = '';
		const timer = setTimeout(() => no(new Error(`no address in: ${out}`)), 45_000);
		const read = (chunk: Buffer) => {
			out += chunk.toString();
			const match = /http:\/\/\S+/.exec(out);
			if (match) {
				clearTimeout(timer);
				ok(new URL(match[0]));
			}
		};
		child.stdout.on('data', read);
		child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
		child.on('exit', (code) => no(new Error(`exited ${code}: ${out}`)));
		child.on('error', no);
	});
}

describe('quillkit check', () => {
	it(
		'gates the reference quiver end-to-end',
		async () => {
			// A non-zero exit rejects, carrying the gate's own output as the failure.
			const { stdout } = await run(process.execPath, [BIN, 'check', '--drafts'], {
				cwd: await temp.collection()
			});

			expect(stdout).toContain('pass  showcase@1.0.0 (seed, example)');
			expect(stdout).toContain('pass  usaf_memo@0.0.0 (seed, example)');
			expect(stdout).toContain('2/2 passed');
		},
		RENDER_MS
	);

	it('refuses a directory holding no quiver', async () => {
		expect((await refused(['check'], await temp.dir())).message).toMatch(/Quiver\.yaml/);
	});

	it(
		'fails a quill whose example will not open, and passes the rest',
		async () => {
			const source = await temp.collection();
			const example = join(source, 'quills', 'showcase', '1.0.0', 'example.md');
			const md = await readFile(example, 'utf8');
			await writeFile(example, md.replace('$quill: showcase\n', '$quill: showcase@1.0\n'));

			const failure = await refused(['check'], source);

			// A `FAIL` line is the gate's stderr, which the rejection's message carries.
			expect(failure.message).toContain('FAIL  showcase@1.0.0');
			expect(failure.stdout).toContain('pass  usaf_memo@0.0.0');
		},
		RENDER_MS
	);

	it(
		'gates the app App.yaml describes, with the drafts under --drafts',
		async () => {
			const source = await temp.collection();
			await writeFile(join(source, APP_YAML), 'quills: [showcase]\n');

			const failure = await refused(['check'], source);
			expect(failure.message).toMatch(new RegExp(`FAIL {2}app — .*unknown key "quills"`));

			await writeFile(join(source, APP_YAML), 'title: Forms\n');
			const { stdout } = await run(process.execPath, [BIN, 'check'], { cwd: source });
			expect(stdout).toContain('pass  app (showcase@1.0.0)');
			const drafts = await run(process.execPath, [BIN, 'check', '-D'], { cwd: source });
			expect(drafts.stdout).toContain('pass  app (showcase@1.0.0, usaf_memo@0.0.0)');
		},
		RENDER_MS
	);
});

describe('quillkit init', () => {
	it(
		'lays a quiver that needs only quillkit, passes the gate and builds into an app',
		async () => {
			const at = join(await temp.dir(), 'fresh');
			await run(process.execPath, [BIN, 'init', at]);

			const pkg = JSON.parse(await readFile(join(at, 'package.json'), 'utf8'));
			const own = JSON.parse(await readFile(MANIFEST, 'utf8'));
			expect(Object.keys(pkg.devDependencies)).toEqual([own.name]);
			expect(pkg.dependencies).toBeUndefined();
			expect(Object.values(pkg.scripts).join('\n')).toMatch(/quillkit build app/);

			const { stdout } = await run(process.execPath, [BIN, 'check'], { cwd: at });
			expect(stdout).toContain('pass  letter@0.1.0 (seed, example)');

			await run(process.execPath, [BIN, 'build', 'app'], { cwd: at });
			const app = JSON.parse(await readFile(join(at, 'dist', APP_JSON), 'utf8'));
			expect(app.quills.map((q: { ref: string }) => q.ref)).toEqual(['letter@0.1.0']);
		},
		RENDER_MS
	);

	it('refuses a directory that already holds a quiver, before writing anything', async () => {
		const at = await temp.dir();
		await writeFile(join(at, 'Quiver.yaml'), 'name: mine\n');
		expect((await refused(['init'], at)).message).toMatch(/Quiver\.yaml already exists/);
		expect(await readdir(at)).toEqual(['Quiver.yaml']);
	});

	it('prints usage rather than laying a quiver under a flag', async () => {
		const at = await temp.dir();
		expect((await refused(['init', '--quiver', 'x'], at)).message).toMatch(/Usage:/);
		expect(await readdir(at)).toEqual([]);
	});
});

describe('quillkit build', () => {
	it('lays studio into dist/ where no target is named, and each target where -o points', async () => {
		const source = await temp.collection();
		const { stdout } = await run(process.execPath, [BIN, 'build'], { cwd: source });
		expect(stdout).toContain(`quillkit build ${DEFAULT_TARGET}:`);
		expect(existsSync(join(source, 'dist', 'index.html'))).toBe(true);

		const out = join(await temp.dir(), 'pack');
		await run(process.execPath, [BIN, 'build', 'quiver', '-o', out], { cwd: source });
		expect(existsSync(join(out, 'quiver', 'quiver.json'))).toBe(true);
		expect(existsSync(join(out, 'index.html'))).toBe(false);
	}, 60_000);

	it('names every target when given one it does not have', async () => {
		const source = await temp.collection();
		for (const args of [
			['build', 'site'],
			['serve', 'site'],
			['serve', '--built', 'site']
		]) {
			const { message } = await refused(args, source);
			for (const target of TARGETS) expect(message, args.join(' ')).toContain(target);
		}
		expect(existsSync(join(source, 'dist'))).toBe(false);
	});
});

describe('quillkit serve', () => {
	it('serves studio by default: the client at the root and the drafts packed beneath it', async () => {
		const url = await serving(['serve'], await temp.collection());

		const index = await fetch(url);
		expect(index.status).toBe(200);
		expect(index.headers.get('content-type')).toContain('text/html');
		expect(await fetch(new URL(APP_JSON, url)).then((r) => r.status)).toBe(404);

		const catalog = await fetch(new URL('quiver/quiver.json', url));
		expect(catalog.status).toBe(200);
		const { quills } = (await catalog.json()) as { quills: { version: string }[] };
		// The fixture's `usaf_memo` is `0.0.0`, under quiver's floor.
		expect(quills.map((q) => q.version)).toContain('0.0.0');
	}, 60_000);

	it('serves the app over the same quiver, with the app.json the quiver resolves to', async () => {
		const url = await serving(['serve', 'app'], await temp.collection());

		expect((await fetch(url)).status).toBe(200);
		const app = await fetch(new URL(APP_JSON, url));
		expect(app.status).toBe(200);
		const { quills } = (await app.json()) as { quills: { ref: string }[] };
		const catalog = (await fetch(new URL('quiver/quiver.json', url)).then((r) => r.json())) as {
			quills: { name: string; version: string }[];
		};
		for (const { ref } of quills)
			expect(catalog.quills.map((q) => `${q.name}@${q.version}`)).toContain(ref);
	}, 60_000);

	it('serves on where --open finds no browser to open', async () => {
		// An empty PATH is a machine with no opener, which is a CI runner's case.
		const url = await serving(['serve', '--open'], await temp.collection(), { PATH: '' });
		expect((await fetch(url)).status).toBe(200);
	}, 60_000);
});

describe('quillkit serve --built', () => {
	it('serves a build as a static host does', async () => {
		const source = await temp.collection();
		await run(process.execPath, [BIN, 'build', 'app', '-D'], { cwd: source });
		const url = await serving(['serve', '--built', 'app'], source);

		const index = await fetch(url);
		expect(index.status).toBe(200);
		const asset = /assets\/[^"]+\.js/.exec(await index.text())?.[0];
		expect(asset).toBeDefined();

		const hashed = await fetch(new URL(asset!, url));
		expect(hashed.headers.get('cache-control')).toMatch(/immutable/);
		const catalog = await fetch(new URL('quiver/quiver.json', url));
		expect(catalog.headers.get('cache-control')).not.toMatch(/immutable|max-age=[1-9]/);
		expect((await fetch(new URL('nope.html', url))).status).toBe(404);
	}, 60_000);

	it('refuses a directory holding no build of the target', async () => {
		const source = await temp.collection();
		await run(process.execPath, [BIN, 'build'], { cwd: source });
		expect((await refused(['serve', '--built', 'app'], source)).message).toMatch(
			/holds no app build: run `quillkit build app`/
		);
	});
});

describe('how a flag is spelled', () => {
	it('reads a value joined by an equals sign', async () => {
		const source = await temp.collection();
		const out = join(await temp.dir(), 'joined');
		await run(process.execPath, [BIN, 'build', 'quiver', `--out=${out}`], { cwd: source });
		expect(existsSync(join(out, 'quiver', 'quiver.json'))).toBe(true);
	}, 60_000);

	it('refuses a flag given no value, and one the verb does not take', async () => {
		const source = await temp.collection();
		for (const flag of ['--out', '-o'])
			expect((await refused(['build', 'quiver', flag], source)).message).toMatch(
				/--out takes a value/
			);
		// The quiver is the working directory: a `--quiver` read as absent would gate the
		// wrong tree.
		for (const args of [
			['check', '--quiver', '.'],
			['build', 'app', '--port', '1'],
			['serve', '-D'],
			['serve', '-o', 'dist'],
			['serve', '--built', '--drafts']
		])
			expect((await refused(args, source)).message, args.join(' ')).toMatch(/takes no -/);
	});
});

describe('the bin without a verb', () => {
	it('prints usage and fails', async () => {
		expect((await refused([], await temp.dir())).message).toMatch(/Usage:/);
	});

	it('prints usage for a name the verb table inherits', async () => {
		// `toString` is on every object, so a dispatch reading the prototype chain calls it
		// and dies of a TypeError where an author is owed the usage line.
		expect((await refused(['toString'], await temp.dir())).message).toMatch(/Usage:/);
	});
});
