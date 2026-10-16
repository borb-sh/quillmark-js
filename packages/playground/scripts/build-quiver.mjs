// Packs the workspace's fixture quiver into `static/quiver/`, where the app fetches it
// at runtime. A browser cannot read the source layout, so this deploy-time pack is the step every
// browser consumer of a quiver performs (PLAYGROUND §"Quiver, not bundler").
//
// `static/` is Kit's verbatim-copy tree, so one output serves both `vite dev` and the
// static build. Generated, and gitignored.
//
// `--drafts` lifts the quiver's floor, and only `predev` passes it: a dev server offers
// `usaf_memo@0.0.0` as the picker's second entry, and the Pages build serves `showcase`
// alone (fixtures/Quiver.yaml).

import { fileURLToPath } from 'node:url';
import { build } from '@quillmark/quiver/node';

const SOURCE = fileURLToPath(new URL('../../../fixtures', import.meta.url));
const OUT = fileURLToPath(new URL('../static/quiver', import.meta.url));

const drafts = process.argv.includes('--drafts');
await build(SOURCE, OUT, { drafts });
console.log(
	`quiver packed: fixtures/ → static/quiver (drafts ${drafts ? 'included' : 'left out'})`
);
