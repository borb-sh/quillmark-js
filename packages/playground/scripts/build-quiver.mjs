// Packs the workspace's fixture quiver into `static/quiver/`, where the app fetches it
// at runtime. A browser cannot read the source layout, so this deploy-time pack is the step every
// browser consumer of a quiver performs (PLAYGROUND §"Quiver, not bundler").
//
// `static/` is Kit's verbatim-copy tree, so one output serves both `vite dev` and the
// static build. Generated, and gitignored.
//
// The pack lifts the quiver's floor for dev and deploy alike: the playground is a
// harness, a viewer rather than a quill deployment, and `usaf_memo@0.0.0` under the
// floor is the fixture picker's second entry (fixtures/Quiver.yaml).

import { fileURLToPath } from 'node:url';
import { build } from '@quillmark/quiver/node';

const SOURCE = fileURLToPath(new URL('../../../fixtures', import.meta.url));
const OUT = fileURLToPath(new URL('../static/quiver', import.meta.url));

await build(SOURCE, OUT, { drafts: true });
console.log('quiver packed: fixtures/ → static/quiver (drafts included)');
