/**
 * A collection's templates: starter documents beside the quiver, listed by a
 * `templates.json` in their directory. The quiver loaders read none of them, so the
 * directory is named to the verb rather than found in the layout, and the client learns
 * of it from what is served at `templates/` (STUDIO §"The document has doors").
 *
 * Checked here once, before anything is served or cleared: an entry naming a file the
 * directory does not hold is a picker offering a 404.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { within } from './paths.js';

/** The manifest's name inside the directory, which is where the client fetches it. */
export const MANIFEST = 'templates.json';

/** What the client reads of an entry. Other keys ride along unread. */
export interface Template {
	name: string;
	file: string;
	description?: string;
}

/** Returns the directory, resolved, once every entry names a file inside it. */
export function assertTemplates(dir: string): string {
	const at = resolve(dir);
	const manifest = join(at, MANIFEST);
	if (!existsSync(manifest)) throw new Error(`--templates ${dir} holds no ${MANIFEST}`);

	let entries: unknown;
	try {
		entries = JSON.parse(readFileSync(manifest, 'utf8'));
	} catch (err) {
		throw new Error(`${manifest} is not JSON`, { cause: err });
	}
	if (!Array.isArray(entries)) throw new Error(`${manifest} is not an array of templates`);

	entries.forEach((entry: Partial<Template>, i) => {
		const which = `${manifest}[${i}]`;
		if (typeof entry?.name !== 'string' || entry.name === '')
			throw new Error(`${which} has no \`name\``);
		if (typeof entry.file !== 'string' || entry.file === '')
			throw new Error(`${which} has no \`file\``);
		if (entry.description !== undefined && typeof entry.description !== 'string')
			throw new Error(`${which}'s \`description\` is not a string`);
		const file = resolve(at, entry.file);
		if (!within(at, file) || !existsSync(file) || !statSync(file).isFile())
			throw new Error(`${which} names "${entry.file}", which is not a file in ${dir}`);
	});

	return at;
}
