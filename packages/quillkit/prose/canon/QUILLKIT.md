# Quillkit

> **Implementation**: `src/` · `src/bin/` · `client/` · `app/`

## TL;DR

The verbs a quill author types, one bin over a quiver's whole life: `init` starts one, `check` gates it, `serve` shows it as it is edited, `build` lays it out for a static host, and `preview` serves that layout the way the host will. A verb's argument is a target, `studio` where none is named: `quiver` is the pack alone, `studio` is the client the quiver's authors judge it in ([STUDIO.md](STUDIO.md)), and `app` is the client the people filling its forms in reach ([APP.md](APP.md)). It is the only name in the toolchain an author installs: a quiver's `package.json` lists `quillkit` in `devDependencies` and nothing else, and the loaders a browser consumer reaches stay [`@quillmark/quiver`](../../../quiver/prose/canon/QUIVER.md)'s.

## Verbs and targets

| Verb | Takes | Does |
| --- | --- | --- |
| `init` | `[<dir>]` | Lays a quiver: `Quiver.yaml`, one quill, a `package.json` naming quillkit. |
| `check` | `[-D] [--strict]` | Renders every version's seed and example, drafts included, and resolves the app where there is an `App.yaml` or `app.css`. |
| `build` | `[target] [-o <dir>] [-D]` | Lays the target's deploy into `dist/`, or `-o`. |
| `serve` | `[target] [-p <n>] [--open]` | Packs, serves the target over the pack, repacks on change. |
| `preview` | `[-o <dir>] [-p <n>] [--open]` | Serves the build in `dist/`, or `-o`, with the host's rules. |

**The quiver is the working directory.** No verb takes a path to it: every verb runs where `Quiver.yaml` stands, as npm runs where `package.json` stands, so a `scripts` entry and a terminal mean the same tree. The flags are `-D`/`--drafts`, `-o`/`--out`, `-p`/`--port`, `--open` and `--strict`, and a verb refuses a flag it does not take rather than read it as absent, since a flag read as absent runs the verb over something nobody asked for.

**`-D` lifts quiver's draft floor where one applies** (QUIVER §"The draft floor"): on what `build` packs, and on the quills the app opens when `check` resolves it. `check` renders every version either way, and `serve` always packs them.

**Every verb's default target is studio.** It is the client a quiver's own authors judge it in, and the one a first `serve` is for; a pipeline deploying the app names `app`.

**`serve` shows the source, `preview` the build.** `serve` packs the source and repacks on save (§"The local loop"); `preview` serves what `build` laid, under the host's rules (§"The deploy layout"). A deploy says which target it was built for, `app.json` an app, a bare `index.html` studio and a bare `quiver/` the quiver, so `preview` takes no target and serves whichever build `dist/` holds. Each serves one front door, a client's page or, for the quiver alone, `quiver/quiver.json`, and the two take different ports by default so both can run at once. `--open` opens that door in the platform's browser, and a machine with no opener, a CI runner above all, serves on and prints the address.

**No base path is configured.** Each client resolves its assets, `quiver/`, `app.json` and `app.css` relative to `document.baseURI`, and the app keys its documents by that same base, so one build serves a root, a subpath and a preview URL unchanged, and two apps under one origin keep apart. What a subpath asks of a host is that the deploy's own address ends in `/`, a directory a static host redirects to.

## One pin

quillkit's runtime `dependencies` are `@quillmark/wasm` at the workspace's root pin and `@quillmark/quiver` at its workspace version, both exact. The bin packs with the quiver it carries, `check` renders with the wasm it carries, and both clients are built against the same two, so what the gate renders, what `serve` shows and what a deploy serves are one release by construction. An author upgrades the whole set by moving one devDependency.

**Exact, because the clients are bundled.** A range would let an install pair this bin with a wasm or a quiver its clients were not built with, and the gate would then pass a render the deployed page does not perform. `check:deps` holds the pins exact, and a quiver release moves quillkit's pin in the same release PR.

**The format agrees with its reader.** The quiver that writes `quiver.json` is the quiver the clients read it with, so a pack and the client laid over it cannot disagree on the format. The collection's own `node_modules` decides nothing: a quiver installs no loader and no engine beside quillkit, and a `quillkit.config.js` is not read.

**One wasm per process, and mostly none.** Only a verb that reads a quill instantiates the wasm in Node: `check`, and the app target, which loads the quills it pins for their titles and licences. The packer instantiates nothing, and each client is static bytes run in a browser tab, a process this one never shares. No importable entry means no handle minted here reaches another copy.

## Blocked on, looked at

`check` is what an author is **blocked on**: it runs in their CI and fails a build. `serve` and the deploys are what they and their readers **look at**, and nothing fails a build on their verdict, which is what keeps each client's chrome and weight its own problem.

**The gate loads and renders.** `fromDir`, then compile and render every quill's seed, `quill.seedDocument()`: one card per kind, every field absent and every body empty, so what the gate proves is that the plate renders the blank a reader starts from. The core is instantiated before the first render, so a setup fault fails the verb rather than printing as the first quill's.

**What an author wrote is held to every diagnostic.** A quill's `example.md` fails on any diagnostic its parse, its conform or `quill.validate` raises, a warning included: every value in it is the author's own to fix. The seed is the schema's, and answers for its render alone. The render's own warnings, the compile's among them, are the plate's, and the quill's load warnings its schema's: both print under the quill's `pass` line, once each, and fail it only under `--strict`.

**A failure prints as the CLI prints it.** Every diagnostic on a failure prints whole beneath the `FAIL` line, through the wasm's `formatDiagnostic`: severity, message, code, `file:line:col`, path and hint, so the gate an author is blocked on says no less than `quillmark render` does.

**The app resolves too.** With an `App.yaml` or an `app.css` beside `Quiver.yaml` the gate runs what `build app` runs before it writes anything (§"The app target"), so an unknown key, or an `app.css` naming a file outside the quiver or none, fails the gate as it would fail the deploy. What `build app` only warns about prints under its `pass` line and fails only under `--strict`.

**One door.** An author on vitest, jest or another runner spawns the bin (`execFileSync('quillkit', ['check'])`) and gates what CI gates; a second entry onto the verdict would be a second answer under one name. The suite spawns it against the reference quiver, since nothing that imports a module proves a surface reached through a linked bin.

## Where a quiver comes from

`init` lays one: `Quiver.yaml` and a single quill out of the tarball's `starter/`, plus the files a tarball cannot carry, written by the verb. Every other verb runs over a quiver that exists.

**The starter is a quiver the suite gates.** Carried as files rather than emitted from strings, so `cli.integration.test.ts` lays it, runs `check` over it and builds it into an app: a scaffold that stops rendering fails CI before it fails an author on their first command.

**One shape, no options.** The quill is the smallest one worth reading rather than a tour of what a quill can hold, since the first thing an author does is rename and delete: a field of each kind an author copies by analogy (a `date`, a `text` that may be left blank, an `enum` whose id the plate maps to words), a body, one card kind, and an `example.md` every field of which prints. It ships no font and declares `CC0-1.0`, so its first `build app` raises no licensing warning.

**One devDependency.** The written `package.json` ranges `quillkit` at its own version and nothing else (§"One pin"), with `serve`, `test`, `build` and `preview` scripts running `quillkit serve --open`, `quillkit check`, `quillkit build app` and `quillkit preview --open`, so `npm test` is the gate. `.gitignore` names `node_modules/` and `dist/`.

**It refuses rather than merges.** An entry of `starter/` already in the directory fails the verb before anything is written. A `package.json` already there is left alone and the install line is printed instead; `.gitignore` and `.prettierignore` are written only where absent. The last is there because prettier rewrites a card's `~~~` fence as a backtick fence, which opens no card.

## The local loop

`serve` packs the source into `node_modules/.quillkit/quiver`, serves the target's client at the root with the pack mounted at `/quiver`, and repacks when the source changes. For `app` it also writes `app.json` and the author's files into `node_modules/.quillkit/app`, served behind the client, so `App.yaml` and `app.css` reload with the page. For `quiver` it serves the pack alone with CORS open, for a consumer's own dev server on another port. Three parts, and only the first is subtle:

**The pack lands whole, and that is quiver's** (QUIVER §"The generation lands whole"). Nothing here stages or swaps: the directory belongs to `build`, and a caller cannot close a window inside it. What is left here is the trigger: a burst of watcher events collapsed to one repack, the work tree and `dist/` filtered out of the watch so a watcher seeing its own writes does not repack forever, and a queue that serializes packs without ending on the first failure, a quiver mid-edit being invalid as often as not. A close ends both halves in the teardown's order, the watch first and then the burst still settling, so nothing packs into a tree the caller is done with. It always packs drafts (QUIVER §"The draft floor"): this is the author looking at their own quiver, where a quill under `0.1.0` is the likeliest thing on the screen.

**The server is written rather than borrowed.** Two things a general-purpose static server gets wrong for this: `.wasm` must be served as `application/wasm`, since wasm-bindgen's web target instantiates by streaming and `WebAssembly.instantiateStreaming` refuses any other type; and a path escaping its root must be refused, checked on the resolved path so `%2e%2e`, a doubled separator and a plain `..` collapse into one answer. Mounts sharing a prefix fall through in order, which is how the app's staged files stand behind its client. The live loop caches nothing, a cache answering about the last generation, and for studio it streams one thing a static host does not: a server-sent `repacked` at `/.quillkit/events` after each repack lands, named by an `x-quillkit-events` header on every file it serves so the page finds it off a HEAD of itself rather than by asking a deployed host for a path it would 404. No other target and no `preview` serves a stream. The repack is also what a borrowed server has no reason to survive: it takes a file out from under a request between the stat and the open, and a read that fails there destroys the response rather than ending the session.

**Nothing renders on the server.** The WASM boundary and the paint loop are browser concerns, which is what keeps this half a packer and a file watcher.

## The deploy layout

`build` writes the arrangement a static host serves and nothing else:

| Path | Target | What |
| --- | --- | --- |
| `index.html`, `assets/*` | studio, app | The client, carried in the tarball. |
| `app.json` | app | What `App.yaml` resolved to (§"The app target"). |
| `app.css`, its files, the icon | app | The author's, copied at the paths they stand at in the quiver. |
| `quiver/` | every target | The packed quiver, where each client looks (`document.baseURI`). |

The verb is the whole encapsulation, which is why there is no workflow beside it: a consumer's `scripts`, this repository's CI and a Pages job all reach the layout by running it, and an author running it locally gates the shape their deploy will have.

**What can refuse is read before anything is cleared**, the quiver packed beside the out and moved in after the clear, so a bad `App.yaml` or a quill the packer refuses leaves the last deploy where it stood. A client carrying a `quiver/` of its own would occupy the URL the laid one is served from, so that is refused too, and no author file may land on a name the client or the quiver occupies.

**The floor is the default, and `--drafts` lifts it.** A deploy is a deployment, so it takes quiver's floor; a quiver whose studio is where reviewers preview its prototypes asks for the draft space with `--drafts`.

**What the layout cannot assert is the host's, and it is four rules**: `assets/*` immutable, no edge cache on `quiver/quiver.json`, a missing path answered as a 404, and https. The first is the client's own content-hashed bundle; the second is the edge alone, the browser layer being closed by the fetch mode the loader picks for each name (QUIVER §"The index"). The last two are what a static host's defaults get wrong, and both surface as something other than themselves: a file refused as not the one it was named, and bytes nothing checked. `preview` serves a build under the first three, every path outside `assets/` sent `no-cache`, so a deploy is looked at locally under the rules it will meet. The README carries them with the host recipes.

**The gate is the recipe's, not this verb's.** The packer stats each `Quill.yaml` as a sentinel and parses none, and the app target loads the quills it pins but renders none, so a quill whose plate does not compile builds cleanly; the verb that renders is `check`, and every documented recipe runs it first. Putting it inside `build` would buy the author who does not read, at the price of a second gate for every pipeline already running one.

**It clears what it writes**, so an `--out` holding the quiver or the working directory is refused. An `--out` nested inside the quiver is the ordinary layout, `dist/`, and nothing of the source is read after the clear.

## The app target

Convention over configuration: everything the app target reads is found by name beside `Quiver.yaml`, and none of it is required. `build app` resolves it against the quiver into `app.json`, which is all the client reads at boot.

| File | Default | What |
| --- | --- | --- |
| `App.yaml` | `Quiver.yaml`'s `name`, made readable, and its `description` | `title`, the header and the tab; `description`, the sentence over the landing's cards. |
| `app.css` | the preset's look | How the app looks. |
| `icon.svg`, else `icon.png` | none | The header's mark and the tab's icon. |

**The quills are the quiver's.** The app opens every quill the pack holds, each at its latest version, so a different set of forms is a different quiver, which can depend on another through npm rather than copy its quills. The ref is canonical and is what a document records, so a document made today reopens on the version it was made on; a draft is admitted only under `--drafts`, as the pack admits one.

**An unknown key is refused.** `App.yaml` names the app and nothing else: a look written into it would be a second theming system with a vocabulary of its own, and a list of quills a second way to say what the quiver already says.

**`app.css` lands last, and its files with it.** The client links it after its own sheets, so a rule of equal rank is the author's. Every relative `url()` it names is copied at the same path, and one naming a file outside the quiver, or none, is refused; one from the host's root is warned, a deploy under a subpath not serving it. A selector aiming at anything the theming contract does not promise (THEMING §"What a stylesheet may aim at") is warned, since a release may move it.

**A quill without a licence is warned, not refused.** An app hands its plate and its fonts to every reader, which is a licensing question the author answers in `Quill.yaml`'s `license`; a quiver deployed for its own organisation may have answered it elsewhere.

**An earlier version opens while the pack holds it.** The client reads a document's standing off the quiver it has loaded rather than off anything the build records, since a deploy is a directory a host replaces whole and the pack is the one thing in it that knows which versions remain (APP §"Retired pins"). Only the app makes a document, so every pin a reader holds is one a build shipped; a version the quiver keeps keeps its documents opening on it, and one it drops leaves them offering their markdown and the latest form.

## Not

Not a generator: `init` lays one shape and takes no options. Not a renderer: every render is `@quillmark/wasm`'s. Not a library: no importable entry, and the loaders stay quiver's, where a browser consumer can reach them. Not a theme engine: `App.yaml` holds no look, and `app.css` aims at what the theming contract promises. No service worker: the app is online, and what it keeps offline is the reader's documents (APP §"Documents").

## Links

[STUDIO.md](STUDIO.md) · [APP.md](APP.md) · [QUIVER.md](../../../quiver/prose/canon/QUIVER.md) · [`THEMING.md`](../../../svelte/THEMING.md)
