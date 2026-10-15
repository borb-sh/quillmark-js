/**
 * The bin, as an author reaches it: `dist/bin/quillkit.js` spawned against a collection.
 *
 * Every other test in this package imports `src/`, which is what makes this one worth
 * its seconds: what an author reaches is a linked bin, and nothing that imports a module
 * proves one works. It pins the two resolutions the tool is built on (the packer and the
 * engine, each out of the collection's own tree), the client it carries instead, and a
 * real render of every quill's seed and example, that last being what a gate for quills is.
 *
 * It runs against `dist/`, so it needs the package built: both halves, since the verbs
 * that serve reach for the client. The root `npm run build` does that in an order `tsc`
 * here depends on, which is what CI runs before it tests.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { scratch } from './helpers/collection.js';

const run = promisify(execFile);

/** The bin as npm links it, not the TypeScript behind it. */
const BIN = fileURLToPath(new URL('../../dist/bin/quillkit.js', import.meta.url));
/** The tarball's `dist`, both halves: the compiled tool and the built client. */
const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
/** The client's half of it, which is a browser program. */
const CLIENT = `client${sep}`;

/** A real Typst backend load and one page compiled. */
const RENDER_MS = 120_000;

const temp = scratch('quillkit-cli-');
afterEach(() => temp.cleanup());

beforeAll(() => {
	expect(
		existsSync(BIN),
		`${BIN} is missing: run \`npm run build -w packages/quillkit\` first`
	).toBe(true);
});

describe('quillkit test', () => {
	it(
		'gates the reference quiver end-to-end',
		async () => {
			// A non-zero exit rejects, carrying the gate's own output as the failure.
			const { stdout } = await run(process.execPath, [BIN, 'test'], {
				cwd: await temp.collection()
			});

			expect(stdout).toContain('pass  showcase@1.0.0 (seed, example)');
			expect(stdout).toContain('pass  usaf_memo@0.0.0 (seed, example)');
			expect(stdout).toContain('2/2 passed');
		},
		RENDER_MS
	);

	it('names the install when the collection has no engine or loader', async () => {
		await expect(run(process.execPath, [BIN, 'test'], { cwd: await temp.dir() })).rejects.toThrow(
			/npm install --save-dev @quillmark\/wasm/
		);
	});

	it(
		'fails on a broken quillkit.config.js, saying what broke',
		async () => {
			// The arm `loadEngine`'s own suite cannot reach: a verb that exits non-zero, and
			// the cause printed under the error.
			const source = await temp.collection();
			await writeFile(join(source, 'quillkit.config.js'), "throw new Error('config is broken');");

			const failure = await run(process.execPath, [BIN, 'test'], { cwd: source }).then(
				() => new Error('the gate ran to a verdict on a config that throws'),
				(err: Error) => err
			);

			expect(failure.message).toContain('Cannot load quillkit.config.js');
			expect(failure.message).toContain('config is broken');
			expect(failure.message).not.toContain('pass  ');
		},
		RENDER_MS
	);

	it(
		'fails a quill whose example will not open, and passes the rest',
		async () => {
			const source = await temp.collection();
			const example = join(source, 'quills', 'showcase', '1.0.0', 'example.md');
			const md = await readFile(example, 'utf8');
			await writeFile(example, md.replace('$quill: showcase\n', '$quill: showcase@1\n'));

			const failure: Error & { stdout?: string } = await run(process.execPath, [BIN, 'test'], {
				cwd: source
			}).then(
				() => new Error('the gate passed a quill whose example names a selector'),
				(err: Error) => err
			);

			// A `FAIL` line is the gate's stderr, which the rejection's message carries.
			expect(failure.message).toContain('FAIL  showcase@1.0.0');
			expect(failure.stdout).toContain('pass  usaf_memo@0.0.0');
		},
		RENDER_MS
	);

	it(
		'renders every listed template in the quill it names, failing one that warns or names none held',
		async () => {
			const source = await temp.collection();
			const templates = join(source, 'templates');
			const memo = await readFile(join(templates, 'usaf_memo.md'), 'utf8');
			const added = {
				'selector.md': memo.replace('$quill: usaf_memo@0.0.0\n', '$quill: usaf_memo@0\n'),
				'stray.md': memo.replace('\nsubject:', '\nstray: kept\nsubject:'),
				'elsewhere.md': memo.replace('$quill: usaf_memo@0.0.0\n', '$quill: usaf_memo@9\n')
			};
			const manifest = join(templates, 'templates.json');
			const listed = JSON.parse(await readFile(manifest, 'utf8'));
			for (const [file, md] of Object.entries(added)) {
				await writeFile(join(templates, file), md);
				listed.push({ name: file, file });
			}
			await writeFile(manifest, JSON.stringify(listed));

			const failure: Error & { stdout?: string } = await run(
				process.execPath,
				[BIN, 'test', '--templates', templates],
				{ cwd: source }
			).then(
				() => new Error('the gate passed a template carrying a warning'),
				(err: Error) => err
			);

			expect(failure.stdout).toContain('pass  usaf_memo.md (usaf_memo@0.0.0)');
			expect(failure.stdout).toContain('pass  selector.md (usaf_memo@0.0.0)');
			expect(failure.message).toMatch(/FAIL {2}stray\.md — .*\(validation::unknown_field\)/);
			expect(failure.message).toMatch(/FAIL {2}elsewhere\.md — .*"usaf_memo@9"/);
			const passed = failure.stdout!.match(/^pass {2}/gm)!.length;
			expect(failure.stdout).toContain(`${passed}/${passed + 2} passed`);
		},
		RENDER_MS
	);
});

describe('quillkit init', () => {
	it(
		'lays a quiver the gate passes, pinned to what the client carries',
		async () => {
			const at = join(await temp.dir(), 'fresh');
			await run(process.execPath, [BIN, 'init', at]);
			await temp.peers(at);

			const { stdout } = await run(process.execPath, [BIN, 'test'], { cwd: at });
			expect(stdout).toContain('pass  letter@0.1.0 (seed, example)');

			const carried = JSON.parse(await readFile(join(DIST, 'client', 'carried.json'), 'utf8'));
			const pkg = JSON.parse(await readFile(join(at, 'package.json'), 'utf8'));
			expect(pkg.devDependencies['@quillmark/wasm']).toBe(`^${carried['@quillmark/wasm']}`);
			expect(pkg.devDependencies['@quillmark/quiver']).toBe(`^${carried['@quillmark/quiver']}`);
		},
		RENDER_MS
	);

	it('refuses a directory that already holds a quiver, before writing anything', async () => {
		const at = await temp.dir();
		await writeFile(join(at, 'Quiver.yaml'), 'name: mine\n');
		await expect(run(process.execPath, [BIN, 'init'], { cwd: at })).rejects.toThrow(
			/Quiver\.yaml already exists/
		);
		expect(await readdir(at)).toEqual(['Quiver.yaml']);
	});

	it('prints usage rather than laying a quiver under a flag', async () => {
		const at = await temp.dir();
		await expect(
			run(process.execPath, [BIN, 'init', '--quiver', 'x'], { cwd: at })
		).rejects.toThrow(/Usage:/);
		expect(await readdir(at)).toEqual([]);
	});
});

describe('quillkit build', () => {
	it('packs a collection into the directory it was pointed at', async () => {
		const out = join(await temp.dir(), 'dist');
		const { stdout } = await run(process.execPath, [BIN, 'build', '--out', out], {
			cwd: await temp.collection()
		});

		expect(stdout).toContain('quillkit build:');
		expect(existsSync(join(out, 'quiver.json'))).toBe(true);
	}, 60_000);
});

describe('quillkit studio', () => {
	it('packs, serves the client at the root and the quiver and templates beneath it', async () => {
		const source = await temp.collection();
		const child = spawn(
			process.execPath,
			[BIN, 'studio', '--quiver', source, '--port', '0', '--templates', join(source, 'templates')],
			{ stdio: ['ignore', 'pipe', 'pipe'] }
		);

		try {
			const url = await new Promise<string>((ok, no) => {
				let out = '';
				const timer = setTimeout(() => no(new Error(`no address in: ${out}`)), 45_000);
				child.stdout.on('data', (chunk: Buffer) => {
					out += chunk.toString();
					const match = /http:\/\/\S+/.exec(out);
					if (match) {
						clearTimeout(timer);
						ok(match[0]);
					}
				});
				child.on('error', no);
			});

			const index = await fetch(url);
			expect(index.status).toBe(200);
			expect(index.headers.get('content-type')).toContain('text/html');

			const catalog = await fetch(new URL('quiver/quiver.json', url));
			expect(catalog.status).toBe(200);
			expect(await catalog.json()).toHaveProperty('quills');

			const listed = await fetch(new URL('templates/templates.json', url));
			expect(listed.status).toBe(200);
			const [{ file }] = (await listed.json()) as Array<{ file: string }>;
			const template = await fetch(new URL(`templates/${file}`, url));
			expect(template.status).toBe(200);
			expect(template.headers.get('content-type')).toContain('text/markdown');
		} finally {
			child.kill('SIGTERM');
		}
	}, 60_000);
});

describe('how a flag is spelled', () => {
	it('reads a value joined by an equals sign', async () => {
		// A verb reading only `--quiver <dir>` takes `--quiver=<dir>` for a directory it was
		// never given and runs against the working one, which is a verdict about the wrong
		// tree. The bare collection is what makes that visible: it names the missing packer,
		// where the working directory resolves one.
		const bare = await temp.dir();
		await expect(
			run(process.execPath, [BIN, 'site', `--quiver=${bare}`, `--out=${join(bare, 'site')}`])
		).rejects.toThrow(/npm install --save-dev @quillmark\/quiver/);
	});
});

describe('the bin without a verb', () => {
	it('prints usage and fails', async () => {
		await expect(run(process.execPath, [BIN])).rejects.toThrow(/Usage:/);
	});

	it('prints usage for a name the verb table inherits', async () => {
		// `toString` is on every object, so a dispatch reading the prototype chain calls it
		// and dies of a TypeError where an author is owed the usage line.
		await expect(run(process.execPath, [BIN, 'toString'])).rejects.toThrow(/Usage:/);
	});
});

describe('what the tool loads', () => {
	it('names the wasm artifact in no specifier of its own', async () => {
		// The engine is the collection's, reached by a resolved path at runtime, so the
		// artifact is in this process only when `test` puts it there. A static specifier
		// would put it in every verb's, which is what the single-copy rule forbids.
		// Prose naming it is not one.
		//
		// The tool's half of `dist` alone. The client beside it bundles the artifact on
		// purpose, that copy running in a browser tab in a process this one never
		// shares, so scanning it would answer about the wrong process.
		const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
		const files = (await readdir(DIST, { recursive: true })).filter(
			(f) => f.endsWith('.js') && !f.startsWith(CLIENT)
		);
		expect(files.length).toBeGreaterThan(0);

		for (const file of files) {
			const text = await readFile(join(DIST, file), 'utf8');
			const specifiers = [...text.matchAll(SPECIFIER)].map((m) => m[1]);
			expect(specifiers, `${file} reaches the wasm artifact`).not.toContain('@quillmark/wasm');
		}
	});
});
