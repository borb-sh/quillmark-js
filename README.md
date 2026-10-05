# quillmark-js

The JavaScript tier downstream of the [`@quillmark/wasm`](https://github.com/borb-sh/quillmark) artifact.

| Package                                |                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`@quillmark/svelte`](packages/svelte) | Editing, live-preview and source surfaces over a session.                                              |
| [`@quillmark/quiver`](packages/quiver) | Collections of quills, resolved and loaded.                                                            |
| [`quillkit`](packages/quillkit)        | The quill author's toolchain: one bin over gate, pack, look at, ship, and the studio client it serves. |
| [`playground`](packages/playground)    | The app that composes them, for a developer reading the library; deployed as the Pages site.           |

A quill author types one name, `quillkit`, and pins two: the tool resolves the loader and the engine out of the collection's own `node_modules`, so the versions a collection depends on decide what packs it and what renders it. The client it draws with is the tool's own, carried rather than resolved, since no version an author pins makes a client more theirs.

A package whose JS a consumer imports peers `@quillmark/wasm` and never depends on it, so the consumer supplies the one copy whose linear memory the handles index into; a bundled terminal, imported by nobody, contains it instead. `check:deps` holds the peer half and the rest of the graph (`scripts/check-deps.mjs`); what a terminal's manifest may hold is review's.

## Development

```sh
npm install                # one install, every package
npm run dev                # the playground at :5173
npm run dev:studio         # the studio client at :5173
npm run build              # quiver → svelte → quillkit and the playground, in that order
npm run site               # the fixture quiver as a deploy serves it, into ./site
npm test                   # every package's suite
npm run check              # types, per package
npm run lint               # prettier, over the repo
npm run gate:fast          # every check below, in order, without a build
npm run gate               # gate:fast, then build, bundle and the suite
npm run check:docs         # every cross-doc section reference, and the stated wasm pin
npm run check:style        # the closed `--_qm-*` / `--pg-*` / `--st-*` scales
npm run check:deps         # the dependency law
npm run check:svelte       # the Svelte 5 forms, over every package that depends on svelte
npm run check:bundle       # the same scales, in a built consumer
```

The gates hold what a reviewer cannot see for itself: a rung that resolves to nothing, a promise that outranks a consumer, a pointer at a heading that moved, an edge between two siblings. What is legible in a diff — a value's own shape, a manifest's, a declaration in a JS string — is review's, with one exception: the Svelte 5 rule admits no case for review to weigh, so `check:svelte` refuses a Svelte 4 form outright.

Everything runs against the one reference quill, [`fixtures/quills/showcase/1.0.0`](fixtures/quills/showcase), a dev fixture at the workspace root, never published: it declares a field for every control the tier draws and three card kinds, so a surface is exercised against a schema rather than against a mock.

## Canon

The settled systems, per tier: [`svelte`'s](packages/svelte/prose/canon/INDEX.md), [`quiver`'s](packages/quiver/prose/canon/INDEX.md), [`quillkit`'s](packages/quillkit/prose/canon/INDEX.md) (the tool and the studio client both), [the playground's](packages/playground/prose/canon/INDEX.md). Work that is not settled lives in GitHub issues.
