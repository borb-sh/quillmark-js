/**
 * `init`: a quiver from nothing (QUILLKIT §"Where a quiver comes from"). The quills come
 * out of the tarball's `starter/`; the files that name versions are written here.
 */

import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { CLIENT, STARTER } from './paths.js';

export interface Laid {
	/** The quiver's root. */
	at: string;
	/** Whether a `package.json` was written, or one already stood there. */
	wrotePackage: boolean;
	/** The devDependencies the starter needs, as `npm install` takes them. */
	install: string[];
}

/** What a scaffold writes beside the quills, and why each is absent from `starter/`:
 *  npm drops a `.gitignore` from a tarball, and prettier rewrites a card's `~~~` fence. */
const BESIDE: Record<string, string> = {
	'.gitignore': 'node_modules/\ndist/\nsite/\n',
	'.prettierignore': '# Prettier rewrites a card-yaml `~~~` fence as a backtick fence.\nquills/\n'
};

/** The versions a fresh collection pins: this tool's, and the loader and wasm its client
 *  was built against. */
async function versions(): Promise<Record<string, string>> {
	const own = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	const stamp = join(CLIENT, 'carried.json');
	if (!existsSync(stamp)) throw new Error(`${stamp} is missing: the client is not built`);
	const carried = JSON.parse(await readFile(stamp, 'utf8'));
	return {
		'@quillmark/quiver': carried['@quillmark/quiver'],
		'@quillmark/wasm': carried['@quillmark/wasm'],
		quillkit: own.version
	};
}

/** An npm package name out of a directory's: lowercase, and nothing npm refuses. */
function packageName(dir: string): string {
	const name = basename(dir)
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^[._-]+|-+$/g, '');
	return name === '' ? 'my-quiver' : name;
}

export async function layStarter(dir: string): Promise<Laid> {
	const at = resolve(dir);
	const laid = await readdir(STARTER);
	for (const entry of laid) {
		const path = join(at, entry);
		if (existsSync(path)) throw new Error(`${path} already exists: init lays a new quiver`);
	}

	const pins = await versions();
	const install = Object.entries(pins).map(([name, v]) => `${name}@^${v}`);

	await mkdir(at, { recursive: true });
	for (const entry of laid) await cp(join(STARTER, entry), join(at, entry), { recursive: true });
	for (const [file, text] of Object.entries(BESIDE))
		if (!existsSync(join(at, file))) await writeFile(join(at, file), text);

	const manifest = join(at, 'package.json');
	const wrotePackage = !existsSync(manifest);
	if (wrotePackage) {
		const pkg = {
			name: packageName(at),
			version: '0.1.0',
			private: true,
			scripts: { studio: 'quillkit studio', test: 'quillkit test' },
			devDependencies: Object.fromEntries(Object.entries(pins).map(([n, v]) => [n, `^${v}`]))
		};
		await writeFile(manifest, `${JSON.stringify(pkg, null, '\t')}\n`);
	}
	return { at, wrotePackage, install };
}
