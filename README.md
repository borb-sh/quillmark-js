# quillmark-js

The JavaScript tier downstream of the [`@quillmark/wasm`](https://github.com/borb-sh/quillmark) artifact.

| Package                                |                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [`@quillmark/svelte`](packages/svelte) | Editing, live-preview and source surfaces over a session.                                                                   |
| [`@quillmark/quiver`](packages/quiver) | Collections of quills, resolved and loaded.                                                                                 |
| [`@quillmark/fonts`](packages/fonts)   | The font suite every client hands its engine, so a family a document names sets the same way everywhere.                    |
| [`@quillmark/collab`](packages/collab) | Live editing: a `Document` bound to a shared Yjs state, and the session log its clients merge through.                      |
| [`quillkit`](packages/quillkit)        | The quill author's toolchain: one bin over start, gate, look at, build and preview, and the studio and app clients it lays. |
| [`playground`](packages/playground)    | The app that composes them, for a developer reading the library; deployed as the Pages site.                                |

A quill author types one name, `quillkit`, and pins one: the tool carries the loader, the engine and the font suite at exact versions, and its clients are built against the same three, so what the gate renders and what a deploy serves are one release.

A package whose JS a consumer imports peers `@quillmark/wasm` and never depends on it, so the consumer supplies the one copy whose linear memory the handles index into; a bundled terminal, imported by nobody, contains it instead, and pins it exactly. `check:deps` holds both halves and the rest of the graph (`scripts/check-deps.mjs`).

## Development

```sh
npm install                # one install, every package
npm run dev                # the playground at :5173
npm run dev:studio         # the studio client at :5173
npm run build              # quiver, svelte, fonts and collab → quillkit and the playground, in that order
npm run site               # the fixture quiver's studio as a deploy serves it, into ./site
npm test                   # every package's suite
npm run check              # types, per package
npm run lint               # prettier, over the repo
npm run gate:fast          # every check below, in order, without a build
npm run gate               # gate:fast, then build, bundle and the suite
npm run check:docs         # every cross-doc section reference, and the stated wasm pin
npm run check:style        # the closed `--_qm-*` / `--pg-*` / `--st-*` scales
npm run check:deps         # the dependency law
npm run check:svelte       # the Svelte 5 forms, over every package that depends on svelte
npm run check:fonts        # the font suite's files against its manifest
npm run check:bundle       # the same scales, in a built consumer
```

Everything runs against the reference quill, [`fixtures/quills/showcase/1.0.0`](fixtures/quills/showcase), a dev fixture at the workspace root, never published (beside it sits `usaf_memo`, a held copy of a shipped quill; see [`fixtures/Quiver.yaml`](fixtures/Quiver.yaml)): it declares a field for every control the tier draws and three card kinds, so a surface is exercised against a schema rather than against a mock.

## Canon

The settled systems, per tier: [`svelte`'s](packages/svelte/prose/canon/INDEX.md), [`quiver`'s](packages/quiver/prose/canon/INDEX.md), [`fonts`'](packages/fonts/prose/canon/INDEX.md), [`collab`'s](packages/collab/prose/canon/INDEX.md), [`quillkit`'s](packages/quillkit/prose/canon/INDEX.md) (the tool and both clients), [the playground's](packages/playground/prose/canon/INDEX.md). Work that is not settled lives in GitHub issues.
