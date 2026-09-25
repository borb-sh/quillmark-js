# Quiver

> **Implementation**: `src/`

## TL;DR

A quiver is a collection of quills, addressed by ref and resolved to a `Quill`. This package reads one from where it lives (a source directory, or the one file `build` packs it into), packs one for a browser, and hands out quills. The **loaders** never render: `@quillmark/wasm` does that, and the handles pass to it untouched. Nothing here is a verb an author types either: this is the library a collection depends on, and [quillkit](../../../quillkit/prose/canon/QUILLKIT.md) is the tool that resolves it.

## One authored shape, one packed file

Authors write **one** layout: `Quiver.yaml` at the package root, quills under `quills/<name>/<x.y.z>/`, published as an npm package or a git tag. A browser cannot read that layout, so `build(src, outFile)` packs it into **one file** at deploy time, and every consumer that is not reading the source reads that file.

The loaders name exactly what they read; there is no auto-detection and no branching on artifact shape.

| Holds | Loader | Where |
| --- | --- | --- |
| the source layout | `fromDir(path)` | `/node` |
| the artifact's bytes | `Quiver.fromBytes(bytes)` | anywhere |
| the artifact's URL | `Quiver.fromUrl(url)` | anywhere |

A server with the artifact in its image reads the file and passes the bytes; a serverless function with it inlined by a bundler passes the bytes it holds; a browser passes the URL. There is no transport to choose, because a caller holds either bytes or a URL, and `fromUrl` is a fetch in front of `fromBytes`.

Reaching a quiver installed from npm is not a fourth row: `dirname(createRequire(import.meta.url).resolve('<pkg>/Quiver.yaml'))` handed to `fromDir` or `build` is one line at the call site, where the resolution base belongs to the caller and the `exports`-map subpath it lands on is visible rather than a rule this package documents and holds.

**The table is the removal test.** This package is published, so its callers are mostly outside this workspace and "nothing here calls it" is measured on a sample that excludes them. Surface comes out when no row needs it, which is not the same question.

**Every export names `default` beside `import`.** A tool resolving this package from a consumer's tree walks the exports map under CJS conditions whatever its own module system, so a subpath offering `import` alone is invisible to it. Every verb quillkit runs reaches this package that way, out of the collection's own tree; `@quillmark/wasm` names both, which is why its engine discovery works at all.

The `/node` factories are free functions, not statics: the class stays browser-pure, the entry that reads a filesystem imports nothing onto it, and a bundler drops the verbs a consumer does not call. The statics are the two that reach no filesystem, so what is on the class is what runs anywhere. Construction itself is sealed: `Quiver` has a private constructor and the loader seam is reachable from no entry in `exports`. There is no public fetch API (auth headers, custom fetch, `AbortSignal`) and no consumer story asking for one: a caller needing any of it fetches the bytes itself and calls `fromBytes`.

## The artifact

One zip, conventionally `quiver.qv`:

| Path | Holds |
| --- | --- |
| `quiver.json` | the format, the collection's `name` and `description`, and per quill its `name`, `version` and a map of font paths to their SHA-256 |
| `quills/<name>/<version>/…` | each quill's files, fonts excepted |
| `fonts/<sha256>` | each font once, however many quills carry it |

Fonts are the heavy bytes and the ones quills share, so they are stored once by full-width hash and put back at each quill's own paths when it is read. The full 64 hex chars, because the store is keyed by hash and two distinct fonts sharing a prefix would merge into one entry.

**The artifact is opened whole and inflated by the quill.** `fromBytes` reads the central directory, `quiver.json` and nothing else, and checks the layout against the document: every entry is one the document accounts for, and every font a quill names is present. A torn or hand-assembled file fails there, whole, rather than at whichever quill a reader happens to open first. `getQuill` inflates that quill's files and its fonts out of the held bytes and nothing more, so the catalog is resident from the first moment and the quills cost what is asked for.

`build` writes it deterministically: entries sorted, one fixed mtime, the document serialized in catalog order. The same source packs to the same bytes.

## One file, one version

**`quiver.json` states the format, and it is read before anything else is believed.** Skew is the ordinary case rather than the broken one: a collection is packed by whatever copy of this package the author's CI installs, and read by the copy frozen inside whichever client is laid over it. A `format` above the reader's is refused with the upgrade named; a reader takes every format up to its own.

The document is closed past that: a field it does not know is refused. That closure is what makes the number load-bearing rather than decorative. A field added to a closed document is one an older reader rejects as an unknown key, naming neither what happened nor what to do; the format is what that reader reads first instead. So an addition moves the number, and an unknown field under a newer format is answered by the format rather than by the field.

## The file is replaced whole

`build` writes the artifact beside its destination under a name unique to the build, then renames it on. A rename on one filesystem is atomic, so a reader sees the previous file or the next one and never a torn one, and a build that throws removes its temp file and leaves the previous artifact in place. The unique name is what lets two builds aimed at one file land in either order without writing into each other.

Nothing is cleared. `build` owns one path, and a destination it cannot rename onto (a directory, a parent that is a file) is a `transport_error` that leaves nothing behind.

## The draft floor

`build` packs `0.1.0` and up. Below it is the draft space: a version an author is still shaping, inside a collection that is very likely already published, and the artifact is a deployment rather than a working tree. The floor is a semver reading rather than a policy knob — `0.0.x` is the range semver already spends on what is not for consumption — so it is a constant here and not a field `Quiver.yaml` carries.

The source layout keeps every version, and `fromDir` reads them all: the filter is `build`'s alone, which is what leaves an author's own tooling and `quillkit test` looking at the whole tree. `build(src, out, { drafts: true })` turns it off, for a viewer rather than a deployment — `quillkit studio` packs through this function to serve an author their own collection, where a floor would hide the quill most likely to be under the cursor, and `quillkit site --drafts` lays out a preview of the same.

A quill with nothing above the floor is absent from the artifact rather than present and empty, and a quiver of nothing but drafts packs an empty catalog. Which of the two ran is not stamped anywhere: the document is closed and carries its own format, so a field there costs a format bump to record a fact no deployment reads.

## Fetched whole, revalidated

`fromUrl` fetches the file once, `no-cache`: the browser revalidates with the origin, and a 304 still serves from disk. A release therefore reaches the next load rather than the next cache expiry, and there is exactly one request to get right. The layer above the browser's is the host's, and the rule it owes is the one it owes the client's own `index.html`: revalidate everything that is not hash-named ([quillkit's README](../../../quillkit/README.md#what-a-host-owes-it) carries the deploy contract).

A host answering a missing path with its index page (an SPA fallback, the commonest static-host default) serves HTML where the artifact should be. The reader names that case, rather than reporting a zip it cannot open.

## What the file does not carry

**No digest.** Integrity is the channel's and the deploy's: the artifact is served over https, from the same deploy as the client reading it, so it arrives by the same authenticated road as the code that reads it, and the host rule that keeps a client current keeps the artifact beside it current too. A digest would add a check for the one case this shape does not have, bytes from a source the deployer does not control, and it is integrity rather than provenance anyway: it says the bytes are the bytes a name claims, and nothing about who packed them. What a consumer owns is the choice of source, stated for them in the [README](../../README.md#what-a-quiver-is-trusted-to-be).

**A budget, held where the zip is opened**: a ceiling on what the artifact unpacks to, on any one file inside it, and on how many there are, spent off the sizes the central directory declares and refused as `quiver_invalid` at the entry that trips it. Deflate tops out near 1032:1, so what a megabyte of zip costs a reader is a gigabyte of resident bytes, and it finds out by allocating them. The ceiling is a constant rather than an option a consumer raises: what a budget answers is a build that packed something enormous, not an artifact chosen to be hostile, which is a thing to refuse by choosing the source. `build` spends the same budget, so a collection over it is refused by the build that packs it, named, rather than by whatever reads the artifact later.

## What grows it back

Each piece this shape does without answers one trigger, and meeting the trigger is what brings the piece back:

| Trigger | Brings back |
| --- | --- |
| a collection large enough that fetching it whole is felt, or releases frequent enough that re-fetching unchanged fonts is | per-quill files fetched on demand, content-addressed names, a font store shared across releases |
| an artifact deployed apart from the clients reading it | a stable pointer over immutable names, and a store that keeps old generations |
| bytes from a source the deployer does not control | a digest per name, checked on arrival |

None fires for an artifact that ships with its client, which is every deployment `quillkit site` writes.

## getQuill is the seam

`quiver.getQuill(ref)` is the only way to obtain a quill from a quiver, and the only entry point a consumer needs. It accepts selector refs (`"memo"`, `"memo@1"`) and canonical ones (`"memo@1.0.0"`), resolves the selector, fetches the tree, materializes it through `Quill.fromTree`, and caches one instance per canonical ref for the quiver's lifetime. Concurrent calls for the same ref coalesce into a single load.

**It awaits the WASM gate itself**, so instantiating the core is not a precondition a consumer has to know about. `init()` is the only door to `Quill`, and it is memoized: this is one instantiation across every caller, overlapped with the fetch that pays for it. A consumer reaching the classes for its own reasons awaits the same gate.

Reaching for `Quill.fromTree` inside a quiver consumer bypasses that cache and redoes the work. `Quill.fromTree` is for quills built **outside** a quiver: a server route receiving a raw tree over the network, a test fixture assembling one by hand.

One narrower verb sits beside it: `resolve(ref)` returns the canonical ref without materializing anything.

The quill cache is the only one. A fetched tree lives for the length of the materialization that consumes it and no longer: a second cache holding trees would buy a retry after a `Quill.fromTree` throw its refetch, which is a round-trip saved on the path where the quill is broken, against a cache to evict, coalesce and reason about on every path where it is not.

`resolve` is **sync**, and so are `quillNames()` and `versionsOf()`: the catalog is materialized as the quiver is built (`fromBytes` reads `quiver.json`, `fromDir` scans the source tree), and `QuiverLoader` carries one verb, `loadTree`, which resolution never reaches. A promise there would price I/O the design does not admit.

Every catalog row is a name a ref can spell. Both loaders hold the row to the charset `parseQuillRef` takes, so what `quillNames()` hands out is what `getQuill` takes back; a source directory or a `quiver.json` entry outside it is a `quiver_invalid` naming it, not a row the one verb lists and the other refuses.

`name` and `description` are what `Quiver.yaml` says the collection is, and both reach the class by the same road: parsed off the source tree, written into `quiver.json` by `build`, read back out of it by `fromBytes`. A surface over a quiver has no other authored sentence to print — everything else it can show about a collection is a name a directory happens to carry.

## The render boundary

This package produces quills; `@quillmark/wasm` renders them. A quill from `getQuill` is engine-free portable data (schema inspection, validation, blueprint access, seeding) and passes straight to `engine.render(quill, doc)`, which routes on `quill.backendId`, lazily loads that backend, clones both handles into its memory, renders, and frees the clones. There is no boundary-crossing step to perform.

The canonical `Quill` / `Document` / `Engine` types are **not** re-exported here. They come from the `@quillmark/wasm` peer, which is their single source of truth: the one installed copy whose linear memory every handle indexes into (`check:deps`).

`Engine.render`, `open` and `supportedFormats` are async.

## Errors

Every error is a `QuiverError` carrying a `code`, a human-readable `message`, and the offending `ref` where there is one. The codes are a closed set: `invalid_ref`, `quill_not_found`, `quiver_invalid`, `transport_error`, so a consumer branches on `code` rather than parsing text.

## Nothing here is a verb

This package has no `bin`. Loading a quiver and packing one are library functions; the verbs a quill author types are [quillkit](../../../quillkit/prose/canon/QUILLKIT.md)'s, which resolves this package out of the collection's own `node_modules` and calls them.

**What that buys is stated there; what it costs is stated here.** `build` writes the format and `fromBytes` reads it, so a collection depending on this package pins both halves at once. The file names its own format, so a reader meeting a newer one says so rather than misreading it; what the pin still holds is that the copy which packs is the copy `quillkit test` renders through, one wasm module behind both the quills and the engine. A verb added to a CLI must not move it.

The name stays the artifact's. `quiver` is the plain word that reads right inside an ambiguous sentence (the quiver is stale, the quiver has no quills), and `Quiver.yaml` at a collection's root is what an author names the thing after. A bin lands in a namespace it shares with every other tool a consumer installs, which is a place for a coined word rather than a plain one.
