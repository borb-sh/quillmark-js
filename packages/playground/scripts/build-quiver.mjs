// Packs the workspace's fixture quiver into `static/quiver.qv`, where the app fetches
// it at runtime. A browser cannot read the source layout, so this deploy-time pack
// is the step every browser consumer of a quiver performs
// (PLAYGROUND §"Quiver, not bundler").
//
// `static/` is Kit's verbatim-copy tree, so one output serves both `vite dev` and the
// static build. Generated, and gitignored.
//
// `--drafts` packs what is under the quiver's floor as well, which is `usaf_memo@0.0.0`
// and the fixture picker's second entry. `predev` asks for it and `prebuild` does not:
// a deploy serves the reference quill alone (fixtures/Quiver.yaml).

import { fileURLToPath } from 'node:url';
import { build } from '@quillmark/quiver/node';

const SOURCE = fileURLToPath(new URL('../../../fixtures', import.meta.url));
const OUT = fileURLToPath(new URL('../static/quiver.qv', import.meta.url));
const drafts = process.argv.includes('--drafts');

await build(SOURCE, OUT, { drafts });
console.log(`quiver packed: fixtures/ → static/quiver.qv${drafts ? ' (drafts included)' : ''}`);
