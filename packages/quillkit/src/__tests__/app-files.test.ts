/**
 * The app target's inputs, read: what `App.yaml` may say, which quills the app opens, and
 * what `app.css` reaches for. The layout they land in is `deploy.test.ts`'s.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromDir, isDraft } from '@quillmark/quiver/node';
import { APP_YAML, PROMISED, appRefs, readAppYaml, scanCss } from '../app-files.js';
import { scratch } from './helpers/collection.js';

const THEMING = fileURLToPath(new URL('../../../svelte/THEMING.md', import.meta.url));

const temp = scratch('quillkit-app-');
afterEach(() => temp.cleanup());

async function withAppYaml(text: string): Promise<string> {
	const at = await temp.dir();
	await writeFile(join(at, APP_YAML), text);
	return at;
}

describe('App.yaml', () => {
	it('is optional', async () => {
		expect(readAppYaml(await temp.dir())).toBeUndefined();
	});

	it('reads what the app is', async () => {
		const at = await withAppYaml('title: Memos\ndescription: Fill it in.\n');
		expect(readAppYaml(at)).toEqual({ title: 'Memos', description: 'Fill it in.' });
	});

	it('refuses a key it does not know, which is how a look would creep in', async () => {
		for (const key of ['theme', 'quills', 'icon'])
			await expect(withAppYaml(`${key}: x\n`).then(readAppYaml), key).rejects.toThrow(
				new RegExp(`unknown key "${key}"`)
			);
	});

	it('refuses a value of the wrong shape', async () => {
		for (const text of ['title: [a]\n', "title: ''\n", 'description: 1\n'])
			await expect(withAppYaml(text).then(readAppYaml), text).rejects.toThrow(/App\.yaml/);
	});
});

describe('the quills', () => {
	it('are every quill the quiver holds, at its latest version', async () => {
		const quiver = await fromDir(await temp.collection());

		expect(appRefs(quiver, true)).toEqual(quiver.quillNames().map((name) => quiver.resolve(name)));
	});

	it('admit a draft only under --drafts', async () => {
		const quiver = await fromDir(await temp.collection());
		const draft = quiver
			.quillNames()
			.find((name) => quiver.versionsOf(name).every((v) => isDraft(v)));
		expect(draft, 'the reference quiver holds a quill only in drafts').toBeDefined();

		expect(appRefs(quiver, true)).toContain(quiver.resolve(draft!));
		expect(appRefs(quiver, false)).not.toContain(quiver.resolve(draft!));
	});
});

describe('app.css', () => {
	it('names the files its url()s reach beside it, and no one else’s', () => {
		const { urls, absolute } = scanCss(`
			/* url(commented.woff2) */
			@font-face { src: url("fonts/a.woff2?v=1#x") format('woff2'), url(fonts/b%20c.woff); }
			header { background: url(data:image/png;base64,AAAA), url(https://cdn.example/x.png); }
			.x { mask: url(#m); background-image: url('/root.png'); }
		`);
		expect(urls).toEqual(['fonts/a.woff2', 'fonts/b c.woff']);
		expect(absolute).toEqual(['/root.png']);
	});

	it('flags what it aims at beyond the promise', () => {
		const { stray } = scanCss(`
			.qm-app-header .qm-app-title { color: white }
			[data-qm-card="indorsement"] { border-left: 3px solid }
			.qm-bar, [data-qm-prop='to'] { gap: 0 }
			.mine { content: ".qm-not-a-selector" }
		`);
		expect(stray.sort()).toEqual(['.qm-bar', '[data-qm-prop]']);
	});

	it('is promised nothing THEMING.md does not promise', () => {
		const promised = new Set(
			[...readFileSync(THEMING, 'utf8').matchAll(/`\.(qm-[\w-]+)`/g)].map((m) => m[1])
		);
		for (const name of PROMISED) expect(promised, name).toContain(name);
	});
});
