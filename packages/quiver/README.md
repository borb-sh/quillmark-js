# @quillmark/quiver

Load and build collections of quills for rendering with `@quillmark/wasm`.

## Install

```bash
npm install @quillmark/quiver @quillmark/wasm
```

Upgrading from an earlier version: [`MIGRATION.md`](MIGRATION.md).

## Loading a quiver

A quiver has one authored shape, the **source layout** (`Quiver.yaml` at the package root, quills under `quills/<name>/<x.y.z>/`), published as an npm package. Browsers cannot read that layout, so `build(src, out)` packs it at deploy time and the output is served as static assets. Each loader names exactly what it reads; there is no auto-detection.

| Loader                         | Reads                     | Import                   |
| ------------------------------ | ------------------------- | ------------------------ |
| `fromDir(path)`                | the source layout         | `@quillmark/quiver/node` |
| `fromBuiltDir(path)`           | build output, off disk    | `@quillmark/quiver/node` |
| `Quiver.fromBuiltUrl(url)`     | build output, over HTTP   | `@quillmark/quiver`      |
| `Quiver.fromBuiltFiles(files)` | build output, from memory | `@quillmark/quiver`      |

The filesystem factories are free functions from `/node`; the two that reach no filesystem are statics on `Quiver`. Importing `/node` adds nothing to the class, so a bundler drops the verbs you do not call.

## Consuming a quiver (Node)

A quiver installed from npm is a directory like any other. Resolve its root from your own module: your dependencies are reachable from your module, not from this package's install location.

```ts
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { Engine, init } from '@quillmark/wasm';
import { fromDir } from '@quillmark/quiver/node';

const root = dirname(createRequire(import.meta.url).resolve('@org/my-quiver/Quiver.yaml'));
const quiver = await fromDir(root);
const engine = new Engine();

const { Document } = await init(); // the gate is the only door to Document
const doc = Document.fromMarkdown(markdownString);
const quill = await quiver.getQuill(doc.quillRef);
const result = await engine.render(quill, doc, { format: 'pdf' });
```

`getQuill(ref)` is the only way to obtain a quill from a quiver, and the only entry point most consumers need. It accepts selector refs (`"memo"`, `"memo@1"`) and canonical ones (`"memo@1.0.0"`), resolves the selector, materializes the quill via `Quill.fromTree`, and caches one instance per canonical ref for the quiver's lifetime; concurrent calls for the same ref coalesce into a single load. It awaits `init()` itself, so instantiating the core is not a precondition of calling it.

That quill is **borrowed, not owned**: every caller asking for that ref gets the same instance, so `free()` on it hands the next caller a freed handle. Code that owns its quill mints one from `(await quiver.getQuill(ref)).toTree()` and frees that.

This package produces quills; `@quillmark/wasm` renders them. A quill from `getQuill` is engine-free portable data — schema inspection, validation, blueprint access, `seedDocument()` — and passes straight to `engine.render(quill, doc)`, which routes on `quill.backendId`, loads that backend, clones both handles into its memory, renders, and frees the clones. There is no boundary-crossing step to perform. `Engine.render`, `open`, `supportedFormats` and `supportsCanvas` are **async**. The canonical `Quill` / `Document` / `Engine` types are not re-exported here; import them from the `@quillmark/wasm` peer, their single source of truth.

One narrower verb sits beside `getQuill`: `resolve(ref)` returns the canonical ref without materializing anything, and is **sync** (the catalog is in memory from the moment the quiver is built).

```ts
const canonicalRef = quiver.resolve('memo'); // "memo@1.1.0"
```

## Consuming a quiver (browser)

Build at deploy time, serve the output as static files:

```ts
// build script (Node) — typically wired into your existing build pipeline
import { build } from '@quillmark/quiver/node';

await build('./node_modules/@org/my-quiver', './public/quivers/my-quiver');
```

`build` owns its output path outright: it assembles a generation in `<outDir>.stage`, moves it in whole, and deletes the one it replaced. A reader fetching mid-build sees the previous generation rather than a torn tree, and a build that throws leaves it serving. An `outDir` that is, or contains, the source quiver or the working directory is refused with a `transport_error` rather than deleted.

Quills below `0.1.0` are drafts and are left out: they stay in the source layout, which `fromDir` reads whole, and reach the artifact only under `build(src, out, { drafts: true })`. A quill with no version above the floor is absent from the built catalog entirely.

```ts
// browser runtime
import { Engine, init } from '@quillmark/wasm';
import { Quiver } from '@quillmark/quiver';

const quiver = await Quiver.fromBuiltUrl('/quivers/my-quiver/');
const engine = new Engine();

const { Document } = await init(); // the gate is the only door to Document
const doc = Document.fromMarkdown(markdownString);
const quill = await quiver.getQuill(doc.quillRef);
const result = await engine.render(quill, doc, { format: 'pdf' });
```

A CDN URL works the same way, for consumers who cannot run a Node build step of their own — a collection you publish, on a host you pick, and pinned like the dependency [it is](#what-a-quiver-is-trusted-to-be).

## Server-side runtime (Node, packed artifact on disk)

Where the packed artifact ships in the deployment image, `fromBuiltDir` reads it from disk, avoiding the self-fetch round-trip `fromBuiltUrl` would force on a self-hosted deployment and letting the source quiver stay a `devDependency`:

```ts
import { fromBuiltDir } from '@quillmark/quiver/node';

// Packed at build time, e.g. into ./static/quills/my-quiver
const quiver = await fromBuiltDir('./static/quills/my-quiver');
```

## Server-side runtime (no filesystem)

A serverless function's packed artifact is not on a path the invocation can read, so `fromBuiltDir` cannot see it. Hand over the bytes instead, keyed by artifact-relative path as `build` writes them (`latest.json`, `manifest.<digest>.json`, `<name>@<x.y.z>.<digest>.zip`, `store/<hash>`):

```ts
import { Quiver } from '@quillmark/quiver';

const quiver = await Quiver.fromBuiltFiles(artifactFiles); // Map<string, Uint8Array>
```

Nothing is fetched, so nothing self-fetches over your own load balancer. The map must carry the whole artifact; a path it lacks is a `transport_error` naming that path.

Where inlining the bundles and fonts is not practical, hold the two small documents and let the host serve the rest:

```ts
const quiver = await Quiver.fromBuiltUrl('/quills/my-quiver/', {
	seed: new Map([
		['latest.json', pointerBytes],
		[manifestName, manifestBytes]
	])
});
```

The seed answers first and the URL serves what it does not carry. Seeding `latest.json` also settles which catalog the process reads at deploy time rather than at cache-revalidation time. Seeded bytes are checked against the digest in their name exactly as fetched bytes are.

## The `latest.json` pointer

`Quiver.fromBuiltUrl(url)` first fetches `<url>/latest.json`, a stable-named pointer to the current manifest. Everything behind that pointer is content-addressed and checked against the digest in its name; the pointer itself is not, so a cache layer can serve a stale one and silently pin the client to the old catalog. It is therefore the one request fetched `no-cache` (revalidate with the origin; a 304 still serves from disk), and every other request is `force-cache`, a digest-carrying name being entitled to whatever the cache already holds. Both are the browser layer only: a stale CDN edge is answered by that host's cache headers, and `quillkit`'s README states the whole contract for a deploy that serves a client over one of these.

The check itself needs `crypto.subtle`, which a browser exposes only in a secure context. An `https` page, `http://localhost` and Node have one; a page served over plain `http` to anything else — a dev host on a LAN address, a staging box without a certificate — has none, and there every fetch passes through unchecked.

## What a quiver is trusted to be

**A quill is a template the backend executes, so loading a quiver runs its author's code.** Point one at a source you would take a dependency from — an npm package or a git tag, pinned like any other — because nothing here sandboxes a quill, and a collection assembled from anywhere else is a decision to make on purpose.

Content addressing is an integrity check and not a provenance one: the digest in each name catches a corrupted object, a partial sync and a name reused across releases, and says nothing about who packed the bytes. Where the primitive behind it is absent the page is no secure context either, so the pointer, the manifest, the digests and the client itself all arrived over the same unauthenticated channel — which is the whole of why a built quiver is served over `https`.

## Error handling

Every error is a `QuiverError` carrying a `code` from a closed set — `invalid_ref`, `quill_not_found`, `quiver_invalid`, `transport_error` — a human-readable `message`, and the offending `ref` where there is one.

```ts
import { QuiverError } from '@quillmark/quiver';

try {
	quiver.resolve('unknown_quill');
} catch (err) {
	if (err instanceof QuiverError) console.error(err.code, err.message, err.ref);
}
```

## Authoring a quiver

Lay out the source per the spec, then publish to npm (or push a git tag):

```
my-quiver/
  Quiver.yaml
  quills/
    <name>/<x.y.z>/
      Quill.yaml
      ...
  package.json
```

A consumer reaches an installed quiver by resolving `<specifier>/Quiver.yaml`, which goes through your `exports` map. A package that declares one must expose that subpath, or the quiver is unreachable however correct its layout; a package with no `exports` map needs nothing.

```jsonc
// package.json
{
	"files": ["Quiver.yaml", "quills"],
	"exports": {
		"./Quiver.yaml": "./Quiver.yaml"
	}
}
```

## Authoring is [quillkit](../quillkit#readme)'s

This package is a library: it loads a quiver and packs one, and it has no CLI. The verbs a quill author runs (gate, pack, look at, deploy) are `quillkit`'s, and it resolves this package out of the collection's own `node_modules`. Depend on it here and the version you pin is the format your quiver is packed in:

```sh
npm install --save-dev @quillmark/quiver @quillmark/wasm quillkit
```

```jsonc
// package.json
{
	"scripts": { "test": "quillkit test" }
}
```
