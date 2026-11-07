# quillmark-js

The JS tier downstream of the `@quillmark/wasm` artifact: `packages/svelte`, `packages/quiver`, `packages/fonts`, `packages/collab`, `packages/quillkit`, and the private `packages/playground`. One npm workspace, one install, one gate.

Each published package's `prose/INVARIANTS.md` holds the rules a change to it must keep, the reason for each, and the designs already rejected. What the code, tsdoc or a README already carries stays there, and `prose/` holds that one page; unsettled work lives in GitHub issues.

Write no comment the code can carry itself. A comment or doc states what is, in present tense: no change history, no issue or PR numbers, no selling. A markdown paragraph is one line. `CHANGELOG.md` entries are records of their release: fix what was wrong, leave the rest.

## Commands

Run everything from the root; a package script is `npm run <script> -w packages/<name>`.

- `npm run gate:fast`: lint, typecheck, and the `check:*` scripts that need no build.
- `npm run gate`: `gate:fast`, then build, bundle check, and the full test suite. CI runs it plus `check:pack`.
- Each `scripts/check-*.mjs` opens with a header saying what it enforces. `check:docs` fails when a `<DOC> §<Section>` pointer no longer resolves, so renaming a heading or a rule's bold lead means updating its references; a name several packages carry is qualified from outside its package, as `quiver/INVARIANTS §…`.

## Verification

Vitest is the whole committed suite, real WASM under node; each published package's `vitest.config.ts` documents its setup. What a unit test cannot reach is checked by hand or headlessly on a surface: the playground for `@quillmark/svelte` (`npm run dev` serves it from source, `npm run probe` evaluates an expression against it in a browser; playground/README §"Reaching it from source"), and studio for a quill (quillkit/INVARIANTS §Studio). Chromium is preinstalled; never run `playwright install`.

A committed assertion never restates a value another file defines, and a browser assertion takes one of two shapes: TESTING.md §Assertions.
