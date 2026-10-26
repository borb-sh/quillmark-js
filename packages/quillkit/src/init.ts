/**
 * `init`: a quiver from nothing (QUILLKIT §"Where a quiver comes from"). The quills come out
 * of the tarball's `starter/`; the files that name versions are written here.
 */

import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { STARTER } from './paths.js';

export interface Laid {
	/** The quiver's root. */
	at: string;
	/** Whether a `package.json` was written, or one already stood there. */
	wrotePackage: boolean;
	/** The one devDependency the quiver needs, as `npm install` takes it. */
	install: string;
}

/** What a scaffold writes beside the quills, and why each is absent from `starter/`:
 *  npm drops a `.gitignore` from a tarball, and prettier rewrites a card's `~~~` fence. */
const BESIDE: Record<string, string> = {
	'.gitignore': 'node_modules/\ndist/\n',
	'.prettierignore': '# Prettier rewrites a card-yaml `~~~` fence as a backtick fence.\nquills/\n'
};

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

	const own = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	const range = `^${own.version}`;

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
			scripts: {
				serve: 'quillkit serve --open',
				test: 'quillkit check',
				build: 'quillkit build app',
				preview: 'quillkit preview --open'
			},
			devDependencies: { quillkit: range }
		};
		await writeFile(manifest, `${JSON.stringify(pkg, null, '\t')}\n`);
	}
	return { at, wrotePackage, install: `quillkit@${range}` };
}
