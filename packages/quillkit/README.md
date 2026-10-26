# quillkit

The quill author's toolchain: one command over a quiver's whole life. Start one, gate it, look at it, and build it into a studio for its authors or a standalone app for the people filling its forms in.

A quiver is a collection of quills, and a quill is a document format: the fields a document fills in and the Typst plate that prints them. [Creating Quills](https://quillmark.dev/quills/creating-quills/) walks through the quiver `init` writes, one file at a time, and the [Glossary](https://quillmark.dev/getting-started/glossary/) defines the rest of the terms.

## Start

```sh
npx quillkit@latest init my-quiver
cd my-quiver
npm install
npx quillkit serve --open
```

`init` lays a new quiver: `Quiver.yaml`, one quill under `quills/letter/0.1.0/` (`Quill.yaml`, `plate.typ`, `example.md`), and a `package.json` whose one devDependency is quillkit. The quill passes `quillkit check` as laid; rename it and edit from there. A directory already holding a `Quiver.yaml` or `quills/` is refused rather than merged into, and a `package.json` already there is left alone, with the install line printed instead.

`@latest` names the release outright. An unversioned `npx quillkit` takes the newest release whose `engines` admits the running Node.

## Install

```sh
npm install --save-dev quillkit
```

That is the whole install. quillkit carries `@quillmark/quiver` and `@quillmark/wasm` at exact versions, and both of its clients are built against those same two, so what `check` renders, what `serve` shows and what a deploy serves are one release. Upgrading quillkit upgrades all of it. `dist/client/carried.json` names the versions, and each release's notes say the same in one line.

## The verbs

Every verb runs over the quiver in the working directory. A verb's argument is a target: `studio` (where you and your co-authors judge the quills, and the target when none is named), `app` (what the people filling your forms in use) or `quiver` (the packed quiver alone).

| Verb                      | What it does                                                          |
| ------------------------- | --------------------------------------------------------------------- |
| `quillkit init [<dir>]`   | lay a new quiver holding one starter quill                            |
| `quillkit check`          | the gate: every quill's seed and example render, and the app resolves |
| `quillkit serve [target]` | pack, serve the target over the pack, repack on save                  |
| `quillkit build [target]` | lay the target's deploy into `dist/`                                  |
| `quillkit preview`        | serve the build in `dist/` the way a static host will                 |

| Flag                | Verbs              |                                                   |
| ------------------- | ------------------ | ------------------------------------------------- |
| `-D`, `--drafts`    | `check`, `build`   | admit versions below `0.1.0`; `serve` always does |
| `-o`, `--out <dir>` | `build`, `preview` | the deploy directory, `dist` by default           |
| `-p`, `--port <n>`  | `serve`, `preview` | `5174` for `serve`, `4174` for `preview`          |
| `--open`            | `serve`, `preview` | open the page in your browser                     |

A verb refuses a flag it does not take.

## Gating

`check` is what you are **blocked on**: it runs in CI and fails the build.

```jsonc
// package.json
{
	"scripts": { "test": "quillkit check" }
}
```

It loads the quiver, then renders every quill's seed, the blank document its schema opens on, and its root `example.md` where it ships one. An example that will not parse, or whose `$quill` is not the quill's bare name, fails the quill, and so does any diagnostic its parse, its conform or `quill.validate` raises, a warning included: every value in it is yours to fix. With an `App.yaml` or an `app.css`, the app they describe resolves too, so an unknown key or a `url()` naming no file fails here before it fails a deploy.

On vitest, jest or `node:test`, spawn the bin rather than rebuilding the loop against the library. The gate stays one implementation, and the case gates what CI gates:

```ts
import { execFileSync } from 'node:child_process';

it('gates the quiver', () => {
	execFileSync('quillkit', ['check'], { stdio: 'inherit' });
});
```

## Looking at it

`serve` is what you **look at**: it packs your quiver, drafts included, serves a client over it, and repacks whenever you save. Reload the page to pick up a repack.

```sh
npx quillkit serve --open      # studio
npx quillkit serve app --open  # the app, with your App.yaml and app.css
```

**Studio** is for authors. Pick a quill, edit, watch it paint, read the errors: `quillkit check` answers _does it work_, studio answers _what is it like to use_. The address bar names what is on screen (`?quill=showcase@1.0.0`), so a link goes to a quill; `?quill=showcase` and `?quill=showcase@1.0` resolve the way `getQuill` resolves them. **Edit source** is the document's canonical markdown, out and back in, and **Download PDF** is the page itself, rendered from the compile the preview is painting. Nothing it holds outlives the tab.

**The app** is for the people filling your forms in, and names no quill, version or file. One quill opens its form; several open a card for each. The form stands beside the page it prints, with a Form/Page switch on a phone, and **Download PDF** waits for the page to catch up with the last keystroke and refuses a page that does not render. **My documents** keeps every document a reader starts, in their browser only, to reopen, download as `.md` or delete; a reload reopens the one that was open.

## The app

The app opens every quill in the quiver at its latest version, so a different set of forms is a different quiver. Everything else is found by name beside `Quiver.yaml`, and all of it is optional.

`App.yaml` names the app. It takes two keys and refuses any other:

```yaml
title: Memo Builder # the header and the tab; Quiver.yaml's name, made readable, by default
description: Fill in a memo and download it as a PDF. # over the cards; Quiver.yaml's by default
```

`icon.svg`, else `icon.png`, is the app's icon, in the header and on the tab.

`app.css` beside it says how it looks. It is linked after the app's own styles, and every relative `url()` in it is copied into the deploy at the same path:

```css
@font-face {
	font-family: Brand;
	src: url('fonts/brand.woff2') format('woff2');
}
:root {
	--qm-accent: #0b5cad;
	--qm-font: Brand, system-ui, sans-serif;
}
.qm-app-header {
	background: #0b5cad;
	color: white;
}
```

What it may aim at is the theming contract: the `--qm-*` dials, `.qm-editor`, `.qm-preview` and `.qm-pane`, the app chrome (`.qm-app-header`, `.qm-app-title`, `.qm-app-footer`, `.qm-app-primary`), and `[data-qm-card="<kind>"]` on each card of a document ([THEMING.md](../svelte/THEMING.md)). `build app` warns on any other `.qm-*` class or `data-qm-*` attribute, since a release may move it, and on a quill that declares no `license` in its `Quill.yaml`, since an app hands its plate and fonts to every reader.

**A document reopens on the version it was made on.** When a release moves a quill to a new version, a document made on the old one still opens on it, as long as the quiver still holds that version, and offers **Update to the latest form** with its markdown offered first. Keep a released version in the quiver for as long as documents made on it should open.

## Shipping it

`build` writes the arrangement a static host serves into `dist/`:

```sh
npx quillkit check && npx quillkit build app
npx quillkit preview
```

| Path                           | Target       |                                                 |
| ------------------------------ | ------------ | ----------------------------------------------- |
| `index.html`, `assets/*`       | studio, app  | the client                                      |
| `app.json`                     | app          | what `App.yaml` resolved to                     |
| `app.css`, its files, the icon | app          | yours, at the paths they stand at in the quiver |
| `quiver/`                      | every target | the packed quiver, where each client looks      |

**The gate runs first, here and in every recipe below.** `build` packs files and renders none of them, so a quill whose plate does not compile builds cleanly and reports itself in the client.

**`--drafts` packs the versions below `0.1.0` too.** Without it `build` takes quiver's draft floor, as a deployment should; with it a studio deploy is a preview of the quiver as it stands, prototypes included.

**No base path to configure.** Each client resolves its assets, its quiver, `app.json` and `app.css` relative to the page's own address, and the app keeps its documents per address, so one build serves a root, a subpath (`https://you.github.io/forms/`) and a preview URL with no rebuild, and a `?quill=` link needs no rewrite rule. Serve a subpath with its trailing `/`, which every static host redirects a directory to. `preview` serves `dist/` with the cache headers below, so a deploy is looked at under the rules it will meet.

### What a host owes it

Four rules, the same on every host:

| Rule                                          | Why                                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| serve `assets/*` immutable                    | hash-named, so revalidating one can only return 304: a wasted round-trip per asset per visit                                             |
| do not cache `quiver/quiver.json` at the edge | the one name the loader reads that carries no digest, and a stale one pins readers to old quills                                         |
| a missing path is a 404                       | an SPA fallback — the commonest default there is — answers 200 with the client's HTML, which the loader refuses as not the file it named |
| serve over https                              | nothing checks the artifact's bytes against their names, so the channel is what answers a corrupted or substituted one                   |

The second rule covers the edge alone. The browser layer is the loader's own — `quiver.json` fetched `no-cache`, every digest-carrying name `force-cache` — so a host that sets no cache header at all is already correct there. An edge serving one generation's `quiver.json` after the next has shipped is the one staleness the addressing cannot catch.

On Vercel, a `vercel.json` at the repository root is the whole of it — a missing path is already a 404 and everything but `assets/*` already revalidates:

```json
{
	"$schema": "https://openapi.vercel.sh/vercel.json",
	"buildCommand": "quillkit check && quillkit build app",
	"outputDirectory": "dist",
	"headers": [
		{
			"source": "/assets/(.*)",
			"headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
		}
	]
}
```

Netlify takes the same shape in a root `netlify.toml`: `[build]` for the command and the publish directory, one `[[headers]]` block for `assets/*`. On a host reading `_headers` or `_redirects` out of the served directory itself, write them after the build rather than committing them — `build` clears what it writes, so a file placed there beforehand is gone before the deploy uploads.

For GitHub Pages, the build is the gate, `quillkit build` and an artifact upload:

```yaml
# .github/workflows/app.yml
name: App
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
      - run: npx quillkit check
      - run: npx quillkit build app
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
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

Keep the deploy in your own repository, as above: nothing outside it then holds `pages: write`. Swap `app` for `studio` to deploy the studio instead, or run both into two `--out` directories.

**If your quiver is not an npm project** (a `Quiver.yaml` and `quills/` with no `package.json`), install the tool for the run and drop the `npm ci`:

```yaml
- run: npm install --no-save quillkit
- run: npx quillkit check
- run: npx quillkit build app
```

That takes whatever quillkit is current, where a `package.json` would pin it.

A deployed quiver is frozen at a commit, so the repack loop is the local one, over a working tree.

## Refusals

`build` clears what it writes, so an `--out` that is, or contains, your quiver or the working directory is refused rather than deleted. Everything that can refuse, a bad `App.yaml` above all, is read before the clear, so a refused build leaves the last one standing.
