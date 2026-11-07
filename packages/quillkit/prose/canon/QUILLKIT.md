# Quillkit

> **Implementation**: `src/` · `src/bin/` · `client/` · `app/`

## TL;DR

The verbs a quill author types, one bin over a quiver's whole life: `init` starts one, `check` gates it, `serve` shows it as it is edited, `build` lays it out for a static host, and `preview` serves that layout the way the host will. A verb's argument is a target, `studio` where none is named: `quiver` is the pack alone, `studio` is the client the quiver's authors judge it in ([STUDIO.md](STUDIO.md)), and `app` is the client the people filling its forms in reach ([APP.md](APP.md)). It is the only name in the toolchain an author installs: a quiver's `package.json` lists `quillkit` in `devDependencies` and nothing else, and the loaders a browser consumer reaches stay [`@quillmark/quiver`](../../../quiver/prose/canon/QUIVER.md)'s.

## Verbs and targets

| Verb | Takes | Does |
| --- | --- | --- |
| `init` | `[<dir>]` | Lays a quiver: `Quiver.yaml`, one quill, a `package.json` naming quillkit. |
| `check` | `[-D] [--strict]` | Renders every version's seed and example, drafts included, and resolves the app where there is one. |
| `build` | `[target] [-o <dir>] [-D]` | Lays the target's deploy into `dist/`, or `-o`. |
| `serve` | `[target] [-p <n>] [--open]` | Packs, serves the target over the pack, repacks on change. |
| `preview` | `[-o <dir>] [-p <n>] [--open]` | Serves the build in `dist/`, or `-o`, with the host's rules. |

**The quiver is the working directory.** No verb takes a path to it, so a `scripts` entry and a terminal mean the same tree. A verb refuses a flag it does not take rather than read it as absent.

**`-D` lifts quiver's draft floor** (QUIVER §"The draft floor") on what `build` packs and on the quills the app opens when `check` resolves it.

**Every verb's default target is studio**, the client a quiver's own authors judge it in; a pipeline deploying the app names `app`.

**`serve` shows the source, `preview` the build.** A deploy records which target it was built for, so `preview` takes no target.

**No base path is configured.** Each client resolves everything relative to `document.baseURI`, so one build serves a root, a subpath and a preview URL unchanged.

## One pin

quillkit's runtime dependencies are `@quillmark/wasm`, `@quillmark/quiver` and `@quillmark/fonts`, all at exact versions. The bin packs with the quiver it carries, `check` renders with the wasm and fonts it carries, and both clients are built against the same three, so what the gate renders, what `serve` shows and what a deploy serves are one release by construction. An author upgrades the whole set by moving one devDependency.

**Exact, because the clients are bundled.** A range would let an install pair this bin with a wasm or quiver its clients were not built with, and the gate would pass a render the deployed page does not perform. `check:deps` holds the pins exact. The collection's own `node_modules` decides nothing.

**One wasm per process, and mostly none.** Only `check` and the app target instantiate the wasm in Node; the packer instantiates nothing and each client runs in a browser tab. There is no importable entry, so no handle minted here reaches another copy.

## Blocked on, looked at

`check` is what an author is **blocked on**: it runs in their CI and fails a build. `serve` and the deploys are what they **look at**, and nothing fails a build on their verdict.

**The gate loads and renders** every quill's seed, one card per kind with every field absent, so it proves the plate renders the blank a reader starts from.

**What an author wrote is held to every diagnostic.** A quill's example document fails on any diagnostic `quill.validate` raises, warnings included, since every value in it is the author's to fix. The render's own warnings and the quill's load warnings print under its `pass` line and fail it only under `--strict`.

**A failure prints as the CLI prints it**, every diagnostic whole through the wasm's `formatDiagnostic`.

**The app resolves too.** With an `App.yaml` or `app.css` present, the gate runs what `build app` runs before writing, so a bad app fails the gate as it would fail the deploy.

**One door.** An author on another test runner spawns the bin and gates what CI gates; a second entry onto the verdict would be a second answer under one name.

## Where a quiver comes from

`init` lays `Quiver.yaml` and a single quill out of the tarball's `starter/`, plus a `package.json` ranging `quillkit` and nothing else, with scripts for `serve`, `test`, `build` and `preview`, so `npm test` is the gate.

**The starter is a quiver the suite gates**, so a scaffold that stops rendering fails CI before it fails an author on their first command.

**One shape, no options.** The quill is the smallest one worth reading, since the first thing an author does is rename and delete: a field of each kind an author copies by analogy, a body, one card kind and an example on everything. It ships no font and declares `CC0-1.0`, so its first `build app` raises no licensing warning.

**It refuses rather than merges.** A starter entry already in the directory fails the verb before anything is written; an existing `package.json` is left alone.

## The local loop

`serve` packs the source into `node_modules/.quillkit/quiver`, serves the target's client over the pack, and repacks when the source changes. The pack always includes drafts, since a quill under `0.1.0` is the likeliest thing on an author's screen.

**The pack lands whole, and that is quiver's** (QUIVER §"The generation lands whole"). What is left here is the trigger: watcher bursts collapsed to one repack, the outputs filtered out of the watch so it does not repack forever, and a queue that survives a failed pack, since a quiver mid-edit is invalid as often as not.

**The server is written rather than borrowed.** A general-purpose static server gets two things wrong here: `.wasm` must be served as `application/wasm` for streaming instantiation, and a path escaping its root must be refused on the resolved path. For studio it also streams a `repacked` event after each repack, which a deployed host never does.

## The deploy layout

`build` writes the arrangement a static host serves and nothing else:

| Path | Target | What |
| --- | --- | --- |
| `index.html`, `assets/*` | studio, app | The client, carried in the tarball. |
| `app.json` | app | What `App.yaml` resolved to (§"The app target"). |
| `app.css`, its files, the icon | app | The author's, at the paths they stand at in the quiver. |
| `quiver/` | every target | The packed quiver, where each client looks. |

The verb is the whole encapsulation, so there is no workflow beside it: a consumer's scripts, this repository's CI and a Pages job all reach the layout by running it.

**What can refuse is read before anything is cleared**, so a bad `App.yaml` or a refused quill leaves the last deploy standing. An `--out` holding the quiver or the working directory is refused.

**The floor is the default, and `--drafts` lifts it**, for a studio where reviewers preview prototypes.

**What the layout cannot assert is the host's, and it is four rules**: `assets/*` immutable, no edge cache on `quiver/quiver.json`, a missing path answered as a 404, and https. `preview` serves a build under the first three, so a deploy is looked at locally under the rules it will meet.

**The gate is the recipe's, not this verb's.** `build` compiles nothing, so a quill whose plate does not compile builds cleanly; every documented recipe runs `check` first.

## The app target

Convention over configuration: everything the app target reads is found by name beside `Quiver.yaml`, none of it required, and `build app` resolves it into `app.json`, which is all the client reads at boot.

| File | Default | What |
| --- | --- | --- |
| `App.yaml` | `Quiver.yaml`'s `name` and `description` | `title` and `description`. |
| `app.css` | the preset's look | How the app looks. |
| `icon.svg`, else `icon.png` | none | The header's mark and the tab's icon. |

**The quills are the quiver's.** The app opens every quill the pack holds at its latest version, so a different set of forms is a different quiver. A document records the canonical ref, so it reopens on the version it was made on.

**An unknown key is refused.** `App.yaml` names the app and nothing else: a look in it would be a second theming system, and a quill list a second way to say what the quiver says.

**`app.css` lands last, and its files with it**, so a rule of equal rank is the author's. A `url()` naming a file outside the quiver is refused, and a selector aiming at anything the theming contract does not promise (THEMING §"What a stylesheet may aim at") is warned.

**A quill without a licence is warned, not refused.** An app hands its plate and fonts to every reader, which is a licensing question the author answers in `Quill.yaml`.

**An earlier version opens while the pack holds it.** The client reads a document's standing off the quiver it loaded, the one thing in a deploy that knows which versions remain (APP §"Retired pins").

## Not

Not a generator: `init` lays one shape and takes no options. Not a renderer: every render is `@quillmark/wasm`'s. Not a library: no importable entry. Not a theme engine: `App.yaml` holds no look. No service worker: the app is online, and what it keeps offline is the reader's documents (APP §"Documents").
