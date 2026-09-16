# Playground

> **Implementation**: `src/routes/`

## TL;DR

The dev app around the library: the reference wiring for the glue the primitives push outward, the manual harness for what a unit test cannot reach, and the page a stranger evaluating the package opens first. Its shape is two routes, two readers, and the endorsed look they are drawn with. What a host must provide a mounted surface is [`THEMING.md`](../../../svelte/THEMING.md); nothing here reads a `--_qm-*` rung.

## Two jobs on one page

The playground is a harness *and* the package's landing page (it deploys as the project's Pages site), and those pull in opposite directions. A harness wants its instruments within reach: state strips, live document dumps, fixture variants, the `data-testid` hooks a headless pass drives. A landing page wants to be readable by a stranger.

The resolution is **placement**: the harness is one route, the front page the other. The instruments live on the harness and take no plate: the label and readout runs already say the strip is chrome, and a plate would restate it in a fill and a hairline, at two rungs of the height the panes want. What has no reader outside a hand driving the harness (the seed variants, the consumer channels a quill cannot declare) is a query flag, not chrome.

So the front page **mounts what it describes**. It is a quickstart, and every surface it names is mounted beside the steps that reach it, over a session of the reference quill opened exactly as a consumer's is: the page a stranger reads is also the page that runs. Nothing on it claims a capability the mounted surface is not already showing.

What that buys is spent one screen down. The page opens on a thesis and two actions and mounts nothing: a stranger deciding whether this is the thing they want reads one sentence, and a surface beside that sentence answers a question they have not asked. The quickstart is the rest of the same scroll, reached by the second action.

## The host scale

The playground draws with `@quillmark/svelte/preset`, the same import a third-party consumer makes, so it looks like the endorsed version by construction. The preset carries the `--qmh-*` scale and the recipes, the workspace shell's shape among them; `playground.css` carries what the app adds on top and nothing the preset already has. The column the front page reads against is the preset's measure, so the width prose wraps at and the width a code sample is cut to are one number.

An app scale may not restate a name the preset defines, and two app scales may not mint one concept at two values ([ARCHITECTURE.md](../../../svelte/prose/canon/ARCHITECTURE.md) §Styling). A rung two app scales have to keep agreeing on is a rung the preset owns: the second rule holding is the signal to promote, not a state to rest in. A recipe is not the same case: two apps writing a rule that only looks alike is what a promotion has to rule out first, and the test is whether both would take the same edit.

A mounting site states only what the surface cannot, and most of that is `.qm-frame`'s and `.qm-split`'s rather than the route's: a track that may shrink below its content, an edge and a corner, and the clip that holds a surface to them, positioned so the clip reaches the surface's out-of-flow parts (one that resolves past the frame lands unclipped and extends the page's scroll past its own foot). The editor carries `.qm-pane` because it is mounted in a fixed height rather than a page, and the gutter, the tone, the desk and the tail are the surface's own (THEMING §"Drop it in").

The chrome around a mounted surface stays **plainer than the surface**, which is the most detailed thing on any route. Colour is spent on one thing, a boundary that failed; an open session takes no colour and no word, since the page it paints already shows it.

## The routes

Two, because the site has two readers.

- **`/`**: one scroll in two parts. The **first screen** is the thesis and two actions, held to the measure at the page's start edge and centred in the small viewport less the running head, so mobile chrome expanding cannot push the actions off the screen they are the point of. It mounts nothing and carries no step, so everything under it is under the fold. The **quickstart** is the second part, and the second action scrolls to it: one step per thing a consumer does, in two columns, prose and code down the reading column and the surfaces in what is left of the page, one band per surface rather than per step. It reads down the same column the thesis did, so the scroll moves down one column rather than across the page. The jump is animated, or what it lands on reads as a second page rather than the rest of this one (the document's `scroll-behavior`, in `chrome.css`; cut under reduced motion). The code and its output are read without scrolling between them, which is what the surface **sticking inside its band** buys: a reading column runs half again the height of the mount beside it, so a surface fixed at the band's top would have scrolled off by the step that describes it. Below the width that holds a measure and a surface abreast, the split stacks, each surface follows the steps that reach it, and there is nothing left to keep up with, so the stick goes. A step with no output of its own spends no width on one. Nothing is named over a mount: the step beside it sets the component in the same run, so a caption would be that name a second time. The numbered steps are the page's second heading level and carry no section title over them, the action that scrolled here having already said the word one would hold. What stands over the preview is the boundary's phase, and only while there is one; what stands under it is the click round-trip, the one claim in the column beside it that no sample can show. The samples are strings in `samples.ts`, one per step: a Svelte sample carries a `</script>` that would close the route's own script block, and a step's code is the value the tutorial edits.
- **`/playground`**: the reference split-pane shell, and the harness; its architecture is ARCHITECTURE §Playground's. It is a **workspace, not a page**, and the shape of one is `.qm-workspace`'s: the layout hands the route the viewport less the running head and it scrolls nowhere, so the panes hold still while their contents move. The shell is pinned at every width, and a gesture past the end of a pane stops there rather than chaining out to bounce the document. It carries **no title**: the running head spells the route and marks it current, so a display run under that is the word a third time, in the one place on the site where a band of height is a band the surfaces do not get. What stands there instead is the boundary's phase, and only while there is one — an open session says the rest by painting the page. The strip above them reads the bridge's outcomes back out, and carries the picker, the diagnostic injector and the download. That download is the one lane on this route the canvas paint does not run: `session.render` over the compiled snapshot the preview is already showing, one artifact where `pdf` is asked for and one per page where the raster formats are, so what leaves as a document is the PDF and the control is drawn where a backend writes one. Its outcome is read back out like every other hop — the bytes and what they cost, or what refused them — a harness that hands over a file and says nothing about it being one instrument short. The panes take `.qm-split`'s even tracks at the preset's own gap, each framed, which is the endorsed look unmodified: this route is what a consumer copying the shell gets. Under the preset's threshold the split shows one track and the `.qm-switch` band above it says which, so a narrow viewport gets a whole mount rather than two short ones; what the route holds is the number, and the reveal the bridge owes it: a hit crossing from the preview shows the editor as well as placing the caret in it. Both panes stay mounted at every width, the switch being CSS over an attribute rather than a branch in the markup, so neither surface loses its caret, its history or its scroll to a tap.

Both surfaces run on the front page too, each over its own document. No apply loop runs there, so one document across two steps would let typing in the editor desynchronize the page painted above it. `/playground` is where the two are wired together.

Two guardrails hold across both: the playground consumes only the public subpath API (a needed internal is an API gap to fix), and it stays a harness, not a product: no auth, persistence, or multi-doc management.

## Which quill, and what is seeded into it

The reference quill declares a field for every control and three card kinds, so the schema reaches the branches a harness is for. What a shipped quill asks of the surfaces is the other half, and `usaf_memo` is what asks it (`fixtures/Quiver.yaml`). So **which quill is a control**, at the end of `/playground`'s strip, where the seed variants below it are flags: the answer changes what both surfaces are, rather than reaching a branch a hand went looking for.

Picking tears the shell down and stands it back up, so one session is live at a time. The surfaces come down before their handles do. The readouts reset with them, each having named something in the document that went.

The strip is drawn from the moment the catalog is known rather than with the panes: the picker at its end is what opens them, and a control that goes while what it asked for loads is one a hand cannot get back to.

What is in the list is the **pack's call**, not the route's. `usaf_memo` is held at `0.0.0`, under the quiver's floor, so `--drafts` is what puts it in the served tree: `predev` asks for it, `prebuild` does not, and a deploy serves the reference quill alone. An axis holding one value is printed rather than offered, so a deploy's strip states the quill where a dev server's offers two.

Two branches are not a schema's to declare — a guidance channel a consumer supplies, and a card whose kind the schema cannot project — and those are **query flags on `/playground`**, read once per open and applied to the seeded document: `?tips`, `?foreign`. They carry no chrome, because the only reader is a hand driving the harness, and a switch for one would be a control on the landing page for everyone else.

`?foreign` reaches a second branch with it: the engine refuses a document holding a kind the schema does not declare, so the route opens without a session. The editor binds `doc` and `quill` and needs none, so the shell stands, the band says what refused, and the preview track waits — which is what makes the recovery shell reachable at all. The retype or delete it offers tries the open again.

## Quiver, not bundler

Every route opens its session over a quill from a **quiver**, not from the bundler: no Typst source or font bytes in the JS bundle. The front page opens the reference quill; `/playground` opens whichever its picker holds. This is the workspace's one edge to `@quillmark/quiver`; the library has none, so the app is where the two tiers meet.

One `Quiver` serves the page. Its quill cache is per canonical ref and lives as long as the quiver does, so a client-side navigation between routes reuses one materialization rather than paying for its own. Routes mint and free their own `Quill` from the tree the quiver hands back, so a route holds the handles it frees.

## Links

[ARCHITECTURE.md](../../../svelte/prose/canon/ARCHITECTURE.md) · [`THEMING.md`](../../../svelte/THEMING.md)
