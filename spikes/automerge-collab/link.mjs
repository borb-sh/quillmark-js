// Points node_modules/@quillmark/wasm at a local build of the binding (`./scripts/build-wasm.sh`
// in a quillmark checkout leaves it in `pkg/`), so the tests run against the branch under test
// rather than the published package. The published one stays installed as
// `@quillmark/wasm-published`, for the size comparison.
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = process.env.QUILLMARK_WASM_PKG;
if (!pkg || !existsSync(join(pkg, 'package.json'))) {
	console.error(
		'Set QUILLMARK_WASM_PKG to a built @quillmark/wasm package directory (quillmark/pkg).'
	);
	process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const link = join(here, 'node_modules', '@quillmark', 'wasm');
mkdirSync(dirname(link), { recursive: true });
if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false }))
	rmSync(link, { recursive: true });
symlinkSync(resolve(pkg), link, 'dir');
console.log(`${link} -> ${resolve(pkg)}`);
