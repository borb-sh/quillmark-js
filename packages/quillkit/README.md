# quillkit

The quill author's toolchain: one command over the whole loop. Gate a quiver, pack it, look at it, ship it.

## Install

```sh
npm install --save-dev quillkit @quillmark/quiver @quillmark/wasm
```

quillkit carries neither of the other two. It resolves both out of your collection's own `node_modules`, so the versions you pin are the format your quiver is packed in and the wasm your gate renders through. The studio client is the one thing it does carry: `studio` and `site` serve it out of the tool's own `dist/client`, so there is nothing to install for it and nothing to keep in step.

That client compiles in its own copies of both libraries and the engine, which your install does not resolve and your lockfile does not record. `dist/client/carried.json` names all three, and each release's notes say the same in one line.

## The verbs

| Verb              | What it does                                                       |
| ----------------- | ------------------------------------------------------------------ |
| `quillkit test`   | the gate: every quill's example document compiles and renders      |
| `quillkit build`  | pack the source layout into a servable artifact                    |
| `quillkit studio` | the local loop: pack, serve, repack on save                        |
| `quillkit site`   | the deploy layout: the client at a root, a built quiver beneath it |

Every verb takes `--quiver <dir>`, the collection root where `Quiver.yaml` lives, defaulting to the working directory. `build`, `studio` and `site` take `--out <dir>`, and `studio` takes `--port <n>` and `--host <addr>`.

## Gating

`test` is what you are **blocked on**: it runs in CI, against your own wasm, and installs no app.

```jsonc
// package.json
{
	"scripts": { "test": "quillkit test" }
}
```

It loads the source layout with `fromDir`, then compiles and renders every quill's example document, seeded from the blueprint's `example:` values. It finds the engine itself: a named `engine` export from `quillkit.config.js` at the collection root, else `@quillmark/wasm` from your own `node_modules`. A config that is there and throws fails the gate, naming the file and what threw: only a config you have not written falls through to the artifact.

On vitest, jest or `node:test`, spawn the bin rather than rebuilding the loop against the library. The gate stays one implementation, and the case gates what CI gates:

```ts
import { execFileSync } from 'node:child_process';

it('gates the quiver', () => {
	execFileSync('quillkit', ['test'], { stdio: 'inherit' });
});
```

## Looking at it

`studio` is what you **look at**: it packs your source, serves the studio client over it, and repacks whenever you save. Nothing fails a build on its verdict.

```sh
npx quillkit studio
```

Pick a quill, edit, watch it paint, read the errors. `quillkit test` answers _does it work_; studio answers _what is it like to use_. The document it holds is the blueprint's own, so what the gate renders is what you judge. Reload the page to pick up a repack.

The address bar names what is on screen — `?quill=showcase@1.0.0` — so a link goes to a quill rather than to the quiver's first. `?quill=showcase` and `?quill=showcase@1` are links too, resolved the way `getQuill` resolves them; a ref the quiver does not hold opens the first quill and the address bar says so. The document is not in the URL: a reload keeps the quill and reseeds the example.

The document has two doors, both in the head. **Edit source** is its canonical markdown, out and back in: what comes out opens in the CLI or a quiver repo unchanged, and what goes in is parsed and conformed against the quill in hand, so a file that names a quill this quiver holds lands in it and anything the schema will not take is named on the control it is about. **Download PDF** is the page itself — `name@x.y.z.pdf`, rendered from the compile the preview is painting, so the file and the screen agree. It is drawn where the quill's backend writes a PDF.

It shows a quill rather than editing one: no plate editing, no schema editing, no auth, and nothing it holds outlives the tab.

The client renders through the `@quillmark/wasm` it was built against, and the head names it; your `quillkit test` runs whatever your own tree holds, and nothing at runtime reconciles the two. The gate is authoritative, studio is advisory.

## Shipping it

`site` writes the arrangement a deploy serves (the client at the root, a built quiver at `quiver/` beneath it, which is where the client looks) and asserts both halves of it.

```sh
npx quillkit test && npx quillkit site --out ./site
```

**The gate runs first, here and in every recipe below.** `site` packs files and opens none of them — it stats each `Quill.yaml` as a sentinel and never parses it — so a quill that does not compile packs cleanly and reports itself in the client. That is what the local loop wants and what a deploy does not, and nothing in `site` supplies it.

The client resolves its quiver against `document.baseURI` and its assets relatively, so one build serves a root, a subpath and a preview URL with no rebuild. A `?quill=` link needs no rewrite rule either: a query participates in no file resolution, and relative resolution drops it. The arrangement itself is two rules: the client's files at some base with a built quiver at `quiver/` under that same base, and no quiver inside the client, since one packed there would occupy the URL the built one is served from.

### What a host owes it

Four rules, the same on every host:

| Rule                                          | Why                                                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| serve `assets/*` immutable                    | hash-named by the build, and the engine is tens of megabytes                                                           |
| do not cache `quiver/latest.json` at the edge | the one name in the artifact carrying no digest, and a stale one pins readers to old quills                            |
| a missing path is a 404                       | an SPA fallback — the commonest default there is — answers 200 with the client's HTML, which then fails a digest check |
| serve over https                              | `crypto.subtle` is secure-context-only, and without it arriving bytes go unchecked                                     |

The second rule covers the edge alone. The browser layer is the loader's own — `latest.json` fetched `no-cache`, every digest-carrying name `force-cache` — so a host that sets no cache header at all is already correct there. An edge serving one generation's pointer after the next has shipped is the one staleness the addressing cannot catch.

On Vercel, a `vercel.json` at the repository root is the whole of it — a missing path is already a 404 and everything but `assets/*` already revalidates:

```json
{
	"buildCommand": "quillkit test && quillkit site --out site",
	"outputDirectory": "site",
	"headers": [
		{
			"source": "/assets/(.*)",
			"headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
		}
	]
}
```

Netlify takes the same shape in a root `netlify.toml`: `[build]` for the command and the publish directory, one `[[headers]]` block for `assets/*`. On a host reading `_headers` or `_redirects` out of the served directory itself, write them after the build rather than committing them — `site` clears what it writes, so a file placed there beforehand is gone before the deploy uploads.

For GitHub Pages, the build is the gate, `quillkit site` and an artifact upload:

```yaml
# .github/workflows/studio.yml
name: Studio
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: npx quillkit test
      - run: npx quillkit site --out site
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Keep the deploy in your own repository, as above: nothing outside it then holds `pages: write`.

**If your quiver is not an npm project** (a `Quiver.yaml` and `quills/` with no `package.json`), there is no tree for the packer to be resolved from, so install it for the run and drop the `npm ci`:

```yaml
- run: npm install --no-save @quillmark/quiver @quillmark/wasm quillkit
- run: npx quillkit test
- run: npx quillkit site --out site
```

That takes whatever `@quillmark/quiver` is current, where a `package.json` would pin the format your quiver is packed in. The gate renders, so `@quillmark/wasm` joins the install here. Dropping it and the `quillkit test` line with it is the trade: a deploy that installs no wasm, and nothing that fails on a quill that does not compile.

A deployed quiver is frozen at a commit, so the repack loop is the local one, over a working tree.

## Refusals

`build` and `site` clear what they write, so an `--out` that is, or contains, your collection or the working directory is refused rather than deleted. `build` assembles each generation beside its output and moves it in whole, so a client reading mid-pack sees the previous one and a failed pack leaves it serving.
