# Changelog

`@quillmark/quiver`. An entry is written into `## Unreleased` by the change that earns it; a release promotes that body to its own version section.

## Unreleased

**A built quiver is `quiver.json`, one bundle per quill, and `fonts/`.** `quiver.json` carries the format and the catalog, and is the one name fetched `no-cache`; every bundle and font name carries the digest of its bytes and is fetched `force-cache`. The hashed manifest and `store/` are gone, and `latest.json` carries only `format`, so a reader of format 1 refuses a format-2 artifact by name; every artifact is rebuilt (MIGRATION.md). `getQuill` still reads one bundle and the fonts it names, and a font shared across quills or versions is still written once.

**`quiver.json` states `format` and is closed.** The format is read before the key check, so a newer document is refused as newer with the upgrade named; past it, an unknown field is `quiver_invalid`.

**A tab outliving a release reads the next one's names.** A failed bundle or font read rereads `quiver.json` once, takes every entry both generations carry, and retries under the entry it now names where that entry names other files; otherwise the first error stands, unless the reread refused the index itself. Concurrent failures share one reread.

**A bundle has to open as a zip and a font as a font.** A host answering a missing name with its own page answers 200, and a font nothing parses reaches Typst, which substitutes for it silently; either is now a `transport_error` naming the path. `build` refuses a font file that does not open as TrueType, OpenType, WOFF or WOFF2.

**Nothing checks fetched bytes against their names, and no fetch carries a byte ceiling.** The digests are for caching and https answers a corrupted byte, so `crypto.subtle` and the plain-http pass-through go with the check. A bundle's unpack budget is unchanged. `Quiver.fromBuiltUrl` takes no `seed`, and `fromBuiltDir` reads each name `quiver.json` lists off disk, a validated name carrying no separator.

## v0.29.0 - 2026-09-23

**The `@quillmark/wasm` peer floor is `>=0.115.0-0`.** Nothing here reads a schema or a content, so the span's declarations — `type: matrix`, `ui.layout: "table"`, `max:` on an array — and its cuts land outside this package; the floor rises because a quiver hands out `Quill` handles the consumer's copy of the artifact has to load. Two cuts reach a packed quill: a matrix `members:` is one flat `{id: Title}` mapping, the list of `{group, values}` blocks failing at load, and a `ui.layout: table` column that is not a leaf is `quill::table_column_not_flat`. What a consumer meets on the artifact's own terms is one new load warning, `quill::bodiless_card_kind`, on a card kind declaring `body.enabled: false`.

## v0.28.0 - 2026-09-16

**The `@quillmark/wasm` peer floor is `>=0.113.0-0`.** Nothing here reads a line, a mark or a container, so the release's closing of the content vocabularies lands outside this package; the floor rises because a quiver hands out `Quill` handles the consumer's copy of the artifact has to load. What a consumer of those handles meets is on the artifact's own terms: a payload under `attrs`, a name outside a vocabulary refused wherever content is decoded, and a `Quill` whose `metadata` carries its five identity keys and no mirrored backend key. Canvas paint stops being a capability, so `Engine.supportsCanvas` is gone and `BackendDescriptor` is `formats` alone — a registry entry keeps working with a `canvas` key left on it, which is now ignored.

**A quill loads under a stricter reader.** The floor's step refuses shapes a quiver happily packed: a `Quill.yaml` whose `main:` is not a mapping or carries an unknown key (`quill::invalid_card_schema`), a `ui.group` with no `ui.groups` registry (`quill::implicit_group`, at error severity), more than 1000 declared fields on one card (`quill::too_many_fields`), and a vendored `packages/<dir>/` with no `typst.toml`, which is skipped with a `typst::package_manifest` warning instead of loading under a synthesized name. `.quillignore` is not read at all: a bundle carrying one ships it as an ordinary file and whatever it excluded ships too.

**The floor's previous step refuses two PDF shapes.** A consumer's copy of the artifact now declines a pdfform base carrying an `/AcroForm` of its own (`pdf::existing_acroform`) or a non-finite widget rect (`pdf::bad_rect`). A quill that rendered PDF and stops did so on a double-form background whose behavior was the reader's choice.

**A fetch names what it may weigh, and a response over it is refused where it arrives.** Each path carries its own ceiling: a bundle's is the unpack budget (64 MiB), a font's is 32 MiB, and `latest.json` and the manifest are 8 MiB apiece. `HttpTransport` refuses a `Content-Length` over the ceiling before reading a byte and cancels the body past it, so an artifact no loader would unpack costs a `quiver_invalid` naming the file rather than the tab. It is `quiver_invalid` and not `transport_error` because a retry fetches the same response, so there is nothing for an evicting cache to fix. `FsBuiltTransport` and `MemoryTransport` ignore the number: a file is read at the size it is, and a held buffer is already held.

**Every request but the pointer is `force-cache`.** A name carrying its own digest is entitled to whatever a cache already holds, so a second load re-fetches `latest.json` and nothing else — on a host that sends no cache header, and on one that sends `max-age=0, must-revalidate`. A stale entry handed back under it fails its digest as `transport_error`, which is the check that makes those names safe to cache at all. The pointer stays `no-cache`, and the layer above the browser's stays the host's.

## v0.27.0 - 2026-08-26

**The `@quillmark/wasm` peer floor is `>=0.110.0-0`.** Nothing here reads a container path or emits one, and nothing here validates, so the release's breaks land outside this package; the floor moves because a quiver hands out `Quill` handles the consumer's copy of the artifact has to be able to parse and render.

## v0.26.0 - 2026-08-24

**The `@quillmark/wasm` peer floor is `>=0.109.0-0`.** Nothing here reads a container path or emits one, so the release's breaks land outside this package; the floor moves because a quiver hands out `Quill` handles the consumer's copy of the artifact has to be able to parse and render.

## v0.25.0 - 2026-08-21

**The `@quillmark/wasm` peer floor is `>=0.108.3-0`.** Nothing here reads a content address or emits one, so the three steps land outside this package; the floor moves because a quiver hands out `Quill` handles the consumer's copy of the artifact has to be able to parse and render.

## v0.24.0 - 2026-08-18

**The `@quillmark/wasm` peer floor is `>=0.108.0-0`.** Nothing here reads a schema shape or a region address, so the release's breaks land outside this package; the floor moves because a quiver hands out `Quill` handles the consumer's copy of the artifact has to be able to parse. Five schema declarations now fail at `getQuill`: a nested `richtext(inline)` `default:` or `example:` spanning more than one paragraph, a container-shaped literal on a variant-bearing enum, two enum variants declaring one name differently, a `default:` or `example:` on a typed dictionary, and `must_fill:` anywhere at all.

**`build` packs `0.1.0` and up.** Below it is the draft space: a version an author is still shaping does not reach a deployment, and a quill with nothing above the floor is absent from the built catalog rather than present and empty. The source layout keeps every version and `fromDir` still reads them all, so the filter is `build`'s alone; `build(src, out, { drafts: true })` turns it off for a caller serving an author their own collection.

## v0.23.0 - 2026-08-14

**The `@quillmark/wasm` peer floor is `>=0.105.0-0`.** Nothing here reads a schema domain or a validation rung, so the release's breaks land outside this package; the floor moves because a quiver hands out `Quill` handles the consumer's copy of the artifact has to be able to parse. A quill declaring `""` among an enum's `values:` now fails at `getQuill`, the blank being the engine's to supply.

## v0.22.0 - 2026-08-13

**The `@quillmark/wasm` peer floor is `>=0.104.0-0`.** Nothing here reads a field address or a schema domain, so the release's breaks land outside this package; the floor moves because a quiver hands out `Quill` handles the consumer's copy of the artifact has to be able to parse. A quill authoring the retired `enum:` modifier now fails at `getQuill` rather than at a control.

## v0.21.0 - 2026-08-11

## v0.20.0 - 2026-08-09

**A runtime whose packed artifact is not on a path it can read has a loader.** `Quiver.fromBuiltFiles(files)` reads build output from a `Map` of artifact-relative path to bytes, fetching nothing: a serverless function whose deployment bundle carries the artifact, a bundler that inlines it, a test. It spares that runtime the self-fetch over its own load balancer that `fromBuiltDir` spares one with the artifact on disk.

`Quiver.fromBuiltUrl(url, { seed })` is the partial case: the map answers first, the URL serves what it does not carry. A deployment that ships `latest.json` settles which catalog the process reads at deploy time rather than at cache-revalidation time. Seeded bytes are checked against the digest in their name exactly as fetched bytes are.

[`MIGRATION.md`](MIGRATION.md) covers 0.16 → 0.19, leading with the removals whose only signal is a runtime `TypeError`: `buildPackage`, `fromPackage`, `warm`, `fromManifest`, and `resolve` becoming sync.

**The `@quillmark/wasm` peer floor is `>=0.103.0-0`, and `getQuill` awaits the gate itself.** `init()` is the only door to `Quill` at that pin, so the materialization awaits it beside the tree load rather than leaving it a precondition of the call. The gate is memoized, so this is one instantiation shared with every other caller, overlapped with the fetch that pays for it.

## v0.19.0 - 2026-08-08

**The bin is gone.** `quillmark-quiver test` and `quillmark-quiver build` are `quillkit test` and `quillkit build`, in a package of its own. This is a library: it loads a quiver and packs one, and a collection that depends on it pins the format its quiver is written in rather than a version tooling releases move. `quiver.config.js` is `quillkit.config.js`.

**`build` lands a generation whole.** It assembles in `<out>.stage` and moves the tree in, so a reader fetching mid-build gets the previous generation rather than a missing pointer or a manifest whose bundles have not landed, and a build that throws leaves the previous one serving. The destructive-write refusals now cover the staging siblings, which are named off `out` and cleared with it.

## v0.18.1 - 2026-08-07

## v0.18.0 - 2026-08-07

The bin is `quillmark-quiver`. A bin is the one name this package writes into a namespace it shares — a consumer's `node_modules/.bin`, and their PATH when it is installed globally — and `quiver` is too plain a word to hold there. The verbs are untouched, so a `scripts` entry becomes `quillmark-quiver test` and a runner spawning the gate names the bin it links (`execFileSync('quillmark-quiver', ['test'])`).

## v0.17.0 - 2026-08-07

`Quiver.warm()` is removed. It prefetched every quill's tree so a later `getQuill` would be microseconds, and it was the only reason the quiver held a tree cache beside its quill cache; call `getQuill` for the refs you want ahead of time instead. The quill cache is untouched — one instance per canonical ref, concurrent calls coalescing — and a retry after a `Quill.fromTree` throw now refetches rather than reusing the retained tree.

The Node factories become free functions: `import { fromDir, fromBuiltDir, build } from '@quillmark/quiver/node'`, replacing the statics `/node` installed on the shared `Quiver` class. The class is browser-pure, the package has no side effects, and `Quiver._fromLoader` is gone from the public surface. `Quiver.fromBuiltUrl` is unchanged, and is the class's one factory.

Three loaders, not five. `fromPackage` and `buildPackage` are gone: an npm-installed quiver is a directory, and `dirname(createRequire(import.meta.url).resolve('<pkg>/Quiver.yaml'))` handed to `fromDir` or `build` is the line, written where the resolution base belongs to the caller. `Quiver.fromManifest` is gone with them: it closed a stale-pointer layer above the browser cache the pointer's `no-cache` fetch already closes, for an SSR consumer that does not exist. A published quiver still exposes `./Quiver.yaml` from its `exports` map or is unreachable.

`build` refuses an output directory that is, or contains, the source quiver or the working directory, rather than clearing it.

Build output moves from MD5 to SHA-256 — 12 hex chars in bundle and manifest names, full width for font store keys — and the loader now verifies fetched bytes against the digest in their name, raising `transport_error` on a mismatch. `latest.json` is fetched `no-cache`. Artifacts built by an earlier version must be rebuilt.

`BuildOptions` is removed; it reserved nothing an optional trailing parameter cannot add back.

The `/preview` subpath is removed, along with `renderQuiverSamples`, its HTML gallery and the CLI's `preview` verb. `build` and `test` are now the whole of what this package gives a quill author.

It answered "let me look at it" with one seeded example per quill, rendered once to a file beside a hand-written gallery. Studio answers the same question live, with a document the author controls and a schema they can feel, so a file writer and an HTML gallery inside a loader package have nothing left to survive on.

The `/testing` subpath is removed, along with `runQuiverTests`. `quiver test` is the gate, and one door leaves the loop and the engine contract one home each rather than two answering differently under a single name: a caller-supplied engine gated nothing about the discovery the bin does. An author on vitest, jest or `node:test` spawns the bin (`execFileSync('quiver', ['test'])`), which the README shows under the gate section.

The flat "this package never renders" claim narrows to the loaders: the gate compiles and renders every quill, because proving a quill renders is what a gate for quills is.

`Quiver#resolve` is sync: `quiver.resolve(ref)` returns the canonical ref rather than a promise for one. Resolution reads the in-memory catalog every loader materializes when the quiver is built, and `QuiverLoader` carries one verb, `loadTree`, which it never reaches — so the promise priced I/O the design does not admit, and `quillNames()` / `versionsOf()` were already sync. Drop the `await`; a caller catching `invalid_ref` or `quill_not_found` catches a throw instead of a rejection. `getQuill` is unchanged.

The `@quillmark/wasm` peer floor is `>=0.101.0-0`. The prose leaf reads its corpus through `reader.getContent`, which decodes a content field by its declared type: a `plaintext` field keeps the markdown characters its author typed.

The author-side gate instantiates the core before it renders. Every `@quillmark/wasm` export throws `runtime::not_initialized` until `init()` resolves and `new Engine()` is lazy, so `quiver test` reported an uninitialized runtime as a failing quill and gated nothing.

`getQuill`'s returned quill is documented as **borrowed**: it is cached per canonical ref and handed to every caller for the quiver's lifetime, so `free()`ing it leaves the next caller holding a freed handle. Code that wants a quill of its own mints it from `(await quiver.getQuill(ref)).toTree()`.

The `file://` refusal from `Quiver.fromBuiltUrl` names a factory that exists: `import { fromBuiltDir } from '@quillmark/quiver/node'`, not the `Quiver.fromBuiltDir` static removed when the Node factories became free functions.

The license is Apache-2.0, not MIT. The workspace's `LICENSE` was Apache-2.0 while every `package.json` declared MIT; the declaration now matches the text, and the tarball carries a copy of it alongside a `NOTICE` naming the copyright holder, Nibs.

Package metadata points at the `quillmark-js` monorepo and the subdirectory the package lives in.
