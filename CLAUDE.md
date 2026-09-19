# quillmark-js

The JS tier downstream of the `@quillmark/wasm` artifact: `packages/svelte`, `packages/quiver`, `packages/quillkit`, and `packages/playground`, the one private package. One npm workspace, one install, one gate.

Start at each package's `prose/canon/INDEX.md` for what the package is and its settled design; work that is not settled lives in GitHub issues. Canon design choices are currently evolving and malleable.

Comments default to none, and one earns its place only where the code cannot carry the fact itself. What survives states what is: present tense, unsold, no history. The `dense-prose` skill is the whole policy.

## Commands

Every command is the root's; a package script is reached with `-w packages/<name>`. `gate` is the whole gate in one verb, and with `check:pack` is what CI (`.github/workflows/ci.yml`) holds. `gate:fast` is its first half, everything that needs no build. A verb name means one thing across the workspace; the implementations differ per package.

Three gates, each holding what a reviewer cannot see for itself: `check:style` the closed scales, from the file that mints a rung to the built bundle that has to resolve it (`--built`); `check:deps` the dependency graph and one wasm per process; `check:docs` every cross-doc pointer and the stated boundary pin. What is legible in the diff that causes it — a value's own shape, a manifest's, a declaration inside a JS string — is review's, and a claim another tool already fails on is that tool's.

Gates warn rather than fail on what a reviewer can see for itself. A value a surface mints on purpose says so on the line (`mint: <reason>`) and is counted rather than blocked.

`check:registry` sits outside both: it asks the registry whether each published version is there, and a release branch is ahead of the registry by design. It runs on its own schedule (`.github/workflows/registry.yml`), against `main`, where being ahead is a fault.

## Verification

Vitest is the whole committed suite (real WASM under node; each published package's `vitest.config.ts` documents its setup), and CI runs it in full. The playground is the surface for what a unit test cannot reach (canvas paint, scroll virtualization, DPR, the click round-trip), and `npm run dev:studio` or `quillkit studio` for the repack loop, driven by hand or headlessly. Chromium is preinstalled (`/opt/pw-browsers/chromium`, `PLAYWRIGHT_BROWSERS_PATH` preset; never run `playwright install`).

`npm run dev` is the playground's whole loop in one verb (`scripts/playground.mjs`). The app resolves both siblings through the workspace symlink to each one's `dist`, so a source edit needs a rebuild, a cache drop and a restart — and HMR alone, `--force` alone, and a rebuild without a restart each serve the previous CSS with nothing failing. `npm run probe -- '<expr>'` is that loop with a question at the end: the expression is evaluated in a real browser against the served page and answered as JSON, `@<file>` reading it off disk. That is where a CSS-level fact about a mounted surface is asked at all, jsdom computing no layout — `position`, whether a `@container` rule applied, a clip, the specificity between two rules, whether a longhand against a two-value rung parsed. Asking is free; what an answer may then be committed as is the two shapes below.

A browser assertion is committed on two shapes and no others. **Presence against absence**: the client boots, the quiver resolves against the base it was served at, a surface mounts. **A relation no dial owns**: the tracks of a split sum to the shell they stand in, and that shell is the viewport. Both hold at every rung of every scale, so a retune leaves them green. What is refused is a **value the CSS single-sources**, which restates a number outside the file that mints it and fails on the next retune of a dial the test does not own.

One load is committed on it, `packages/quillkit/src/__tests__/deploy.browser.test.ts`: a site the bin laid, served two segments deep, opened at each side of the preset's threshold. The author's loop reaches neither fact it holds, a dev server tree-shaking nothing and serving at a root, so a pruned bundle and an asset URL that resolves only at a root are both invisible where the work is done. The browser is whatever the host has; `QUILLKIT_CHROME` overrides, and the refusal names what was tried.
