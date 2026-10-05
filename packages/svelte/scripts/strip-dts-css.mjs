// Drops the stylesheet imports `svelte-package` carries into `dist/**/*.d.ts`. An import in a
// declaration loads nothing, and under TypeScript 6's `noUncheckedSideEffectImports` a
// `.css` one is an error for a consumer checking libraries, no declaration answering it.
// The `.js` beside each declaration keeps its imports, so the sheets still load.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const CSS_IMPORT = /^import\s+(['"])[^'"]+\.css\1;?\n/gm;

let dropped = 0;
for (const name of readdirSync(DIST, { recursive: true })) {
	if (!name.endsWith('.d.ts')) continue;
	const file = join(DIST, name);
	const text = readFileSync(file, 'utf8');
	const kept = text.replace(CSS_IMPORT, () => (dropped++, ''));
	if (kept !== text) writeFileSync(file, kept);
}
console.log(`dist declarations: ${dropped} stylesheet imports dropped`);
