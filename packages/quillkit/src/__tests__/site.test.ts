/**
 * The site layout, and the refusals around it.
 *
 * Getting the layout subtly wrong is silent: a client laid over the wrong tree loads the
 * wrong quiver, or none, and says so only in a browser.
 *
 * The client is a stand-in throughout except where the shipped one is the subject. The
 * layout is indifferent to what the client contains, so a suite that waited on a Vite
 * build to prove that would be paying seconds for nothing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENT } from '../paths.js';
import { assertClient, assertPacked, assertSafeOut, laySite } from '../site.js';
import { scratch } from './helpers/collection.js';

const temp = scratch('quillkit-site-');
afterEach(() => temp.cleanup());

/** A client of the shape `vite build` produces: an `index.html` and its assets. */
async function stubClient(): Promise<string> {
	const at = await temp.dir();
	await writeFile(join(at, 'index.html'), '<!doctype html><div id="studio"></div>');
	await mkdir(join(at, 'assets'), { recursive: true });
	await writeFile(join(at, 'assets', 'index.js'), '// the client');
	return at;
}

describe('laying a site out', () => {
	it('puts the client at the root and the quiver beneath it', async () => {
		const out = join(await temp.dir(), 'site');
		await laySite({ collection: await temp.collection(), out, client: await stubClient() });

		expect(existsSync(join(out, 'index.html'))).toBe(true);
		expect(existsSync(join(out, 'assets', 'index.js'))).toBe(true);
		// Where the client looks: `new URL('quiver/', document.baseURI)`.
		const { quills } = JSON.parse(await readFile(join(out, 'quiver', 'quiver.json'), 'utf8')) as {
			quills: Array<{ bundle: string }>;
		};
		expect(quills.length).toBeGreaterThan(0);
		for (const { bundle } of quills) expect(existsSync(join(out, 'quiver', bundle))).toBe(true);
	});

	it('packs the draft space only when asked', async () => {
		// The fixture's `usaf_memo` is `0.0.0`, under quiver's floor.
		const refs = async (drafts?: boolean): Promise<string[]> => {
			const out = join(await temp.dir(), 'site');
			const collection = await temp.collection();
			await laySite({ collection, out, client: await stubClient(), drafts });
			const { quills } = JSON.parse(await readFile(join(out, 'quiver', 'quiver.json'), 'utf8')) as {
				quills: Array<{ name: string; version: string }>;
			};
			return quills.map((q) => `${q.name}@${q.version}`);
		};

		expect(await refs()).not.toContain('usaf_memo@0.0.0');
		expect(await refs(true)).toContain('usaf_memo@0.0.0');
	});

	it('owns its output: a previous generation does not bleed through', async () => {
		const out = join(await temp.dir(), 'site');
		await mkdir(out, { recursive: true });
		await writeFile(join(out, 'stale.txt'), 'from a previous layout');
		await laySite({ collection: await temp.collection(), out, client: await stubClient() });

		expect(existsSync(join(out, 'stale.txt'))).toBe(false);
	});

	it('refuses before it deletes', async () => {
		// The refusals are checked ahead of the clear, so a rejected command leaves the
		// directory it was pointed at whole.
		const out = await temp.dir();
		await writeFile(join(out, 'keep.txt'), 'still here');
		const client = await stubClient();
		await rm(join(client, 'index.html'));

		await expect(laySite({ collection: await temp.collection(), out, client })).rejects.toThrow(
			/No client/
		);
		expect(existsSync(join(out, 'keep.txt'))).toBe(true);
	});
});

describe('the out refusals', () => {
	// The layout clears its output first, so these two spellings delete the thing being
	// laid out. Both are one keystroke from a correct command.
	it('refuses an out that holds the collection', () => {
		expect(() => assertSafeOut('/work/quiver', '/work')).toThrow(/the collection/);
		expect(() => assertSafeOut('/work/quiver', '/work/quiver')).toThrow(/the collection/);
	});

	it('refuses an out that holds the working directory', () => {
		expect(() => assertSafeOut('/elsewhere', process.cwd())).toThrow(/the working directory/);
		expect(() => assertSafeOut('/elsewhere', join(process.cwd(), '..'))).toThrow(
			/the working directory/
		);
	});

	it('allows an out nested inside the collection', () => {
		// `site/` under the quiver root is the ordinary layout, and nothing of the
		// source is read after the clear.
		expect(() => assertSafeOut('/work/quiver', '/work/quiver/site')).not.toThrow();
	});
});

describe('the client assertion', () => {
	it('refuses a client carrying a quiver of its own', async () => {
		// It would occupy the URL the author's is served from, and the winner would be
		// whichever copy landed last.
		const dist = await stubClient();
		await mkdir(join(dist, 'quiver'), { recursive: true });

		expect(() => assertClient(dist)).toThrow(/shadow/);
	});
});

describe('the pack assertion', () => {
	// The collection's copy of quiver packs and the client's copy reads, so a collection
	// pinned behind the client packs a tree the client fetches nothing of.
	it('refuses a pack the client cannot read, naming the upgrade', async () => {
		const out = await temp.dir();
		await writeFile(join(out, 'latest.json'), '{"format":1}');
		expect(() => assertPacked(out, '/work/quiver')).toThrow(/Upgrade it in the collection/);
	});
});

describe('the client this package carries', () => {
	// The one place the real client is the subject. `vite build` writes it beside the
	// compiled bin, which `npm run build` does and the gate runs before the suite.
	it('is the built client, and carries no quiver', async () => {
		expect(
			existsSync(join(CLIENT, 'index.html')),
			`no client at ${CLIENT}: run \`npm run build -w packages/quillkit\``
		).toBe(true);

		// Built, not the tree it is built from. The constant is spelled once for two
		// trees (this suite reads `src/paths.ts`, the bin runs `dist/paths.js`), and a
		// spelling that lands on `client/` from both resolves to a source directory
		// carrying an `index.html` of its own. What separates them is the entry: source
		// names `/main.ts`, and a build rewrites it to the emitted bundle.
		const html = await readFile(join(CLIENT, 'index.html'), 'utf8');
		expect(html).not.toContain('/main.ts');

		// `vite build` runs with `copyPublicDir: false` precisely so a dev run's packed
		// tree cannot ride into the tarball.
		expect(existsSync(join(CLIENT, 'quiver'))).toBe(false);
		expect(() => assertClient(CLIENT)).not.toThrow();
	});
});
