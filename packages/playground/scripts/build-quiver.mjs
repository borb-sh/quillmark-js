// Packs the workspace's fixture quiver into `static/quiver/`, and copies each quill's
// template document into `static/templates/`, where the app fetches both at runtime. A
// browser cannot read the source layout, so this deploy-time pack is the step every
// browser consumer of a quiver performs (PLAYGROUND §"Quiver, not bundler").
//
// `static/` is Kit's verbatim-copy tree, so one output serves both `vite dev` and the
// static build. Generated, and gitignored.
//
// `--drafts` packs what is under the quiver's floor as well, which is `usaf_memo@0.0.0`
// and the fixture picker's second entry. `predev` asks for it and `prebuild` does not:
// a deploy serves the reference quill alone (fixtures/Quiver.yaml).

import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from '@quillmark/quiver/node';

const SOURCE = fileURLToPath(new URL('../../../fixtures', import.meta.url));
const OUT = fileURLToPath(new URL('../static/quiver', import.meta.url));
const TEMPLATES = fileURLToPath(new URL('../../../fixtures/templates', import.meta.url));
const TEMPLATES_OUT = fileURLToPath(new URL('../static/templates', import.meta.url));
const drafts = process.argv.includes('--drafts');

await build(SOURCE, OUT, { drafts });
await cp(TEMPLATES, TEMPLATES_OUT, { recursive: true });
console.log(`quiver packed: fixtures/ → static/quiver${drafts ? ' (drafts included)' : ''}`);
