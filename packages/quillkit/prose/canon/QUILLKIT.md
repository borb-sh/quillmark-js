# Quillkit

> **Implementation**: `src/` · `src/bin/` · `client/`

## TL;DR

The verbs a quill author types, one bin over the whole loop: `test` gates, `build` packs, `studio` shows, `site` lays a deploy out. It is the only name in the toolchain an author runs, and the audit surface a production tree does not carry: a collection depends on [`@quillmark/quiver`](../../../quiver/prose/canon/QUIVER.md) for the loaders, and on this only in `devDependencies`.

## quillkit carries nothing it can resolve

Two things every verb runs on (the loader that packs, the engine that renders) come out of the **collection's** `node_modules`, resolved from its `package.json` (`collection.ts`). Neither is a dependency of this package, which ships no runtime dependencies at all.

That is one rule paying two ways, and both are about a version someone else pins:

- **The collection pins its own packer, and so its engine's partner.** `@quillmark/quiver` packs the file and `fromDir` materializes the quills `test` renders, through the `@quillmark/wasm` it resolves beside the collection's engine: one module, so a quill handle and the engine rendering it index one linear memory. A tool carrying the packer would carry a quiver whose wasm resolves from the tool's install, and the two would be one module only where the install happened to dedupe them. The file names its own format, so a reader skewed against the packer says so; the pin holds the identity, not the format.
- **One copy packs, however the pack is reached.** `build` in CI, `studio` mid-edit and `site` at deploy all resolve the same install, so the bytes a local loop serves and the bytes a deploy publishes agree by construction rather than by a version range someone keeps true.

The cost is a name in `devDependencies` per thing resolved, and each absence names its install rather than surfacing a resolver's own words.

**The client is carried, and the same rule says why.** Resolution buys a collection the version it pins; the client answers to no version of theirs, writing no quiver, so there is nothing for a pin to decide. It does read one: a file packed by a quiver newer than the copy the client bundles is refused in the page with the upgrade named, which is the skew a self-describing file turns from a misreading into a sentence. It ships in this tarball at `dist/client` (`paths.ts`) and costs tens of megabytes of browser-targeted wasm in the tool's own install, downloaded once and npm-cached, in a package nothing depends on outside `devDependencies`.

**And it takes no override.** A flag naming another client would be a second answer to a question the tarball already settles: the bin and the client are built together and ship together, so the one on disk beside the bin is the one that matches it. `laySite` keeps a `client` option for the suite, which asserts the layout over a stub rather than waiting on a Vite build to prove a copy.

**Every specifier resolves under CJS conditions.** `createRequire().resolve` walks an exports map as `require`, `node`, `default` whatever the caller's own module system, so a subpath offering `import` alone is invisible to it. Quiver names `default` beside `import` on every entry for this.

## Blocked on, looked at

`test` is what an author is **blocked on**: it runs in their CI, against their own wasm, and installs a loader rather than an app. `studio` is what they **look at**, and nothing fails a build on its verdict, which is what keeps the client's chrome, its weight and its wasm its own problem.

**The gate loads and renders.** `fromDir`, then compile and render every quill's example document, seeded with `quill.seedDocument()` since the blueprint carries `<must-fill>` sentinels and is not directly renderable. The engine is a named `engine` export from `quillkit.config.js` at the collection root, else `@quillmark/wasm` resolved from the collection's tree. The core is instantiated before either: `new Engine()` is lazy, so the gate holds a live instance before it renders rather than at whichever call first needs one.

**The artifact loads and inits before the config is read**, since `init()` is module-global, memoized and idempotent: an engine the config builds out of that same module rides the init the gate already ran. The other order leaves the extension point it exists for, `new Engine({ backends })`, un-inited to fail at its first render, inside the per-quill catch that prints a setup fault as the author's quill.

**Absence is the only thing a load recovers from.** A specifier that will not resolve names its install; a `quillkit.config.js` that is not on disk falls through to the artifact. Past that answer the fault is the collection's own — an artifact that will not import or will not instantiate, a config that throws — and each fails the verb under the name of what was loading, with what threw chained as `cause` and printed beneath it. The config is the one whose fault read as an absence costs a verdict rather than a message: the gate renders every quill through an engine the author did not write, and prints a pass table for it. So presence is the filesystem's answer, `ERR_MODULE_NOT_FOUND` being equally what a config raises over a specifier of its own.

**One door, so the loop and the engine contract have one home each.** A second entry onto the same verdict copies both, and a caller-supplied engine gates nothing about the discovery this does, so the two answer differently under one name. An author on vitest, jest or another runner spawns the bin (`execFileSync('quillkit', ['test'])`) and gates what CI gates. The suite spawns it against the reference quiver, since nothing that imports a module proves a surface reached through a linked bin.

The blueprint is what the two share: the client seeds the same way, so the document the gate renders is the document the author judges, and it is the only document either one can name.

## One wasm per process, and mostly none

`test` is the only verb that puts a wasm in this process, and it is the collection's own. The packer instantiates nothing, and the client is static bytes handed to a browser tab, a process this one never shares. So the tool holds at most one copy and hands a handle to nobody.

The tarball holds two, and they never meet: the client bundles the copy it was built against, and the bin resolves the collection's when `test` runs. Neither half is importable, a `bin` being a process of its own and the client being bytes, so no handle minted by one can reach the other. That is what lets a compiled Node program and a bundled browser program share one manifest as a single bundled terminal.

## The local loop

`studio` packs the source into one file, serves the client at the root with the file mounted at `/quiver.qv`, and repacks when the source changes. Three parts, and only the first is subtle:

**The pack lands whole, and that is quiver's** (QUIVER §"The file is replaced whole"). Nothing here stages or renames: the file belongs to `build`, and a caller cannot close a window inside it. What is left here is the trigger: a burst of watcher events collapsed to one repack, the pack's own output filtered out of the watch (the default output is under the collection's `node_modules`, so a watcher seeing its own writes would repack forever), and a queue that serializes packs without ending on the first failure, a quiver mid-edit being invalid as often as not. A close ends both halves in the teardown's order — the watch first, then the burst still settling — so nothing packs into a file the caller is done with. It always asks for drafts (QUIVER §"The draft floor"): this is the author looking at their own collection, where a quill under `0.1.0` is the likeliest thing on the screen. `build` writes a deployment and takes quiver's floor; `site` takes it unless `--drafts` asks otherwise.

**The server is written rather than borrowed.** Two things a general-purpose static server gets wrong for this: `.wasm` must be served as `application/wasm`, since wasm-bindgen's web target instantiates by streaming and `WebAssembly.instantiateStreaming` refuses any other type; and a path escaping its root must be refused, checked on the resolved path so `%2e%2e`, a doubled separator and a plain `..` collapse into one answer. Nothing is cached: this is a loop an author repacks under, and a cache would answer about the last artifact. The repack is also what a borrowed server has no reason to survive: it renames a new file over the path mid-request, so the length a response declares and the body it streams come off one descriptor, opened before either is read, and a read that fails destroys the response rather than throwing out of the event loop and ending the session.

**Nothing renders on the server.** The WASM boundary and the paint loop are browser concerns, which is what keeps this half a packer and a file watcher.

## The deploy layout

`site` writes the arrangement a deploy serves and nothing else: the client at a root, the packed quiver beside it as `quiver.qv`, which is where the client looks (`document.baseURI`). The verb is the whole encapsulation, which is why there is no workflow beside it: a consumer's `scripts`, this repository's CI and a Pages job all reach the layout by running it, and a consumer running it locally gates the shape their deploy will have. What a reusable workflow would add over `npx quillkit site` is a checkout and an upload, at the price of an input contract this repository would then have to version.

Both halves are asserted rather than assumed: a client carrying a `quiver.qv` of its own would occupy the URL the built one is served from, and the winner would be whichever copy landed last.

**The floor is the default, and `--drafts` lifts it.** A site is a deployment, so it takes quiver's floor like `build`; a collection whose site is where reviewers preview its prototypes asks for the draft space with `--drafts`, and the site then serves what `studio` serves locally.

**What the layout cannot assert is the host's, and it is four rules**: `assets/*` immutable, everything else revalidating, a missing path answered as a 404, and https. The first two are the whole cache policy: hash-named files forever, and the two names that persist across releases (`index.html`, `quiver.qv`) never served stale, the browser's layer being closed by the `no-cache` fetch (QUIVER §"Fetched whole, revalidated"). The 404 rule is what an SPA fallback breaks, and the reader names that case rather than reporting a broken zip; https is what the artifact's integrity rests on, it carrying no digest of its own. The README carries them with the recipes, where a consumer deploying studio reads, rather than in quiver's.

**And the gate is the recipe's, not this verb's.** `site` stats each `Quill.yaml` as a sentinel and parses none, so a quill that does not compile packs cleanly; the verb that renders is `test`, and every documented recipe runs it first. Putting it inside `site` would buy the consumer who does not read, at the price of a wasm in the packer's process and a second gate for every pipeline already running one.

**It clears what it writes**, so an `--out` holding the collection or the working directory is refused. The tree is this verb's; `build` owns one file inside it and clears nothing.

## Not

Not a scaffolder: there is no `new`, and a collection is laid out by hand. Not a renderer: every render is `@quillmark/wasm`'s, through the collection's copy. Not a library: no importable entry, and the loaders stay quiver's, where a browser consumer can reach them.

## Links

[STUDIO.md](STUDIO.md) · [QUIVER.md](../../../quiver/prose/canon/QUIVER.md)
