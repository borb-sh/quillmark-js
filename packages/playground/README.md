# playground

The private app that composes `@quillmark/svelte` and `@quillmark/quiver`: the reference wiring for the glue the surfaces push outward, the manual harness for what a unit test cannot reach, and the project's Pages site. The rules it keeps are svelte/INVARIANTS §"The playground".

## Routes

- **`/`**: the landing page and quickstart, each surface mounted beside the steps that reach it.
- **`/playground`**: the reference split-pane shell and the harness, with the quill picker, the diagnostic injector and a download over the compiled snapshot.

Harness flags on `/playground`: `?examples=off` opens on the seed rather than the example document, `?tips` supplies a guidance channel, `?foreign` adds a card whose kind the schema cannot project, `?review` stands a reviewer's answer over the showcase's example, as the list `proposalsBetween` makes of it for the editor to draw, and `?collab=<room>` opens the document as a live session over `localStorage`, every tab of the origin on the same room editing one document.

## Reaching it from source

What a unit test cannot reach is here: canvas paint, scroll virtualization, DPR, the click round-trip, and every CSS fact jsdom computes no layout for. The app resolves the sibling packages through their `dist`, so what it serves is the last build, and every partial refresh sequence serves stale CSS silently. So the sequence is one verb: `npm run dev` (`scripts/playground.mjs`) rebuilds the siblings, drops the Vite and SvelteKit caches, and restarts a server it owns by pid.

`npm run probe -- '<expr>'` is the same sequence with an expression evaluated in a real browser against the served page, printed as JSON. It is how a layout fact about a mounted surface is asked at all. What an answer may then be committed as is one of the two shapes in TESTING.md §Assertions; what the probe is for is the pass before that, where what is wrong is not yet known.
