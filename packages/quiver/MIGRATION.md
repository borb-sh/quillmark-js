# Migrating `@quillmark/quiver`

Upgrade notes per range. The [CHANGELOG](CHANGELOG.md) is the full record; this page is the subset that breaks a working consumer, ordered by how late you find out.

## 0.29 → 0.30

### Rebuild every artifact, and move quiver and quillkit together

A built quiver is `quiver.json` beside one bundle per quill and a `fonts/` directory. The hashed manifest and `store/` are gone, and `latest.json` carries only `format`, now 2. An old artifact under 0.30 is a `transport_error` on `quiver.json`; a 0.30 artifact under an older reader is refused with the upgrade named. Re-run `build`; nothing in the source layout changes.

`quillkit`'s client carries its own copy of this package's reader and packs through the collection's, so a collection upgrades `@quillmark/quiver` in the same change as `quillkit`. `quillkit site` and `quillkit studio` refuse a pack with no `quiver.json`, naming the upgrade.

A host rule naming `quiver/latest.json` now names `quiver/quiver.json`.

### Runtime, not build time

**`Quiver.fromBuiltUrl(url, { seed })` takes no `seed`.** TypeScript refuses the second argument; plain JavaScript ignores it, so a seeded call fetches what it used to hold. Hold the whole artifact and call `Quiver.fromBuiltFiles(files)`, or fetch it.

**Fetched bytes are not checked against their names**, and no fetch carries a byte ceiling; a bundle's unpack budget is unchanged. A bundle that does not open as a zip and a font that does not open as a font are refused, and `build` refuses a font file of the second kind where it packs it. Serve the artifact over `https`, which is what answers a corrupted byte.

## 0.16 → 0.19

### Runtime, not build time

Four removals leave valid JavaScript. A consumer on plain JS, or on TypeScript reaching these through an `any`, learns about them from a `TypeError` at runtime naming neither the version nor the replacement.

**`Quiver.buildPackage(specifier, outDir)` and `Quiver.fromPackage(specifier)` are gone.** An npm-installed quiver is a directory, and resolving it belongs to the caller: the resolution base has to be your module, because under an isolated `node_modules` layout your dependencies are reachable from you and not from this package.

```js
// 0.16
await Quiver.buildPackage('@org/my-quiver', './public/quills');
const quiver = await Quiver.fromPackage('@org/my-quiver');

// 0.19
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { build, fromDir } from '@quillmark/quiver/node';

const root = dirname(createRequire(import.meta.url).resolve('@org/my-quiver/Quiver.yaml'));
await build(root, './public/quills');
const quiver = await fromDir(root);
```

That resolution goes through the collection's `exports` map. A collection that declares one and does not expose `./Quiver.yaml` fails here with a module-resolution error naming neither the collection nor the convention; the fix is in the collection's `package.json`, not at your call site.

**`quiver.warm()` is gone.** It prefetched every tree into a second cache that no longer exists. `getQuill` caches and coalesces per canonical ref, so prefetching is calling it early:

```js
const refs = quiver.quillNames().flatMap((n) => quiver.versionsOf(n).map((v) => `${n}@${v}`));
await Promise.allSettled(refs.map((r) => quiver.getQuill(r)));
```

Skipping it costs one fetch on first open of each quill, cached from then on.

**`Quiver.fromManifest(baseUrl, bytes)` is gone**, replaced by two doors that cover more than it did. Pass the whole artifact and fetch nothing, or seed what you hold and let the URL serve the rest:

```js
// 0.16
const quiver = await Quiver.fromManifest('/quills/my-quiver/', manifestBytes);

// 0.19 — whole artifact in hand, no filesystem, no fetch
const quiver = await Quiver.fromBuiltFiles(artifactFiles);

// 0.19 — hold the small documents, fetch the heavy ones
const quiver = await Quiver.fromBuiltUrl('/quills/my-quiver/', {
	seed: new Map([
		['latest.json', pointerBytes],
		[manifestName, manifestBytes]
	])
});
```

Keys are artifact-relative, as `build` writes them. `fromManifest` took manifest bytes and skipped the pointer; the seed takes any subset of the artifact, so it covers that and the case where the bundles are in hand too.

**`quiver.resolve(ref)` is sync.** `await` on it still works, so this breaks only a call site that used the promise as one: `.then()`, `Promise.all([...])`, or a `.catch()` that now has a throw to catch instead of a rejection.

### Rebuild every artifact

Build output moved from MD5 to SHA-256, and the loader verifies fetched bytes against the digest in their name. An artifact packed by 0.16 fails to load under 0.19. Re-run `build`; nothing in the source layout changes.

### The compiler-caught rest

| 0.16                                                              | 0.19                                           |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| `Quiver.fromDir`, `Quiver.fromBuiltDir`, `Quiver.build` (statics) | free functions from `@quillmark/quiver/node`   |
| `Quiver._fromLoader`                                              | removed; construction is sealed                |
| `BuildOptions`                                                    | removed; `build(src, out)` takes two arguments |
| `@quillmark/quiver/preview`, `renderQuiverSamples`                | removed; `quillkit studio` answers live        |
| `@quillmark/quiver/testing`, `runQuiverTests`                     | removed; `quillkit test` is the gate           |
| `quiver` / `quillmark-quiver` bin                                 | removed; the verbs are `quillkit`'s            |
| `quiver.config.js`                                                | `quillkit.config.js`                           |

The `@quillmark/wasm` peer floor is `>=0.101.0-0`. That range carries its own boundary changes, several of which a type checker also misses; the ledger is [`DOCUMENT_MODEL.md`](../svelte/prose/canon/DOCUMENT_MODEL.md) in `@quillmark/svelte`.

### Installing the tooling

The bin left this package in 0.19. A collection that ran `quiver test` or `quillmark-quiver build` from its `scripts` installs `quillkit` and keeps depending on this package for the format its quiver is packed in:

```sh
npm install --save-dev @quillmark/quiver @quillmark/wasm quillkit
```

```jsonc
{
	"scripts": { "test": "quillkit test", "build": "quillkit build" }
}
```
