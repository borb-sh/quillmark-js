# Playground

> **Implementation**: `src/routes/`

## TL;DR

The dev app around the library: the reference wiring for the glue the primitives push outward, the manual harness for what a unit test cannot reach, and the page a stranger evaluating the package opens first. Its shape is two routes, two readers, and the endorsed look they are drawn with. What a host must provide a mounted surface is [`THEMING.md`](../../../svelte/THEMING.md); nothing here reads a `--_qm-*` rung.

## Two jobs on one page

The playground is a harness and the package's landing page (it deploys as the project's Pages site), and those pull in opposite directions: a harness wants its instruments within reach, and a landing page wants to be readable by a stranger. The resolution is placement. The harness is one route and the front page the other, and what only a hand driving the harness needs (seed variants, channels a quill cannot declare) is a query flag rather than chrome.

The front page **mounts what it describes**: every surface it names runs beside the steps that reach it, over a session opened exactly as a consumer's is, so nothing on it claims a capability the mounted surface is not already showing.

## The host scale

The playground draws with `@quillmark/svelte/preset`, the same import a third-party consumer makes, so it looks like the endorsed version by construction. `playground.css` carries what the app adds and nothing the preset already has.

An app scale may not restate a name the preset defines, and two app scales may not mint one concept at two values ([ARCHITECTURE.md](../../../svelte/prose/canon/ARCHITECTURE.md) §Styling). A rung two app scales have to keep agreeing on belongs in the preset. A mounting site states only what the surface cannot, and most of that is `.qm-frame`'s and `.qm-split`'s (THEMING §"Drop it in").

The chrome around a mounted surface stays plainer than the surface. Colour is spent on one thing, a boundary that failed.

## The routes

Two, because the site has two readers.

- **`/`**: a first screen of thesis and two actions that mounts nothing, then a quickstart: one step per thing a consumer does, prose and code down a reading column and each surface sticking beside the steps that reach it, so code and its output are read without scrolling between them. Both surfaces run here over separate documents, since no apply loop joins them on this page. The samples are strings in `samples.ts`.
- **`/playground`**: the reference split-pane shell and the harness ([ARCHITECTURE.md](../../../svelte/prose/canon/ARCHITECTURE.md) §Playground). It is a workspace, not a page: `.qm-workspace` hands it the viewport and it scrolls nowhere, so the panes hold still while their contents move. A strip above reads the bridge's outcomes back out and carries the quill picker, the diagnostic injector and a download that renders the compiled snapshot the preview is showing. The panes are `.qm-split` unmodified, which is what a consumer copying the shell gets; under the preset's threshold the split shows one track at a time, both panes staying mounted so neither loses its caret or scroll.

Two guardrails hold across both: the playground consumes only the public subpath API (a needed internal is an API gap to fix), and it stays a harness, not a product: no auth, no multi-doc management, and no persistence but a `?collab=` room's.

## Which quill, and what is seeded into it

The reference quill declares a field for every control and three card kinds, so the schema reaches the branches a harness is for; `usaf_memo` is the shipped quill that asks what real use asks (`fixtures/Quiver.yaml`). Which quill is a control on `/playground`'s strip, because it changes what both surfaces are.

A quill opens on its example document, every `example:` its `Quill.yaml` declares committed, so the harness reaches value branches; `?examples=off` opens on the seed instead. The flag lives in the URL rather than the browser, so a link in a report reproduces the document it was copied from.

Picking tears the shell down and stands it back up, so one session is live at a time; the editor stands once the quill resolves and the preview follows ([HOSTING.md](../../../svelte/prose/canon/HOSTING.md) §Opening).

What the picker lists is the pack's call: `usaf_memo` is held under the quiver's draft floor, so a dev server offers both quills and the Pages build serves the showcase quill alone.

Two branches are not a schema's to declare, so they are query flags on `/playground`: `?tips` (a guidance channel a consumer supplies) and `?foreign` (a card whose kind the schema cannot project, which only the editor's recovery shell reaches).

Every open builds the engine over `@quillmark/fonts`' suite, as an app does (FONTS §"The suite"), and hands the editor `engine.fontFaces(quill)`.

## Live editing

`?collab=<room>` opens the document as a live session (`@quillmark/collab`) with `localStorage` as the store: every tab of the origin on the same room edits one document, and a reload rejoins it. The room's save is the record, so the quill and seed flags apply only to its first open. Local edits push with the card op their `EditorChange` carries; remote changes land through the editor's host verbs (`applyCardOps`, `refresh`, `applyExternal`). The route answers a direct load on every host, so a room link works on Pages and Vercel previews alike.

## Quiver, not bundler

Every route opens its session over a quill from a quiver, not the bundler, so no Typst source or font bytes are in the JS bundle. This is the workspace's one edge to `@quillmark/quiver`; the library has none, so the app is where the two tiers meet. One `Quiver` serves the page, so navigation between routes reuses one materialization, and each route mints and frees its own `Quill` from the tree.

## Reaching it from source

What a unit test cannot reach is here: canvas paint, scroll virtualization, DPR, the click round-trip, and every CSS fact jsdom computes no layout for. The app resolves the sibling packages through their `dist`, so what it serves is the last build, and every partial refresh sequence serves stale CSS silently. So the sequence is one verb: `npm run dev` (`scripts/playground.mjs`) rebuilds the siblings, drops the Vite and SvelteKit caches, and restarts a server it owns by pid.

`npm run probe -- '<expr>'` is the same sequence with an expression evaluated in a real browser against the served page, printed as JSON. It is how a layout fact about a mounted surface is asked at all. What an answer may then be committed as is one of the two shapes in TESTING.md §Assertions; what the probe is for is the pass before that, where what is wrong is not yet known.
