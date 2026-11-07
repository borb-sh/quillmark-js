# @quillmark/quiver invariants

The rules a change to `@quillmark/quiver` must keep, the reason behind each, and the designs already weighed and rejected. The loaders, `build` and `getQuill` are walked through in the [README](../README.md) and documented in tsdoc. A rule belongs here only if a capable reader of the code would plausibly break it, and a change that breaks one updates this page in the same commit, with the new reason.

## Loaders

**One authored shape; each loader names exactly what it reads.** Authors write one layout and the deployment is the consumer's decision, so the author flow stays one command and the loaders fan out below it. Rejected: auto-detection, which would make the deployment the package's decision rather than the consumer's.

**A loader comes out when no deployment needs it**, not when nothing in this workspace calls it. The package is published and most callers are outside this workspace; the README's loader table is the removal test.

**The class stays browser-pure.** The `/node` factories are free functions, so a bundler drops what a consumer does not call. Every export names `default` beside `import`, because a tool resolving this package from a consumer's tree walks the exports map under CJS conditions.

**Construction is sealed.** There is no public transport API and no consumer asking for one, and a half-open seam would let dependents grow on an unsupported surface.

## Build

**`build` owns `out` outright, and refuses an `out` that is or contains the source or the working directory**, since that deletion is one keystroke away and unrecoverable.

**The generation lands whole.** A build is assembled in `<out>.stage` and swapped in by renames, so a client reading mid-build never sees a `quiver.json` naming bundles that have not landed. The property belongs here because the directory is this function's and no caller can close a window inside it. A failed swap puts the previous generation back: the worst case is a torn read, never both generations lost.

**The draft floor is `0.1.0`, and it is a constant.** Below it is the draft space, a version an author is still shaping inside a collection that is likely already published. Rejected: a `Quiver.yaml` field, since the floor is semver's own reading of `0.0.x` rather than a collection's choice. `fromDir` reads every version, so the author's tooling and the gate see the whole tree, and `isDraft` is the floor's one reading.

**A bundle over the format's size budget is refused at build**, named, rather than later by a reader, since `build` spends the same budget the codec enforces.

## The index

**`quiver.json` is the one name fetched `no-cache`.** Every other name carries a digest of what it names, so it is fetched `force-cache` and can never be stale. The same split is what a host owes the layer above, stated for a deploy in quillkit's [README](../../quillkit/README.md).

**The format is read before anything else is believed.** Skew is the ordinary case: a collection is packed by whatever copy the author's CI installs and read by the copy frozen inside each client. A reader skips fields it does not know, so an addition an older reader can do without keeps the format; a change an older reader would misread moves it, and a reader refuses any format but its own with the fix named.

**A tab outlives a generation.** A client that booted on the previous `quiver.json` may ask for names the next build deleted, so a failed read rereads the index once and retries under the entry it now names.

## Quills

**A quill is one file**: a `.quill` bundle, the format every Quillmark runtime reads (quillmark [`quill-bundle.md`](https://github.com/borb-sh/quillmark/blob/main/prose/references/quill-bundle.md)), holding the quill's whole tree with its fonts. The file `getQuill` reads is the file a host can store, attach or hand to `Quill.fromBundle`. Rejected: bundles sharing a font store, which saves a font two quills both carry at the cost of a quill no longer being one portable file.

**Nothing checks the bytes against their name.** Integrity is the channel's, so an artifact is served over https. What is checked is that a bundle opens as a zip, since a host answering a missing name with its own page answers 200. Nothing here is provenance either: the choice of source is the consumer's ([README](../README.md#what-a-quiver-is-trusted-to-be)).

**`getQuill` is the seam**, and its cache the only cache. It is the only way to obtain a quill and holds one instance per canonical ref for the quiver's lifetime, coalescing concurrent calls, so a quill it returns is borrowed: shared with every caller for that ref, and never the caller's to free. It awaits the WASM gate itself, so instantiating the core is not a precondition a consumer has to know.

**A selector is `x.y` or `x.y.z`.** A quill's compatibility boundary is `MAJOR.MINOR` at every version: a patch asks nothing of a stored document and a minor step asks one to be rewritten. So `memo@1.0` is the highest `1.0.z` held, and `memo@1` names no series and is `invalid_ref`.

**Names follow Quillmark's `[a-z][a-z0-9_]*`**, the rule a document's `$quill`, a `Quill.yaml` and a ref share, and both loaders hold the catalog to it. The quiver's own name follows it too, since a ref `<quiver>.memo` names the collection it was written for. A source version directory must sit where its `Quill.yaml` says it is.

## Boundaries

**This package produces quills; `@quillmark/wasm` renders them.** The handles pass to the engine untouched. The `Quill`, `Document` and `Engine` types are not re-exported: they come from the `@quillmark/wasm` peer, the one installed copy whose memory every handle indexes into (`check:deps`).

**Every error is a `QuiverError` with a `code` from a closed set**, so a consumer branches on `code`, never on message text.

**This package has no verb, and its version is a format number.** The verbs a quill author types are quillkit's, which carries this package at an exact version. `build` writes the format and `fromBuiltUrl` reads it, so a release here is a release of the format, and a CLI change must not move it.
