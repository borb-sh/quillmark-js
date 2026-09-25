# Quiver

> **Implementation**: `src/`

## TL;DR

A quiver is a collection of quills, addressed by ref and resolved to a `Quill`. This package loads one from wherever it lives (a source directory, a packed artifact on disk, a URL), packs one for a browser, and hands out quills. The **loaders** never render: `@quillmark/wasm` does that, and the handles pass to it untouched. Nothing here is a verb an author types either: this is the library a collection depends on, and [quillkit](../../../quillkit/prose/canon/QUILLKIT.md) is the tool that resolves it.

## One authored shape, four deployments

Authors write **one** layout: `Quiver.yaml` at the package root, quills under `quills/<name>/<x.y.z>/`, published as an npm package or a git tag. The deployment-topology decision belongs to the consumer, not the author, so the author flow stays one command and the loaders fan out below it.

The loaders name exactly what they read; there is no auto-detection and no branching on artifact shape.

| Deployment | Holds | Loader | Where |
| --- | --- | --- | --- |
| Author machine, CI | the source layout | `fromDir(path)` | `/node` |
| Browser | nothing | `Quiver.fromBuiltUrl(url)` | anywhere |
| Server with a filesystem | build output in its image | `fromBuiltDir(path)` | `/node` |
| Server without one | build output in memory | `Quiver.fromBuiltFiles(files)` | anywhere |

Reaching a quiver installed from npm is not a fifth: `dirname(createRequire(import.meta.url).resolve('<pkg>/Quiver.yaml'))` handed to `fromDir` or `build` is one line at the call site, where the resolution base belongs to the caller and the `exports`-map subpath it lands on is visible rather than a rule this package documents and holds.

**The table is the removal test.** This package is published, so its callers are mostly outside this workspace and "nothing here calls it" is measured on a sample that excludes them: the playground is a browser and quillkit is a tool, so no node in this repository runs `fromBuiltDir` or `fromBuiltFiles`. Surface comes out when no row needs it, which is not the same question.

**Every export names `default` beside `import`.** A tool resolving this package from a consumer's tree walks the exports map under CJS conditions whatever its own module system, so a subpath offering `import` alone is invisible to it. Every verb quillkit runs reaches this package that way, out of the collection's own tree; `@quillmark/wasm` names both, which is why its engine discovery works at all.

The `/node` factories are free functions, not statics: the class stays browser-pure, the entry that reads a filesystem imports nothing onto it, and a bundler drops the verbs a consumer does not call. The statics are the two that reach no filesystem, so what is on the class is what runs anywhere. Construction itself is sealed: `Quiver` has a private constructor and the loader seam is reachable from no entry in `exports`. There is no public transport API (auth headers, custom fetch, `AbortSignal`) and no consumer story asking for one; a sealed seam keeps that option clean, a half-open one lets dependents grow on an unsupported surface.

Browsers cannot read the source layout, so `build(src, out)` packs it at deploy time and the output is served as static assets. `fromBuiltDir` exists for the server that ships the packed artifact in its own image: it avoids the self-fetch round-trip `fromBuiltUrl` would force on a self-hosted deployment, and lets the source quiver stay a devDependency. It reads each name `quiver.json` lists straight off the disk: no name the index validates carries a separator, so none escapes the directory.

`fromBuiltFiles` buys the same property where the artifact is not on a path the process can read, which is a serverless function: the packed tree is outside the invocation's filesystem, so handing over the bytes is what is left.

`build` owns `out` outright: the previous generation never bleeds into the new one. An `out` that is, or contains, the source quiver or the working directory is refused rather than cleared: `--out .` and a slipped `--out ..` are one keystroke away and the deletion is unrecoverable. An `out` nested *inside* the source (`dist/` under the quiver root) is the ordinary layout and stays allowed, since the scan reads the source before the first write.

## The generation lands whole

A build is never observably half-written. It is assembled in `<out>.stage` and moved in, and the tree it replaces is deleted after. Packing straight into `out` would leave a window seconds wide where `quiver.json` is missing or names bundles that have not landed, and a client reading it there reports a broken quiver for an edit that was fine; a build that throws would leave that window open until the next one.

The property belongs here rather than to whatever is serving, because the directory is this function's and no caller can close a window inside it. What remains is two renames: a directory rename refuses a non-empty target, so the outgoing generation steps aside first. Between the two it is only at `.prev`, so a second rename that throws puts it back, and the sweep that clears the siblings spares it where even that fails: what the window costs is a torn read, never both generations. The staging siblings are named off `out` and cleared with it, which is why the destructive-write refusals are checked over all three.

## The draft floor

`build` packs `0.1.0` and up. Below it is the draft space: a version an author is still shaping, inside a collection that is very likely already published, and the artifact is a deployment rather than a working tree. The floor is a semver reading rather than a policy knob — `0.0.x` is the range semver already spends on what is not for consumption — so it is a constant here and not a field `Quiver.yaml` carries.

The source layout keeps every version, and `fromDir` reads them all: the filter is `build`'s alone, which is what leaves an author's own tooling and `quillkit test` looking at the whole tree. `build(src, out, { drafts: true })` turns it off, for a viewer rather than a deployment — `quillkit studio` packs through this function to serve an author their own collection, where a floor would hide the quill most likely to be under the cursor, and `quillkit site --drafts` lays out a preview of the same.

A quill with nothing above the floor is absent from `quiver.json` rather than present and empty, and a quiver of nothing but drafts builds an empty catalog. Which of the two ran is not stamped anywhere: `quiver.json` is closed, so a field there costs a format bump to record a fact about a directory under `node_modules` that no deployment reads.

## The index

`fromBuiltUrl` fetches `<url>/quiver.json` first: the format, the collection's name and description, and one entry per quill naming its bundle and its fonts. Every other name carries the SHA-256 of what it names, so a changed byte is a changed name and a cached response for one is never stale; `quiver.json` is the one name that is not, and a stale one pins a reader to the old catalog. So it is fetched `no-cache` (revalidate with the origin, a 304 still serving from disk) and every other name `force-cache`, whatever the host's headers say. That closes the browser layer. The layer above is a host's, and the rule a host owes it is the same split, stated for a deploy in quillkit's [README](../../../quillkit/README.md).

**The format is read before anything is believed about the rest.** Skew is the ordinary case rather than the broken one: a collection is packed by whatever copy of this package the author's CI installs, and read by the copy frozen inside whichever client is laid over it. `quiver.json` is closed, rejecting a field it does not know, so an added field moves `format`; and `format` is read ahead of the key check, so a reader meeting a newer document refuses it as newer, with the upgrade named, rather than as carrying a stray key.

**A tab outlives a generation.** `build` replaces its output, so a client that booted on the previous `quiver.json` asks for names the next one deleted. A failed read rereads `quiver.json` once and retries under the entry it now names, where that entry names other files; otherwise the first error stands. A quill the next generation dropped stays that error: the catalog a `Quiver` resolves against is the one it was built with. Where an artifact and its clients deploy independently, an append-only tree with garbage collection is what would keep a dropped quill loadable.

## Content addressing is for caching

A bundle's name carries 32 hex chars of its digest, enough that a changed bundle never reuses one. A font's is the full 64, because fonts are keyed by hash: two distinct fonts sharing a prefix would merge into one file.

**Fonts are stored once.** Fonts are usually most of a quill's bytes, and one shared across quills or versions is written once under `fonts/`. So a release that edits a template leaves every font's name, and a returning reader's cache for it, untouched, and what arrives is the bundle.

**Nothing checks the bytes against their name.** A client and its artifact ship together over https, which is what answers a corrupted or substituted byte, and a check would need `crypto.subtle`, which exists only in a secure context. Nothing here is provenance either: what a consumer owns is the choice of source, stated for them in the [README](../../README.md#what-a-quiver-is-trusted-to-be).

**A bundle carries a budget**: a ceiling on what it unpacks to, on any one file inside it, and on how many there are, spent off the sizes the central directory declares and refused as `quiver_invalid` at the entry that trips it. fflate filters and inflates in one pass, so the entries the budget already took are resident when it throws — bounded, being what fit inside it. Deflate tops out near 1032:1, so what a megabyte of zip costs a reader is a gigabyte of resident bytes, and it finds out by allocating them.

The ceiling is a constant rather than an option a consumer raises: what a budget answers is a build that packed something enormous, not an artifact chosen to be hostile, which is a thing to refuse by choosing the source. `packFiles` spends the same budget, so a quill over it is refused by the build that packs it, named, rather than by whatever reads the artifact later. Fonts sit outside it, being files `quiver.json` names rather than bundle entries.

## getQuill is the seam

`quiver.getQuill(ref)` is the only way to obtain a quill from a quiver, and the only entry point a consumer needs. It accepts selector refs (`"memo"`, `"memo@1"`) and canonical ones (`"memo@1.0.0"`), resolves the selector, fetches the tree, materializes it through `Quill.fromTree`, and caches one instance per canonical ref for the quiver's lifetime. Concurrent calls for the same ref coalesce into a single load.

**It awaits the WASM gate itself**, so instantiating the core is not a precondition a consumer has to know about. `init()` is the only door to `Quill`, and it is memoized: this is one instantiation across every caller, overlapped with the fetch that pays for it. A consumer reaching the classes for its own reasons awaits the same gate.

Reaching for `Quill.fromTree` inside a quiver consumer bypasses that cache and redoes the work. `Quill.fromTree` is for quills built **outside** a quiver: a server route receiving a raw tree over the network, a test fixture assembling one by hand.

One narrower verb sits beside it: `resolve(ref)` returns the canonical ref without materializing anything.

The quill cache is the only one. A fetched tree lives for the length of the materialization that consumes it and no longer: a second cache holding trees would buy a retry after a `Quill.fromTree` throw its refetch, which is a round-trip saved on the path where the quill is broken, against a cache to evict, coalesce and reason about on every path where it is not.

`resolve` is **sync**, and so are `quillNames()` and `versionsOf()`: the catalog is materialized as the quiver is built (`fromBuiltUrl` fetches `quiver.json`, `fromDir` scans the source tree), and `QuiverLoader` carries one verb, `loadTree`, which resolution never reaches. A promise there would price I/O the design does not admit.

Every catalog row is a name a ref can spell. Both loaders hold the row to the charset `parseQuillRef` takes, so what `quillNames()` hands out is what `getQuill` takes back; a source directory or a `quiver.json` entry outside it is a `quiver_invalid` naming it, not a row the one verb lists and the other refuses.

`name` and `description` are what `Quiver.yaml` says the collection is, and both reach the class by the same road: parsed off the source tree, written into `quiver.json` by `build`, read back out of it by every built loader. A surface over a quiver has no other authored sentence to print — everything else it can show about a collection is a name a directory happens to carry.

## The render boundary

This package produces quills; `@quillmark/wasm` renders them. A quill from `getQuill` is engine-free portable data (schema inspection, validation, blueprint access, seeding) and passes straight to `engine.render(quill, doc)`, which routes on `quill.backendId`, lazily loads that backend, clones both handles into its memory, renders, and frees the clones. There is no boundary-crossing step to perform.

The canonical `Quill` / `Document` / `Engine` types are **not** re-exported here. They come from the `@quillmark/wasm` peer, which is their single source of truth: the one installed copy whose linear memory every handle indexes into (`check:deps`).

`Engine.render`, `open` and `supportedFormats` are async.

## Errors

Every error is a `QuiverError` carrying a `code`, a human-readable `message`, and the offending `ref` where there is one. The codes are a closed set: `invalid_ref`, `quill_not_found`, `quiver_invalid`, `transport_error`, so a consumer branches on `code` rather than parsing text.

## Nothing here is a verb

This package has no `bin`. Loading a quiver and packing one are library functions; the verbs a quill author types are [quillkit](../../../quillkit/prose/canon/QUILLKIT.md)'s, which resolves this package out of the collection's own `node_modules` and calls them.

**What that buys is stated there; what it costs is stated here.** This version number is a format number. `build` writes `quiver.json` and the names it lists, and `fromBuiltUrl` reads them, so a collection depending on this package pins both halves at once, and a release here is a release of the format. A verb added to a CLI must not move it.

The name stays the artifact's. `quiver` is the plain word that reads right inside an ambiguous sentence (the quiver is stale, the quiver has no quills), and `Quiver.yaml` at a collection's root is what an author names the thing after. A bin lands in a namespace it shares with every other tool a consumer installs, which is a place for a coined word rather than a plain one.
