/**
 * The deploy layout each target lays, and the refusals around it.
 *
 * Getting the layout subtly wrong is silent: a client laid over the wrong tree loads the
 * wrong quiver, or none, and says so only in a browser.
 *
 * The client is a stand-in throughout except where the shipped one is the subject. The
 * layout is indifferent to what the client contains, so a suite that waited on a Vite
 * build to prove that would be paying seconds for nothing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { APP_JSON, RESERVED } from '../app-files.js';
import { APP, STUDIO } from '../paths.js';
import {
	CLIENTS,
	DEFAULT_TARGET,
	TARGETS,
	assertClient,
	assertSafeOut,
	layOut,
	targetOf
} from '../deploy.js';
import { scratch } from './helpers/collection.js';

const temp = scratch('quillkit-deploy-');
afterEach(() => temp.cleanup());

/** A client of the shape `vite build` produces: an `index.html` and its assets. */
async function stubClient(): Promise<string> {
	const at = await temp.dir();
	await writeFile(join(at, 'index.html'), '<!doctype html><div id="app"></div>');
	await mkdir(join(at, 'assets'), { recursive: true });
	await writeFile(join(at, 'assets', 'index.js'), '// the client');
	return at;
}

/** The refs a laid quiver holds. */
async function packed(out: string): Promise<string[]> {
	const { quills } = JSON.parse(await readFile(join(out, 'quiver', 'quiver.json'), 'utf8')) as {
		quills: Array<{ name: string; version: string; bundle: string }>;
	};
	for (const { bundle } of quills) expect(existsSync(join(out, 'quiver', bundle))).toBe(true);
	return quills.map((q) => `${q.name}@${q.version}`);
}

describe('the targets', () => {
	it('lays the quiver alone for the quiver target', async () => {
		const out = join(await temp.dir(), 'dist');
		await layOut({ target: 'quiver', root: await temp.collection(), out });

		expect(await readdir(out)).toEqual(['quiver']);
		expect((await packed(out)).length).toBeGreaterThan(0);
	});

	it('lays the client at the root and the quiver beneath it for studio', async () => {
		const out = join(await temp.dir(), 'dist');
		await layOut({
			target: 'studio',
			root: await temp.collection(),
			out,
			client: await stubClient()
		});

		expect(existsSync(join(out, 'index.html'))).toBe(true);
		expect(existsSync(join(out, 'assets', 'index.js'))).toBe(true);
		// Where the client looks: `new URL('quiver/', document.baseURI)`.
		expect((await packed(out)).length).toBeGreaterThan(0);
		expect(existsSync(join(out, APP_JSON))).toBe(false);
	});

	it('lays app.json beside the client for the app, naming the quills the pack holds', async () => {
		const root = await temp.collection();
		const out = join(await temp.dir(), 'dist');
		await layOut({ target: 'app', root, out, client: await stubClient() });

		const app = JSON.parse(await readFile(join(out, APP_JSON), 'utf8'));
		const refs = await packed(out);
		expect(app.quills.length).toBeGreaterThan(0);
		for (const { ref } of app.quills) expect(refs).toContain(ref);
	});

	it('packs the draft space only when asked', async () => {
		// The fixture's `usaf_memo` is `0.0.0`, under quiver's floor.
		const refs = async (drafts?: boolean): Promise<string[]> => {
			const out = join(await temp.dir(), 'dist');
			await layOut({ target: 'quiver', root: await temp.collection(), out, drafts });
			return packed(out);
		};

		expect(await refs()).not.toContain('usaf_memo@0.0.0');
		expect(await refs(true)).toContain('usaf_memo@0.0.0');
	});

	it('takes the default where no target is named', () => {
		expect(targetOf(undefined, 'build')).toBe(DEFAULT_TARGET);
		expect(TARGETS).toContain(DEFAULT_TARGET);
	});
});

describe('the app target', () => {
	it('takes its icon by name, and writes nothing into the quiver', async () => {
		const root = await temp.collection();
		await writeFile(join(root, 'icon.svg'), '<svg/>');
		const before = await readdir(root);
		const out = join(await temp.dir(), 'dist');
		await layOut({ target: 'app', root, out, client: await stubClient() });

		const app = JSON.parse(await readFile(join(out, APP_JSON), 'utf8'));
		expect(app.icon).toBe('icon.svg');
		expect(existsSync(join(out, 'icon.svg'))).toBe(true);
		expect(await readdir(root)).toEqual(before);
	});

	it('copies the author files app.css names, and refuses one outside the quiver', async () => {
		const root = await temp.collection();
		await mkdir(join(root, 'fonts'), { recursive: true });
		await writeFile(join(root, 'fonts', 'brand.woff2'), 'font');
		await writeFile(
			join(root, 'app.css'),
			"@font-face { font-family: Brand; src: url('fonts/brand.woff2'); }\n"
		);
		const out = join(await temp.dir(), 'dist');
		await layOut({ target: 'app', root, out, client: await stubClient() });

		expect(existsSync(join(out, 'app.css'))).toBe(true);
		expect(existsSync(join(out, 'fonts', 'brand.woff2'))).toBe(true);

		await writeFile(join(root, 'app.css'), "body { background: url('../elsewhere.png'); }\n");
		await expect(layOut({ target: 'app', root, out, client: await stubClient() })).rejects.toThrow(
			/outside the quiver/
		);
		// Refused before the clear, so the last deploy stands.
		expect(existsSync(join(out, 'app.css'))).toBe(true);
	});

	it('warns on a selector the theming contract does not promise, and on a quill with no licence', async () => {
		const root = await temp.collection();
		await writeFile(join(root, 'app.css'), '.qm-app-header { color: red } .qm-bar { gap: 0 }\n');
		const out = join(await temp.dir(), 'dist');
		const { warnings } = await layOut({ target: 'app', root, out, client: await stubClient() });

		expect(warnings.some((w) => w.includes('.qm-bar'))).toBe(true);
		expect(warnings.some((w) => w.includes('.qm-app-header'))).toBe(false);

		const { quills } = JSON.parse(await readFile(join(out, APP_JSON), 'utf8'));
		const unlicensed: string[] = [];
		for (const { ref } of quills as { ref: string }[]) {
			const [name, version] = ref.split('@');
			const yaml = parse(
				await readFile(join(root, 'quills', name!, version!, 'Quill.yaml'), 'utf8')
			);
			if (!yaml.quill.license) unlicensed.push(ref);
		}
		expect(warnings.filter((w) => w.includes('declares no license')).length).toBe(
			unlicensed.length
		);
	});
});

describe('owning the output', () => {
	it('clears it: a previous generation does not bleed through', async () => {
		const out = join(await temp.dir(), 'dist');
		await mkdir(out, { recursive: true });
		await writeFile(join(out, 'stale.txt'), 'from a previous build');
		await layOut({
			target: 'studio',
			root: await temp.collection(),
			out,
			client: await stubClient()
		});

		expect(existsSync(join(out, 'stale.txt'))).toBe(false);
	});

	it('refuses before it deletes', async () => {
		const out = await temp.dir();
		await writeFile(join(out, 'keep.txt'), 'still here');
		const client = await stubClient();
		await rm(join(client, 'index.html'));

		await expect(
			layOut({ target: 'studio', root: await temp.collection(), out, client })
		).rejects.toThrow(/No client/);
		await expect(
			layOut({ target: 'studio', root: out, out, client: await stubClient() })
		).rejects.toThrow(/Refusing to build/);
		const root = await temp.collection();
		await writeFile(join(root, 'App.yaml'), 'colour: blue\n');
		await expect(layOut({ target: 'app', root, out, client: await stubClient() })).rejects.toThrow(
			/unknown key "colour"/
		);
		expect(existsSync(join(out, 'keep.txt'))).toBe(true);
	});

	it('refuses a quiver the packer refuses before it deletes, for every target', async () => {
		const root = await temp.collection();
		const out = join(await temp.dir(), 'dist');
		await layOut({ target: 'studio', root, out, client: await stubClient() });
		const before = await packed(out);
		await mkdir(join(root, 'quills', 'showcase', 'bad'), { recursive: true });
		await writeFile(join(root, 'quills', 'showcase', 'bad', 'Quill.yaml'), '');

		for (const target of TARGETS) {
			const client = CLIENTS[target] && (await stubClient());
			await expect(layOut({ target, root, out, client })).rejects.toThrow(
				/non-canonical version directory/
			);
		}
		expect(await packed(out)).toEqual(before);
		expect(existsSync(join(out, 'index.html'))).toBe(true);
		expect(existsSync(`${out}.quiver`)).toBe(false);
	});

	it('refuses an out that holds the quiver or the working directory', () => {
		expect(() => assertSafeOut('/work/quiver', '/work')).toThrow(/the quiver/);
		expect(() => assertSafeOut('/work/quiver', '/work/quiver')).toThrow(/the quiver/);
		expect(() => assertSafeOut('/elsewhere', process.cwd())).toThrow(/the working directory/);
		expect(() => assertSafeOut('/elsewhere', join(process.cwd(), '..'))).toThrow(
			/the working directory/
		);
	});

	it('allows an out nested inside the quiver', () => {
		expect(() => assertSafeOut('/work/quiver', '/work/quiver/dist')).not.toThrow();
	});

	it('refuses a client carrying a quiver of its own', async () => {
		// It would occupy the URL the laid one is served from.
		const dist = await stubClient();
		await mkdir(join(dist, 'quiver'), { recursive: true });
		expect(() => assertClient(dist)).toThrow(/shadow/);
	});
});

describe('the clients this package carries', () => {
	// The one place the real clients are the subject. `vite build` writes each beside the
	// compiled bin, which `npm run build` does and the gate runs before the suite.
	it('are built, and carry no quiver', async () => {
		for (const at of [STUDIO, APP]) {
			expect(
				existsSync(join(at, 'index.html')),
				`no client at ${at}: run \`npm run build -w packages/quillkit\``
			).toBe(true);
			// Built, not the tree it is built from: source names `/main.ts`, and a build
			// rewrites it to the emitted bundle.
			expect(await readFile(join(at, 'index.html'), 'utf8')).not.toContain('/main.ts');
			expect(() => assertClient(at)).not.toThrow();
		}
	});

	it('leave every name an author file could take free, but the ones the app reserves', async () => {
		for (const entry of await readdir(APP)) expect(RESERVED).toContain(entry);
	});
});
