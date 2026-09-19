# quillmark-js

The JS tier downstream of the `@quillmark/wasm` artifact: `packages/svelte`, `packages/quiver`, `packages/quillkit`, and `packages/playground`, the one private package. One npm workspace, one install, one gate.

Start at each package's `prose/canon/INDEX.md` for what the package is and its settled design; work that is not settled lives in GitHub issues. Canon design choices are currently evolving and malleable.

Comments default to none, and one earns its place only where the code cannot carry the fact itself. What survives states what is: present tense, unsold, no history. The `dense-prose` skill is the whole policy.

## Commands

Every command is the root's; a package script is reached with `-w packages/<name>`. A verb name means one thing across the workspace, and the implementations differ per package. `gate` is the whole gate in one verb and `gate:fast` its first half, everything that needs no build; `gate` with `check:pack` is what CI (`.github/workflows/ci.yml`) holds. `check:registry` stands outside it, on its own schedule.

What each gate holds and why is its own script's header (`scripts/check-*.mjs`); how one speaks is `report` in `scripts/workspace.mjs`, where an error is a fault the diff cannot show and a warning is one review can see for itself.

## Verification

Vitest is the whole committed suite, real WASM under node, and CI runs it in full; each published package's `vitest.config.ts` documents its setup. What a unit test cannot reach belongs to a surface, driven by hand or headlessly: the playground for `@quillmark/svelte`, where `npm run dev` serves it from source and `npm run probe` asks it a question in a browser (PLAYGROUND.md §"Reaching it from source"), and studio for a quill (STUDIO.md). Chromium is preinstalled; never run `playwright install`.

A browser assertion is committed on two shapes and no others. **Presence against absence**: the client boots, the quiver resolves against the base it was served at, a surface mounts. **A relation no dial owns**: the tracks of a split sum to the shell they stand in, and that shell is the viewport. Both hold at every rung of every scale, so a retune leaves them green. What is refused is a **value another file single-sources**, restated outside the one that mints it and failing on the next edit there. One load is committed on it, `packages/quillkit/src/__tests__/deploy.browser.test.ts`.
