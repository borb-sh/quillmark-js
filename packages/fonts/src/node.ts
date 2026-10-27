/**
 * The Node entry: `loadSuite` reading the files off disk, for a test, a server render or a
 * gate. The browser entry fetches the same files; neither imports the other.
 */

import { readFile } from 'node:fs/promises';
import { FILES } from './suite.js';

export { FAMILIES } from './suite.js';

/** Every face in the suite, in the manifest's order, as the browser entry's `loadSuite`. */
export async function loadSuite(): Promise<Uint8Array[]> {
	return Promise.all(FILES.map(async (url) => new Uint8Array(await readFile(url))));
}
