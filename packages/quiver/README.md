# @quillmark/quiver

Load and build collections of quills for rendering with `@quillmark/wasm`.

## Install

```bash
npm install @quillmark/quiver @quillmark/wasm
```

Upgrading from an earlier version: [`MIGRATION.md`](MIGRATION.md).

## Loading a quiver

A quiver has one authored shape, the **source layout** (`Quiver.yaml` at the package root, quills under `quills/<name>/<x.y.z>/`), published as an npm package. Browsers cannot read that layout, so `build(src, outFile)` packs it at deploy time into **one file**, served as a static asset. Each loader names exactly what it reads; there is no auto-detection.

| Loader                    | Reads                    | Import                   |
| ------------------------- | ------------------------ | ------------------------ |
| `fromDir(path)`           | the source layout        | `@quillmark/quiver/node` |
| `Quiver.fromBytes(bytes)` | the packed file's bytes  | `@quillmark/quiver`      |
| `Quiver.fromUrl(url)`     | the packed file, fetched | `@quillmark/quiver`      |

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

This package produces quills; `@quillmark/wasm` renders them. A quill from `getQuill` is engine-free portable data — schema inspection, validation, blueprint access, `seedDocument()` — and passes straight to `engine.render(quill, doc)`, which routes on `quill.backendId`, loads that backend, clones both handles into its memory, renders, and frees the clones. There is no boundary-crossing step to perform. `Engine.render`, `open` and `supportedFormats` are **async**. The canonical `Quill` / `Document` / `Engine` types are not re-exported here; import them from the `@quillmark/wasm` peer, their single source of truth.

One narrower verb sits beside `getQuill`: `resolve(ref)` returns the canonical ref without materializing anything, and is **sync** (the catalog is in memory from the moment the quiver is built).

```ts
const canonicalRef = quiver.resolve('memo'); // "memo@1.1.0"
```

## Consuming a quiver (browser)

Build at deploy time, serve the file beside your app:

```ts
// build script (Node) — typically wired into your existing build pipeline
import { build } from '@quillmark/quiver/node';

await build('./node_modules/@org/my-quiver', './public/quiver.qv');
```

`build` writes the file beside its destination and renames it on, so a reader sees the previous file or the next one, never a torn one, and a build that throws leaves the previous one in place.

Quills below `0.1.0` are drafts and are left out: they stay in the source layout, which `fromDir` reads whole, and reach the artifact only under `build(src, out, { drafts: true })`. A quill with no version above the floor is absent from the built catalog entirely.

```ts
// browser runtime
import { Engine, init } from '@quillmark/wasm';
import { Quiver } from '@quillmark/quiver';

const quiver = await Quiver.fromUrl('/quiver.qv');
const engine = new Engine();

const { Document } = await init(); // the gate is the only door to Document
const doc = Document.fromMarkdown(markdownString);
const quill = await quiver.getQuill(doc.quillRef);
const result = await engine.render(quill, doc, { format: 'pdf' });
```

`fromUrl` fetches the file once, whole, revalidating with the origin (`no-cache`: a 304 still serves from the browser's cache), so a release reaches the next load. Serve it the way you serve your `index.html` — revalidated, never `immutable` — and serve it over https. A host that answers a missing path with its index page serves HTML where the file should be; the reader names that case as a `quiver_invalid` rather than a broken zip.

A file packed by a newer `@quillmark/quiver` than the reader is refused with the upgrade named.

## Server-side runtime

A server with the file in its image, or a function with it inlined by a bundler, holds bytes rather than a URL:

```ts
import { readFile } from 'node:fs/promises';
import { Quiver } from '@quillmark/quiver';

const quiver = await Quiver.fromBytes(await readFile('./static/quiver.qv'));
```

Nothing is fetched, so nothing self-fetches over your own load balancer. The bytes are copied, and each quill is inflated out of them when it is first asked for.

## What a quiver is trusted to be

**A quill is a template the backend executes, so loading a quiver runs its author's code.** Point one at a source you would take a dependency from — an npm package or a git tag, pinned like any other — because nothing here sandboxes a quill, and a collection assembled from anywhere else is a decision to make on purpose.

The packed file carries no signature and no digest: it is trusted as the page reading it is, having arrived by the same road. Serve both over `https`, from one deploy.

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

This package is a library: it loads a quiver and packs one, and it has no CLI. The verbs a quill author runs (gate, pack, look at, deploy) are `quillkit`'s, and it resolves this package out of the collection's own `node_modules`, so the copy that packs is the copy the gate renders through:

```sh
npm install --save-dev @quillmark/quiver @quillmark/wasm quillkit
```

```jsonc
// package.json
{
	"scripts": { "test": "quillkit test" }
}
```
