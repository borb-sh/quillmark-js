/**
 * The browser entry. Each face's file sits beside this module and is fetched through
 * `new URL(file, import.meta.url)`, which Vite and webpack 5 emit as a hashed static asset
 * with no plugin. The `/node` entry reads the same files off disk.
 */

import { FILES } from './suite.js';

export { FAMILIES } from './suite.js';

/**
 * Every face in the suite, in the manifest's order: the `fonts` `new Engine({ fonts })`
 * takes, with a host's extras appended after them. Rejects naming the first file that would
 * not load.
 */
export async function loadSuite(): Promise<Uint8Array[]> {
	return Promise.all(
		FILES.map(async (url) => {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`@quillmark/fonts: ${url.href} answered ${res.status}`);
			return new Uint8Array(await res.arrayBuffer());
		})
	);
}
