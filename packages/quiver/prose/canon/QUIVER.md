# Quiver

> **Implementation**: `src/` · `src/transports/`

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

A consumer holding part of an artifact passes it as `fromBuiltUrl`'s `seed`: the fourth row with the heavy bytes left on the host.

Reaching a quiver installed from npm is not a fifth: `dirname(createRequire(import.meta.url).resolve('<pkg>/Quiver.yaml'))` handed to `fromDir` or `build` is one line at the call site, where the resolution base belongs to the caller and the `exports`-map subpath it lands on is visible rather than a rule this package documents and holds.

**The table is the removal test.** This package is published, so its callers are mostly outside this workspace and "nothing here calls it" is measured on a sample that excludes them: the playground is a browser and quillkit is a tool, so no node in this repository runs `fromBuiltDir` or `fromBuiltFiles`. Surface comes out when no row needs it, which is not the same question.

**Every export names `default` beside `import`.** A tool resolving this package from a consumer's tree walks the exports map under CJS conditions whatever its own module system, so a subpath offering `import` alone is invisible to it. Every verb quillkit runs reaches this package that way, out of the collection's own tree; `@quillmark/wasm` names both, which is why its engine discovery works at all.

The `/node` factories are free functions, not statics: the class stays browser-pure, the entry that reads a filesystem imports nothing onto it, and a bundler drops the verbs a consumer does not call. The statics are the two that reach no filesystem, so what is on the class is what runs anywhere. Construction itself is sealed: `Quiver` has a private constructor and the loader seam is reachable from no entry in `exports`. There is no public transport API (auth headers, custom fetch, `AbortSignal`) and no consumer story asking for one; a sealed seam keeps that option clean, a half-open one lets dependents grow on an unsupported surface.

Browsers cannot read the source layout, so `build(src, out)` packs it at deploy time and the output is served as static assets. `fromBuiltDir` exists for the server that ships the packed artifact in its own image: it avoids the self-fetch round-trip `fromBuiltUrl` would force on a self-hosted deployment, and lets the source quiver stay a devDependency. It carries `transports/fs-built-transport.ts` and the path-escape validation reading manifest-named files off a disk needs.

`fromBuiltFiles` buys the same property where the artifact is not on a path the process can read, which is a serverless function: the packed tree is outside the invocation's filesystem, so handing over the bytes is what is left. It carries `transports/memory-transport.ts`, which needs no path-escape validation: a map has nothing to escape into.

`build` owns `out` outright: the previous generation never bleeds into the new one. An `out` that is, or contains, the source quiver or the working directory is refused rather than cleared: `--out .` and a slipped `--out ..` are one keystroke away and the deletion is unrecoverable. An `out` nested *inside* the source (`dist/` under the quiver root) is the ordinary layout and stays allowed, since the scan reads the source before the first write.

## The generation lands whole

A build is never observably half-written. It is assembled in `<out>.stage` and moved in, and the tree it replaces is deleted after. Packing straight into `out` would leave a window seconds wide where the pointer is missing or names a manifest whose bundles have not landed, and a client reading it there reports a broken quiver for an edit that was fine; a build that throws would leave that window open until the next one.

The property belongs here rather than to whatever is serving, because the directory is this function's and no caller can close a window inside it. What remains is two renames: a directory rename refuses a non-empty target, so the outgoing generation steps aside first. Between the two it is only at `.prev`, so a second rename that throws puts it back, and the sweep that clears the siblings spares it where even that fails: what the window costs is a torn read, never both generations. The staging siblings are named off `out` and cleared with it, which is why the destructive-write refusals are checked over all three.

## The draft floor

`build` packs `0.1.0` and up. Below it is the draft space: a version an author is still shaping, inside a collection that is very likely already published, and the artifact is a deployment rather than a working tree. The floor is a semver reading rather than a policy knob — `0.0.x` is the range semver already spends on what is not for consumption — so it is a constant here and not a field `Quiver.yaml` carries.

The source layout keeps every version, and `fromDir` reads them all: the filter is `build`'s alone, which is what leaves an author's own tooling and `quillkit test` looking at the whole tree. `build(src, out, { drafts: true })` turns it off, for a viewer rather than a deployment — `quillkit studio` packs through this function to serve an author their own collection, where a floor would hide the quill most likely to be under the cursor, and `quillkit site --drafts` lays out a preview of the same.

A quill with nothing above the floor is absent from the manifest rather than present and empty, and a quiver of nothing but drafts builds a pointer over an empty catalog. Which of the two ran is not stamped anywhere: the manifest is closed and carries its own version, so a field there costs a version bump to record a fact about a directory under `node_modules` that no deployment reads.

## The pointer

`fromBuiltUrl` fetches `<url>/latest.json` first: a stable-named, non-content-addressed pointer to the current manifest. Everything behind it is content-addressed and safe to cache forever; that one filename is not. A CDN edge or a browser cache can serve a stale pointer after a release and silently pin the client to the old catalog, with no error, and per-host cache headers fix one serving layer at a time. The pointer is therefore the one request fetched `no-cache` (revalidate with the origin, a 304 still serving from disk), which closes the browser-cache layer and nothing above it.

**Both halves of that are the transport's to say, not a host's.** A name carrying its own digest is entitled to a cached response whatever its age, so every fetch but the pointer is `force-cache`. Left at the default it would cost a revalidation per name per load on any host serving `max-age=0`, which is the commonest static-host default and the one the artifact knows better than. What a header still owns is the layer above the browser's, and the client's own bundle beside the artifact, which this reads nothing of.

**The pointer states the format, and is the one document here that reads past what it knows.** Skew is the ordinary case rather than the broken one: a collection is packed by whatever copy of this package the author's CI installs, and read by the copy frozen inside whichever client is laid over it. `latest.json` is what a reader of any age fetches first, so it is where a format change announces itself. That works only if unknown keys pass through, since a pointer parsed strictly refuses the announcement along with everything else. A `format` above the reader's is named as such, with the upgrade named too; absent means a build from before the marker, which is format 1. The manifest behind it stays closed, carrying its own `version` and rejecting fields it does not know: it is reached only once the format is agreed.

That closure is what makes the manifest's `version` load-bearing rather than decorative. A field added to a closed document is a field an older reader rejects as an unknown key, naming neither what happened nor what to do; the version is what that reader reads first instead, and a manifest above its own is refused with the upgrade named, the way the pointer's format is. So an addition here moves the number, and a reader takes every version up to its own: version 2 carries the quiver's `description`, and version 1 is the same document without it.

The fetch is skippable by holding the answer. `fromBuiltUrl(url, { seed })` reads the map before the network, so a deployment carrying `latest.json` closes the layer above the one `no-cache` closes: which catalog the process reads is settled by what shipped rather than by what a cache returns.

Seeded bytes are checked exactly as fetched bytes are, because the check reads the digest in the name and a name arrives the same way whoever holds it. A deployment shipping one generation's pointer beside another's manifest fails on the digest rather than serving a catalog nobody packed.

## Content addressing is checked, not asserted

Every name but the pointer carries the SHA-256 of what it names, and the loader hashes what arrives before using it: a manifest against the digest in the pointer's filename, a bundle against the digest in the manifest's, a font against its full-width store key. That check is what turns "safe to cache forever" into a property: it catches a corrupted CDN object, a partial sync, and a name reused across releases, and it reports `transport_error`, so the caches that evict on error let a retry succeed. Where no digest primitive exists (`crypto.subtle` is secure-context-only, so a page served over plain `http` to something other than localhost has none) the fetch passes through unchecked rather than failing.

Bundle and manifest names carry 32 hex chars; the width answers a chosen prefix rather than a collision, and `digest.ts` states what that buys. Store keys are the full 64, because the store is keyed by hash and two distinct fonts sharing a prefix would merge into one entry.

**The check is integrity, not provenance.** It says the bytes are the bytes the name claims and nothing about who packed them, so what a consumer owns is the choice of source, stated for them in the [README](../../README.md#what-a-quiver-is-trusted-to-be).

**A bundle carries a budget**: a ceiling on what it unpacks to, on any one file inside it, and on how many there are, spent off the sizes the central directory declares and refused as `quiver_invalid` at the entry that trips it. fflate filters and inflates in one pass, so the entries the budget already took are resident when it throws — bounded, being what fit inside it. Deflate tops out near 1032:1, so what a megabyte of zip costs a reader is a gigabyte of resident bytes, and it finds out by allocating them.

The ceiling is a constant rather than an option a consumer raises, because the check above is integrity and not provenance: what a budget answers is a build that packed something enormous, not an artifact chosen to be hostile, which is a thing to refuse by choosing the source. `packFiles` spends the same budget, so a quill over it is refused by the build that packs it, named, rather than by whatever reads the artifact later. Fonts sit outside it, being store entries the manifest names rather than bundle entries.

**The budget is spent on the wire too.** Each fetch carries the ceiling for what it asked for: the unpack budget for a bundle, a smaller one for a font, smaller again for the pointer and the manifest. `HttpTransport` holds it — a `Content-Length` over it is refused before a byte is read, and a body that runs past it is cancelled mid-stream, `quiver_invalid` either way. Every other refusal above is a verdict on bytes that have all arrived: a digest is what the whole response hashes to, a budget what its zip declares. So without a ceiling at the socket, a response no reader would accept costs a browser tab before anything can say so. `FsBuiltTransport` and `MemoryTransport` ignore the number: a file is read at the size it is, and a held buffer is already held.

What the addressing does not buy is a stale-pointer fallback: `build` replaces its output rather than adding to it, so a client pinned to a stale pointer gets 404s rather than a stale-but-working catalog. That costs nothing while an artifact and its clients deploy together; where they deploy independently, an append-only store with garbage collection is what buys it back.

## getQuill is the seam

`quiver.getQuill(ref)` is the only way to obtain a quill from a quiver, and the only entry point a consumer needs. It accepts selector refs (`"memo"`, `"memo@1"`) and canonical ones (`"memo@1.0.0"`), resolves the selector, fetches the tree, materializes it through `Quill.fromTree`, and caches one instance per canonical ref for the quiver's lifetime. Concurrent calls for the same ref coalesce into a single load.

**It awaits the WASM gate itself**, so instantiating the core is not a precondition a consumer has to know about. `init()` is the only door to `Quill`, and it is memoized: this is one instantiation across every caller, overlapped with the fetch that pays for it. A consumer reaching the classes for its own reasons awaits the same gate.

Reaching for `Quill.fromTree` inside a quiver consumer bypasses that cache and redoes the work. `Quill.fromTree` is for quills built **outside** a quiver: a server route receiving a raw tree over the network, a test fixture assembling one by hand.

One narrower verb sits beside it: `resolve(ref)` returns the canonical ref without materializing anything.

The quill cache is the only one. A fetched tree lives for the length of the materialization that consumes it and no longer: a second cache holding trees would buy a retry after a `Quill.fromTree` throw its refetch, which is a round-trip saved on the path where the quill is broken, against a cache to evict, coalesce and reason about on every path where it is not.

`resolve` is **sync**, and so are `quillNames()` and `versionsOf()`: the catalog is materialized as the quiver is built (`fromBuiltUrl` fetches `latest.json`, `fromDir` scans the source tree), and `QuiverLoader` carries one verb, `loadTree`, which resolution never reaches. A promise there would price I/O the design does not admit.

Every catalog row is a name a ref can spell. Both loaders hold the row to the charset `parseQuillRef` takes, so what `quillNames()` hands out is what `getQuill` takes back; a source directory or a manifest entry outside it is a `quiver_invalid` naming it, not a row the one verb lists and the other refuses.

`name` and `description` are what `Quiver.yaml` says the collection is, and both reach the class by the same road: parsed off the source tree, written into the manifest by `build`, read back out of it by every built loader. A surface over a quiver has no other authored sentence to print — everything else it can show about a collection is a name a directory happens to carry.

## The render boundary

This package produces quills; `@quillmark/wasm` renders them. A quill from `getQuill` is engine-free portable data (schema inspection, validation, blueprint access, seeding) and passes straight to `engine.render(quill, doc)`, which routes on `quill.backendId`, lazily loads that backend, clones both handles into its memory, renders, and frees the clones. There is no boundary-crossing step to perform.

The canonical `Quill` / `Document` / `Engine` types are **not** re-exported here. They come from the `@quillmark/wasm` peer, which is their single source of truth: the one installed copy whose linear memory every handle indexes into (`check:deps`).

`Engine.render`, `open` and `supportedFormats` are async.

## Errors

Every error is a `QuiverError` carrying a `code`, a human-readable `message`, and the offending `ref` where there is one. The codes are a closed set: `invalid_ref`, `quill_not_found`, `quiver_invalid`, `transport_error`, so a consumer branches on `code` rather than parsing text.

## Nothing here is a verb

This package has no `bin`. Loading a quiver and packing one are library functions; the verbs a quill author types are [quillkit](../../../quillkit/prose/canon/QUILLKIT.md)'s, which resolves this package out of the collection's own `node_modules` and calls them.

**What that buys is stated there; what it costs is stated here.** This version number is a format number. `build` writes the pointer, the manifest names and the digest widths, and `fromBuiltUrl` reads them, so a collection depending on this package pins both halves at once, and a release here is a release of the format. A verb added to a CLI must not move it.

The name stays the artifact's. `quiver` is the plain word that reads right inside an ambiguous sentence (the quiver is stale, the quiver has no quills), and `Quiver.yaml` at a collection's root is what an author names the thing after. A bin lands in a namespace it shares with every other tool a consumer installs, which is a place for a coined word rather than a plain one.
