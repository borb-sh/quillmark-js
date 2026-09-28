/**
 * The manifest check `--templates` runs before anything is served or cleared: an entry
 * the client cannot open is a picker offering a 404.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertTemplates } from '../templates.js';
import { scratch } from './helpers/collection.js';

const temp = scratch('quillkit-templates-');
afterEach(() => temp.cleanup());

async function templates(manifest: unknown, files: string[] = []): Promise<string> {
	const at = await temp.dir();
	await writeFile(join(at, 'templates.json'), JSON.stringify(manifest));
	for (const file of files) await writeFile(join(at, file), '~~~\n$quill: q@1.0.0\n~~~\n');
	return at;
}

describe('the templates manifest', () => {
	it("passes the reference quiver's own", async () => {
		const collection = await temp.collection();
		expect(assertTemplates(join(collection, 'templates'))).toBe(join(collection, 'templates'));
	});

	it('passes keys it does not read', async () => {
		const at = await templates(
			[{ id: 'a', name: 'A', description: 'one', file: 'a.md', tags: ['x'] }],
			['a.md']
		);
		expect(() => assertTemplates(at)).not.toThrow();
	});

	it('refuses a directory with no manifest', async () => {
		const at = await temp.dir();
		expect(() => assertTemplates(at)).toThrow(/holds no templates\.json/);
	});

	it('refuses a manifest that is not a list', async () => {
		const at = await templates({ name: 'A' });
		expect(() => assertTemplates(at)).toThrow(/not an array/);
	});

	it('refuses an entry without a name or a file', async () => {
		const nameless = await templates([{ file: 'a.md' }], ['a.md']);
		expect(() => assertTemplates(nameless)).toThrow(/\[0\] has no `name`/);
		const fileless = await templates([{ name: 'A' }]);
		expect(() => assertTemplates(fileless)).toThrow(/\[0\] has no `file`/);
	});

	it('refuses a file the directory does not hold', async () => {
		const missing = await templates([{ name: 'A', file: 'a.md' }]);
		expect(() => assertTemplates(missing)).toThrow(/not a file/);

		const outside = await templates([{ name: 'A', file: '../outside.md' }]);
		const beside = join(outside, '..', 'outside.md');
		await writeFile(beside, '');
		try {
			expect(() => assertTemplates(outside)).toThrow(/not a file/);
		} finally {
			await rm(beside);
		}

		const dir = await templates([{ name: 'A', file: 'dir.md' }]);
		await mkdir(join(dir, 'dir.md'));
		expect(() => assertTemplates(dir)).toThrow(/not a file/);
	});
});
