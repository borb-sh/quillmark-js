# Quiver

> **Implementation**: `src/`

## TL;DR

A quiver is a collection of quills, addressed by ref and resolved to a `Quill`. This package loads one from wherever it lives (a source directory, a packed artifact on disk, a URL), packs one for a browser, and hands out quills. The loaders never render: `@quillmark/wasm` does that, and the handles pass to it untouched. Nothing here is a verb an author types either: this is the library a collection depends on, and [quillkit](../../../quillkit/prose/canon/QUILLKIT.md) is the tool that resolves it.

## One authored shape, four deployments

Authors write one layout: `Quiver.yaml` at the package root, quills under `quills/<name>/<x.y.z>/`, published as an npm package or a git tag. Where it is deployed is the consumer's decision, so the author flow stays one command and the loaders fan out below it. Each loader names exactly what it reads; there is no auto-detection.

| Deployment | Holds | Loader | Where |
| --- | --- | --- | --- |
| Author machine, CI | the source layout | `fromDir(path)` | `/node` |
| Browser | nothing | `Quiver.fromBuiltUrl(url)` | anywhere |
| Server with a filesystem | build output in its image | `fromBuiltDir(path)` | `/node` |
| Server without one | build output in memory | `Quiver.fromBuiltFiles(files)` | anywhere |

**The table is the removal test.** The package is published and most callers are outside this workspace, so a loader comes out when no deployment row needs it, not when nothing here calls it.

The `/node` factories are free functions, so the class stays browser-pure and a bundler drops what a consumer does not call. Construction is sealed: there is no public transport API and no consumer asking for one, and a half-open seam would let dependents grow on an unsupported surface. Every export names `default` beside `import`, because a tool resolving this package from a consumer's tree walks the exports map under CJS conditions.

Browsers cannot read the source layout, so `build(src, out)` packs it at deploy time and the output is served as static assets. `build` owns `out` outright, and refuses an `out` that is or contains the source or the working directory, since that deletion is one keystroke away and unrecoverable.

## The generation lands whole

A build is never observably half-written. It is assembled in `<out>.stage` and swapped in by renames, so a client reading mid-build never sees a `quiver.json` naming bundles that have not landed. The property belongs here because the directory is this function's and no caller can close a window inside it. A failed swap puts the previous generation back: the worst case is a torn read, never both generations lost.

## The draft floor

`build` packs `0.1.0` and up; below it is the draft space, a version an author is still shaping inside a collection that is likely already published. The floor is semver's own reading of `0.0.x`, so it is a constant rather than a `Quiver.yaml` field. `fromDir` reads every version, so the author's tooling and `quillkit check` see the whole tree; `isDraft(version)` is the floor's one reading, and `build(src, out, { drafts: true })` turns it off for a viewer such as `quillkit serve`.

## The index

`fromBuiltUrl` fetches `<url>/quiver.json` first: the format, the collection's name and description, and one entry per quill naming its bundle. Every other name carries a digest of what it names, so it is fetched `force-cache` and can never be stale; `quiver.json` is the one name that is not, so it is fetched `no-cache`. The same split is what a host owes the layer above, stated for a deploy in quillkit's [README](../../../quillkit/README.md).

**The format is read before anything else is believed.** Skew is the ordinary case: a collection is packed by whatever copy the author's CI installs and read by the copy frozen inside each client. A reader skips fields it does not know, so additions an older reader can do without keep the format; a change an older reader would misread moves it, and a reader refuses any format but its own with the fix named.

**A tab outlives a generation.** A client that booted on the previous `quiver.json` may ask for names the next build deleted, so a failed read rereads the index once and retries under the entry it now names.

## Content addressing is for caching

**A quill is one file**: a `.quill` bundle, the format every Quillmark runtime reads ([quill-bundle.md](https://github.com/borb-sh/quillmark/blob/main/prose/references/quill-bundle.md)), holding the quill's whole tree with its fonts. Bundles share nothing, so the file `getQuill` reads is the file a host can store, attach or hand to `Quill.fromBundle`. The cost is a font two quills both carry being in both bundles.

Bundles are read by Quillmark's own codec, so they are refused for whatever the format refuses, including a bundle over the format's size budget. `build` spends the same budget when it packs, so an oversized quill is refused at build, named, rather than later by a reader.

**Nothing checks the bytes against their name.** Integrity is the channel's, so an artifact is served over https. What is checked is that a bundle opens as a zip, since a host answering a missing name with its own page answers 200. Nothing here is provenance either; the choice of source is the consumer's ([README](../../README.md#what-a-quiver-is-trusted-to-be)).

## getQuill is the seam

`quiver.getQuill(ref)` is the only way to obtain a quill from a quiver and the only entry point a consumer needs. It resolves the ref, fetches the bundle or tree, materializes it through `Quill.fromBundle` or `Quill.fromTree`, and caches one instance per canonical ref for the quiver's lifetime, coalescing concurrent calls. It awaits the WASM gate itself, so instantiating the core is not a precondition a consumer has to know. The quill cache is the only cache.

`resolve`, `quillNames()` and `versionsOf()` are sync, because the catalog is materialized when the quiver is built.

**A selector is `x.y` or `x.y.z`.** A quill's compatibility boundary is `MAJOR.MINOR` at every version: a patch asks nothing of a stored document and a minor step asks one to be rewritten. So `memo@1.0` is the highest `1.0.z` held, and `memo@1` names no series and is `invalid_ref`.

Quill names follow Quillmark's `[a-z][a-z0-9_]*`, the rule a document's `$quill`, a `Quill.yaml` and a ref share, and both loaders hold the catalog to it. A source version directory must sit where its `Quill.yaml` says it is. The quiver's own name follows the same rule, since a ref `<quiver>.memo` names the collection it was written for.

## The render boundary

This package produces quills; `@quillmark/wasm` renders them. A quill from `getQuill` passes straight to `engine.render(quill, doc)` with no boundary-crossing step. The `Quill`, `Document` and `Engine` types are not re-exported: they come from the `@quillmark/wasm` peer, the one installed copy whose memory every handle indexes into (`check:deps`).

## Errors

Every error is a `QuiverError` with a `code` from a closed set (`invalid_ref`, `quill_not_found`, `quiver_invalid`, `transport_error`), a `message`, and the offending `ref` where there is one, so a consumer branches on `code`.

## Nothing here is a verb

This package has no `bin`. The verbs a quill author types are quillkit's, which carries this package at an exact version. That makes this version a format number: `build` writes the format and `fromBuiltUrl` reads it, so a release here is a release of the format, and a CLI change must not move it.
